const test = require('node:test');
const assert = require('node:assert/strict');
const reminder = require('../external/arcueid-system/reminder');

function matches(row, query) {
  return Object.entries(query).every(([key, value]) => row[key] === value);
}

function createDatabase() {
  const rows = [];
  let nextId = 1;
  return {
    schemas: new Map(),
    extend(name, schema) {
      this.schemas.set(name, schema);
    },
    async create(name, row) {
      const stored = { ...row, id: nextId++ };
      rows.push(stored);
      return { ...stored };
    },
    async get(name, query) {
      return rows.filter(row => matches(row, query)).map(row => ({ ...row }));
    },
    async set(name, query, update) {
      rows.filter(row => matches(row, query)).forEach(row => Object.assign(row, update));
    },
    async remove(name, query) {
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (matches(rows[index], query)) rows.splice(index, 1);
      }
    },
  };
}

function createContext() {
  const database = createDatabase();
  const commands = new Map();
  return {
    database,
    commands,
    logger() {
      return { info() {}, warn() {}, error() {} };
    },
    on() {},
    middleware() {},
    setInterval() {},
    command(name) {
      return {
        action(handler) {
          commands.set(name, handler);
          return this;
        },
      };
    },
  };
}

test('reminder command persists, lists, and cancels scoped reminders', async () => {
  const ctx = createContext();
  reminder.apply(ctx);
  const handler = ctx.commands.get('提醒 [action] [args:text]');
  const session = { userId: 'demo-user', channelId: 'demo-channel', platform: 'onebot', selfId: 'demo-bot' };

  const created = await handler({ session }, '设置', '10分钟后 完成公开作品文档');
  assert.match(created, /已设置/);
  assert.equal(ctx.database.schemas.has('reminders'), true);
  assert.equal((await ctx.database.get('reminders', { uid: 'demo-user', channelId: 'demo-channel' })).length, 1);

  const listed = await handler({ session }, '列表');
  assert.match(listed, /完成公开作品文档/);

  const cancelled = await handler({ session }, '取消', '1');
  assert.match(cancelled, /已取消/);
  const active = await ctx.database.get('reminders', { uid: 'demo-user', channelId: 'demo-channel', enabled: true });
  assert.equal(active.length, 0);
});
