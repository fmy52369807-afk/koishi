// 空想具象化 — AI 生图（硅基流动 Kolors）
const { h } = require('koishi');

module.exports.name = 'arcueid-image-gen';

module.exports.apply = (ctx) => {
  const logger = ctx.logger('空想具象化');
  const PREFIX = '空想具象化';
  const SF_API = 'https://api.siliconflow.cn/v1/images/generations';
  const SF_KEY = process.env.SILICONFLOW_API_KEY;
  const DS_KEY = process.env.DEEPSEEK_API_KEY;

  if (!SF_KEY) {
    logger.warn('SILICONFLOW_API_KEY 未配置，生图功能将不可用。');
  }
  if (!DS_KEY) {
    logger.warn('DEEPSEEK_API_KEY 未配置，生图后的文字回复将使用兜底文案。');
  }

  ctx.middleware(async (session, next) => {
    let content = (session.content || '').toString();
    content = content.replace(/<at[^>]*\/>/g, '').trim();
    if (!content.startsWith(PREFIX)) return next();

    const prompt = content.slice(PREFIX.length).trim();
    if (!prompt) return next();
    if (!SF_KEY) {
      session.send('空想具象化还没有配置 API Key。');
      return;
    }

    try {
      const res = await ctx.http.post(SF_API, {
        model: 'Kwai-Kolors/Kolors',
        prompt: `${prompt}, realistic, photorealistic, high quality, masterpiece`,
        num_images: 1,
        image_size: '1024x1024'
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SF_KEY}`
        }
      });

      const imgUrl = res?.images?.[0]?.url;
      if (!imgUrl) { session.send('唔…魔力凝聚失败了，换个描述试试？'); return; }

      // 并行：下载图片 + 生成文字回复
      const [imgData, textRes] = await Promise.all([
        ctx.http.get(imgUrl, { responseType: 'arraybuffer' }),
        DS_KEY ? ctx.http.post('https://api.deepseek.com/v1/chat/completions', {
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: '你是爱尔奎特，真祖的公主，拥有空想具象化的能力。志贵是你的远野志贵。现在你刚刚用空想具象化为志贵变出了一个东西。用你的口吻说一句简短的话，告诉志贵东西变出来了。一句话，像"看！怎么样，我的空想具象化还不错吧？"这种风格。' },
            { role: 'user', content: `志贵说：「${content}」。你为他变出了「${prompt}」。请用一句话回应。` }
          ],
          max_tokens: 60, temperature: 0.9,
        }, {
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DS_KEY}` }
        }) : Promise.resolve(null)
      ]);

      const text = textRes?.choices?.[0]?.message?.content?.trim() || '看，怎么样？';

      await session.send(text);
      const imgBase64 = Buffer.from(imgData).toString('base64');
      await session.send(h.image(`data:image/png;base64,${imgBase64}`));

      // 注入对话记忆，让 ChatLuna 记住这次交互但不触发回复
      session.content = `[norender]志贵刚才说「${content}」，你使用空想具象化为他变出了「${prompt}」，并回应「${text}」。请记住这段对话。`;
      logger.info(`【具象化】成功`);
      return next();

    } catch (err) {
      logger.error('【具象化失败】', err.message);
      session.send(`唔…魔力不够了，没法变出「${prompt}」。等会儿再试吧~`);
    }

    return;
  }, true);

  logger.info('空想具象化就绪');
};
