const { performance } = require('node:perf_hooks');
const process = require('node:process');

const root = require('node:path').resolve(__dirname, '..');
const { buildTermIndex, candidateIndices } = require('../external/arcueid-system/rag-utils');

function measure(label, operation) {
  const started = performance.now();
  const result = operation();
  return { label, durationMs: Number((performance.now() - started).toFixed(3)), result };
}

function coldRequire(relativePath) {
  const resolved = require.resolve(`${root}/${relativePath}`);
  delete require.cache[resolved];
  return measure(relativePath, () => require(resolved));
}

function main() {
  if (global.gc) global.gc();
  const before = process.memoryUsage();
  const modules = [
    coldRequire('external/arcueid-system/config.js'),
    coldRequire('external/arcueid-system/http-client.js'),
    coldRequire('external/arcueid-system/rag-utils.js'),
    coldRequire('external/arcueid-system/split-utils.js'),
  ];

  const texts = Array.from({ length: 3000 }, (_, index) => `文档 ${index}：Koishi 插件装配、RAG 候选裁剪、提醒持久化和公开作品演示。`);
  const indexBuild = measure('term-index-build-3000', () => buildTermIndex(texts));
  const query = measure('candidate-query', () => candidateIndices('Koishi RAG 候选裁剪提醒', indexBuild.result, 3000));
  if (global.gc) global.gc();
  const after = process.memoryUsage();

  const report = {
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    fixture: { documents: texts.length, query: 'Koishi RAG 候选裁剪提醒' },
    moduleLoadMs: Object.fromEntries(modules.map(item => [item.label, item.durationMs])),
    rag: {
      indexBuildMs: indexBuild.durationMs,
      candidateQueryMs: query.durationMs,
      candidates: query.result?.length || 0,
    },
    memoryMiB: {
      heapUsedBefore: Number((before.heapUsed / 1048576).toFixed(2)),
      heapUsedAfter: Number((after.heapUsed / 1048576).toFixed(2)),
    },
    note: 'This measures local module bootstrap and a synthetic, anonymized RAG candidate fixture. It does not start Koishi or connect to OneBot or external APIs.',
  };
  console.log(JSON.stringify(report, null, 2));
}

main();
