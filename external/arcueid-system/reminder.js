// 自然语言定时提醒 — SQLite 持久化
module.exports.name = 'arcueid-reminder';
module.exports.using = ['database'];

module.exports.apply = (ctx) => {
  const logger = ctx.logger('时间契约');

  // ── 数据库表 ──────────────────────────────────────
  ctx.database.extend('reminders', {
    id: 'unsigned',
    uid: 'string',
    channelId: 'string',
    platform: 'string',
    selfId: 'string',
    hour: 'integer',
    minute: 'integer',
    fireAt: 'unsigned',
    message: 'text',
    isDaily: 'boolean',
    enabled: 'boolean',
    lastFiredDay: 'string',
    createdAt: 'unsigned'
  }, { autoInc: true });

  // ── AI 生成提醒消息 ──────────────────────────────
  const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;
  const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

  if (!DEEPSEEK_KEY) {
    logger.warn('DEEPSEEK_API_KEY 未配置，提醒将使用兜底文案。');
  }

  async function generateReminderMsg(userMessage) {
    try {
      if (!DEEPSEEK_KEY) return `志贵，${userMessage}！`;
      const res = await ctx.http.post(DEEPSEEK_URL, {
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: '你是爱尔奎特，真祖的公主。志贵是你的远野志贵。现在到了志贵设定的提醒时间。用你的口吻自然提醒他，一两句话就好，不要用表情符号，像真人在聊天一样。' },
          { role: 'user', content: `志贵之前说：「${userMessage}」。现在时间到了，请自然地提醒志贵。` }
        ],
        max_tokens: 80, temperature: 0.9,
      }, {
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_KEY}` }
      });
      return res?.choices?.[0]?.message?.content?.trim() || `志贵，${userMessage}的时间到啦~`;
    } catch (e) {
      logger.warn('【AI提醒生成失败】', e.message);
      return `志贵，${userMessage}！`;
    }
  }

  // ── 时间解析 ──────────────────────────────────────
  const TIME_UNITS = { '分钟': 60*1000, '分': 60*1000, '小时': 60*60*1000, '时': 60*60*1000, '天': 24*60*60*1000, '周': 7*24*60*60*1000, '星期': 7*24*60*60*1000 };
  const PERIOD_MAP = { '凌晨':0, '早晨':7, '早上':7, '上午':9, '中午':12, '正午':12, '下午':13, '傍晚':17, '黄昏':17, '晚上':19, '夜里':21, '半夜':22 };
  const NUMBER_MAP = { '一':1, '二':2, '两':2, '三':3, '四':4, '五':5, '六':6, '七':7, '八':8, '九':9, '十':10, '半':0.5 };

  function toDigit(str) {
    const map = { '零':0, '一':1, '二':2, '两':2, '三':3, '四':4, '五':5, '六':6, '七':7, '八':8, '九':9, '十':10 };
    if (str in map) return map[str];
    const n = parseInt(str);
    return isNaN(n) ? null : n;
  }

  function stripLeadingCommand(text) {
    return text
      .replace(/^(?:请)?(?:记得)?(?:提醒|叫|喊|通知)\s*(?:我|你)?\s*[:：,，]?\s*/, '')
      .trim();
  }

  function cleanReminderMessage(text) {
    return stripLeadingCommand(text)
      .replace(/^(?:我|你)\s*/, '')
      .replace(/[，,。；;：:\s]+$/, '')
      .trim();
  }

  function detectDaily(text) {
    text = text.replace(/^(?:请)?记得\s*/, '').trim();
    const patterns = [
      /^(每天|每日|天天)\s*/,
      /[，,。；;\s]*(每天|每日|天天)(都|也)?(要|得|记得)?$/,
      /(天天|每天|每日)(提醒|叫|喊|通知)/,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return {
          daily: true,
          text: text.replace(pattern, '').trim(),
        };
      }
    }

    return { daily: false, text };
  }

  function normalizeHour(hour, minute, periodName, periodBase) {
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

    if (periodBase >= 0) {
      if ((periodName === '凌晨' || periodName === '半夜') && hour === 12) hour = 0;
      else if (periodBase >= 13 && hour < 12) hour += 12;
    }

    if (hour < 0 || hour > 23) return null;
    return hour;
  }

  function parseTime(msg) {
    msg = stripLeadingCommand((msg || '').trim());

    // 1. 相对时间
    const relMatch = msg.match(/^(\d+|[一二两三四五六七八九十]+)\s*(分钟|分|小时|时|天|周|星期)\s*后?\s*(.+)$/);
    if (relMatch) {
      const num = parseInt(relMatch[1]) || (NUMBER_MAP[relMatch[1]] || 0);
      const unit = TIME_UNITS[relMatch[2]];
      const message = cleanReminderMessage(relMatch[3]);
      if (num > 0 && unit && message) return { time: new Date(Date.now() + num * unit), isDaily: false, message };
    }
    const halfMatch = msg.match(/^半\s*(小时|时|个?钟)\s*后?\s*(.+)$/);
    if (halfMatch) {
      const message = cleanReminderMessage(halfMatch[2]);
      if (message) return { time: new Date(Date.now() + 30*60*1000), isDaily: false, message };
    }

    // 2. 绝对时间
    let isDaily = false, dateOffset = 0;
    const daily = detectDaily(msg);
    if (daily.daily) {
      isDaily = true;
      msg = stripLeadingCommand(daily.text);
    }
    if (msg.startsWith('今天')) { msg = msg.slice(2); }
    if (msg.startsWith('明天')) { dateOffset = 1; msg = msg.slice(2); }
    if (msg.startsWith('后天')) { dateOffset = 2; msg = msg.slice(2); }
    msg = stripLeadingCommand(msg);

    let periodBase = -1, periodName = '';
    for (const [name, base] of Object.entries(PERIOD_MAP)) {
      if (msg.startsWith(name)) { periodName = name; periodBase = base; msg = msg.slice(name.length); break; }
    }

    let hour = null, minute = 0;
    const dm = msg.match(/^(\d{1,2}|[一二两三四五六七八九十]{1,2})\s*[点时：:]\s*(半|(\d{1,2})\s*分?)?/);
    if (dm) {
      hour = toDigit(dm[1]);
      if (dm[2] === '半') minute = 30; else if (dm[3]) minute = parseInt(dm[3]) || 0;
      msg = msg.slice(dm[0].length);
    }
    if (hour === null) {
      const tc = msg.match(/^(\d{1,2})\s*[:：]\s*(\d{2})/);
      if (tc) { hour = parseInt(tc[1]); minute = parseInt(tc[2]); msg = msg.slice(tc[0].length); }
    }
    if (msg.startsWith('半')) { minute = 30; msg = msg.slice(1); }
    if (hour === null) return null;

    hour = normalizeHour(hour, minute, periodName, periodBase);
    if (hour === null) return null;

    const message = cleanReminderMessage(msg);
    if (!message) return null;

    // 用东八区显式构造时间
    const nowBj = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
    nowBj.setDate(nowBj.getDate() + dateOffset);
    const yyyy = nowBj.getFullYear();
    const mm = String(nowBj.getMonth() + 1).padStart(2, '0');
    const dd = String(nowBj.getDate()).padStart(2, '0');
    const target = new Date(`${yyyy}-${mm}-${dd}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`);

    if (dateOffset === 0 && target.getTime() <= Date.now() && !isDaily) {
      target.setDate(target.getDate() + 1);
    }
    return { time: target, isDaily, message };
  }

  function cstPart(ts, part) {
    return parseInt(new Date(ts).toLocaleString('en-US', { timeZone: 'Asia/Shanghai', [part]: '2-digit', hour12: false }).replace(/\D/g, ''));
  }

  function reminderSortValue(r) {
    if (r.isDaily) return (r.hour || 0) * 60 + (r.minute || 0);
    return r.fireAt || 0;
  }

  function pad2(n) {
    return String(n || 0).padStart(2, '0');
  }

  function beijingNow() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  }

  function beijingDayKey(date = beijingNow()) {
    const y = date.getFullYear();
    const m = pad2(date.getMonth() + 1);
    const d = pad2(date.getDate());
    return `${y}-${m}-${d}`;
  }

  function dailyDue(r, nowBj) {
    const dueMinute = (r.hour || 0) * 60 + (r.minute || 0);
    const nowMinute = nowBj.getHours() * 60 + nowBj.getMinutes();
    return nowMinute >= dueMinute;
  }

  function formatReminderTime(r) {
    if (r.isDaily) return `每天 ${pad2(r.hour)}:${pad2(r.minute)}`;
    const h = cstPart(r.fireAt, 'hour');
    const m = cstPart(r.fireAt, 'minute');
    const mon = cstPart(r.fireAt, 'month');
    const day = cstPart(r.fireAt, 'day');
    const nowBj = beijingNow();
    const label = (mon === nowBj.getMonth() + 1 && day === nowBj.getDate()) ? '今天' : `${mon}/${day}`;
    return `${label} ${pad2(h)}:${pad2(m)}`;
  }

  function formatReminderLine(r) {
    const status = r.enabled ? '' : '（已取消）';
    const icon = r.isDaily ? '🔁' : '⏰';
    return `${icon} #${r.id} ${formatReminderTime(r)}${status}「${r.message}」`;
  }

  function parseDuration(text) {
    const match = (text || '').trim().match(/^(\d+|[一二两三四五六七八九十]+)\s*(分钟|分|小时|时|天)$/);
    if (!match) return null;
    const num = parseInt(match[1]) || NUMBER_MAP[match[1]];
    const unit = TIME_UNITS[match[2]];
    if (!num || !unit) return null;
    return num * unit;
  }

  function isTodayFireAt(ts) {
    if (!ts) return false;
    const d = new Date(new Date(ts).toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
    const now = beijingNow();
    return d.getFullYear() === now.getFullYear()
      && d.getMonth() === now.getMonth()
      && d.getDate() === now.getDate();
  }

  // ── 触发检查（每分钟） ──────────────────────────
  let checking = false;

  async function deliverReminder(r) {
    const bot = findBot(r);
    if (!bot) {
      logger.warn(`【契约待执行】找不到可用 bot，保留提醒 #${r.id}`);
      return false;
    }

    const msg = await generateReminderMsg(r.message);
    await bot.sendMessage(r.channelId, msg);
    logger.info(`【契约执行】→ ${r.channelId}: "${msg}"`);
    return true;
  }

  async function checkAndFire() {
    if (checking) return;
    checking = true;

    try {
      const now = Date.now();
      const beijing = beijingNow();
      const today = beijingDayKey(beijing);
      const all = await ctx.database.get('reminders', { enabled: true });
      const toRemove = [];

      for (const r of all) {
        if (r.isDaily) {
          if (dailyDue(r, beijing) && r.lastFiredDay !== today) {
            const sent = await deliverReminder(r);
            if (sent) {
              await ctx.database.set('reminders', { id: r.id }, { lastFiredDay: today });
            }
          }
        } else if (r.fireAt && r.fireAt <= now) {
          const sent = await deliverReminder(r);
          if (sent) {
            toRemove.push(r.id);
          }
        }
      }

      for (const id of toRemove) {
        await ctx.database.remove('reminders', { id });
      }
    } catch (e) {
      logger.error('【检查失败】', e.message);
    } finally {
      checking = false;
    }
  }

  function findBot(r) {
    if (r.platform && r.selfId) {
      const bot = ctx.bots[`${r.platform}:${r.selfId}`];
      if (bot) return bot;
    }
    for (const b of ctx.bots) {
      if (b && b.sendMessage) return b;
    }
    return null;
  }

  ctx.on('ready', () => {
    checkAndFire();
    ctx.setInterval(checkAndFire, 60000);
  });

  // ── 兜底：防止 LLM 幻觉出 [定时:...] ──────────────
  ctx.on('before-send', (session) => {
    if (typeof session.content === 'string') {
      session.content = session.content.replace(/\[定时[：:][^\]]+\]/g, '');
    }
  });

  // ── /提醒 CRUD ──────────────────────────────────
  ctx.command('提醒 [action] [args:text]', '管理定时提醒：设置/列表/编辑/取消/恢复/查看')
    .action(async ({ session }, action, args) => {
      const uid = session.userId || session.author?.userId || 'unknown';
      const cid = session.channelId;
      const now = Date.now();

      // 帮助
      if (!action || action === '帮助' || action === 'help') {
        return `📋 提醒管理：\n/提醒 设置 08:00 内容\n/提醒 设置 每天 08:00 内容\n/提醒 今天\n/提醒 列表\n/提醒 查看 <序号>\n/提醒 延后 <序号> 10分钟\n/提醒 完成 <序号>\n/提醒 编辑 <序号> 09:00 新内容\n/提醒 取消 <序号>\n/提醒 恢复 <序号>\n/提醒 删除 <序号>\n/提醒 诊断\n\n自然语言也可以：直接说「每天晚上10点提醒我睡觉」`;
      }

      // 设置
      if (action === '设置' || action === 'add' || action === 'set') {
        if (!args) return '格式：/提醒 设置 08:00 内容 或 /提醒 设置 每天 08:00 内容';
        const parsed = parseTime(args);
        if (!parsed) return '时间格式不对哦。比如：/提醒 设置 08:00 起床 或 /提醒 设置 每天 晚上10点 睡觉';
        const row = {
          uid, channelId: cid, platform: session.platform, selfId: session.selfId,
          message: parsed.message, isDaily: parsed.isDaily, enabled: true, createdAt: now
        };
        if (parsed.isDaily) {
          row.hour = cstPart(parsed.time.getTime(), 'hour');
          row.minute = cstPart(parsed.time.getTime(), 'minute');
          row.lastFiredDay = null;
        } else {
          row.fireAt = parsed.time.getTime();
        }
        const created = await ctx.database.create('reminders', row);
        const timeStr = formatReminderTime(row);
        logger.info(`【契约成立】#${created.id} ${parsed.isDaily ? '每日' : '一次性'} ${timeStr} "${parsed.message}"`);
        return `✅ 已设置。#${created.id} ${timeStr}「${parsed.message}」`;
      }

      // 列表
      if (action === '列表' || action === 'list') {
        const scope = { uid, channelId: cid };
        const showAll = args && /^(全部|all|所有|已取消|取消|disabled)$/i.test(args.trim());
        const showDisabledOnly = args && /^(已取消|取消|disabled)$/i.test(args.trim());
        if (!showAll) scope.enabled = true;
        const my = await ctx.database.get('reminders', scope);
        const visible = showDisabledOnly ? my.filter(r => !r.enabled) : my;
        if (!visible.length) return showAll ? '这里暂时没有提醒记录。' : '你还没有生效中的提醒哦。对我说「每天晚上10点提醒我睡觉」就可以啦~';
        let reply = showAll ? '📋 你的提醒（全部）：\n' : '📋 你的提醒：\n';
        visible.sort((a, b) => {
          if (a.isDaily !== b.isDaily) return a.isDaily ? -1 : 1;
          return reminderSortValue(a) - reminderSortValue(b);
        }).forEach(r => {
          reply += `\n${formatReminderLine(r)}`;
        });
        reply += '\n\n取消：/提醒 取消 <序号> | 编辑：/提醒 编辑 <序号> 新时间 新内容 | 删除：/提醒 删除 <序号>';
        return reply;
      }

      // 今天
      if (action === '今天' || action === 'today') {
        const all = await ctx.database.get('reminders', { uid, channelId: cid, enabled: true });
        const today = all.filter(r => r.isDaily || isTodayFireAt(r.fireAt));
        if (!today.length) return '今天没有生效中的提醒。';
        today.sort((a, b) => reminderSortValue(a) - reminderSortValue(b));
        let reply = '📅 今天的提醒：\n';
        today.forEach(r => reply += `\n${formatReminderLine(r)}`);
        reply += '\n\n可以用 /提醒 延后 <序号> 10分钟，或 /提醒 完成 <序号>';
        return reply;
      }

      // 查看详情
      if (action === '查看' || action === 'detail' || action === 'view') {
        if (!args) return '请输入要查看的提醒序号。';
        const idx = parseInt(args);
        if (isNaN(idx)) return '序号不对哦。';
        const items = await ctx.database.get('reminders', { id: idx, uid, channelId: cid });
        if (!items.length) return `没找到序号 ${idx} 的提醒。`;
        const r = items[0];
        let info = `📌 提醒 #${r.id}\n状态: ${r.enabled ? '✅ 生效中' : '❌ 已取消'}\n创建者: 你`;
        if (r.isDaily) {
          const nowBj = beijingNow();
          const due = dailyDue(r, nowBj);
          info += `\n类型: 🔁 每日\n时间: 每天 ${pad2(r.hour)}:${pad2(r.minute)}`;
          info += `\n今日状态: ${r.lastFiredDay === beijingDayKey(nowBj) ? '今天已触发' : due ? '今天待补发' : '等待时间到达'}`;
          if (r.lastFiredDay) info += `\n上次触发: ${r.lastFiredDay}`;
        } else {
          info += `\n类型: ⏰ 一次性\n时间: ${formatReminderTime(r)}`;
        }
        info += `\n内容: ${r.message}\n创建时间: ${new Date(r.createdAt).toLocaleString('zh-CN')}`;
        return info;
      }

      // 编辑
      if (action === '编辑' || action === 'edit' || action === 'update') {
        if (!args) return '格式：/提醒 编辑 <序号> 新时间 新内容';
        const parts = args.match(/^(\d+)\s+(.+)$/);
        if (!parts) return '格式：/提醒 编辑 1 每天 09:00 新内容';
        const idx = parseInt(parts[1]);
        if (isNaN(idx)) return '序号不对哦。';
        const items = await ctx.database.get('reminders', { id: idx, uid, channelId: cid });
        if (!items.length) return `没找到序号 ${idx} 的提醒。`;
        const parsed = parseTime(parts[2]);
        if (!parsed) return '时间格式不对。例如：/提醒 编辑 1 每天 09:00 新内容';
        const updates = {
          message: parsed.message, isDaily: parsed.isDaily
        };
        if (parsed.isDaily) {
          updates.hour = cstPart(parsed.time.getTime(), 'hour');
          updates.minute = cstPart(parsed.time.getTime(), 'minute');
          updates.fireAt = null;
          updates.lastFiredDay = null;
        } else {
          updates.fireAt = parsed.time.getTime();
          updates.hour = null;
          updates.minute = null;
          updates.lastFiredDay = null;
        }
        await ctx.database.set('reminders', { id: idx }, updates);
        logger.info(`【契约变更】#${idx} → "${parsed.message}"`);
        return `✅ 已更新。#${idx}「${parsed.message}」`;
      }

      // 延后
      if (action === '延后' || action === 'snooze' || action === 'delay') {
        if (!args) return '格式：/提醒 延后 <序号> 10分钟';
        const parts = args.match(/^#?(\d+)\s+(.+)$/);
        if (!parts) return '格式：/提醒 延后 1 10分钟';
        const idx = parseInt(parts[1]);
        const duration = parseDuration(parts[2]);
        if (isNaN(idx)) return '序号不对哦。';
        if (!duration) return '延后时间不对。例如：10分钟、半小时请写 30分钟、2小时。';
        const items = await ctx.database.get('reminders', { id: idx, uid, channelId: cid });
        if (!items.length) return `没找到序号 ${idx} 的提醒。`;
        const r = items[0];
        if (r.isDaily) return '每日提醒不能临时延后哦，可以用 /提醒 编辑 改它的固定时间。';
        const base = Math.max(Date.now(), r.fireAt || 0);
        const fireAt = base + duration;
        await ctx.database.set('reminders', { id: idx }, { fireAt, enabled: true });
        logger.info(`【契约延后】#${idx} → ${new Date(fireAt).toLocaleString('zh-CN')}`);
        return `⏳ 已延后。#${idx} 将在 ${formatReminderTime({ ...r, fireAt, isDaily: false })} 提醒你。`;
      }

      // 完成
      if (action === '完成' || action === 'done' || action === 'finish') {
        if (!args) return '格式：/提醒 完成 <序号>';
        const idx = parseInt(args.replace(/^#/, ''));
        if (isNaN(idx)) return '序号不对哦。';
        const items = await ctx.database.get('reminders', { id: idx, uid, channelId: cid });
        if (!items.length) return `没找到序号 ${idx} 的提醒。`;
        const r = items[0];
        if (r.isDaily) {
          await ctx.database.set('reminders', { id: idx }, { lastFiredDay: beijingDayKey(beijingNow()) });
          return `✅ 今天的每日提醒已标记完成：#${idx}「${r.message}」`;
        }
        await ctx.database.remove('reminders', { id: idx });
        return `✅ 已完成并移除：#${idx}「${r.message}」`;
      }

      // 取消
      if (action === '取消' || action === 'del' || action === 'delete') {
        if (!args) return '格式：/提醒 取消 <序号>';
        const idx = parseInt(args);
        if (isNaN(idx)) return '序号不对哦。';
        const items = await ctx.database.get('reminders', { id: idx, uid, channelId: cid });
        if (!items.length) return `没找到序号 ${idx} 的提醒。`;
        await ctx.database.set('reminders', { id: idx }, { enabled: false });
        logger.info(`【契约解除】#${idx} "${items[0].message}"`);
        return `🗑️ 已取消：#${idx}「${items[0].message}」（可 /提醒 恢复 ${idx}）`;
      }

      // 恢复
      if (action === '恢复' || action === 'restore' || action === 'undo') {
        if (!args) return '格式：/提醒 恢复 <序号>';
        const idx = parseInt(args);
        if (isNaN(idx)) return '序号不对哦。';
        const items = await ctx.database.get('reminders', { id: idx, uid, channelId: cid });
        if (!items.length) return `没找到序号 ${idx} 的提醒。`;
        await ctx.database.set('reminders', { id: idx }, { enabled: true });
        logger.info(`【契约恢复】#${idx} "${items[0].message}"`);
        return `✅ 已恢复：#${idx}「${items[0].message}」`;
      }

      // 删除
      if (action === '删除' || action === 'remove' || action === 'rm') {
        if (!args) return '格式：/提醒 删除 <序号>';
        const idx = parseInt(args);
        if (isNaN(idx)) return '序号不对哦。';
        const items = await ctx.database.get('reminders', { id: idx, uid, channelId: cid });
        if (!items.length) return `没找到序号 ${idx} 的提醒。`;
        await ctx.database.remove('reminders', { id: idx });
        logger.info(`【契约删除】#${idx} "${items[0].message}"`);
        return `✅ 已删除：#${idx}「${items[0].message}」`;
      }

      // 诊断
      if (action === '诊断' || action === 'status' || action === 'debug') {
        const all = await ctx.database.get('reminders', { uid, channelId: cid });
        const enabled = all.filter(r => r.enabled);
        const daily = enabled.filter(r => r.isDaily);
        const once = enabled.filter(r => !r.isDaily);
        const nowBj = beijingNow();
        const today = beijingDayKey(nowBj);
        let reply = `🩺 提醒诊断\n当前北京时间: ${nowBj.toLocaleString('zh-CN')}\n当前频道记录: ${all.length} 条\n生效中: ${enabled.length} 条（每日 ${daily.length}，一次性 ${once.length}）`;
        if (!daily.length) {
          reply += '\n\n没有生效中的每日提醒。';
        } else {
          reply += '\n\n每日提醒：';
          daily.sort((a, b) => reminderSortValue(a) - reminderSortValue(b)).forEach(r => {
            const state = r.lastFiredDay === today ? '今天已触发' : dailyDue(r, nowBj) ? '今天待补发' : '未到时间';
            reply += `\n#${r.id} ${pad2(r.hour)}:${pad2(r.minute)} ${state}，上次=${r.lastFiredDay || '无'}「${r.message}」`;
          });
        }
        return reply;
      }

      return '对我说「早上8点叫我起床」就行啦~ 输入 /提醒 帮助 查看更多。';
    });

  // ── 自然语言中间件 ───────────────────────────────
  const TRIGGER_WORDS = /提醒|叫我|喊我|通知我|记得叫我|记得提醒/;

  ctx.middleware(async (session, next) => {
    const content = (session.content || '').toString().replace(/<at[^>]*\/>/g, '').trim();
    if (!content || content.startsWith('/') || content.startsWith('搜索') || content.startsWith('空想具象化')) return next();
    if (!TRIGGER_WORDS.test(content)) return next();

    const parsed = parseTime(content);
    if (!parsed) return next();

    const uid = session.userId || session.author?.userId || 'unknown';
    const cid = session.channelId;
    const platform = session.platform;
    const selfId = session.selfId || session.bot?.selfId;

    const now = Date.now();
    const row = {
      uid, channelId: cid, platform, selfId,
      message: parsed.message,
      isDaily: parsed.isDaily, enabled: true,
      createdAt: now
    };

    if (parsed.isDaily) {
      row.hour = cstPart(parsed.time.getTime(), 'hour');
      row.minute = cstPart(parsed.time.getTime(), 'minute');
      row.lastFiredDay = null;
    } else {
      row.fireAt = parsed.time.getTime();
    }

    const created = await ctx.database.create('reminders', row);
    const id = created.id;

    const h = parsed.isDaily ? row.hour : cstPart(parsed.time.getTime(), 'hour');
    const m = parsed.isDaily ? row.minute : cstPart(parsed.time.getTime(), 'minute');
    const mon = cstPart(parsed.time.getTime(), 'month');
    const day = cstPart(parsed.time.getTime(), 'day');
    const timeDesc = parsed.isDaily
      ? `每天 ${pad2(h)}:${pad2(m)}`
      : `${mon}月${day}日 ${pad2(h)}:${pad2(m)}`;
    logger.info(`【契约成立】#${id} ${parsed.isDaily ? '每日' : '一次性'} ${timeDesc} "${parsed.message}"`);

    session.content = `[norender][系统指令：志贵刚才对你说「${content}」。你已经帮他设置好了${parsed.isDaily ? '每日' : '一次性'}提醒：${timeDesc}「${parsed.message}」。请用你的口吻自然回应志贵，确认你记住了。一两句话，绝对不要输出任何技术格式如 [定时:...] 或 [提醒:...]，就像普通聊天一样。]`;
    return next();
  }, true);

  logger.info('时间契约就绪（SQLite）');
};
