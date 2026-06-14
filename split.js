module.exports = {
  name: 'auto-split-message',
  
  apply(ctx) {
    const logger = ctx.logger('auto-split-message');

    ctx.on('before-send', async (session) => {
      // 🛡️ 防护结界：如果发现“隐形符文”（\u200B），说明这是已经切好并正在发出的短句，直接放行！
      if (!session.content || session.content.includes('\u200B')) {
        return;
      }

      // 1. 如果没有换行符，说明是单句，直接放行
      if (!session.content.includes('\n')) {
        return;
      }

      // 2. 按换行符切分，并过滤掉空行
      const rawLines = session.content.split('\n').filter(line => line.trim().length > 0);

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
        for (let i = 0; i < lines.length; i++) {
          // 🗡️ 在每块合并好的消息末尾打上“隐形符文”，赋予免检特权
          const finalLine = lines[i] + '\u200B';
          
          try {
            await session.bot.sendMessage(session.channelId, finalLine);
          } catch (err) {
            logger.warn(`分段发送失败: ${err.message}`);
            return;
          }
          
          // 停顿 2 秒（2000毫秒），稍微加长一点等待时间，让公主的“打字”显得更从容真实
          if (i < lines.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
        
        // 4. 关键：阻断原始的那条“打包大长篇”
        return true; 
      }
      
      // 如果合并完发现其实只剩下一条消息了，就不拦截，直接走默认的发信/发语音通道
    });
  }
}
