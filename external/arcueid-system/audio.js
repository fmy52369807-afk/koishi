const { h } = require('koishi')

module.exports.name = 'arcueid-custom-tts'

module.exports.apply = (ctx) => {
  const logger = ctx.logger('声音炼金')

  const apiBaseUrl = process.env.TTS_API_URL
  const refAudioPath = process.env.TTS_REF_AUDIO_PATH || 'E:\\game\\voice-queen\\ar.mp3'
  const promptText = process.env.TTS_PROMPT_TEXT || '你可以叫我帕朵，也可以叫我菲利斯，随你喜欢，哪个都行。'
  const promptLang = process.env.TTS_PROMPT_LANG || 'zh'
  const textLang = process.env.TTS_TEXT_LANG || 'zh'

  if (!apiBaseUrl) {
    logger.warn('TTS_API_URL 未配置，语音功能将不可用。')
  }

  // 👇 最高优先级法阵
  ctx.on('before-send', async (session) => {
    logger.info(`【神经接入】检测到信号: "${session.content}"`)

    if (!session.content || session.content.includes('[norender]') || session.content.includes('\u200B')) return

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

      const buffer = await ctx.http.get(url.toString(), { 
        responseType: 'arraybuffer',
        proxy: false
      })
      
      const buf = Buffer.from(buffer)

      logger.info(`【降神成功】声音已就绪，正在抹除原始文字，发射纯语音！`)
      session.content = h.audio(buf, 'audio/wav').toString()

    } catch (err) {
      logger.error('【严重断线】回路短路:', err.message)
    }
  }, true)
}
