const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeLines, preserveShortBurst, shouldSkipNaturalSplit, splitNaturalChat } = require('../external/arcueid-system/split-utils');

const options = {
  naturalMinChars: 10,
  naturalMaxChars: 110,
  naturalPartMaxChars: 45,
};

test('splits short natural chat without splitting structured content', () => {
  assert.deepEqual(splitNaturalChat('今天的测试都通过了。我们把结果写进演示文档吧！', options), ['今天的测试都通过了。', '我们把结果写进演示文档吧！']);
  assert.equal(shouldSkipNaturalSplit('https://example.invalid/docs'), true);
  assert.equal(shouldSkipNaturalSplit('[语音]你好'), true);
});

test('preserves conversational bursts and merges long line groups', () => {
  assert.equal(preserveShortBurst(['第一句', '第二句']), true);
  assert.equal(preserveShortBurst(['- 列表项', '第二句']), false);
  assert.deepEqual(mergeLines(['第一段', '第二段', '第三段很长'], 8), ['第一段 第二段', '第三段很长']);
});
