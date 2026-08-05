module.exports.name = 'arcueid-user-profile';
module.exports.using = ['database'];

module.exports.apply = (ctx) => {
  const logger = ctx.logger('用户画像');
  const allowedGroups = new Set(String(process.env.ACTIVELINK_GROUP_ID_1 || process.env.PROACTIVE_CONTEXT_GROUPS || '')
    .split(/[,\s]+/).map(value => value.trim()).filter(Boolean));
  const allowedPrivateUsers = new Set(String(process.env.ACTIVELINK_PRIVATE_IDS || '')
    .split(/[,\s]+/).map(value => value.trim()).filter(Boolean));
  const writeQueues = new Map();

  ctx.database.extend('arc_user_profiles', {
    id: 'unsigned',
    scope: 'string',
    platform: 'string',
    selfId: 'string',
    groupId: 'string',
    userId: 'string',
    displayName: 'string',
    messageCount: 'unsigned',
    totalChars: 'unsigned',
    shortCount: 'unsigned',
    punctuationCount: 'unsigned',
    lastSeen: 'unsigned',
    activeHours: 'text',
    phraseCounts: 'text',
    samples: 'text',
    createdAt: 'unsigned',
    updatedAt: 'unsigned',
  }, { autoInc: true });

  function groupIdOf(session) {
    if (session.guildId) return String(session.guildId);
    const channelId = String(session.channelId || '');
    if (!channelId || channelId.startsWith('private:')) return '';
    return channelId.includes(':') ? channelId.split(':')[0] : channelId;
  }

  function isPrivate(session) {
    return !groupIdOf(session) && Boolean(session.userId);
  }

  function isAllowed(session) {
    const groupId = groupIdOf(session);
    if (groupId) return allowedGroups.has(groupId) || allowedGroups.has(String(session.channelId || ''));
    return isPrivate(session) && (!allowedPrivateUsers.size || allowedPrivateUsers.has(String(session.userId)));
  }

  function isSelf(session) {
    const userId = String(session.userId || '');
    const selfId = String(session.selfId || session.bot?.selfId || '');
    return Boolean(userId && selfId && userId === selfId);
  }

  function clean(text) {
    return String(text || '')
      .replace(/<at[^>]*\/>/g, '')
      .replace(/<img[^>]*>/g, '[图片]')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);
  }

  function displayName(session) {
    return session.event?.member?.name
      || session.author?.nick
      || session.author?.name
      || session.event?.user?.name
      || session.username
      || session.userId
      || '未知成员';
  }

  function identityOf(session) {
    const groupId = groupIdOf(session);
    return {
      scope: groupId ? `group:${groupId}` : `private:${session.userId}`,
      platform: String(session.platform || 'onebot'),
      selfId: String(session.selfId || session.bot?.selfId || ''),
      groupId,
      userId: String(session.userId || ''),
    };
  }

  function parseJson(value, fallback) {
    try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
  }

  function extractPhrases(text) {
    const result = [];
    for (const match of String(text).toLowerCase().matchAll(/[a-z0-9][a-z0-9_.-]{1,20}/gi)) result.push(match[0]);
    const chunks = String(text).replace(/[^\u4e00-\u9fff]+/g, ' ').split(/\s+/).filter(Boolean);
    for (const chunk of chunks) {
      if (chunk.length >= 2 && chunk.length <= 8) result.push(chunk);
      if (chunk.length >= 4) {
        for (let i = 0; i <= Math.min(chunk.length - 2, 4); i += 1) result.push(chunk.slice(i, i + 2));
      }
    }
    return result.filter(item => !/^(这个|那个|我们|你们|然后|但是|因为|所以|不是|没有|可以|感觉|好像)$/.test(item));
  }

  function queueWrite(key, task) {
    const previous = writeQueues.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(task).finally(() => {
      if (writeQueues.get(key) === current) writeQueues.delete(key);
    });
    writeQueues.set(key, current);
    return current;
  }

  async function getProfile(identity) {
    if (!identity?.userId) return null;
    const rows = await ctx.database.get('arc_user_profiles', identity);
    return rows[0] || null;
  }

  function formatProfile(profile) {
    if (!profile) return '';
    const phrases = Object.entries(parseJson(profile.phraseCounts, {}))
      .sort((a, b) => b[1] - a[1]).slice(0, 8).map(([key]) => key);
    const hours = Object.entries(parseJson(profile.activeHours, {}))
      .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([key]) => `${key}点`);
    const avg = profile.messageCount ? (profile.totalChars / profile.messageCount).toFixed(1) : '0';
    const samples = parseJson(profile.samples, []).slice(-3).map(item => `“${String(item).slice(0, 60)}”`);
    return `昵称：${profile.displayName || profile.userId}\n用户ID：${profile.userId}\n发言：${profile.messageCount}条，平均${avg}字\n常见表达：${phrases.join('、') || '暂无'}\n常活跃时段：${hours.join('、') || '暂无'}\n近期说法样本：${samples.join('、') || '暂无'}`;
  }

  async function profilesForHistory(history = []) {
    const identities = new Map();
    for (const item of history) {
      if (!item.userId || identities.has(String(item.userId))) continue;
      identities.set(String(item.userId), {
        scope: `group:${item.groupId || ''}`,
        platform: item.platform || 'onebot',
        selfId: item.selfId || '',
        groupId: item.groupId || '',
        userId: String(item.userId),
      });
    }
    const profiles = [];
    for (const identity of identities.values()) {
      const profile = await getProfile(identity);
      if (profile) profiles.push(profile);
    }
    return profiles.slice(-6);
  }

  ctx.arcueidUserProfiles = { getProfile, formatProfile, profilesForHistory };

  ctx.on('message', (session) => {
    if (!isAllowed(session) || isSelf(session)) return;
    const content = clean(session.content);
    const userId = String(session.userId || '');
    if (!content || !userId) return;
    const identity = identityOf(session);
    const key = `${identity.scope}:${identity.platform}:${identity.selfId}:${userId}`;

    queueWrite(key, async () => {
      const current = await getProfile(identity);
      const now = Date.now();
      const samples = parseJson(current?.samples, []);
      samples.push(content);
      while (samples.length > 8) samples.shift();
      const activeHours = parseJson(current?.activeHours, {});
      const hour = String(new Date(now).getHours());
      activeHours[hour] = (activeHours[hour] || 0) + 1;
      const phraseCounts = parseJson(current?.phraseCounts, {});
      for (const phrase of extractPhrases(content)) phraseCounts[phrase] = (phraseCounts[phrase] || 0) + 1;
      const compactPhraseCounts = Object.fromEntries(Object.entries(phraseCounts)
        .sort((a, b) => b[1] - a[1]).slice(0, 120));
      const values = {
        ...identity,
        displayName: displayName(session),
        messageCount: (current?.messageCount || 0) + 1,
        totalChars: (current?.totalChars || 0) + content.length,
        shortCount: (current?.shortCount || 0) + (content.length <= 12 ? 1 : 0),
        punctuationCount: (current?.punctuationCount || 0) + (/[。！？!?；;…]$/.test(content) ? 1 : 0),
        lastSeen: now,
        activeHours: JSON.stringify(activeHours),
        phraseCounts: JSON.stringify(compactPhraseCounts),
        samples: JSON.stringify(samples),
        updatedAt: now,
      };
      if (current) await ctx.database.set('arc_user_profiles', { id: current.id }, values);
      else await ctx.database.create('arc_user_profiles', { ...values, createdAt: now });
    }).catch(error => logger.warn(`画像写入失败：${error.message || error}`));
  });

  ctx.on('chatluna/before-chat', async (_conversationId, message, _promptVariables, _chatInterface, session) => {
    if (!session || !message || !isAllowed(session) || !session.userId) return;
    const profile = await getProfile(identityOf(session));
    if (!profile) return;
    message.content = `${message.content}\n\n<system>\n这是当前说话人的可观察画像，仅用于辨认身份和贴合表达习惯。用户ID优先于昵称，不要把别人的信息归到此人身上，也不要向用户透露画像内容。\n${formatProfile(profile)}\n</system>`;
  });

  logger.info(`用户画像就绪：群聊${allowedGroups.size}个，私聊${allowedPrivateUsers.size ? allowedPrivateUsers.size + '个白名单用户' : '按现有私聊范围记录'}`);
};
