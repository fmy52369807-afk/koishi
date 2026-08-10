const { buildReplyStyleInstruction } = require('./reply-style');
const { config } = require('./config');
const { errorSummary, requestWithRetry } = require('./http-client');

module.exports = {
  name: 'web-search',

  apply(ctx) {
    const logger = ctx.logger('搜索引擎');

    const TAVILY_API_KEY = config.tavily.apiKey;
    const TAVILY_URL = config.tavily.url;
    const CACHE_TTL = config.tavily.cacheTtlMs;
    const COOLDOWN_MS = config.tavily.cooldownMs;

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
          res = await requestWithRetry(ctx, 'post', TAVILY_URL, {
            api_key: TAVILY_API_KEY,
            query,
            search_depth: 'basic',
            include_answer: true,
            max_results: config.tavily.maxResults,
          }, {
            headers: { 'Content-Type': 'application/json' }
          }, {
            timeout: config.tavily.timeoutMs,
            retries: config.http.retries,
            retryDelayMs: config.http.retryDelayMs,
          });

          if (uid) cooldowns.set(uid, Date.now());
          cache.set(cacheKey, { result: res, ts: Date.now() });
          logger.info(`【搜索成功】"${query}" — ${res.results?.length || 0} 条结果`);

        } catch (err) {
          const detail = errorSummary(err);
          logger.error(`【搜索失败】${detail}`);
          session.send(`搜索失败：${detail}`);
          return; // 阻止 ChatLuna 也回复
        }
      }

      // 注入搜索结果到上下文，改写消息让 ChatLuna 以为是自然对话
      let ctx_text = '\n\n[系统指令：你已联网搜索得到了以下最新信息。请用你的口吻简洁回答志贵，先给结论，不要复述他的问题，不要直接复制链接。]\n';
      ctx_text += `${buildReplyStyleInstruction('search')}\n`;

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
