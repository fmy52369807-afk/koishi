const test = require('node:test');
const assert = require('node:assert/strict');
const { requestWithRetry } = require('../external/arcueid-system/http-client');

test('retries transient failures with bounded attempts', async () => {
  let calls = 0;
  const ctx = {
    http: {
      async get() {
        calls += 1;
        if (calls === 1) {
          const error = new Error('temporarily unavailable');
          error.response = { status: 503 };
          throw error;
        }
        return { ok: true };
      },
    },
  };
  const result = await requestWithRetry(ctx, 'get', 'https://example.invalid', null, {}, { retries: 1, retryDelayMs: 1, timeout: 50 });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 2);
});

test('does not retry client errors', async () => {
  let calls = 0;
  const ctx = {
    http: {
      async post() {
        calls += 1;
        const error = new Error('invalid request');
        error.response = { status: 400 };
        throw error;
      },
    },
  };
  await assert.rejects(
    requestWithRetry(ctx, 'post', 'https://example.invalid', {}, {}, { retries: 3, retryDelayMs: 1 }),
    /invalid request/,
  );
  assert.equal(calls, 1);
});
