import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import express from 'express';
import imageRouter from '../src/routes/image.route.ts';

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7XkAAAAASUVORK5CYII=';
const png = Buffer.from(pngBase64, 'base64');
const analysis = {
  summary: '흰색 긴팔 셔츠 한 벌이 보입니다.',
  closetItems: [{ category: '상의', color: '흰색', description: '단추와 칼라가 있는 긴팔 셔츠' }],
};

function imageForm(bytes: Uint8Array = png, mimeType = 'image/png', field = 'image'): FormData {
  const form = new FormData();
  form.append(field, new Blob([Uint8Array.from(bytes)], { type: mimeType }), 'clothes.png');
  return form;
}

function completion(content: unknown): Response {
  return Response.json({ choices: [{ message: { content: JSON.stringify(content) } }] });
}

test('POST /images/analyze uploads one image and handles validation and model failures without other services', async (t) => {
  const localFetch = globalThis.fetch;
  const environmentKeys = ['MODEL_API_KEY', 'MODEL_NAME', 'OPENWEATHER_API_KEY', 'FIREBASE_CONFIG', 'DATABASE_URL'];
  const environment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of environment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  for (const key of environmentKeys) delete process.env[key];
  process.env.MODEL_API_KEY = 'test-meta-key';

  const unexpectedFetch = t.mock.method(globalThis, 'fetch', async () => {
    assert.fail('Invalid requests must not call any external service');
  });
  const app = express();
  app.use('/images', imageRouter);
  const server = app.listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/images/analyze`;
  const upload = (form = imageForm()) => localFetch(url, { method: 'POST', body: form });

  await t.test('sends the actual image bytes with the configured credentials and returns the analysis', async (t) => {
    const modelFetch = t.mock.method(globalThis, 'fetch', async (input, init) => {
      assert.equal(input, 'https://api.meta.ai/v1/chat/completions');
      assert.equal(init?.method, 'POST');
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-meta-key');
      assert.equal(new Headers(init?.headers).get('content-type'), 'application/json');
      assert.ok(init?.signal instanceof AbortSignal);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, 'muse-spark-1.3');
      assert.equal(body.messages[1].content[1].image_url.url, `data:image/png;base64,${pngBase64}`);
      assert.equal(body.response_format.type, 'json_schema');
      assert.equal(body.response_format.json_schema.name, 'clothing_image_analysis');
      assert.deepEqual(body.response_format.json_schema.schema.required, ['summary', 'closetItems']);
      return completion(analysis);
    });

    const response = await upload();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), analysis);
    assert.equal(modelFetch.mock.callCount(), 1);
  });

  await t.test('supports MODEL_NAME and returns an empty list when no clothes can be identified', async (t) => {
    process.env.MODEL_NAME = 'test-vision-model';
    t.after(() => delete process.env.MODEL_NAME);
    const noClothes = { summary: '사진에서 옷을 확인할 수 없습니다.', closetItems: [] };
    t.mock.method(globalThis, 'fetch', async (_input, init) => {
      assert.equal(JSON.parse(String(init?.body)).model, 'test-vision-model');
      return completion(noClothes);
    });

    const response = await upload();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), noClothes);
  });

  await t.test('accepts a file at the inclusive 8 MiB limit', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => completion(analysis));
    const bytes = Buffer.alloc(8 * 1024 * 1024);
    png.copy(bytes);
    const response = await upload(imageForm(bytes));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), analysis);
  });

  const invalidUploads = [
    { name: 'missing file', status: 400, form: () => new FormData() },
    { name: 'unsupported MIME type', status: 400, form: () => imageForm(png, 'image/gif') },
    { name: 'plain bytes labelled as PNG', status: 400, form: () => imageForm(Buffer.from('not an image')) },
    { name: 'wrong file field', status: 400, form: () => imageForm(png, 'image/png', 'photo') },
    {
      name: 'multiple files',
      status: 400,
      form: () => {
        const form = imageForm();
        form.append('image', new Blob([Uint8Array.from(png)], { type: 'image/png' }), 'second.png');
        return form;
      },
    },
    {
      name: 'file larger than 8 MiB',
      status: 413,
      form: () => {
        const bytes = Buffer.alloc(8 * 1024 * 1024 + 1);
        png.copy(bytes);
        return imageForm(bytes);
      },
    },
  ];
  for (const fixture of invalidUploads) {
    await t.test(`rejects ${fixture.name} before calling the model`, async () => {
      const response = await upload(fixture.form());
      assert.equal(response.status, fixture.status);
      assert.equal(typeof (await response.json()).message, 'string');
    });
  }

  await t.test('reports an unconfigured API key without making an external request', async (t) => {
    delete process.env.MODEL_API_KEY;
    t.after(() => {
      process.env.MODEL_API_KEY = 'test-meta-key';
    });
    const response = await upload();
    assert.equal(response.status, 503);
    assert.equal(typeof (await response.json()).message, 'string');
  });

  for (const upstreamStatus of [401, 403, 429, 500]) {
    await t.test(`maps provider HTTP ${upstreamStatus} without exposing its body`, async (t) => {
      t.mock.method(globalThis, 'fetch', async () =>
        Response.json({ message: 'private upstream detail' }, { status: upstreamStatus })
      );
      const response = await upload();
      assert.equal(response.status, upstreamStatus === 500 ? 502 : 503);
      const body = await response.json();
      assert.equal(typeof body.message, 'string');
      assert.doesNotMatch(body.message, /private upstream detail/);
    });
  }

  const malformedResponses = [
    { name: 'invalid response JSON', response: () => new Response('not JSON') },
    { name: 'null response envelope', response: () => Response.json(null) },
    { name: 'missing choices', response: () => Response.json({}) },
    { name: 'null first choice', response: () => Response.json({ choices: [null] }) },
    { name: 'null message', response: () => Response.json({ choices: [{ message: null }] }) },
    { name: 'invalid analysis JSON', response: () => Response.json({ choices: [{ message: { content: '{' } }] }) },
    { name: 'null analysis', response: () => completion(null) },
    { name: 'missing summary', response: () => completion({ closetItems: [] }) },
    { name: 'empty summary', response: () => completion({ summary: ' ', closetItems: [] }) },
    { name: 'invalid closet item', response: () => completion({ summary: '옷', closetItems: [{ category: 1 }] }) },
  ];
  for (const fixture of malformedResponses) {
    await t.test(`returns 502 for ${fixture.name}`, async (t) => {
      t.mock.method(globalThis, 'fetch', async () => fixture.response());
      const response = await upload();
      assert.equal(response.status, 502);
      assert.equal(typeof (await response.json()).message, 'string');
    });
  }

  await t.test('reports provider network failure', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => {
      throw new TypeError('private connection detail');
    });
    const response = await upload();
    assert.equal(response.status, 502);
    assert.doesNotMatch((await response.json()).message, /private connection detail/);
  });

  await t.test('reports provider timeout as 504 with a 30 second deadline', async (t) => {
    const deadline = t.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
      assert.equal(milliseconds, 30_000);
      return new AbortController().signal;
    });
    t.mock.method(globalThis, 'fetch', async () => {
      throw new DOMException('deadline exceeded', 'TimeoutError');
    });
    const response = await upload();
    assert.equal(response.status, 504);
    assert.equal(typeof (await response.json()).message, 'string');
    assert.equal(deadline.mock.callCount(), 1);
  });

  assert.equal(unexpectedFetch.mock.callCount(), 0);
});
