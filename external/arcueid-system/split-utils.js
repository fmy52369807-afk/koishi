function shouldSkipNaturalSplit(content) {
  return !content
    || content.includes('\u200B')
    || content.includes('[norender]')
    || content.includes('[语音]')
    || /data:image\/[a-z0-9.+-]+;base64,/i.test(content)
    || /base64:\/\//i.test(content)
    || /^file:\/\//i.test(content)
    || /https?:\/\//i.test(content)
    || /<[^>]+>/.test(content)
    || /```|^\s*(?:[-*]|\d+[.)、])/m.test(content);
}

function attachLooseExpression(parts) {
  const result = [];
  for (const part of parts) {
    if (/^\s*[\[【]表情[:：][^\]】]+[\]】]\s*$/.test(part) && result.length) {
      result[result.length - 1] += part.trim();
    } else {
      result.push(part);
    }
  }
  return result;
}

function splitNaturalChat(content, options) {
  const value = String(content || '').replace(/\s+/g, ' ').trim();
  if (value.length < options.naturalMinChars || value.length > options.naturalMaxChars) return [];

  let parts = value.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [];
  parts = attachLooseExpression(parts.map(part => part.trim()).filter(Boolean));

  if (parts.length === 1 && /[，,、]/.test(parts[0])) {
    const chunk = parts[0];
    const index = Math.max(chunk.lastIndexOf('，'), chunk.lastIndexOf(','), chunk.lastIndexOf('、'));
    const left = chunk.slice(0, index).trim();
    const right = chunk.slice(index + 1).trim();
    if (left.length >= 6 && right.length >= 6 && left.length <= options.naturalPartMaxChars && right.length <= options.naturalPartMaxChars) {
      parts = [left, right];
    }
  }

  if (parts.length < 2 || parts.length > 3) return [];
  if (parts.some(part => part.length < 2 || part.length > options.naturalPartMaxChars)) return [];
  return parts;
}

function preserveShortBurst(lines) {
  return lines.length >= 2
    && lines.length <= 3
    && lines.every(line => line.trim().length <= 30)
    && !lines.some(line => /^\s*(?:[-*]|\d+[.)、]|[一二三四五六七八九十]+[、.])/.test(line));
}

function mergeLines(rawLines, maxChars) {
  const lines = [];
  let currentChunk = '';
  for (const line of rawLines) {
    if (currentChunk.length + line.length > maxChars) {
      if (currentChunk) lines.push(currentChunk.trim());
      currentChunk = line;
    } else {
      currentChunk = currentChunk ? `${currentChunk} ${line}` : line;
    }
  }
  if (currentChunk) lines.push(currentChunk.trim());
  return lines;
}

module.exports = {
  mergeLines,
  preserveShortBurst,
  shouldSkipNaturalSplit,
  splitNaturalChat,
};
