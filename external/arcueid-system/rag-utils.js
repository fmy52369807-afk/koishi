const GENERIC_TERMS = new Set([
  '这个', '那个', '什么', '怎么', '为什么', '如何', '是否', '是不是', '可以', '知道',
  '介绍', '解释', '内容', '资料', '问题', '一下', '一些', '一个', '一种', '这里',
  '那里', '我们', '你们', '他们', '她们', '以及', '因为', '所以', '但是', '不过',
  '如果', '然后', '比较', '相关', '关于', '系统', '用户', '志贵',
]);

function extractTerms(text, maxTerms = 240) {
  const value = String(text || '').toLowerCase();
  const terms = new Set();

  for (const match of value.matchAll(/[a-z0-9][a-z0-9_.-]{1,31}/gi)) {
    const token = match[0];
    if (!/^\d+$/.test(token)) terms.add(token);
    if (terms.size >= maxTerms) return [...terms];
  }

  const chineseChunks = value
    .replace(/[^\u4e00-\u9fff]+/g, ' ')
    .split(/\s+/)
    .map(part => part.trim())
    .filter(Boolean);

  for (const chunk of chineseChunks) {
    if (chunk.length >= 2 && chunk.length <= 12 && !GENERIC_TERMS.has(chunk)) {
      terms.add(chunk);
      if (terms.size >= maxTerms) return [...terms];
    }

    const maxGram = Math.min(4, chunk.length);
    for (let n = 2; n <= maxGram; n++) {
      for (let i = 0; i <= chunk.length - n; i++) {
        const term = chunk.slice(i, i + n);
        if (!GENERIC_TERMS.has(term)) terms.add(term);
        if (terms.size >= maxTerms) return [...terms];
      }
    }
  }

  return [...terms];
}

function buildTermIndex(texts, maxTerms = 240) {
  const index = new Map();
  texts.forEach((text, itemIndex) => {
    addTextToTermIndex(text, itemIndex, index, maxTerms);
  });
  return index;
}

function addTextToTermIndex(text, itemIndex, index, maxTerms = 240) {
  for (const term of extractTerms(text, maxTerms)) {
    if (!index.has(term)) index.set(term, new Set());
    index.get(term).add(itemIndex);
  }
  return index;
}

function candidateIndices(query, index, maxCandidates, maxQueryTerms = 80) {
  if (!maxCandidates || maxCandidates <= 0 || !index?.size) return null;

  const counts = new Map();
  for (const term of extractTerms(query, maxQueryTerms)) {
    const bucket = index.get(term);
    if (!bucket) continue;
    for (const itemIndex of bucket) counts.set(itemIndex, (counts.get(itemIndex) || 0) + 1);
  }

  if (!counts.size) return null;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxCandidates)
    .map(([itemIndex]) => itemIndex);
}

module.exports = { addTextToTermIndex, buildTermIndex, candidateIndices, extractTerms };
