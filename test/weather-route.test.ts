import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { test } from 'node:test';
import weatherRouter from '../src/routes/weather.route.ts';

test('GET /weather validates coordinates and returns weather for either query naming style', async () => {
  const localFetch = globalThis.fetch;
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENWEATHER_API_KEY;
  const originalUnits = process.env.OPENWEATHER_UNITS;
  process.env.OPENWEATHER_API_KEY = 'test-weather-key';
  process.env.OPENWEATHER_UNITS = 'metric';

  const app = express();
  app.use('/weather', weatherRouter);
  app.use('/recommend/weather', weatherRouter);
  const server = app.listen(0, '127.0.0.1');

  try {
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');

    const url = `http://127.0.0.1:${address.port}/weather`;
    const invalidResponse = await localFetch(url);
    assert.equal(invalidResponse.status, 400);
    assert.match((await invalidResponse.json()).message, /latitude와 longitude/);

    globalThis.fetch = async (input) => {
      const requestUrl = new URL(input.toString());
      assert.equal(requestUrl.searchParams.get('appid'), 'test-weather-key');
      return Response.json({
        city: { name: 'Seoul', timezone: 0 },
        list: [
          {
            dt: Math.floor(Date.now() / 1000),
            main: { temp: 18, feels_like: 17, humidity: 60 },
            weather: [{ description: '맑음' }],
            wind: { speed: 2 },
            pop: 0,
          },
        ],
      });
    };

    for (const [path, query] of [
      ['/weather', 'latitude=37.5665&longitude=126.978'],
      ['/recommend/weather', 'lat=37.5665&lon=126.978'],
    ] as const) {
      const response: Response = await localFetch(`http://127.0.0.1:${address.port}${path}?${query}`);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).location, 'Seoul');
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENWEATHER_API_KEY;
    else process.env.OPENWEATHER_API_KEY = originalApiKey;
    if (originalUnits === undefined) delete process.env.OPENWEATHER_UNITS;
    else process.env.OPENWEATHER_UNITS = originalUnits;

    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
