import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import express from 'express';
import recommendationRouter from '../src/routes/recommendation.route.ts';

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7XkAAAAASUVORK5CYII=';
const png = Buffer.from(pngBase64, 'base64');
const recommendation = {
  closetItems: [{ category: '상의', color: '흰색', description: '긴팔 셔츠' }],
  suitability: {
    status: 'needs_adjustment',
    reason: '셔츠만으로는 쌀쌀한 아침저녁에 추울 수 있습니다.',
    concerns: ['체감 최저 기온 10°C에 대비한 겉옷이 필요합니다.'],
  },
  additionalItems: [
    {
      category: '아우터',
      name: '가디건',
      color: '남색',
      reason: '아침저녁에 보온을 더하고 일교차에 대응할 수 있습니다.',
      stylingTip: '흰색 셔츠 위에 걸치고 더워지면 벗어 휴대하세요.',
    },
    {
      category: '액세서리',
      name: '접이식 우산',
      color: '검정색',
      reason: '강수 확률이 70%이므로 비에 대비하기 좋습니다.',
      stylingTip: '작게 접어 가방에 넣어 두세요.',
    },
  ],
  outfits: [
    {
      name: '가디건을 더한 코디',
      items: ['사진의 흰색 긴팔 셔츠', '추가 추천: 남색 가디건'],
      reason: '일교차에 따라 가디건을 입고 벗을 수 있습니다.',
      tips: '비에 대비해 우산을 챙기세요.',
    },
  ],
  weatherAdvice: '아침저녁 일교차와 비에 대비하세요.',
};

function outfitForm(latitude = '37.5665', longitude = '126.978', imageFirst = false): FormData {
  const form = new FormData();
  const appendImage = () => form.append('image', new Blob([Uint8Array.from(png)], { type: 'image/png' }), 'outfit.png');
  if (imageFirst) appendImage();
  form.append('latitude', latitude);
  form.append('longitude', longitude);
  if (!imageFirst) appendImage();
  return form;
}

function forecast(): Response {
  const now = Math.floor(Date.now() / 1000);
  const laterToday = now + Math.min(10_800, Math.max(0, 86_400 - (now % 86_400) - 1));
  return Response.json({
    city: { name: 'Seoul', timezone: 0 },
    list: [
      {
        dt: now,
        main: { temp: 12, feels_like: 10, humidity: 50 },
        weather: [{ description: '약한 비' }],
        wind: { speed: 2 },
        pop: 0.7,
      },
      {
        dt: laterToday,
        main: { temp: 20, feels_like: 19, humidity: 70 },
        weather: [{ description: '약한 비' }],
        wind: { speed: 5 },
        pop: 0.4,
      },
    ],
  });
}

function completion(content: unknown): Response {
  return Response.json({ choices: [{ message: { content: JSON.stringify(content) } }] });
}

