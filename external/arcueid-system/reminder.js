// 自然语言定时提醒 — SQLite 持久化
const { buildReplyStyleInstruction, sanitizeReply } = require('./reply-style');
const { config } = require('./config');
const { errorSummary, requestWithRetry } = require('./http-client');

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
    lastFiredReason: 'string',
    createdAt: 'unsigned'
  }, { autoInc: true });

  // ── AI 生成提醒消息 ──────────────────────────────
  const DEEPSEEK_KEY = config.deepseek.apiKey;
  const DEEPSEEK_MODEL = config.deepseek.model;
  const DEEPSEEK_URL = config.deepseek.chatUrl;

  if (!DEEPSEEK_KEY) {
    logger.warn('DEEPSEEK_API_KEY 未配置，提醒将使用兜底文案。');
  }

  async function generateReminderMsg(userMessage) {
    try {
      if (!DEEPSEEK_KEY) return `志贵，${userMessage}！`;
      const res = await requestWithRetry(ctx, 'post', DEEPSEEK_URL, {
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: '你是爱尔奎特，真祖的公主。志贵是你的远野志贵。现在到了志贵设定的提醒时间。用你的口吻自然提醒他，一两句话就好，不要用表情符号，像真人在聊天一样。' },
          { role: 'system', content: buildReplyStyleInstruction('reminder') },
          { role: 'user', content: `提醒事项：「${userMessage}」。现在时间到了，请自然地提醒志贵。` }
        ],
        max_tokens: 80, temperature: 0.9,
      }, {
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_KEY}` }
      }, {
        timeout: config.deepseek.timeoutMs,
        retries: config.http.retries,
        retryDelayMs: config.http.retryDelayMs,
      });
      return sanitizeReply(res?.choices?.[0]?.message?.content, { maxChars: 45 }) || `志贵，${userMessage}的时间到啦~`;
    } catch (e) {
      logger.warn(`【AI提醒生成失败】${errorSummary(e)}`);
      return `志贵，${userMessage}！`;
    }
  }

  // ── 时间解析 ──────────────────────────────────────
  const TIME_UNITS = { '分钟': 60*1000, '分': 60*1000, '小时': 60*60*1000, '时': 60*60*1000, '天': 24*60*60*1000, '周': 7*24*60*60*1000, '星期': 7*24*60*60*1000 };
  const PERIOD_MAP = { '凌晨':0, '早晨':7, '早上':7, '上午':9, '中午':12, '正午':12, '下午':13, '傍晚':17, '黄昏':17, '晚上':19, '夜里':21, '半夜':22 };
  const NUMBER_MAP = { '零':0, '〇':0, '一':1, '二':2, '两':2, '三':3, '四':4, '五':5, '六':6, '七':7, '八':8, '九':9, '十':10, '半':0.5 };

  function toDigit(str) {
    str = String(str || '').trim();
    if (!str) return null;
    if (/^\d+$/.test(str)) return parseInt(str, 10);
    if (str in NUMBER_MAP) return NUMBER_MAP[str];
    const tenParts = str.match(/^([一二两三四五六七八九])?十([一二两三四五六七八九])?$/);
    if (tenParts) {
      const tens = tenParts[1] ? NUMBER_MAP[tenParts[1]] : 1;
      const ones = tenParts[2] ? NUMBER_MAP[tenParts[2]] : 0;
      return tens * 10 + ones;
    }
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

    if (/(每天|每日|天天)/.test(text)) {
      return {
        daily: true,
        text: text
          .replace(/^(每天|每日|天天)\s*(都|也)?\s*(要|得|记得)?\s*/, '')
          .replace(/[，,。；;\s]*(每天|每日|天天)(都|也)?(要|得|记得)?\s*$/, '')
          .replace(/(天天|每天|每日)\s*(提醒|叫|喊|通知)/, '$2')
          .replace(/\s*(每天|每日|天天)\s*/g, '')
          .trim(),
      };
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
    const relMatch = msg.match(/^(\d+|[零〇一二两三四五六七八九十]+)\s*(分钟|分|小时|时|天|周|星期)\s*后?\s*(.+)$/);
    if (relMatch) {
      const num = toDigit(relMatch[1]) || 0;
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
    const dm = msg.match(/^(\d{1,2}|[零〇一二两三四五六七八九十]{1,3})\s*[点时：:]\s*(半|一刻|三刻|(\d{1,2}|[零〇一二两三四五六七八九十]{1,3})\s*分?)?/);
    if (dm) {
      hour = toDigit(dm[1]);
      if (dm[2] === '半') minute = 30;
      else if (dm[2] === '一刻') minute = 15;
      else if (dm[2] === '三刻') minute = 45;
      else if (dm[3]) minute = toDigit(dm[3]) || 0;
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
    const value = parseInt(new Date(ts).toLocaleString('en-US', { timeZone: 'Asia/Shanghai', [part]: '2-digit', hour12: false }).replace(/\D/g, ''));
    return part === 'hour' && value === 24 ? 0 : value;
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

  function initialLastFiredDayForDaily(hour, minute) {
    const nowBj = beijingNow();
    const dueMinute = (hour || 0) * 60 + (minute || 0);
    const nowMinute = nowBj.getHours() * 60 + nowBj.getMinutes();
    return nowMinute >= dueMinute ? beijingDayKey(nowBj) : null;
  }

  function initialDailyFireState(hour, minute, reason) {
    const lastFiredDay = initialLastFiredDayForDaily(hour, minute);
    return {
      lastFiredDay,
      lastFiredReason: lastFiredDay ? reason : null,
    };
  }

  function dailyStateText(r, nowBj = beijingNow()) {
    const today = beijingDayKey(nowBj);
    if (r.lastFiredDay === today) {
      if (r.lastFiredReason === 'sent') return '今天已触发';
      if (r.lastFiredReason === 'manual_done') return '今天已标记完成';
      if (r.lastFiredReason === 'failed') return '今天发送失败，明天会再试';
      if (r.lastFiredReason === 'created_after_due') return '今天设置时已过点，明天开始触发';
      if (r.lastFiredReason === 'edited_after_due') return '今天编辑时已过点，明天开始触发';
      if (r.lastFiredReason === 'restored_after_due') return '今天恢复时已过点，明天开始触发';
      return '今天已处理';
    }
    return dailyDue(r, nowBj) ? '今天待补发' : '还没到时间';
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

  async function buildReminderDiagnosticReply(session) {
    const uid = session.userId || session.author?.userId || 'unknown';
    const cid = session.channelId;
    const all = await ctx.database.get('reminders', { uid, channelId: cid });
    const enabled = all.filter(r => r.enabled);
    const daily = enabled.filter(r => r.isDaily);
    const once = enabled.filter(r => !r.isDaily);
    const nowBj = beijingNow();
    const today = beijingDayKey(nowBj);

    if (!all.length) {
      return `我查了一下，这个频道里现在没有你的提醒记录。\n如果你刚才只是聊天里说“怎么不提醒”，那不会自动补建提醒；重新说一次具体时间，比如“下午五点十分提醒我喝水”，我会按真实记录存下来。`;
    }

    let reply = `我查了真实提醒记录：现在 ${nowBj.toLocaleString('zh-CN')}，这个频道共有 ${all.length} 条记录，生效中 ${enabled.length} 条。`;
    if (!enabled.length) {
      const disabled = all.slice().sort((a, b) => b.createdAt - a.createdAt)[0];
      return `${reply}\n不过生效中的提醒没有了。最近一条是 #${disabled.id}「${disabled.message}」，状态是已取消或已完成。`;
    }

    const next = enabled.slice().sort((a, b) => reminderSortValue(a) - reminderSortValue(b))[0];
    reply += `\n最近一条生效提醒：${formatReminderLine(next)}`;

    if (daily.length) {
      reply += '\n每日提醒状态：';
      daily.sort((a, b) => reminderSortValue(a) - reminderSortValue(b)).forEach(r => {
        const state = dailyStateText(r, nowBj);
        reply += `\n#${r.id} ${pad2(r.hour)}:${pad2(r.minute)} ${state}「${r.message}」`;
      });
    }

    if (once.length) {
      reply += '\n一次性提醒：';
      once.sort((a, b) => reminderSortValue(a) - reminderSortValue(b)).slice(0, 3).forEach(r => {
        reply += `\n#${r.id} ${formatReminderTime(r)}「${r.message}」`;
      });
    }

    return `${reply}\n你也可以发“/提醒 诊断”看完整状态。`;
  }

  function parseDuration(text) {
    const match = (text || '').trim().match(/^(\d+|[零〇一二两三四五六七八九十]+)\s*(分钟|分|小时|时|天)$/);
    if (!match) return null;
    const num = toDigit(match[1]);
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
  const recentDeliveredReminders = new Map();
  const REMINDER_CONTEXT_TTL = config.reminder.contextTtlMs;

  function reminderContextKey(platform, channelId, uid) {
    return [platform || '', channelId || '', uid || ''].join(':');
  }

  function rememberDeliveredReminder(r, sentMessage) {
    const item = {
      channelId: r.channelId,
      uid: r.uid,
      platform: r.platform || '',
      selfId: r.selfId || '',
      reminderId: r.id,
      reminderMessage: r.message,
      sentMessage,
      sentAt: Date.now(),
      isDaily: !!r.isDaily,
    };
    recentDeliveredReminders.set(reminderContextKey(r.platform, r.channelId, r.uid), item);
    recentDeliveredReminders.set(reminderContextKey('', r.channelId, r.uid), item);
  }

  function getRecentDeliveredReminder(session) {
    const uid = session.userId || session.author?.userId || '';
    const keys = [
      reminderContextKey(session.platform, session.channelId, uid),
      reminderContextKey('', session.channelId, uid),
    ];
    const item = keys.map(key => recentDeliveredReminders.get(key)).find(Boolean);
    if (!item) return null;
    if (Date.now() - item.sentAt > REMINDER_CONTEXT_TTL) {
      keys.forEach(key => recentDeliveredReminders.delete(key));
      return null;
    }
    return item;
  }

  async function deliverReminder(r) {
    const bot = findBot(r);
    if (!bot) {
      logger.warn(`【契约待执行】找不到可用 bot，保留提醒 #${r.id}`);
      return false;
    }

    try {
      const msg = await generateReminderMsg(r.message);
      await bot.sendMessage(r.channelId, msg);
      rememberDeliveredReminder(r, msg);
      logger.info(`【契约执行】→ ${r.channelId}: "${msg}"`);
      return true;
    } catch (e) {
      logger.warn(`【契约执行失败】#${r.id} → ${r.channelId}: ${e.message}`);
      return false;
    }
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
              await ctx.database.set('reminders', { id: r.id }, { lastFiredDay: today, lastFiredReason: 'sent' });
            } else {
              await ctx.database.set('reminders', { id: r.id }, { lastFiredDay: today, lastFiredReason: 'failed' });
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
    ctx.setInterval(checkAndFire, config.reminder.checkIntervalMs);
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
          Object.assign(row, initialDailyFireState(row.hour, row.minute, 'created_after_due'));
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
          info += `\n类型: 🔁 每日\n时间: 每天 ${pad2(r.hour)}:${pad2(r.minute)}`;
          info += `\n今日状态: ${dailyStateText(r, nowBj)}`;
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
          Object.assign(updates, initialDailyFireState(updates.hour, updates.minute, 'edited_after_due'));
        } else {
          updates.fireAt = parsed.time.getTime();
          updates.hour = null;
          updates.minute = null;
          updates.lastFiredDay = null;
          updates.lastFiredReason = null;
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
          await ctx.database.set('reminders', { id: idx }, { lastFiredDay: beijingDayKey(beijingNow()), lastFiredReason: 'manual_done' });
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
        const r = items[0];
        const updates = { enabled: true };
        if (r.isDaily) {
          Object.assign(updates, initialDailyFireState(r.hour, r.minute, 'restored_after_due'));
        }
        await ctx.database.set('reminders', { id: idx }, updates);
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
        return buildReminderDiagnosticReply(session);
      }

      return '对我说「早上8点叫我起床」就行啦~ 输入 /提醒 帮助 查看更多。';
    });

  // ── 自然语言中间件 ───────────────────────────────
  const TRIGGER_WORDS = /提醒|叫我|喊我|通知我|记得叫我|记得提醒/;
  const REMINDER_TROUBLE_WORDS = /(?:怎么|咋|为什么|为啥|咋就).{0,8}(?:不|没|没有).{0,6}(?:提醒|叫我|通知我|触发|响)|(?:提醒|叫我|通知我).{0,8}(?:没响|没触发|没发|失效|坏了)/;

  ctx.middleware(async (session, next) => {
    const content = (session.content || '').toString().replace(/<at[^>]*\/>/g, '').trim();
    if (!content || content.startsWith('/') || content.startsWith('搜索') || content.startsWith('空想具象化')) return next();

    const recentReminder = getRecentDeliveredReminder(session);
    if (recentReminder && !/^(?:提醒|叫我|喊我|通知我|记得叫我|记得提醒)/.test(content)) {
      const firedAt = new Date(recentReminder.sentAt).toLocaleString('zh-CN');
      session.content = `${content}\n\n[系统指令：你刚刚在 ${firedAt} 主动提醒过用户。提醒内容是「${recentReminder.reminderMessage}」，你发送的提醒文本是「${recentReminder.sentMessage}」。当前这句是用户对刚才提醒的回应，请自然短句接话，先承认你刚刚已经提醒过，不要再说自己忘了提醒，也不要把对话带回到“是否已经提醒”这种怀疑上。一次只回应当前这句话的核心意思。]\n${buildReplyStyleInstruction('addressed')}`;
    }

    if (!TRIGGER_WORDS.test(content)) return next();

    if (REMINDER_TROUBLE_WORDS.test(content)) {
      await session.send(await buildReminderDiagnosticReply(session));
      return;
    }

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
      Object.assign(row, initialDailyFireState(row.hour, row.minute, 'created_after_due'));
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

    session.content = `[norender][系统指令：志贵刚才对你说「${content}」。你已经帮他设置好了${parsed.isDaily ? '每日' : '一次性'}提醒：${timeDesc}「${parsed.message}」。请用你的口吻自然回应志贵，确认你记住了。只说一句短话，绝对不要输出任何技术格式如 [定时:...] 或 [提醒:...]，不要复述完整提醒内容。]\n${buildReplyStyleInstruction('reminder')}`;
    return next();
  }, true);

  logger.info('时间契约就绪（SQLite）');
};
