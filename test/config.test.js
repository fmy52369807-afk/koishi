const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const configPath = path.resolve(__dirname, '../external/arcueid-system/config.js');

function loadConfig(overrides) {
  const previous = new Map();
  for (const [name, value] of Object.entries(overrides)) {
    previous.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  delete require.cache[configPath];
  const loaded = require(configPath);
  for (const [name, value] of previous) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  delete require.cache[configPath];
  return loaded.config;
}

test('configuration falls back when numeric values are invalid', () => {
  const config = loadConfig({ API_TIMEOUT_MS: '0', RAG_TOP_K: '999', PROACTIVE_INITIAL_PROBABILITY: '1.2' });
  assert.equal(config.http.timeoutMs, 45000);
  assert.equal(config.rag.topK, 3);
  assert.equal(config.proactive.initialProbability, 0.2);
});

test('configuration normalizes URLs and deduplicates allowlists', () => {
  const config = loadConfig({
    DEEPSEEK_BASE_URL: 'https://example.invalid/v1///',
    ACTIVELINK_GROUP_IDS: '10001, 10002 10001',
    ACTIVELINK_PRIVATE_IDS: '20001 20001',
  });
  assert.equal(config.deepseek.chatUrl, 'https://example.invalid/v1/chat/completions');
  assert.deepEqual(config.proactive.groupIds, ['10001', '10002']);
  assert.deepEqual(config.proactive.privateIds, ['20001']);
});
