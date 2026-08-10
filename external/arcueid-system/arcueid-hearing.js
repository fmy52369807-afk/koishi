const { h } = require('koishi')
const { config } = require('./config')
const { errorSummary, requestWithRetry } = require('./http-client')

module.exports.name = 'arcueid-hearing'

module.exports.apply = (ctx) => {
  const logger = ctx.logger('听觉神经')

  // 🔮 记得填入你的 API Key！
  const ASR_API_KEY = config.siliconFlow.apiKey

  if (!ASR_API_KEY) {
    logger.warn('SILICONFLOW_API_KEY 未配置，语音转写功能将不可用。')
  }

  ctx.middleware(async (session, next) => {
    // 1. 扩大感知范围：优先看当前消息有没有语音，如果没有，就去翻看“被引用的历史消息”
    let targetContent = session.content
    let isReply = false

    if (!/<audio /i.test(targetContent) && session.quote && session.quote.content) {
      if (/<audio /i.test(session.quote.content)) {
        targetContent = session.quote.content
        isReply = true
        logger.info('【听觉感知】志贵通过“回复”功能指引了一段语音！')
      }
    }

    // 在确定的目标内容中寻找下载链接
    const audioMatch = targetContent.match(/<audio src="([^"]+)"/i)

    if (audioMatch && audioMatch[1]) {
      const audioUrl = audioMatch[1].replace(/&amp;/g, '&')
      logger.info('【听觉感知】检测到语音消息，准备转写。')

      if (!ASR_API_KEY) {
        if (isReply) {
          session.content += `\n[系统提示：志贵让你听一段语音，但语音转写服务还没有配置。]\n`
        } else {
          session.content = session.content.replace(/<audio[^>]+>/ig, `\n[系统提示：志贵发了一段语音，但语音转写服务还没有配置。]\n`)
        }
        return next()
      }

      try {
        const audioBuffer = await requestWithRetry(ctx, 'get', audioUrl, null, { responseType: 'arraybuffer' }, {
          timeout: config.siliconFlow.timeoutMs,
          retries: config.http.retries,
          retryDelayMs: config.http.retryDelayMs,
        })
        
        if (audioBuffer.byteLength === 0) {
          throw new Error('下载到的语音文件是空的！')
        }

        const form = new FormData()
        const blob = new Blob([audioBuffer], { type: 'audio/wav' })
        form.append('file', blob, 'voice.wav')
        form.append('model', config.siliconFlow.asrModel)

        const response = await requestWithRetry(ctx, 'post', config.siliconFlow.asrUrl, form, {
          headers: {
            'Authorization': `Bearer ${ASR_API_KEY}`
          }
        }, {
          timeout: config.siliconFlow.timeoutMs,
          retries: config.http.retries,
          retryDelayMs: config.http.retryDelayMs,
        })

        const text = response.text || ''
        logger.info(`【听觉转译成功】志贵的原话是: "${text}"`)

        // 2. 🗡️ 完美缝合：根据触发方式，给大脑注入不同的场景提示
        if (isReply) {
          // 如果是回复，就在你的 @ 消息后面，悄悄把语音内容补上
          session.content += `\n[系统听觉转译：志贵让你听了上面那段语音，语音的内容是：“${text}”]\n`
        } else {
          // 如果是直接发，就替换掉原本的录音代码
          session.content = session.content.replace(/<audio[^>]+>/ig, `\n[系统听觉转译：志贵发来了一段语音，他对你说：“${text}”]\n`)
        }

      } catch (err) {
        logger.error(`【听觉受阻】底层拒绝原因: ${errorSummary(err)}`)
        
        if (isReply) {
          session.content += `\n[系统提示：志贵让你听一段语音，但你的听觉神经受到了干扰，没听清。]\n`
        } else {
          session.content = session.content.replace(/<audio[^>]+>/ig, `\n[系统提示：志贵发了一段语音，但你的听觉神经受到了干扰，没听清。]\n`)
        }
      }
    }

    return next()
  }, true)
}
