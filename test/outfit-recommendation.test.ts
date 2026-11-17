import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recommendOutfits } from '../src/services/outfit.recommendation.service.ts';
import { getTodayWeather } from '../src/services/weather.service.ts';

function restoreEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

test('builds today weather from the forecast in the location timezone', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENWEATHER_API_KEY;
  const originalUnits = process.env.OPENWEATHER_UNITS;
  const originalLanguage = process.env.OPENWEATHER_LANG;

  process.env.OPENWEATHER_API_KEY = 'test-weather-key';
  process.env.OPENWEATHER_UNITS = 'metric';
  process.env.OPENWEATHER_LANG = 'kr';

  const now = Math.floor(Date.now() / 1000);
  const secondsUntilTomorrow = 86_400 - (now % 86_400);
  const laterToday = now + Math.min(10_800, Math.max(0, secondsUntilTomorrow - 1));
  globalThis.fetch = async (input) => {
    const url = new URL(input.toString());
    assert.equal(url.pathname, '/data/2.5/forecast');
    assert.equal(url.searchParams.get('lat'), '37.5665');
    assert.equal(url.searchParams.get('lon'), '126.978');
    assert.equal(url.searchParams.get('units'), 'metric');
    assert.equal(url.searchParams.get('lang'), 'kr');
    assert.equal(url.searchParams.get('appid'), 'test-weather-key');

    return new Response(
      JSON.stringify({
        city: { name: 'Seoul', timezone: 0 },
        list: [
          {
            dt: now,
            main: { temp: 18, feels_like: 16, humidity: 60 },
            weather: [{ description: '맑음' }],
            wind: { speed: 2 },
            pop: 0.1,
          },
          {
            dt: laterToday,
            main: { temp: 22, feels_like: 21, humidity: 70 },
            weather: [{ description: '맑음' }],
            wind: { speed: 4 },
            pop: 0.4,
          },
        ],
      })
    );
  };

  try {
    const weather = await getTodayWeather(37.5665, 126.978);
    assert.equal(weather.location, 'Seoul');
    assert.equal(weather.minTemperature, 18);
    assert.equal(weather.maxTemperature, 22);
    assert.equal(weather.precipitationProbability, 40);
    assert.equal(weather.description, '맑음');
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment('OPENWEATHER_API_KEY', originalApiKey);
    restoreEnvironment('OPENWEATHER_UNITS', originalUnits);
    restoreEnvironment('OPENWEATHER_LANG', originalLanguage);
  }
});

test('reports the upstream reason when the weather provider returns 404', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENWEATHER_API_KEY;
  process.env.OPENWEATHER_API_KEY = 'test-weather-key';
  globalThis.fetch = async () => Response.json({ cod: '404', message: 'city not found' }, { status: 404 });

  try {
    await assert.rejects(getTodayWeather(37.5665, 126.978), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal('statusCode' in error ? error.statusCode : undefined, 502);
      assert.match(error.message, /city not found/);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment('OPENWEATHER_API_KEY', originalApiKey);
  }
});

test('sends the outfit image and weather to Meta and parses suitability and additional item recommendations', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.MODEL_API_KEY;
  process.env.MODEL_API_KEY = 'test-meta-key';

  const recommendation = {
    closetItems: [{ category: '상의', color: '흰색', description: '긴팔 셔츠' }],
    suitability: {
      status: 'needs_adjustment',
      reason: '낮에는 괜찮지만 체감 기온이 낮아지는 아침저녁에는 겉옷이 필요합니다.',
      concerns: ['체감 최저 6°C에는 셔츠만으로 추울 수 있습니다.'],
    },
    additionalItems: [
      {
        category: '아우터',
        name: '가디건',
        color: '남색',
        reason: '쌀쌀한 아침저녁에 보온을 더할 수 있습니다.',
        stylingTip: '흰색 셔츠 위에 걸치고 낮에는 벗어 휴대하세요.',
      },
    ],
    outfits: [
      {
        name: '가벼운 출근 코디',
        items: ['흰색 긴팔 셔츠'],
        reason: '선선한 날씨에 적당합니다.',
        tips: '기온이 내려가면 겉옷을 더하세요.',
      },
    ],
    weatherAdvice: '아침저녁 기온 차에 대비하세요.',
  };

  globalThis.fetch = async (input, init) => {
    assert.equal(input, 'https://api.meta.ai/v1/chat/completions');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-meta-key');

    const requestBody = JSON.parse(String(init?.body)) as {
      model: string;
      messages: Array<{
        content: string | Array<{ type: string; image_url?: { url: string }; text?: string }>;
      }>;
      response_format: { type: string; json_schema: { name: string } };
    };
    assert.equal(requestBody.model, 'muse-spark-1.3');
    const userContent = requestBody.messages[1]?.content;
    assert.ok(Array.isArray(userContent));
    assert.equal(userContent[1]?.image_url?.url, 'data:image/jpeg;base64,Y2xvc2V0');
    assert.equal(userContent[0]?.type, 'text');
    assert.match(userContent[0]?.text ?? '', /Seoul/);
    assert.match(userContent[0]?.text ?? '', /8~15°C/);
    assert.match(userContent[0]?.text ?? '', /6~14°C/);
    assert.match(userContent[0]?.text ?? '', /20%/);
    assert.equal(requestBody.response_format.type, 'json_schema');
    assert.equal(requestBody.response_format.json_schema.name, 'outfit_recommendation');

    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(recommendation) } }],
      })
    );
  };

  try {
    const result = await recommendOutfits(Buffer.from('closet'), 'image/jpeg', {
      location: 'Seoul',
      date: '2026-11-16',
      description: '맑음',
      minTemperature: 8,
      maxTemperature: 15,
      feelsLikeMin: 6,
      feelsLikeMax: 14,
      humidity: 55,
      maxWindSpeed: 3,
      precipitationProbability: 20,
      temperatureUnit: '°C',
      windSpeedUnit: 'm/s',
    });

    assert.deepEqual(result, recommendation);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment('MODEL_API_KEY', originalApiKey);
  }
});
