module.exports.name = 'arcueid-personal-assistant';
module.exports.using = ['database'];

module.exports.apply = (ctx) => {
  const logger = ctx.logger('生活侧写');

  ctx.database.extend('arc_todos', {
    id: 'unsigned',
    uid: 'string',
    channelId: 'string',
    platform: 'string',
    selfId: 'string',
    content: 'text',
    done: 'boolean',
    createdAt: 'unsigned',
    updatedAt: 'unsigned',
    doneAt: 'unsigned'
  }, { autoInc: true });

  ctx.database.extend('arc_memories', {
    id: 'unsigned',
    uid: 'string',
    channelId: 'string',
    platform: 'string',
    selfId: 'string',
    content: 'text',
    tags: 'string',
    enabled: 'boolean',
    createdAt: 'unsigned',
    updatedAt: 'unsigned'
  }, { autoInc: true });

  const getUid = (session) => session.userId || session.author?.userId || 'unknown';
  const clean = (text) => (text || '').toString().replace(/<at[^>]*\/>/g, '').trim();
  const now = () => Date.now();

  function formatTodo(todo) {
    return `${todo.done ? '✓' : '□'} #${todo.id} ${todo.content}`;
  }

  function formatMemory(memory) {
    const tags = memory.tags ? ` [${memory.tags}]` : '';
    return `#${memory.id}${tags} ${memory.content}`;
  }

  function parseTodoItems(text) {
    return text
      .split(/[\n；;]/)
      .map(item => item.replace(/^[-*、\d.\s]+/, '').trim())
      .filter(Boolean);
  }

  async function createTodo(session, content) {
    const item = {
      uid: getUid(session),
      channelId: session.channelId,
      platform: session.platform,
      selfId: session.selfId || session.bot?.selfId,
      content,
      done: false,
      createdAt: now(),
      updatedAt: now()
    };
    const created = await ctx.database.create('arc_todos', item);
    logger.info(`新增待办 #${created.id}: ${content}`);
    return created;
  }

  async function createMemory(session, content, tags = '') {
    const item = {
      uid: getUid(session),
      channelId: session.channelId,
      platform: session.platform,
      selfId: session.selfId || session.bot?.selfId,
      content,
      tags,
      enabled: true,
      createdAt: now(),
      updatedAt: now()
    };
    const created = await ctx.database.create('arc_memories', item);
    logger.info(`新增记忆 #${created.id}: ${content}`);
    return created;
  }

  ctx.command('待办 [action] [args:text]', '管理待办：添加/列表/完成/编辑/删除/清理')
    .action(async ({ session }, action, args) => {
      const uid = getUid(session);
      const channelId = session.channelId;

      if (!action || action === '帮助' || action === 'help') {
        return '📝 待办：\n/待办 添加 买牛奶；写报告\n/待办 列表\n/待办 完成 <序号>\n/待办 编辑 <序号> 新内容\n/待办 删除 <序号>\n/待办 清理';
      }

      if (action === '添加' || action === 'add') {
        if (!args) return '格式：/待办 添加 买牛奶；写报告';
        const items = parseTodoItems(args);
        if (!items.length) return '没有看到要记录的待办。';
        const created = [];
        for (const item of items) created.push(await createTodo(session, item));
        return `✅ 已加入待办：${created.map(t => `#${t.id}`).join('、')}`;
      }

      if (action === '列表' || action === 'list' || action === '今天') {
        const showAll = args && /^(全部|all|已完成|done)$/i.test(args.trim());
        const items = await ctx.database.get('arc_todos', showAll ? { uid, channelId } : { uid, channelId, done: false });
        if (!items.length) return showAll ? '还没有待办记录。' : '现在没有未完成待办。';
        items.sort((a, b) => (a.done - b.done) || a.createdAt - b.createdAt);
        return `📝 你的待办：\n${items.map(formatTodo).join('\n')}\n\n完成：/待办 完成 <序号>`;
      }

      if (action === '完成' || action === 'done' || action === 'finish') {
        if (!args) return '格式：/待办 完成 <序号>';
        const id = parseInt(args.replace(/^#/, ''));
        if (isNaN(id)) return '序号不对哦。';
        const items = await ctx.database.get('arc_todos', { id, uid, channelId });
        if (!items.length) return `没找到待办 #${id}。`;
        await ctx.database.set('arc_todos', { id }, { done: true, doneAt: now(), updatedAt: now() });
        return `✅ 完成：#${id} ${items[0].content}`;
      }

      if (action === '编辑' || action === 'edit') {
        const match = (args || '').match(/^#?(\d+)\s+(.+)$/);
        if (!match) return '格式：/待办 编辑 <序号> 新内容';
        const id = parseInt(match[1]);
        const content = match[2].trim();
        const items = await ctx.database.get('arc_todos', { id, uid, channelId });
        if (!items.length) return `没找到待办 #${id}。`;
        await ctx.database.set('arc_todos', { id }, { content, updatedAt: now() });
        return `✅ 已更新：#${id} ${content}`;
      }

      if (action === '删除' || action === 'remove' || action === 'rm') {
        if (!args) return '格式：/待办 删除 <序号>';
        const id = parseInt(args.replace(/^#/, ''));
        if (isNaN(id)) return '序号不对哦。';
        const items = await ctx.database.get('arc_todos', { id, uid, channelId });
        if (!items.length) return `没找到待办 #${id}。`;
        await ctx.database.remove('arc_todos', { id });
        return `🗑️ 已删除：#${id} ${items[0].content}`;
      }

      if (action === '清理' || action === 'clear') {
        const done = await ctx.database.get('arc_todos', { uid, channelId, done: true });
        if (!done.length) return '没有已完成待办需要清理。';
        await ctx.database.remove('arc_todos', { uid, channelId, done: true });
        return `🧹 已清理 ${done.length} 条已完成待办。`;
      }

      return '输入 /待办 帮助 查看用法。';
    });

  ctx.command('记忆 [action] [args:text]', '管理个人记忆：添加/列表/查找/编辑/忘记')
    .action(async ({ session }, action, args) => {
      const uid = getUid(session);
      const channelId = session.channelId;

      if (!action || action === '帮助' || action === 'help') {
        return '🧠 记忆：\n/记忆 添加 我不喜欢太正式的语气\n/记忆 列表\n/记忆 查找 语气\n/记忆 编辑 <序号> 新内容\n/记忆 忘记 <序号>';
      }

      if (action === '添加' || action === 'add') {
        if (!args) return '格式：/记忆 添加 要记住的内容';
        const created = await createMemory(session, args.trim());
        return `✅ 我记住了。#${created.id} ${created.content}`;
      }

      if (action === '列表' || action === 'list') {
        const items = await ctx.database.get('arc_memories', { uid, channelId, enabled: true });
        if (!items.length) return '现在还没有可控记忆。';
        items.sort((a, b) => b.updatedAt - a.updatedAt);
        return `🧠 我现在记得：\n${items.slice(0, 20).map(formatMemory).join('\n')}`;
      }

      if (action === '查找' || action === '搜索' || action === 'find') {
        if (!args) return '格式：/记忆 查找 关键词';
        const keyword = args.trim();
        const items = await ctx.database.get('arc_memories', { uid, channelId, enabled: true });
        const found = items.filter(m => m.content.includes(keyword) || (m.tags || '').includes(keyword));
        if (!found.length) return `没有找到包含「${keyword}」的记忆。`;
        return `🔎 相关记忆：\n${found.slice(0, 10).map(formatMemory).join('\n')}`;
      }

      if (action === '编辑' || action === 'edit') {
        const match = (args || '').match(/^#?(\d+)\s+(.+)$/);
        if (!match) return '格式：/记忆 编辑 <序号> 新内容';
        const id = parseInt(match[1]);
        const content = match[2].trim();
        const items = await ctx.database.get('arc_memories', { id, uid, channelId });
        if (!items.length) return `没找到记忆 #${id}。`;
        await ctx.database.set('arc_memories', { id }, { content, updatedAt: now() });
        return `✅ 已更新记忆：#${id} ${content}`;
      }

      if (action === '忘记' || action === '删除' || action === 'remove') {
        if (!args) return '格式：/记忆 忘记 <序号>';
        const id = parseInt(args.replace(/^#/, ''));
        if (isNaN(id)) return '序号不对哦。';
        const items = await ctx.database.get('arc_memories', { id, uid, channelId });
        if (!items.length) return `没找到记忆 #${id}。`;
        await ctx.database.set('arc_memories', { id }, { enabled: false, updatedAt: now() });
        return `🗑️ 好，我忘掉这条：#${id} ${items[0].content}`;
      }

      return '输入 /记忆 帮助 查看用法。';
    });

  ctx.middleware(async (session, next) => {
    const content = clean(session.content);
    if (!content || content.startsWith('/') || content.includes('[norender]')) return next();

    const todoMatch = content.match(/^(?:帮我)?(?:记一?个?待办|加一?个?待办|待办[:：])\s*(.+)$/);
    if (todoMatch) {
      const items = parseTodoItems(todoMatch[1]);
      if (!items.length) return next();
      const created = [];
      for (const item of items) created.push(await createTodo(session, item));
      session.content = `[norender][系统指令：志贵刚才说「${content}」。你已经帮他加入待办：${items.join('；')}。请自然确认，一句话就好。]`;
      return next();
    }

    const memoryMatch = content.match(/^(?:你)?(?:记住|记一下|帮我记住)[:：,，]?\s*(.+)$/);
    if (memoryMatch) {
      const memory = memoryMatch[1].trim();
      if (!memory) return next();
      await createMemory(session, memory);
      session.content = `[norender][系统指令：志贵刚才说「${content}」。你已经把这条作为可控记忆保存：「${memory}」。请自然确认，一句话就好。]`;
      return next();
    }

    const uid = getUid(session);
    const channelId = session.channelId;
    const memories = await ctx.database.get('arc_memories', { uid, channelId, enabled: true });
    if (memories.length) {
      const related = memories
        .filter(m => {
          const words = m.content.match(/[\u4e00-\u9fa5]{2,}|[a-zA-Z0-9_]{3,}/g) || [];
          return words.some(w => content.includes(w));
        })
        .slice(0, 3);
      if (related.length) {
        session.content += `\n\n<system>以下是用户主动要求你记住的偏好或事实，必要时自然参考，不要逐条复述：\n${related.map(m => `- ${m.content}`).join('\n')}</system>`;
      }
    }

    return next();
  }, true);

  logger.info('生活侧写就绪（待办 / 可控记忆）');
};
