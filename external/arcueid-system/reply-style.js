const DEFAULT_OPENINGS = [
  /^你们刚才/,
  /^你刚才/,
  /^我看到/,
  /^有人提到/,
  /^关于/,
  /^听起来你们/,
  /^听起来你/,
  /^总结一下/,
  /^从聊天记录/,
  /^根据聊天记录/,
  /^简单来说/,
  /^总的来说/,
]

const INTERNAL_META_PATTERNS = [
  /^(关键词|关键字|话题|主题|切入口|回复|最终回复|可回复|回应方向|发言策略)\s*[:：]/i,
  /^(可以回复|可以接|适合回复|适合插话|不适合回复|判断|结论)\s*[:：]/i,
  /^(选择|切入)\s*(最后|第)?\s*\d*\s*(条|句)?\s*[:：]/i,
]

function stripFormatting(text) {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<output[^>]*>|<\/output>|<message[^>]*>|<\/message>/gi, '')
    .replace(/^\s*[\-*>#`]+/gm, '')
    .replace(/\r/g, '')
    .trim()
}

function isInternalMetaReply(text) {
  const value = stripFormatting(text).trim()
  if (!value) return false

  const firstLine = value.split('\n').map(s => s.trim()).filter(Boolean)[0] || ''
  if (INTERNAL_META_PATTERNS.some(pattern => pattern.test(firstLine))) return true

  const compact = firstLine.replace(/\s+/g, '')
  if (/^(关键词|关键字|话题|主题|切入口)[：:]/i.test(compact)) return true
  if (/^(关键词|关键字|话题|主题|切入口)$/.test(compact)) return true

  return false
}

function buildReplyStyleInstruction(scene = 'default') {
  const base = [
    '你不是助手，不要像客服。',
    '默认短句接话，一次只回应一个重点。',
    '不要复述别人原话，不要总结聊天记录。',
    '不要使用“你刚才说/我看到/听起来/关于这个话题”这类 AI 感开头。',
    '如果不是用户明确要求解释、分析、写代码、列步骤、整理资料，就不要长篇展开。',
  ]

  if (scene === 'proactive') {
    base.unshift(
      '这是群聊里主动插话，不是正式回复。',
      '优先接最后 1 到 3 条里最自然的一个切入口，不要同时回应多个话题。',
      '回复通常 8 到 55 个汉字左右，但完整表达优先，不要为了满足字数把句子截断。'
    )
  } else if (scene === 'addressed') {
    base.unshift(
      '这是群里直接 @ 你 的消息。',
      '先用最短的话接住对方，再决定要不要补一句。',
      '通常 1 句就够；需要补充时可以说完整的第二句，用换行分开，像连发两条短消息。'
    )
  } else if (scene === 'reminder') {
    base.unshift(
      '这是提醒场景。',
      '只做自然确认，不要解释流程，不要复读提醒内容。'
    )
  } else if (scene === 'search') {
    base.unshift(
      '这是搜索问答场景。',
      '可以稍微解释，但先给结论，再补一句自然说明。'
    )
  }

  return `<system>\n${base.join('\n')}\n</system>`
}

function sanitizeReply(text, options = {}) {
  const {
    maxChars = 80,
    openings = DEFAULT_OPENINGS,
    singleLine = true,
  } = options

  let value = stripFormatting(text)
    .replace(/[“”"']/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!value) return ''

  if (isInternalMetaReply(value)) return ''

  if (singleLine) {
    value = value.split('\n').map(s => s.trim()).filter(Boolean)[0] || ''
  }

  if (!value) return ''

  for (const pattern of openings) {
    if (pattern.test(value)) return ''
  }

  const sentenceParts = value.split(/[。！？!?；;]/).map(s => s.trim()).filter(Boolean)
  const sentence = sentenceParts.length > 1 ? sentenceParts.slice(0, 2).join('，') : (sentenceParts[0] || value)
  value = sentence.replace(/[，,、]\s*$/, '').trim()

  if (!value) return ''
  if (value.length > maxChars) {
    const cut = value.slice(0, Math.max(0, maxChars - 1)).trim()
    return cut ? `${cut}…` : ''
  }

  return value
}

function analyzeChatStyle(history = []) {
  const recent = Array.isArray(history) ? history.slice(-20) : []
  const count = recent.length || 1
  let totalChars = 0
  let shortCount = 0
  let punctCount = 0
  let maxBurst = 1
  let burst = 1
  let prevUserId = null

  for (const item of recent) {
    const content = String(item?.content || '')
    const len = content.length
    totalChars += len
    if (len <= 12) shortCount += 1
    if (/[。！？!?；;…]$/.test(content)) punctCount += 1

    const userId = String(item?.userId || '')
    if (userId && userId === prevUserId) {
      burst += 1
    } else {
      burst = 1
      prevUserId = userId
    }
    if (burst > maxBurst) maxBurst = burst
  }

  const avgChars = totalChars / count
  const shortRate = shortCount / count
  const punctRate = punctCount / count
  const splitTendency = avgChars <= 28 || shortRate >= 0.3 || maxBurst >= 2

  let replyCount = 1
  if (recent.length >= 8 && splitTendency) replyCount = 2
  if ((avgChars <= 14 && shortRate >= 0.55 && maxBurst >= 2) || maxBurst >= 3) replyCount = 3

  return {
    avgChars,
    shortRate,
    punctRate,
    maxBurst,
    replyCount,
    splitTendency,
  }
}

module.exports = {
  buildReplyStyleInstruction,
  analyzeChatStyle,
  isInternalMetaReply,
  sanitizeReply,
}
