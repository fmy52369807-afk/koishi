const { buildReplyStyleInstruction, sanitizeReply, analyzeChatStyle, isInternalMetaReply } = require('./reply-style');

module.exports.name = 'arcueid-proactive-context';
module.exports.using = ['database', 'chatluna'];

module.exports.apply = (ctx) => {
  const logger = ctx.logger('群聊侧耳');
  const limit = parseInt(process.env.PROACTIVE_CONTEXT_LIMIT || '20', 10) || 20;
  const triggerInterval = parseInt(process.env.PROACTIVE_TRIGGER_MESSAGES || '12', 10) || 12;
  const cooldownMs = (parseInt(process.env.PROACTIVE_COOLDOWN_SECONDS || '300', 10) || 300) * 1000;
  const rawGroup = process.env.ACTIVELINK_GROUP_ID_1 || process.env.PROACTIVE_CONTEXT_GROUPS || '';
  const allowedGroups = new Set(rawGroup.split(/[,\s]+/).map(s => s.trim()).filter(Boolean).slice(0, 1));
  const histories = new Map();
  const lastLogAt = new Map();
  const stats = new Map();
  const running = new Set();
  const recordingBotSend = new Set();

  function groupIdOf(session) {
    const channelId = session.channelId || '';
    if (!channelId || channelId.startsWith('private:')) return '';
    if (session.guildId) return String(session.guildId);
    return channelId.includes(':') ? channelId.split(':')[0] : channelId;
  }

  function isAllowedGroup(session) {
    const groupId = groupIdOf(session);
    if (!groupId) return false;
    return allowedGroups.has(groupId) || allowedGroups.has(session.channelId);
  }

  function cleanContent(content) {
    return String(content || '')
      .replace(/<at[^>]*\/>/g, '')
      .replace(/<img[^>]*>/g, '[图片]')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);
  }

  function speakerName(session) {
    const author = session.author || {};
    const eventUser = session.event?.user || {};
    const member = session.event?.member || {};
    return member.name
      || author.nick
      || author.name
      || eventUser.name
      || session.username
      || session.userId
      || '未知成员';
  }

  function botName(session) {
    return session.bot?.user?.name || session.bot?.user?.nick || '爱尔奎特';
  }

  function formatTime(ts) {
    return new Date(ts || Date.now()).toLocaleTimeString('zh-CN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function pushHistory(session, content, speaker = {}) {
    if (!isAllowedGroup(session)) return;

    const channelId = session.channelId;
    const history = histories.get(channelId) || [];
    history.push({
      time: formatTime(session.timestamp),
      userId: speaker.userId || session.userId || '',
      name: speaker.name || speakerName(session),
      platform: session.platform || 'onebot',
      selfId: session.selfId || session.bot?.selfId || '',
      groupId: groupIdOf(session),
      content,
    });
    while (history.length > limit) history.shift();
    histories.set(channelId, history);

    const now = Date.now();
    const last = lastLogAt.get(channelId) || 0;
    if (now - last > 60 * 1000 || history.length <= 3) {
      logger.info(`已记录群聊上下文：群=${groupIdOf(session)} channel=${channelId} guild=${session.guildId || ''} 条数=${history.length}`);
      lastLogAt.set(channelId, now);
    }

    return history;
  }

  function remember(session) {
    if (!isAllowedGroup(session)) return;

    const content = cleanContent(session.content);
    if (!content) return;

    const selfMessage = isSelf(session);
    const history = pushHistory(session, content, selfMessage ? {
      userId: session.selfId || session.userId || '',
      name: botName(session),
    } : undefined);

    if (!history || selfMessage) return;

    maybeTrigger(session, history, !isAddressingBot(session)).catch((err) => {
      logger.warn(`主动回复触发失败：${err.message || err}`);
    });
  }

  function isSelf(session) {
    return session.userId && session.selfId && String(session.userId) === String(session.selfId);
  }

  function isAddressingBot(session) {
    const content = String(session.content || '');
    const selfId = String(session.selfId || session.bot?.selfId || '');
    if (selfId) {
      const escaped = selfId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`<at\\s+[^>]*id=["']?${escaped}["']?`, 'i').test(content)) return true;
      if (new RegExp(`\\[CQ:at,[^\\]]*qq=${escaped}(?:,|\\])`, 'i').test(content)) return true;
    }

    const botNames = ['爱尔奎特', '公主'];
    return botNames.some((name) => content.includes(name));
  }

  function getStat(channelId) {
    if (!stats.has(channelId)) {
      stats.set(channelId, { sinceReply: 0, lastReplyAt: 0 });
    }
    return stats.get(channelId);
  }

  function buildBindingKey(session) {
    const platform = session.platform || 'onebot';
    const selfId = session.selfId || session.bot?.selfId || '';
    const groupId = groupIdOf(session);
    if (!selfId || !groupId) return '';
    return `shared:${platform}:${selfId}:${groupId}`;
  }

  async function getConversation(session) {
    const bindingKey = buildBindingKey(session);
    if (!bindingKey) return null;

    const bindings = await ctx.database.get('chatluna_binding', { bindingKey });
    const conversationId = bindings[0]?.activeConversationId;
    if (!conversationId) return null;

    const conversations = await ctx.database.get('chatluna_conversation', { id: conversationId });
    return conversations[0] || null;
  }

  function formatHistory(history) {
    return history.slice(-limit).map((item, index) => {
      return `${index + 1}. [${item.time}] ${item.name}(${item.userId}): ${item.content}`;
    }).join('\n');
  }

  function formatHistoryWindow(history, startIndex = 0) {
    return history.map((item, index) => {
      return `${startIndex + index + 1}. [${item.time}] ${item.name}(${item.userId}): ${item.content}`;
    }).join('\n');
  }

  function splitHistoryByFreshness(history, recentSize = 3) {
    const slice = Array.isArray(history) ? history.slice(-limit) : [];
    const recent = slice.slice(-Math.max(1, recentSize));
    const background = slice.slice(0, Math.max(0, slice.length - recent.length));
    return { history: slice, recent, background };
  }

  const GENERIC_TOPIC_WORDS = new Set([
    '这个', '那个', '这事', '那事', '事情', '问题', '东西', '话题', '消息', '群聊',
    '我们', '你们', '他们', '她们', '它们', '大家', '有人', '没人', '什么', '怎么',
    '为什么', '为啥', '是不是', '是否', '可以', '能不能', '行不行', '也许', '可能',
    '好像', '感觉', '觉得', '其实', '然后', '现在', '刚才', '之前', '之后', '这里',
    '那里', '那边', '这边', '一下', '一点', '很多', '比较', '已经', '还是', '不是',
    '没有', '如果', '因为', '所以', '而且', '但是', '不过', '只是', '而已', '再说',
    '回复', '接话', '插话', '聊天', '随口', '自然', '一句', '一条', '今天', '明天',
    '昨天', '晚上', '早上', '中午', '下午', '发言', '开口', '话茬', '切口',
  ]);

  function extractTopicTerms(text) {
    const value = String(text || '').toLowerCase();
    const terms = new Set();

    for (const match of value.matchAll(/[a-z0-9][a-z0-9_.-]*/gi)) {
      const token = match[0].trim();
      if (token.length >= 2) terms.add(token);
    }

    const chineseChunks = value
      .replace(/[^\u4e00-\u9fff]+/g, ' ')
      .split(/\s+/)
      .map(part => part.trim())
      .filter(Boolean);

    for (const chunk of chineseChunks) {
      if (chunk.length < 2 || chunk.length > 8) continue;
      if (GENERIC_TOPIC_WORDS.has(chunk)) continue;
      terms.add(chunk);
    }

    return [...terms];
  }

  async function buildPrompt(session, history, profile) {
    const { recent, background } = splitHistoryByFreshness(history, 3);
    const now = new Date().toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const userProfiles = ctx.arcueidUserProfiles
      ? await ctx.arcueidUserProfiles.profilesForHistory(history)
      : [];
    const profileText = userProfiles.length
      ? userProfiles.map(item => ctx.arcueidUserProfiles.formatProfile(item)).join('\n---\n')
      : '（暂无用户画像）';

    return `你正在群聊里旁听，允许你主动插一句，但这不是命令回复。
当前时间：${now}
群号：${groupIdOf(session)}
群聊节奏画像：
- 平均每条消息约 ${profile.avgChars.toFixed(1)} 个字
- 短消息占比 ${Math.round(profile.shortRate * 100)}%
- 连续同一人最长连发 ${profile.maxBurst} 条
- 本次最多回复 ${profile.replyCount} 条

只允许接的最后几句：
${formatHistoryWindow(recent, background.length)}

更早的背景，只当参考，不要主动接这些话题：
${background.length ? formatHistoryWindow(background, 0) : '（无）'}

请判断现在是否适合自然开口。
如果大家只是在刷屏、测试、或没有值得接的话题，请输出空消息。
如果适合开口，只能选择一个最近的切入口，像爱尔奎特本人一样随口接话。
只接最后 1 到 3 条里最自然的一句；更早的话题只要没有在最后几句重新出现，就不要碰。
不要照顾多个话题，不要逐条回答，不要总结聊天记录。
如果最后几句已经换话题、只是在发单字/表情/无上下文玩笑，请输出空消息。
可以发 1 到 ${profile.replyCount} 条消息；群里短句多、连发多时，可以像群友一样拆成两三条很短的话。不要为了凑数量硬拆。
每条都必须是能直接发出去的自然台词，不能只输出关键词、话题名、切入口或内部判断。
回复要短，每条通常 8 到 55 个汉字左右；可以好奇、接梗、吐槽、追问，但必须先把意思说完整，不要为了短而截断。
如果一个意思需要两句，可以拆成两条消息；不要把半句话硬切成一条。
以下是近期发言者画像，只用于区分用户身份和贴合他们的表达习惯，不要把画像内容当成事实扩展，也不要向群友透露：
${profileText}
如果你脑子里先冒出来的是背景里的旧话题，而不是最后几句正在继续的话题，就不要说。
禁止使用“你们刚才说/我看到/有人提到/关于这个话题/听起来你们在/总结一下”这类复述或总结开头。
不要暴露你读取了聊天记录，不要给人一种系统提示生成的感觉。

输出必须是：
<output>
<message>要发送的话</message>
${profile.replyCount > 1 ? '<message>可选的第二条短消息</message>' : ''}
${profile.replyCount > 2 ? '<message>可选的第三条短消息</message>' : ''}
</output>

如果决定不说话，输出：
<output>
<message></message>
</output>`;
  }

  function normalizeForEcho(text) {
    return String(text || '')
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '')
      .trim();
  }

  function looksLikeKeywordEcho(message, history) {
    const value = String(message || '').trim();
    if (isInternalMetaReply(value)) return true;

    const normalized = normalizeForEcho(value);
    if (!normalized || normalized.length > 10) return false;

    const hasConversationalTone = /[我你咱谁吗呢啊呀吧嘛呗啦哦喔欸诶哇哈了？?!！~]/.test(value);
    if (hasConversationalTone) return false;

    return history.slice(-8).some((item) => {
      const recent = normalizeForEcho(item.content);
      return recent === normalized || (normalized.length >= 3 && recent.includes(normalized));
    });
  }

  function looksLikeStaleTopicReply(message, history) {
    const value = String(message || '').trim();
    if (!value) return false;
    if (value.length <= 4) return false;

    const replyTerms = extractTopicTerms(value);
    if (!replyTerms.length) return false;

    const { recent, background } = splitHistoryByFreshness(history, 3);
    const recentTerms = new Set(recent.flatMap((item) => extractTopicTerms(item.content)));
    const backgroundTerms = new Set(background.flatMap((item) => extractTopicTerms(item.content)));

    let recentHits = 0;
    let backgroundHits = 0;
    for (const term of replyTerms) {
      if (recentTerms.has(term)) recentHits += 1;
      if (backgroundTerms.has(term)) backgroundHits += 1;
    }

    if (recentHits > 0) return false;
    if (backgroundHits === 0) return false;

    return true;
  }

  function stripOutput(content, maxMessages = 1, history = []) {
    const text = String(content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const output = text.match(/<output[^>]*>([\s\S]*?)<\/output>/i);
    const body = output ? output[1] : text;
    const messages = [];
    const pattern = /<message[^>]*>([\s\S]*?)<\/message>/gi;
    let match;
    while ((match = pattern.exec(body))) {
      const item = match[1]
        .replace(/^\s+|\s+$/g, '')
        .replace(/\n{3,}/g, '\n\n');
      if (item) messages.push(item);
    }
    if (!messages.length && !output) {
      const fallback = body.trim();
      if (fallback) messages.push(fallback);
    }
    const forbiddenOpenings = /^(你们刚才|你刚才|我看到|有人提到|关于|听起来你们|听起来你|总结一下|从聊天记录|根据聊天记录|选择|切入)/;
    return messages
      .map((message) => message
        .replace(/^[\s"'“”]+|[\s"'“”]+$/g, '')
        .replace(/\n+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim())
      .filter((message) => message && !forbiddenOpenings.test(message))
      .map((message) => sanitizeReply(message, { maxChars: 80 }))
      .filter(Boolean)
      .filter((message) => !looksLikeKeywordEcho(message, history))
      .filter((message) => !looksLikeStaleTopicReply(message, history))
      .slice(0, Math.max(1, Math.min(3, maxMessages)));
  }

  async function maybeTrigger(session, history, countForTrigger) {
    const channelId = session.channelId;
    if (!channelId || running.has(channelId)) return;

    const stat = getStat(channelId);
    if (!countForTrigger) {
      logger.info(`收到指向机器人的消息，仅记录上下文，不计入主动回复触发：群=${groupIdOf(session)}`);
      return;
    }

    stat.sinceReply += 1;

    const now = Date.now();
    if (stat.sinceReply < triggerInterval) return;
    if (now - stat.lastReplyAt < cooldownMs) return;

    const conversation = await getConversation(session);
    if (!conversation) {
      logger.warn(`未找到群 ${groupIdOf(session)} 的 ChatLuna 活跃会话，主动回复跳过`);
      stat.sinceReply = 0;
      return;
    }

    running.add(channelId);
    try {
      logger.info(`准备主动判断是否插话：群=${groupIdOf(session)} 最近消息=${history.length}`);
      const profile = analyzeChatStyle(history);
      const response = await ctx.chatluna.chat(session, conversation, {
        content: await buildPrompt(session, history, profile),
        role: 'system',
        name: 'proactive_context',
      }, {
        stream: false,
      });

      const messages = stripOutput(response?.content, profile.replyCount, history);
      stat.sinceReply = 0;
      stat.lastReplyAt = Date.now();

      if (!messages.length) {
        logger.info(`AI 判断暂不插话：群=${groupIdOf(session)}`);
        return;
      }

      for (const message of messages) {
        recordingBotSend.add(`${channelId}:${message}`);
        await session.send(message);
        const latestHistory = histories.get(channelId) || history;
        pushHistory(session, cleanContent(message), {
          userId: session.selfId || session.bot?.selfId || '',
          name: botName(session),
        });
        histories.set(channelId, latestHistory.length > limit ? latestHistory.slice(-limit) : latestHistory);
      }
      logger.info(`主动回复已发送：群=${groupIdOf(session)} 条数=${messages.length}`);
    } finally {
      running.delete(channelId);
    }
  }

  function isActiveLinkProactive(content) {
    return /主动向用户发起对话|主动发起一个话题|主动来找用户聊天|群里之前的聊天氛围/.test(String(content || ''));
  }

  ctx.on('message', remember);

  ctx.on('chatluna/before-chat', async (_conversationId, message, _promptVariables, _chatInterface, session) => {
    if (!session || !message || !isAllowedGroup(session)) return;

    if (isAddressingBot(session) && !isActiveLinkProactive(session.content) && !isActiveLinkProactive(message.content)) {
      message.content = `${message.content}

${buildReplyStyleInstruction('addressed')}`;
      logger.debug(`已为被 @ 回复注入短句风格约束：${session.channelId}`);
      return;
    }

    if (!isActiveLinkProactive(session.content) && !isActiveLinkProactive(message.content)) return;

    const history = histories.get(session.channelId) || [];
    if (!history.length) return;

    const lines = history.slice(-limit).map((item, index) => {
      return `${index + 1}. [${item.time}] ${item.name}(${item.userId}): ${item.content}`;
    });
    const freshLines = lines.slice(-3);
    const backgroundLines = lines.slice(0, Math.max(0, lines.length - freshLines.length));
    const profile = analyzeChatStyle(history);

    message.content = `${message.content}

<system>
这是允许主动回复的群聊。下面是该群最近 ${lines.length} 条聊天记录，格式为“序号. [时间] 昵称(用户ID): 内容”。
你主动开口时只选一个最近的切入口，优先最后 1 到 3 条里最容易自然接上的一句。不要同时回应多个话题，不要逐条复述记录，不要暴露你在读取系统上下文。
下面这几条才是当前能接的话题：
${freshLines.join('\n') || '（无）'}

更早的内容只是背景，不要主动接：
${backgroundLines.join('\n') || '（无）'}

如果最后几句和前面不是同一话题，以最后几句为准；接不上就少说或不说。
本群最近节奏：平均 ${profile.avgChars.toFixed(1)} 字，短消息占比 ${Math.round(profile.shortRate * 100)}%，最长同一人连发 ${profile.maxBurst} 条。
回复像群友随口插话，可以发 1 到 ${profile.replyCount} 条短消息；如果连发，用换行分隔每条，不要编号，不要列表。
    每条通常 8 到 55 个汉字左右；可以接梗、吐槽、好奇或轻轻追问，但完整表达优先，不要硬截断。
不要只输出关键词、话题名、切入口或内部判断。禁止使用“关键词：”“话题：”“切入口：”“你们刚才说/我看到/有人提到/关于/听起来你们在”这类开头。
如果脑子里先冒出来的是背景里的旧话题，而不是最后几条正在继续的话题，就不要说。
如果上下文不足，宁可少说或不说。

${lines.join('\n')}
</system>`;

    logger.debug(`已为主动回复注入 ${lines.length} 条群聊上下文：${session.channelId}`);
  });

  ctx.on('before-send', async (session) => {
    if (!session || !session.content || !isAllowedGroup(session)) return;
    if (session.content.includes('[norender]') || session.content.includes('\u200B')) return;

    const history = histories.get(session.channelId) || [];
    const rawLines = String(session.content).split('\n').map(line => line.trim()).filter(Boolean);
    const cleaned = rawLines
      .map(line => sanitizeReply(line, { maxChars: 80 }))
      .filter(Boolean)
      .filter(line => !looksLikeKeywordEcho(line, history))
      .filter(line => {
        const stale = looksLikeStaleTopicReply(line, history);
        if (stale) logger.warn(`拦截疑似旧话题主动回复：群=${groupIdOf(session)} 内容=${line}`);
        return !stale;
      });

    if (!cleaned.length && (isInternalMetaReply(session.content) || rawLines.some(line => looksLikeKeywordEcho(line, history) || looksLikeStaleTopicReply(line, history)))) {
      logger.warn(`拦截疑似内部分析式回复：群=${groupIdOf(session)} 内容=${String(session.content).slice(0, 80)}`);
      return true;
    }

    if (cleaned.length && cleaned.join('\n') !== session.content.trim()) {
      session.content = cleaned.slice(0, 3).join('\n');
      logger.info(`已清洗群聊回复输出：群=${groupIdOf(session)} 条数=${cleaned.length}`);
    }

    const key = `${session.channelId}:${String(session.content).replace(/\u200B/g, '')}`;
    if (!recordingBotSend.has(key)) {
      const content = cleanContent(session.content);
      if (content) {
        pushHistory(session, content, {
          userId: session.selfId || session.bot?.selfId || '',
          name: botName(session),
        });
      }
    }
    recordingBotSend.delete(key);
  });

  logger.info(`群聊主动上下文就绪：${allowedGroups.size ? [...allowedGroups].join(', ') : '未配置群白名单'}`);
};
