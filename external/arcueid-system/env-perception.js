module.exports = {
  name: 'env-perception',

  apply(ctx) {
    const logger = ctx.logger('环境感知');

    const CITY = process.env.KOISHI_WEATHER_CITY || '武汉';
    let cachedWeather = null;
    let lastFetchTime = 0;
    const RETRY_MS = 300000;       // 失败后 5 分钟重试
    const REFRESH_MS = 3600000;    // 成功后 1 小时刷新

    ctx.middleware(async (session, next) => {
      if (session.content && !session.content.startsWith('/') && !session.content.includes('[norender]')) {

        const now = new Date();

        const timeStr = now.toLocaleString('zh-CN', {
          timeZone: 'Asia/Shanghai',
          year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
          hour: '2-digit', minute: '2-digit', hour12: false
        });

        logger.info(`【时空刻印】正在向大脑注入当前坐标: ${timeStr}`);

        // 首次或超时后刷新天气；成功用长间隔，失败用短间隔避免频繁重试
        if (now.getTime() - lastFetchTime > (cachedWeather ? REFRESH_MS : RETRY_MS)) {
          try {
            const url = `https://wttr.in/${CITY}?format=%c+%C+%t&lang=zh-cn`;
            const res = await ctx.http.get(url, { responseType: 'text' });
            cachedWeather = res.trim();
            lastFetchTime = now.getTime();
            logger.info(`【气象更新】已感知${CITY}最新天气: ${cachedWeather}`);
          } catch (err) {
            lastFetchTime = now.getTime(); // 失败也更新时间，避免每条消息都重试
            logger.warn('【感知阻断】无法连接气象塔:', err.message);
          }
        }

        // 注入上下文
        if (cachedWeather) {
          session.content += `\n\n<system>当前现实世界的绝对时间是：${timeStr}，${CITY}天气：${cachedWeather}。\n警告：这是系统提供的绝对真理。当你要报出时间时，必须一字不差地使用这个时间，绝对禁止自行猜测、编造或模糊处理！\n注意：这是你的被动感官。除非志贵主动询问时间/天气，或者当前对话逻辑确实需要用到（如深夜提醒睡觉），否则绝对不要主动在回复中复读这些数据。</system>`;
        } else {
          session.content += `\n\n<system>当前现实世界的绝对时间是：${timeStr}。\n警告：这是系统提供的绝对真理。当你要报出时间时，必须一字不差地使用这个时间，绝对禁止自行猜测、编造或模糊处理！</system>`;
        }
      }

      return next();
    }, true);
  }
}
