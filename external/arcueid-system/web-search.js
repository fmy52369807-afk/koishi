module.exports = {
  name: 'web-search',

  apply(ctx) {
    const logger = ctx.logger('搜索引擎');

    const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
    const TAVILY_URL = 'https://api.tavily.com/search';
    const CACHE_TTL = 7200000;
    const COOLDOWN_MS = 30000;

    const cache = new Map();
    const cooldowns = new Map();
    const PREFIX = '搜索';

    if (!TAVILY_API_KEY) {
      logger.warn('TAVILY_API_KEY 未配置，搜索功能将不可用。');
    }

    ctx.setInterval(() => {
      const now = Date.now();
      for (const [k, v] of cache) {
        if (now - v.ts > CACHE_TTL) cache.delete(k);
      }
    }, 600000);

    // 用 middleware 而非 command，这样 ChatLuna 可以自然响应
    ctx.middleware(async (session, next) => {
      // 去掉 QQ 群聊中的 @bot 前缀
      let content = (session.content || '').toString();
      content = content.replace(/<at[^>]*\/>/g, '').trim();
      if (!content.startsWith(PREFIX)) return next();

      const query = content.slice(PREFIX.length).trim();
      if (!query) return next();
      if (!TAVILY_API_KEY) {
        session.send('搜索服务还没有配置 API Key。');
        return;
      }

      // 冷却检查
      const uid = session.userId || session.author?.userId;
      if (uid && cooldowns.has(uid)) {
        const elapsed = Date.now() - cooldowns.get(uid);
        if (elapsed < COOLDOWN_MS) {
          session.send(`请稍等 ${Math.ceil((COOLDOWN_MS - elapsed) / 1000)} 秒后再搜索。`);
          return; // 阻止 ChatLuna 也回复
        }
      }

      // 检查缓存
      const cacheKey = query.toLowerCase();
      const cached = cache.get(cacheKey);
      let res;

      if (cached && Date.now() - cached.ts < CACHE_TTL) {
        logger.info(`【缓存命中】"${query}"`);
        res = cached.result;
      } else {
        try {
          res = await ctx.http.post(TAVILY_URL, {
            api_key: TAVILY_API_KEY,
            query,
            search_depth: 'basic',
            include_answer: true,
            max_results: 5,
          }, {
            headers: { 'Content-Type': 'application/json' }
          });

          if (uid) cooldowns.set(uid, Date.now());
          cache.set(cacheKey, { result: res, ts: Date.now() });
          logger.info(`【搜索成功】"${query}" — ${res.results?.length || 0} 条结果`);

        } catch (err) {
          logger.error('【搜索失败】', err.message);
          session.send(`搜索失败：${err.message}`);
          return; // 阻止 ChatLuna 也回复
        }
      }

      // 注入搜索结果到上下文，改写消息让 ChatLuna 以为是自然对话
      let ctx_text = '\n\n[系统指令：志贵刚才说「' + query + '」，你已联网搜索得到了以下最新信息。请用你的口吻简洁地回答志贵，不要直接复制链接。]\n';

      if (res.answer) {
        ctx_text += `AI 摘要参考：${res.answer}\n`;
      }

      if (res.results && res.results.length > 0) {
        ctx_text += '搜索结果：\n';
        res.results.forEach((r, i) => {
          ctx_text += `${i + 1}. ${r.title}\n   摘要: ${r.content?.slice(0, 250) || '无'}\n   链接: ${r.url}\n`;
        });
      } else {
        ctx_text += '未找到相关结果。请如实告知。\n';
      }

      ctx_text += '[请根据以上信息回答志贵。';

      // 追加搜索结果到上下文，保留原始消息让 ChatLuna 自然处理
      session.content += ctx_text;

      return next(); // 继续传递给 ChatLuna
    }, true); // prepend: 在其他中间件之前运行

    logger.info('搜索引擎就绪（前缀触发：搜索）');
  }
};
