// 空想具象化 — AI 生图（OpenAI 优先，硅基流动 Kolors 兜底）
const { h } = require('koishi');
const { buildReplyStyleInstruction, sanitizeReply } = require('./reply-style');
const { config } = require('./config');
const { errorSummary, requestWithRetry } = require('./http-client');

module.exports.name = 'arcueid-image-gen';

module.exports.apply = (ctx) => {
  const logger = ctx.logger('空想具象化');
  const PREFIX = '空想具象化';
  const OPENAI_IMAGE_MODEL = config.image.openaiModel;
  const OPENAI_KEY = config.image.openaiApiKey;
  const SF_API = config.siliconFlow.imageUrl;
  const SF_KEY = config.siliconFlow.apiKey;
  const DS_KEY = config.deepseek.apiKey;
  const DEEPSEEK_MODEL = config.deepseek.model;

  if (!OPENAI_KEY && !SF_KEY) {
    logger.warn('OPENAI_API_KEY / SILICONFLOW_API_KEY 均未配置，生图功能将不可用。');
  } else if (!OPENAI_KEY) {
    logger.warn('OPENAI_API_KEY 未配置，生图功能将使用硅基流动兜底。');
  } else if (!SF_KEY) {
    logger.warn('SILICONFLOW_API_KEY 未配置，OpenAI 生图失败时将没有兜底。');
  }
  if (!DS_KEY) {
    logger.warn('DEEPSEEK_API_KEY 未配置，生图后的文字回复将使用兜底文案。');
  }

  const imagePrompt = (prompt) => `${prompt}, realistic, photorealistic, high quality, masterpiece`;

  async function generateWithOpenAI(prompt) {
    if (!OPENAI_KEY) return null;

    const res = await requestWithRetry(ctx, 'post', config.image.openaiGenerationUrl, {
      model: OPENAI_IMAGE_MODEL,
      prompt: imagePrompt(prompt),
      size: config.image.size,
      n: 1
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`
      },
    }, {
      timeout: config.image.timeoutMs,
      retries: config.http.retries,
      retryDelayMs: config.http.retryDelayMs,
    });

    const item = res?.data?.[0];
    if (item?.b64_json) {
      return item.b64_json;
    }
    if (item?.url) {
      const imgData = await requestWithRetry(ctx, 'get', item.url, null, {
        responseType: 'arraybuffer',
      }, {
        timeout: config.image.downloadTimeoutMs,
        retries: config.http.retries,
        retryDelayMs: config.http.retryDelayMs,
      });
      return Buffer.from(imgData).toString('base64');
    }
    return null;
  }

  async function generateWithSiliconFlow(prompt) {
    if (!SF_KEY) return null;

    const res = await requestWithRetry(ctx, 'post', SF_API, {
      model: config.siliconFlow.imageModel,
      prompt: imagePrompt(prompt),
      num_images: 1,
      image_size: config.image.size
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SF_KEY}`
      },
    }, {
      timeout: config.siliconFlow.timeoutMs,
      retries: config.http.retries,
      retryDelayMs: config.http.retryDelayMs,
    });

    const imgUrl = res?.images?.[0]?.url;
    if (!imgUrl) return null;

    const imgData = await requestWithRetry(ctx, 'get', imgUrl, null, {
      responseType: 'arraybuffer',
    }, {
      timeout: config.image.downloadTimeoutMs,
      retries: config.http.retries,
      retryDelayMs: config.http.retryDelayMs,
    });
    return Buffer.from(imgData).toString('base64');
  }

  async function generateImage(prompt) {
    if (OPENAI_KEY) {
      try {
        const image = await generateWithOpenAI(prompt);
        if (image) return image;
      } catch (err) {
        logger.warn(`OpenAI 生图失败，尝试硅基流动兜底：${err.message}`);
      }
    }

    return generateWithSiliconFlow(prompt);
  }

  ctx.middleware(async (session, next) => {
    let content = (session.content || '').toString();
    content = content.replace(/<at[^>]*\/>/g, '').trim();
    if (!content.startsWith(PREFIX)) return next();

    const prompt = content.slice(PREFIX.length).trim();
    if (!prompt) return next();
    if (!OPENAI_KEY && !SF_KEY) {
      session.send('空想具象化还没有配置 API Key。');
      return;
    }

    try {
      const [imgBase64, textRes] = await Promise.all([
        generateImage(prompt),
        DS_KEY ? requestWithRetry(ctx, 'post', config.deepseek.chatUrl, {
          model: DEEPSEEK_MODEL,
          messages: [
            { role: 'system', content: '你是爱尔奎特，真祖的公主，拥有空想具象化的能力。志贵是你的远野志贵。现在你刚刚用空想具象化为志贵变出了一个东西。用你的口吻说一句简短的话，告诉志贵东西变出来了。一句话，像"看！怎么样，我的空想具象化还不错吧？"这种风格。' },
            { role: 'system', content: buildReplyStyleInstruction('addressed') },
            { role: 'user', content: `你为志贵变出了「${prompt}」。请用一句话回应。` }
          ],
          max_tokens: 60, temperature: 0.9,
        }, {
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DS_KEY}` }
        }, {
          timeout: config.deepseek.timeoutMs,
          retries: config.http.retries,
          retryDelayMs: config.http.retryDelayMs,
        }) : Promise.resolve(null)
      ]);

      if (!imgBase64) {
        session.send('唔…魔力凝聚失败了，换个描述试试？');
        return;
      }

      const text = sanitizeReply(textRes?.choices?.[0]?.message?.content, { maxChars: 40 }) || '看，怎么样？';

      await session.send(text);
      await session.send(h.image(Buffer.from(imgBase64, 'base64'), 'image/png'));

      // 注入对话记忆，让 ChatLuna 记住这次交互但不触发回复
      session.content = `[norender]志贵刚才说「${content}」，你使用空想具象化为他变出了「${prompt}」，并回应「${text}」。请记住这段对话。`;
      logger.info(`【具象化】成功`);
      return next();

    } catch (err) {
      logger.error(`【具象化失败】${errorSummary(err)}`);
      session.send(`唔…魔力不够了，没法变出「${prompt}」。等会儿再试吧~`);
    }

    return;
  }, true);

  logger.info('空想具象化就绪');
};