test('POST /recommendations/outfit evaluates the uploaded outfit with location weather and suggests additional items', async (t) => {
  const localFetch = globalThis.fetch;
  const environmentKeys = [
    'MODEL_API_KEY',
    'MODEL_NAME',
    'OPENWEATHER_API_KEY',
    'OPENWEATHER_UNITS',
    'OPENWEATHER_LANG',
    'FIREBASE_CONFIG',
    'DATABASE_URL',
  ];
  const environment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of environment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  for (const key of environmentKeys) delete process.env[key];
  process.env.MODEL_API_KEY = 'test-meta-key';
  process.env.OPENWEATHER_API_KEY = 'test-weather-key';
  process.env.OPENWEATHER_UNITS = 'metric';
  process.env.OPENWEATHER_LANG = 'kr';

  const unexpectedFetch = t.mock.method(globalThis, 'fetch', async () => {
    assert.fail('Invalid input must not call the weather or model provider');
  });
  t.mock.method(console, 'error', () => {});
  const app = express();
  app.use('/recommendations', recommendationRouter);
  const server = app.listen(0, '127.0.0.1');
  t.after(async () => {
    if (!server.listening) return;
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/recommendations/outfit`;
  const upload = (form = outfitForm()) => localFetch(url, { method: 'POST', body: form });

  await t.test(
    'passes server weather and real image bytes in one model request regardless of form field order',
    async (t) => {
      const calls: string[] = [];
      t.mock.method(globalThis, 'fetch', async (input, init) => {
        const providerUrl = new URL(input.toString());
        calls.push(providerUrl.hostname);
        if (providerUrl.hostname === 'api.openweathermap.org') {
          assert.equal(providerUrl.searchParams.get('lat'), '37.5665');
          assert.equal(providerUrl.searchParams.get('lon'), '126.978');
          assert.equal(providerUrl.searchParams.get('appid'), 'test-weather-key');
          return forecast();
        }
        assert.equal(providerUrl.href, 'https://api.meta.ai/v1/chat/completions');
        assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-meta-key');
        const body = JSON.parse(String(init?.body));
        assert.equal(body.reasoning_effort, 'low');
        const userContent = body.messages[1].content;
        assert.equal(userContent[1].image_url.url, `data:image/png;base64,${pngBase64}`);
        const weatherPrompt = userContent[0].text;
        for (const value of ['Seoul', '약한 비', '12~20°C', '10~19°C', '60%', '5 m/s', '70%']) {
          assert.ok(weatherPrompt.includes(value), `Model prompt must include normalized weather ${value}`);
        }
        assert.equal(body.response_format.type, 'json_schema');
        assert.ok(body.response_format.json_schema.schema.required.includes('suitability'));
        assert.ok(body.response_format.json_schema.schema.required.includes('additionalItems'));
        return completion(recommendation);
      });

      for (const imageFirst of [false, true]) {
        const response = await upload(outfitForm('37.5665', '126.978', imageFirst));
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.deepEqual(body, {
          weather: {
            location: 'Seoul',
            date: new Date().toISOString().slice(0, 10),
            description: '약한 비',
            minTemperature: 12,
            maxTemperature: 20,
            feelsLikeMin: 10,
            feelsLikeMax: 19,
            humidity: 60,
            maxWindSpeed: 5,
            precipitationProbability: 70,
            temperatureUnit: '°C',
            windSpeedUnit: 'm/s',
          },
          ...recommendation,
        });
      }
      assert.deepEqual(calls, ['api.openweathermap.org', 'api.meta.ai', 'api.openweathermap.org', 'api.meta.ai']);
    }
  );

  const invalidForms = [
    {
      name: 'missing latitude',
      form: () => {
        const form = outfitForm();
        form.delete('latitude');
        return form;
      },
    },
    {
      name: 'missing longitude',
      form: () => {
        const form = outfitForm();
        form.delete('longitude');
        return form;
      },
    },
    { name: 'blank coordinate', form: () => outfitForm(' ') },
    { name: 'non-numeric coordinate', form: () => outfitForm('seoul') },
    { name: 'latitude outside its range', form: () => outfitForm('90.01') },
    { name: 'longitude outside its range', form: () => outfitForm('37', '-180.01') },
    {
      name: 'missing image',
      form: () => {
        const form = outfitForm();
        form.delete('image');
        return form;
      },
    },
    {
      name: 'spoofed image bytes',
      form: () => {
        const form = outfitForm();
        form.set('image', new Blob(['text'], { type: 'image/png' }), 'fake.png');
        return form;
      },
    },
    {
      name: 'multiple images',
      form: () => {
        const form = outfitForm();
        form.append('image', new Blob([Uint8Array.from(png)], { type: 'image/png' }), 'second.png');
        return form;
      },
    },
    {
      name: 'duplicate coordinates',
      form: () => {
        const form = outfitForm();
        form.append('latitude', '38');
        return form;
      },
    },
  ];
  for (const fixture of invalidForms) {
    await t.test(`rejects ${fixture.name} before requesting either provider`, async () => {
      const response = await upload(fixture.form());
      assert.equal(response.status, 400);
      assert.equal(typeof (await response.json()).message, 'string');
    });
  }

  await t.test('rejects a file above 8 MiB before requesting either provider', async () => {
    const form = outfitForm();
    const bytes = Buffer.alloc(8 * 1024 * 1024 + 1);
    png.copy(bytes);
    form.set('image', new Blob([bytes], { type: 'image/png' }), 'large.png');
    const response = await upload(form);
    assert.equal(response.status, 413);
  });

  await t.test('accepts inclusive coordinate boundaries and an image of exactly 8 MiB', async (t) => {
    t.mock.method(globalThis, 'fetch', async (input) => {
      const providerUrl = new URL(input.toString());
      if (providerUrl.hostname === 'api.openweathermap.org') {
        assert.equal(providerUrl.searchParams.get('lat'), '-90');
        assert.equal(providerUrl.searchParams.get('lon'), '180');
        return forecast();
      }
      assert.equal(providerUrl.hostname, 'api.meta.ai');
      return completion({
        ...recommendation,
        weather: { location: 'fabricated model weather' },
        providerInternalData: 'must not be returned',
      });
    });
    const form = outfitForm('-90', '180');
    const bytes = Buffer.alloc(8 * 1024 * 1024);
    png.copy(bytes);
    form.set('image', new Blob([bytes], { type: 'image/png' }), 'limit.png');
    const response = await upload(form);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.weather.location, 'Seoul');
    assert.ok(!('providerInternalData' in body));
  });

  await t.test('returns unknown without invented recommendations when no clothes are visible', async (t) => {
    const noClothes = {
      closetItems: [],
      suitability: { status: 'unknown', reason: '사진에 옷이 없어 날씨 적합성을 판단할 수 없습니다.', concerns: [] },
      additionalItems: [],
      outfits: [],
      weatherAdvice: '비와 일교차가 예상됩니다.',
    };
    t.mock.method(globalThis, 'fetch', async (input) =>
      new URL(input.toString()).hostname === 'api.openweathermap.org' ? forecast() : completion(noClothes)
    );
    const response = await upload();
    assert.equal(response.status, 200);
    const { weather, ...result } = await response.json();
    assert.equal(weather.location, 'Seoul');
    assert.deepEqual(result, noClothes);
  });

  await t.test('stops before the model request when weather lookup fails', async (t) => {
    const providerFetch = t.mock.method(globalThis, 'fetch', async (input) => {
      assert.equal(new URL(input.toString()).hostname, 'api.openweathermap.org');
      return Response.json({ message: 'unavailable' }, { status: 500 });
    });
    const response = await upload();
    assert.equal(response.status, 502);
    assert.equal(providerFetch.mock.callCount(), 1);
  });

  await t.test('returns 503 for missing weather configuration without provider requests', async (t) => {
    delete process.env.OPENWEATHER_API_KEY;
    t.after(() => {
      process.env.OPENWEATHER_API_KEY = 'test-weather-key';
    });
    const response = await upload();
    assert.equal(response.status, 503);
  });

  const invalidRecommendations = [
    { name: 'missing suitability', value: () => ({ ...recommendation, suitability: undefined }) },
    {
      name: 'unsupported suitability status',
      value: () => ({ ...recommendation, suitability: { ...recommendation.suitability, status: 'perfect' } }),
    },
    {
      name: 'array-valued suitability status',
      value: () => ({ ...recommendation, suitability: { ...recommendation.suitability, status: ['suitable'] } }),
    },
    {
      name: 'empty suitability reason',
      value: () => ({ ...recommendation, suitability: { ...recommendation.suitability, reason: ' ' } }),
    },
    {
      name: 'invalid concern',
      value: () => ({ ...recommendation, suitability: { ...recommendation.suitability, concerns: [1] } }),
    },
    { name: 'missing additional items', value: () => ({ ...recommendation, additionalItems: undefined }) },
    {
      name: 'empty additional item name',
      value: () => ({ ...recommendation, additionalItems: [{ ...recommendation.additionalItems[0], name: ' ' }] }),
    },
    {
      name: 'more than five additional items',
      value: () => ({
        ...recommendation,
        additionalItems: Array.from({ length: 6 }, () => recommendation.additionalItems[0]),
      }),
    },
    { name: 'suitability without visible clothes', value: () => ({ ...recommendation, closetItems: [] }) },
    {
      name: 'invented additions without visible clothes',
      value: () => ({
        ...recommendation,
        closetItems: [],
        outfits: [],
        suitability: { status: 'unknown', reason: '확인 불가', concerns: [] },
      }),
    },
  ];
  for (const fixture of invalidRecommendations) {
    await t.test(`rejects model output with ${fixture.name}`, async (t) => {
      t.mock.method(globalThis, 'fetch', async (input) =>
        new URL(input.toString()).hostname === 'api.openweathermap.org' ? forecast() : completion(fixture.value())
      );
      const response = await upload();
      assert.equal(response.status, 502);
      assert.equal(typeof (await response.json()).message, 'string');
    });
  }

  for (const failure of [
    { name: 'model authentication failure', status: 503, modelResponse: () => Response.json({}, { status: 401 }) },
    {
      name: 'model timeout',
      status: 504,
      modelResponse: () => {
        throw new DOMException('timeout', 'TimeoutError');
      },
    },
  ]) {
    await t.test(`reports ${failure.name} after weather is fetched`, async (t) => {
      const calls: string[] = [];
      t.mock.method(globalThis, 'fetch', async (input) => {
        const hostname = new URL(input.toString()).hostname;
        calls.push(hostname);
        return hostname === 'api.openweathermap.org' ? forecast() : failure.modelResponse();
      });
      const response = await upload();
      assert.equal(response.status, failure.status);
      assert.deepEqual(calls, ['api.openweathermap.org', 'api.meta.ai']);
    });
  }

  assert.equal(unexpectedFetch.mock.callCount(), 0);
});
