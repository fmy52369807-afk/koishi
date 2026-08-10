const { config } = require('./external/arcueid-system/config');
const { mergeLines, preserveShortBurst, shouldSkipNaturalSplit, splitNaturalChat } = require('./external/arcueid-system/split-utils');

module.exports = {
  name: 'auto-split-message',

  apply(ctx) {
    const logger = ctx.logger('auto-split-message');

    function sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function sendLines(session, lines, delayMs) {
      for (let i = 0; i < lines.length; i++) {
        const finalLine = lines[i].trim() + '\u200B';

        try {
          await session.bot.sendMessage(session.channelId, finalLine);
        } catch (err) {
          logger.warn(`分段发送失败: ${err.message}`);
          return false;
        }

        if (i < lines.length - 1) {
          await sleep(delayMs);
        }
      }

      return true;
    }

    ctx.on('before-send', async (session) => {
      // 🛡️ 防护结界：如果发现“隐形符文”（\u200B），说明这是已经切好并正在发出的短句，直接放行！
      if (!session.content || session.content.includes('\u200B')) {
        return;
      }

      // 1. 如果没有换行符，说明是单句，直接放行
      if (!session.content.includes('\n')) {
        if (!shouldSkipNaturalSplit(session.content)) {
          const naturalLines = splitNaturalChat(session.content, config.split);
          if (naturalLines.length > 1) {
            logger.info(`自然短句拆分发送：条数=${naturalLines.length}`);
            const sent = await sendLines(session, naturalLines, config.split.naturalDelayMs);
            if (sent) return true;
          }
        }
        return;
      }

      // 2. 按换行符切分，并过滤掉空行
      const rawLines = session.content.split('\n').filter(line => line.trim().length > 0);

      // 如果模型本来就给了 2-3 条很短的自然短句，保留这种“连发”的口吻。
      // 更长或更多的内容才继续合并，避免长篇被刷屏式拆开。
      if (preserveShortBurst(rawLines)) {
        logger.info(`保留短句连发：条数=${rawLines.length}`);
        const sent = await sendLines(session, rawLines, config.split.naturalDelayMs);
        if (sent) return true;
        return;
      }

      // ==========================================
      // 🧠 核心升级：智能缝合短句，防止刷屏！
      // ==========================================
      const lines = mergeLines(rawLines, config.split.mergeMaxChars);

      // 3. 只有当合并后确实有多条消息时，才执行分段发送
      if (lines.length > 1) {
        logger.info(`长内容分段发送：条数=${lines.length}`);
        const sent = await sendLines(session, lines, config.split.longDelayMs);
        if (!sent) return;

        // 4. 关键：阻断原始的那条“打包大长篇”
        return true;
      }
      
      // 如果合并完发现其实只剩下一条消息了，就不拦截，直接走默认的发信/发语音通道
    });
  }
}
