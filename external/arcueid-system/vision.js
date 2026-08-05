const { buildReplyStyleInstruction } = require('./reply-style');

module.exports.name = 'arcueid-vision';

module.exports.apply = (ctx) => {
  const logger = ctx.logger('视觉神经');
  const OPENAI_BASE_URL = (process.env.OPENAI_VISION_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini';
  const OPENAI_KEY = process.env.OPENAI_VISION_API_KEY
    || (/siliconflow\.cn/i.test(OPENAI_BASE_URL) ? process.env.SILICONFLOW_API_KEY : '')
    || process.env.OPENAI_API_KEY;
  const MAX_IMAGES = parseInt(process.env.VISION_MAX_IMAGES || '2', 10) || 2;
  const VISION_TIMEOUT_MS = parseInt(process.env.VISION_TIMEOUT_MS || '45000', 10) || 45000;
  const IMAGE_FETCH_TIMEOUT_MS = parseInt(process.env.VISION_IMAGE_FETCH_TIMEOUT_MS || '12000', 10) || 12000;
  const INLINE_REMOTE_IMAGES = /^true$/i.test(process.env.VISION_INLINE_REMOTE_IMAGES || '');

  if (!OPENAI_KEY) {
    logger.warn('OPENAI_VISION_API_KEY / SILICONFLOW_API_KEY / OPENAI_API_KEY 未配置，识图功能将不可用。');
  } else if (!process.env.OPENAI_VISION_API_KEY && /hikariapi\.xyz/i.test(OPENAI_BASE_URL)) {
    logger.warn('识图正在复用 OPENAI_API_KEY 与 Hikari 代理。如果这枚 key 是生图专用分组，视觉模型会调用失败；建议配置 OPENAI_VISION_API_KEY / OPENAI_VISION_BASE_URL。');
  }

  function groupIdOf(session) {
    const channelId = session.channelId || '';
    if (!channelId || channelId.startsWith('private:')) return '';
    if (session.guildId) return String(session.guildId);
    return channelId.includes(':') ? channelId.split(':')[0] : channelId;
  }

  function isGroup(session) {
    return Boolean(groupIdOf(session));
  }

  function isAddressingBot(session) {
    const content = String(session.content || '');
    const selfId = String(session.selfId || session.bot?.selfId || '');
    if (selfId) {
      const escaped = selfId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`<at\\s+[^>]*id=["']?${escaped}["']?`, 'i').test(content)) return true;
      if (new RegExp(`\\[CQ:at,[^\\]]*qq=${escaped}(?:,|\\])`, 'i').test(content)) return true;
    }

    return ['爱尔奎特', '公主'].some((name) => content.includes(name));
  }

  function decodeEntities(value) {
    return String(value || '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"');
  }

  function cleanText(content) {
    return decodeEntities(content)
      .replace(/<at[^>]*\/>/gi, '')
      .replace(/<img[^>]*>/gi, '')
      .replace(/\[CQ:image,[^\]]+\]/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function extractImageUrls(content) {
    const value = decodeEntities(content);
    const urls = [];

    for (const match of value.matchAll(/<img\b[^>]*(?:src|url)=["']([^"']+)["'][^>]*>/gi)) {
      urls.push(match[1]);
    }

    for (const match of value.matchAll(/\[CQ:image,([^\]]+)\]/gi)) {
      const attrs = {};
      for (const part of match[1].split(',')) {
        const index = part.indexOf('=');
        if (index <= 0) continue;
        attrs[part.slice(0, index)] = part.slice(index + 1);
      }
      if (attrs.url) {
        urls.push(attrs.url);
      } else if (attrs.file) {
        urls.push(`onebot-image-file:${attrs.file}`);
      }
    }

    return [...new Set(urls)]
      .filter(Boolean)
      .slice(0, Math.max(1, MAX_IMAGES));
  }

  async function getQuotedContent(session) {
    const direct = session.quote?.content
      || session.quote?.elements?.map?.((item) => item?.toString?.() || '').join('')
      || session.event?.message?.quote?.content
      || session.event?.quote?.content
      || '';
    if (direct) return direct;

    const quoteId = session.quote?.id
      || session.event?.message?.quote?.id
      || session.event?.quote?.id
      || session.event?.message?.quote?.messageId
      || '';
    if (!quoteId) return '';

    if (typeof session.bot.getMessage === 'function') {
      try {
        const msg = await session.bot.getMessage(session.channelId, quoteId);
        const content = msg?.content || msg?.message || '';
        if (content) {
          logger.info('【引用回溯】通过 Koishi bot.getMessage 取到引用消息。');
          return String(content);
        }
      } catch (err) {
        logger.debug(`Koishi 引用消息回溯失败：${err.message || err}`);
      }
    }

    if (!session.bot?.internal) return '';

    for (const method of ['getMsg', 'get_msg']) {
      if (typeof session.bot.internal[method] !== 'function') continue;
      try {
        const msg = await session.bot.internal[method](quoteId);
        const content = msg?.message || msg?.raw_message || msg?.content || '';
        if (content) {
          logger.info(`【引用回溯】通过 OneBot ${method} 取到引用消息。`);
          return String(content);
        }
      } catch (err) {
        logger.debug(`引用消息回溯失败：${method} ${err.message || err}`);
      }
    }

    return '';
  }

  async function withTimeout(task, ms, label) {
    let timer;
    try {
      return await Promise.race([
        task,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} 超时`)), ms);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function toImageUrl(url, session) {
    if (/^data:image\//i.test(url)) return url;
    if (/^https?:\/\//i.test(url) && !INLINE_REMOTE_IMAGES) return url;

    if (url.startsWith('onebot-image-file:')) {
      const file = url.slice('onebot-image-file:'.length);
      if (!session?.bot?.internal) throw new Error('无法通过 OneBot 回捞图片文件');
      const getter = session.bot.internal.getImage || session.bot.internal.get_image;
      if (typeof getter !== 'function') throw new Error('OneBot 不支持 get_image');
      const image = await withTimeout(
        getter.call(session.bot.internal, file),
        IMAGE_FETCH_TIMEOUT_MS,
        'OneBot 图片回捞',
      );
      const resolved = image?.url || image?.file || image;
      if (!resolved || resolved === file) throw new Error('OneBot 没有返回可下载的图片地址');
      return toImageUrl(String(resolved), session);
    }

    const data = await ctx.http.get(url, {
      responseType: 'arraybuffer',
      timeout: IMAGE_FETCH_TIMEOUT_MS,
    });
    const buffer = Buffer.from(data);
    if (!buffer.length) throw new Error('图片下载为空');

    const lower = url.toLowerCase();
    const mime = lower.includes('.png') ? 'image/png'
      : lower.includes('.webp') ? 'image/webp'
        : lower.includes('.gif') ? 'image/gif'
          : 'image/jpeg';
    return `data:${mime};base64,${buffer.toString('base64')}`;
  }

  async function describeImages(urls, question, session) {
    const imageParts = [];
    for (const url of urls) {
      logger.info(`【视觉感知】正在整理图片：${/^https?:\/\//i.test(url) ? '远程地址' : '本地回捞'}`);
      imageParts.push({
        type: 'image_url',
        image_url: { url: await toImageUrl(url, session) },
      });
    }
    logger.info('【视觉感知】图片已整理，正在请求视觉模型。');

    const res = await ctx.http.post(`${OPENAI_BASE_URL}/chat/completions`, {
      model: OPENAI_VISION_MODEL,
      messages: [
        {
          role: 'system',
          content: '你是给聊天机器人使用的视觉转写层。用中文描述图片中客观可见的信息，结合用户问题回答。不要编造看不见的信息，不要输出 Markdown，不要自称 AI。'
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: question || '请看这张图，简短说清楚图里有什么，以及值得回应的点。' },
            ...imageParts,
          ],
        },
      ],
      temperature: 0.3,
      max_tokens: 500,
    }, {
      timeout: VISION_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`,
      },
    });

    return String(res?.choices?.[0]?.message?.content || '').trim();
  }

  function summarizeVisionError(err) {
    const status = err?.response?.status || err?.status || err?.code || '';
    const data = err?.response?.data || err?.data;
    const detail = typeof data === 'string'
      ? data
      : data?.error?.message || data?.message || '';
    const pieces = [status, detail || err?.message || String(err)].filter(Boolean);
    return pieces.join(' ');
  }

  ctx.middleware(async (session, next) => {
    const content = String(session.content || '');
    const quoteContent = await getQuotedContent(session);
    const currentImageUrls = extractImageUrls(content);
    const quotedImageUrls = extractImageUrls(quoteContent);
    const hasImages = currentImageUrls.length || quotedImageUrls.length;
    if (!hasImages) return next();

    const group = isGroup(session);
    const addressed = isAddressingBot(session);
    const quotedImageAsked = quotedImageUrls.length && addressed;
    const directPrivateImage = !group && currentImageUrls.length;
    const directGroupImageAsked = group && addressed && currentImageUrls.length;

    if (!directPrivateImage && !quotedImageAsked && !directGroupImageAsked) return next();

    if (!OPENAI_KEY) {
      if (!group || addressed) {
        await session.send('我现在还看不了图，视觉接口的 key 还没配好。');
      }
      return;
    }

    try {
      const urls = quotedImageUrls.length ? quotedImageUrls : currentImageUrls;
      const userQuestion = cleanText(content) || (quotedImageUrls.length ? '帮我看看引用的这张图。' : '帮我看看这张图。');
      logger.info(`【视觉感知】准备识别图片：来源=${quotedImageUrls.length ? '引用' : '当前消息'} 数量=${urls.length}`);

      const description = await describeImages(urls, userQuestion, session);
      if (!description) throw new Error('视觉模型没有返回内容');
      logger.info(`【视觉感知】识别完成：${description.slice(0, 80)}`);

      const scene = group ? 'addressed' : 'default';
      const sourceText = quotedImageUrls.length ? '志贵引用了一张图片让你看' : '志贵发来了一张图片';
      const cleanedQuestion = cleanText(content);
      const addressedQuestion = group
        ? `爱尔奎特，${cleanedQuestion || userQuestion}`
        : (cleanedQuestion || userQuestion);
      session.content = `${addressedQuestion}

[系统视觉转写：${sourceText}。用户的问题是：“${userQuestion}”。你看到的内容是：“${description}”。请基于这个视觉信息，用爱尔奎特的口吻自然回复。不要说自己不能看图，不要提到系统视觉转写。]
${buildReplyStyleInstruction(scene)}`;
      logger.info('【视觉感知】已转交聊天模型生成角色回复。');
      return next();
    } catch (err) {
      logger.error(`【视觉受阻】${summarizeVisionError(err)}`);
      await session.send('唔，这张图我没看清，可能是图片地址过期或者视觉接口没接上。');
      return;
    }
  }, true);

  logger.info(`视觉神经就绪（模型：${OPENAI_VISION_MODEL}，接口：${OPENAI_BASE_URL}）`);
};
