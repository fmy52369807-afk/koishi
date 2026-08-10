const { h } = require('koishi')
const { config } = require('./config')
const { errorSummary, requestWithRetry } = require('./http-client')

module.exports.name = 'arcueid-custom-tts'

module.exports.apply = (ctx) => {
  const logger = ctx.logger('声音炼金')

  const apiBaseUrl = config.tts.apiBaseUrl
  const refAudioPath = config.tts.refAudioPath
  const promptText = config.tts.promptText
  const promptLang = config.tts.promptLang
  const textLang = config.tts.textLang

  if (!apiBaseUrl) {
    logger.warn('TTS_API_URL 未配置，语音功能将不可用。')
  }

  // 👇 最高优先级法阵
  ctx.on('before-send', async (session) => {
    if (!session.content || session.content.includes('[norender]') || session.content.includes('\u200B')) return
    if (/<(?:img|image|audio|video|file)\b/i.test(session.content) || /data:image\/[a-z0-9.+-]+;base64,/i.test(session.content) || /base64:\/\//i.test(session.content)) return

    logger.info(`【神经接入】检测到信号: "${String(session.content).slice(0, 120)}"`)

    if (!session.content.includes('[语音]')) {
      // 如果大脑没有给出 [语音] 指令，就直接跳过炼金，正常发送纯文字
      return 
    }

    // 既然决定要发语音了，先把这个用来当开关的 [语音] 标签抹除，免得被读出来
    session.content = session.content.replace(/\[语音\]/g, '')

    // 🗡️ 抹除乱码表情包
    session.content = session.content.replace(/\[face:[^\]]+\]/g, '')
    // 🗡️ 点石成金：还原被转义的艾特
    session.content = session.content.replace(/(?:&lt;|<)at id="?(\d+)"?\/?(?:&gt;|>)/g, (match, id) => {
      return h('at', { id }).toString()
    })

    // 1. 究极净化：提取纯净的发音文本
    const cleanText = session.content
      .replace(/(<[^>]+>)/g, '')
      .replace(/([\[【]表情[:：]([^\]】]+)[\]】])/g, '')
      .trim()

    if (!cleanText) {
      logger.info('【拦截】剔除杂质后无有效文本，保持安静。')
      return
    }

    try {
      if (!apiBaseUrl) {
        logger.warn('【语音跳过】TTS_API_URL 未配置。')
        return
      }

      logger.info(`【启动法阵】大脑已下达发声指令，正在请求语音: "${cleanText}"`)

      const url = new URL(apiBaseUrl)
      url.searchParams.append('text', cleanText)
      url.searchParams.append('text_lang', textLang)
      url.searchParams.append('ref_audio_path', refAudioPath)
      url.searchParams.append('prompt_lang', promptLang)
      url.searchParams.append('prompt_text', promptText)

      const buffer = await requestWithRetry(ctx, 'get', url.toString(), null, {
        responseType: 'arraybuffer',
        proxy: false
      }, {
        timeout: config.tts.timeoutMs,
        retries: config.http.retries,
        retryDelayMs: config.http.retryDelayMs,
      })

      const buf = Buffer.from(buffer)

      logger.info(`【降神成功】声音已就绪，正在抹除原始文字，发射纯语音！`)
      session.content = h.audio(buf, 'audio/wav').toString()

    } catch (err) {
      logger.error(`【严重断线】回路短路: ${errorSummary(err)}`)
    }
  }, true)
}
