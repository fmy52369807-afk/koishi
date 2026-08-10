const test = require('node:test');
const assert = require('node:assert/strict');
const {
  addTextToTermIndex,
  buildTermIndex,
  candidateIndices,
  extractTerms,
} = require('../external/arcueid-system/rag-utils');

test('extracts Chinese n-grams and Latin identifiers', () => {
  const terms = extractTerms('Koishi 插件装配和 RAG 检索');
  assert.ok(terms.includes('koishi'));
  assert.ok(terms.includes('插件'));
  assert.ok(terms.includes('rag'));
});

test('candidate pruning ranks documents sharing more query terms', () => {
  const index = buildTermIndex([
    'Koishi 插件装配与 OneBot 适配器说明',
    'RAG 向量检索、候选裁剪与余弦相似度',
    'RAG 检索使用向量候选裁剪减少扫描范围',
  ]);
  const candidates = candidateIndices('RAG 向量检索候选裁剪', index, 2);
  assert.deepEqual(candidates, [1, 2]);
  assert.equal(candidateIndices('不存在的词汇', index, 2), null);
});

test('incremental indexing adds newly appended documents', () => {
  const index = buildTermIndex(['Koishi 插件装配']);
  addTextToTermIndex('RAG 向量索引增量写入', 1, index);

  assert.deepEqual(candidateIndices('RAG 向量索引', index, 3), [1]);
});
