module.exports = {
  name: 'auto-split-message',
  
  apply(ctx) {
    const logger = ctx.logger('auto-split-message');

    function sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    function shouldSkipNaturalSplit(content) {
      return !content
        || content.includes('\u200B')
        || content.includes('[norender]')
        || content.includes('[语音]')
        || /https?:\/\//i.test(content)
        || /<[^>]+>/.test(content)
        || /```|^\s*(?:[-*]|\d+[.)、])/m.test(content);
    }

    function attachLooseExpression(parts) {
      const result = [];
      for (const part of parts) {
        if (/^\s*[\[【]表情[:：][^\]】]+[\]】]\s*$/.test(part) && result.length) {
          result[result.length - 1] += part.trim();
        } else {
          result.push(part);
        }
      }
      return result;
    }

    function splitNaturalChat(content) {
      const value = String(content || '').replace(/\s+/g, ' ').trim();
      if (value.length < 34 || value.length > 110) return [];

      let parts = value.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [];
      parts = attachLooseExpression(parts.map(part => part.trim()).filter(Boolean));

      if (parts.length === 1 && /[，,、]/.test(parts[0])) {
        const chunk = parts[0];
        const index = Math.max(chunk.lastIndexOf('，'), chunk.lastIndexOf(','), chunk.lastIndexOf('、'));
        const left = chunk.slice(0, index).trim();
        const right = chunk.slice(index + 1).trim();
        if (left.length >= 6 && right.length >= 6 && left.length <= 45 && right.length <= 45) {
          parts = [left, right];
        }
      }

      if (parts.length < 2 || parts.length > 3) return [];
      if (parts.some(part => part.length < 2 || part.length > 45)) return [];
      return parts;
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
          const naturalLines = splitNaturalChat(session.content);
          if (naturalLines.length > 1) {
            logger.info(`自然短句拆分发送：条数=${naturalLines.length}`);
            const sent = await sendLines(session, naturalLines, 1200);
            if (sent) return true;
          }
        }
        return;
      }

      // 2. 按换行符切分，并过滤掉空行
      const rawLines = session.content.split('\n').filter(line => line.trim().length > 0);

      // 如果模型本来就给了 2-3 条很短的自然短句，保留这种“连发”的口吻。
      // 更长或更多的内容才继续合并，避免长篇被刷屏式拆开。
      const preserveShortBurst = rawLines.length >= 2
        && rawLines.length <= 3
        && rawLines.every(line => line.trim().length <= 30)
        && !rawLines.some(line => /^\s*(?:[-*]|\d+[.)、]|[一二三四五六七八九十]+[、.])/.test(line));

      if (preserveShortBurst) {
        logger.info(`保留短句连发：条数=${rawLines.length}`);
        const sent = await sendLines(session, rawLines, 1200);
        if (sent) return true;
        return;
      }

      // ==========================================
      // 🧠 核心升级：智能缝合短句，防止刷屏！
      // ==========================================
      const lines = [];
      let currentChunk = '';

      for (const line of rawLines) {
        // 设定合并阈值：如果当前拼接的内容加上新句子超过 40 个字，就断开，新起一条消息
        if (currentChunk.length + line.length > 40) {
          if (currentChunk) lines.push(currentChunk.trim());
          currentChunk = line;
        } else {
          // 如果还不满 40 个字，就把零碎的短句拼在一起（用换行符连着，保证排版好看）
          currentChunk = currentChunk ? currentChunk + ' ' + line : line;
        }
      }
      // 把最后剩下的一块也塞进发送队列
      if (currentChunk) lines.push(currentChunk.trim()); 

      // 3. 只有当合并后确实有多条消息时，才执行分段发送
      if (lines.length > 1) {
        logger.info(`长内容分段发送：条数=${lines.length}`);
        const sent = await sendLines(session, lines, 2000);
        if (!sent) return;

        // 4. 关键：阻断原始的那条“打包大长篇”
        return true; 
      }
      
      // 如果合并完发现其实只剩下一条消息了，就不拦截，直接走默认的发信/发语音通道
    });
  }
}
