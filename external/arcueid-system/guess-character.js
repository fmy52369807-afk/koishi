module.exports.name = 'arcueid-guess-character'

const POOLS = {
  历史人物: [
    { name: '秦始皇', keywords: ['秦始皇', '嬴政', '始皇帝', '统一六国', '长城'], hint: '他和中国古代一次非常重要的统一有关。' },
    { name: '汉武帝', keywords: ['汉武帝', '刘彻', '汉朝', '霍去病', '张骞'], hint: '他的时代常和开疆、丝路这些词连在一起。' },
    { name: '诸葛亮', keywords: ['诸葛亮', '孔明', '卧龙', '三国', '蜀汉'], hint: '他在三国故事里以谋略出名。' },
    { name: '武则天', keywords: ['武则天', '则天', '女皇', '唐朝'], hint: '她在中国历史上的身份非常特殊。' },
    { name: '李白', keywords: ['李白', '诗仙', '唐诗'], hint: '他和酒、月亮、浪漫的诗意经常被放在一起。' },
    { name: '杜甫', keywords: ['杜甫', '诗圣'], hint: '他的诗常被拿来照见时代的苦难。' },
    { name: '成吉思汗', keywords: ['成吉思汗', '铁木真', '蒙古'], hint: '他的名字和草原、征服、蒙古紧密相连。' },
    { name: '拿破仑', keywords: ['拿破仑', '法国皇帝', '滑铁卢'], hint: '他的一生常和法国、皇帝、战争联系在一起。' },
    { name: '亚历山大大帝', keywords: ['亚历山大大帝', '马其顿', '希腊化'], hint: '他年纪轻轻就把版图推得非常远。' },
    { name: '奥古斯都', keywords: ['奥古斯都', '屋大维', '罗马帝国'], hint: '他和罗马从共和国走向帝国有关。' }
  ],
  动漫人物: [
    { name: '路飞', keywords: ['路飞', '蒙奇·D·路飞', '海贼王', '草帽'], hint: '他总是嚷着要成为某种王。' },
    { name: '鸣人', keywords: ['鸣人', '漩涡鸣人', '火影', '木叶'], hint: '他和忍者、村子、成为火影的梦想有关。' },
    { name: '佐助', keywords: ['佐助', '宇智波佐助', '火影'], hint: '他背着家族和复仇的影子。' },
    { name: '悟空', keywords: ['悟空', '孙悟空', '龙珠', '赛亚人'], hint: '他一打起来就会变得更强，头发也很有名。' },
    { name: '炭治郎', keywords: ['炭治郎', '灶门炭治郎', '鬼灭'], hint: '他为了家人踏上了斩鬼的路。' },
    { name: '雷姆', keywords: ['雷姆', 'Re:0', '从零开始的异世界生活'], hint: '她来自异世界作品，蓝色印象很强。' },
    { name: '初音未来', keywords: ['初音未来', '初音', 'V家', 'VOCALOID'], hint: '她不只是角色，也和虚拟歌声有关。' },
    { name: '阿尔托莉雅', keywords: ['阿尔托莉雅', 'Saber', '亚瑟王', 'Fate'], hint: '她和圣剑、骑士王、Fate 有关。' },
    { name: '五条悟', keywords: ['五条悟', '咒术回战', '最强咒术师'], hint: '他强得有些夸张，还常遮住眼睛。' },
    { name: '夜神月', keywords: ['夜神月', '死亡笔记', '基拉'], hint: '他的故事围绕一本危险的笔记展开。' }
  ],
  游戏人物: [
    { name: '马里奥', keywords: ['马里奥', '超级马里奥', '蘑菇王国'] },
    { name: '林克', keywords: ['林克', '塞尔达', '海拉鲁'] },
    { name: '劳拉·克劳馥', keywords: ['劳拉', '古墓丽影', '劳拉·克劳馥'] },
    { name: '杰洛特', keywords: ['杰洛特', '巫师', '白狼'] },
    { name: '奎托斯', keywords: ['奎托斯', '战神'] },
    { name: '艾吉奥', keywords: ['艾吉奥', '刺客信条'] },
    { name: '萨姆斯', keywords: ['萨姆斯', '银河战士'] },
    { name: '春丽', keywords: ['春丽', '街霸', '街头霸王'] },
    { name: '八神庵', keywords: ['八神庵', 'KOF', '拳皇'] },
    { name: '蒂法', keywords: ['蒂法', '最终幻想', 'FF7'] }
  ],
  神话人物: [
    { name: '宙斯', keywords: ['宙斯', '奥林匹斯', '希腊神话'] },
    { name: '雅典娜', keywords: ['雅典娜', '智慧女神'] },
    { name: '奥丁', keywords: ['奥丁', '北欧神话', '独眼'] },
    { name: '索尔', keywords: ['索尔', '雷神', '北欧神话'] },
    { name: '洛基', keywords: ['洛基', '北欧神话', '诡计之神'] },
    { name: '哪吒', keywords: ['哪吒', '三坛海会大神'] },
    { name: '孙悟空', keywords: ['孙悟空', '齐天大圣', '西游记'] },
    { name: '女娲', keywords: ['女娲', '补天'] },
    { name: '后羿', keywords: ['后羿', '射日'] },
    { name: '波塞冬', keywords: ['波塞冬', '海神'] }
  ]
}

const ALL = Object.entries(POOLS).flatMap(([category, list]) => list.map(item => ({ ...item, category })))
const GAME_PREFIX = '猜人物'
const TTL = 20 * 60 * 1000
const states = new Map()

function randomPick(list) {
  return list[Math.floor(Math.random() * list.length)]
}

function normalize(text) {
  return (text || '')
    .toString()
    .replace(/<at[^>]*\/>/g, '')
    .trim()
}

function stripCommandPrefix(text) {
  return normalize(text)
    .replace(/^[\/!！]\s*/, '')
    .trim()
}

function roomKey(session) {
  return `${session.platform}:${session.channelId || session.userId || 'private'}`
}

function now() {
  return Date.now()
}

function getState(session) {
  return states.get(roomKey(session))
}

function clearExpired() {
  const ts = now()
  for (const [key, state] of states) {
    if (ts - state.updatedAt > TTL) states.delete(key)
  }
}

function fuzzyHit(text, keywords) {
  return keywords.some(k => text.includes(k))
}

function pickPool(category) {
  if (!category || category === '随机') return randomPick(ALL)
  return randomPick(POOLS[category] || ALL)
}

function categoryNames() {
  return Object.keys(POOLS).join('、')
}

function introLine(state) {
  const openers = [
    '我已经在心里藏好一个人了。你可以开始问我。',
    '人物已经选定。来试着把他、她或它问出来吧。',
    '我想好了。现在轮到你来拆线索了。'
  ]
  return `${randomPick(openers)}`
}

function yesLine(state) {
  const lines = [
    '嗯，是的，这条线你摸对了。',
    '对，答案在这边，继续往前走。',
    '是哦，你问到点子上了。'
  ]
  return randomPick(lines)
}

function noLine(state) {
  const lines = [
    '不是，这条路不通，别让它把你带偏了。',
    '不对，不过你已经很接近谜面边缘了。',
    '否定啦。再换个方向试试。'
  ]
  return randomPick(lines)
}

function unsureLine(state) {
  const lines = [
    '这个我不能老实点头，太模糊了。',
    '唔，这个问题问得有点飘，我只能给你一个不太确定的答案。',
    '我现在没法干脆地下结论，换个问法吧。'
  ]
  return randomPick(lines)
}

function hintLine(state) {
  const hint = state.target.hint || `我想的人物属于「${state.category}」。`
  const lines = [
    `我可以再放一点风声：${hint}`,
    `给你一条小线索：${hint}`,
    `别急，我松一点口风：${hint}`
  ]
  return randomPick(lines)
}

function isGameQuestion(text) {
  return /[？?]$/.test(text)
    || /[吗么呢]$/.test(text)
    || /(是不是|是否|有没有|会不会|能不能|难道|莫非)/.test(text)
    || /(跟|和|与).{1,12}(有关|有关系|相关|联系)/.test(text)
    || /(属于|来自|出自|源自|代表|象征)/.test(text)
    || /^(是|不是|他是|她是|它是|这位是|这个是|会是)/.test(text)
}

function fallbackIntent(text) {
  const t = text.toLowerCase()
  if (t.includes('提示') || t.includes('线索') || t.includes('hint')) return { intent: 'hint' }
  if (/(放弃|结束|不猜了|认输|算了)/.test(text)) return { intent: 'giveup' }
  if (isGameQuestion(text)) return { intent: 'question' }
  return { intent: 'chat' }
}

function evaluateQuestion(state, text) {
  const target = state.target
  const t = text.toLowerCase()
  const yes = fuzzyHit(text, target.keywords)
  const patternNo = /是不是|是否|会不会|能不能|有没有|他\/她\/它|男性|女性|人类|虚构|现实|历史|动漫|游戏|神话|中国|日本|欧洲|古代|现代|真名|别名/.test(text)

  if (yes) return { answer: 'yes', line: yesLine(state), hint: hintLine(state) }

  if (t.includes('提示') || t.includes('线索') || t.includes('hint')) {
    return { answer: 'hint', line: hintLine(state) }
  }

  if (/是谁|什么人|哪个|哪位|是哪一个/.test(text)) {
    return { answer: 'maybe', line: unsureLine(state), hint: hintLine(state) }
  }

  if (patternNo) return { answer: 'no', line: noLine(state), hint: state.questions >= 4 ? hintLine(state) : '' }

  return { answer: 'unknown', line: unsureLine(state) }
}

module.exports.apply = (ctx) => {
  const logger = ctx.logger('人物猜谜')
  const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY
  const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions'

  async function judgeWithAi(state, question) {
    if (!DEEPSEEK_KEY) return null
    try {
      const res = await ctx.http.post(DEEPSEEK_URL, {
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: '你是猜人物游戏的裁判。隐藏答案会给你。用户会问一个中文问题。你只能判断这个问题对隐藏人物而言答案是 yes、no、unknown、guess 四种之一。若用户直接猜中人物名字或明显别名，返回 guess。只返回 JSON，不要解释。格式：{"verdict":"yes|no|unknown|guess"}'
          },
          {
            role: 'user',
            content: `隐藏人物：${state.target.name}\n类别：${state.category}\n可识别别名：${state.target.keywords.join('、')}\n用户问题：${question}`
          }
        ],
        max_tokens: 40,
        temperature: 0
      }, {
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_KEY}` }
      })
      const text = res?.choices?.[0]?.message?.content?.trim() || ''
      const match = text.match(/\{[\s\S]*\}/)
      if (!match) return null
      const parsed = JSON.parse(match[0])
      if (['yes', 'no', 'unknown', 'guess'].includes(parsed.verdict)) return parsed.verdict
    } catch (err) {
      logger.warn('AI 判定失败，使用本地兜底：%s', err.message)
    }
    return null
  }

  async function analyzeGameInput(state, content) {
    if (!DEEPSEEK_KEY) return fallbackIntent(content)
    try {
      const res = await ctx.http.post(DEEPSEEK_URL, {
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: [
              '你是猜人物游戏的路由裁判。机器人心里藏着一个隐藏人物，用户可能在提问、索要提示、放弃、或只是闲聊。',
              '你的任务有两步：',
              '1. 判断用户这句话在当前游戏中属于 intent：question、hint、giveup、chat。',
              'question 包括任何自然问法、间接问法、属性判断、关系判断、类别判断、直接猜人物名。chat 是和猜人物判定无关的普通聊天或吐槽。',
              '2. 如果 intent 是 question，再判断隐藏人物对应答案 verdict：yes、no、unknown、guess。直接猜中隐藏人物或明显别名时 verdict 为 guess。',
              '只返回 JSON，不要解释。格式：{"intent":"question|hint|giveup|chat","verdict":"yes|no|unknown|guess|null"}'
            ].join('\n')
          },
          {
            role: 'user',
            content: `隐藏人物：${state.target.name}\n类别：${state.category}\n可识别别名：${state.target.keywords.join('、')}\n用户消息：${content}`
          }
        ],
        max_tokens: 80,
        temperature: 0
      }, {
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_KEY}` }
      })
      const text = res?.choices?.[0]?.message?.content?.trim() || ''
      const match = text.match(/\{[\s\S]*\}/)
      if (!match) return fallbackIntent(content)
      const parsed = JSON.parse(match[0])
      if (!['question', 'hint', 'giveup', 'chat'].includes(parsed.intent)) return fallbackIntent(content)
      if (parsed.intent === 'question' && !['yes', 'no', 'unknown', 'guess'].includes(parsed.verdict)) {
        return { intent: 'question', verdict: null }
      }
      return { intent: parsed.intent, verdict: parsed.verdict || null }
    } catch (err) {
      logger.warn('AI 意图识别失败，使用本地兜底：%s', err.message)
      return fallbackIntent(content)
    }
  }

  function verdictToReply(state, verdict) {
    if (verdict === 'yes') return { answer: 'yes', line: yesLine(state), hint: hintLine(state) }
    if (verdict === 'no') return { answer: 'no', line: noLine(state), hint: state.questions >= 4 ? hintLine(state) : '' }
    if (verdict === 'guess') return { answer: 'guess', line: `答对了，就是「${state.target.name}」。哼，居然被你抓到了。` }
    return { answer: 'unknown', line: unsureLine(state) }
  }

  ctx.setInterval(clearExpired, 5 * 60 * 1000)

  function beginGame(session, category) {
    const target = pickPool(category)
    const state = {
      target,
      category: target.category,
      questions: 0,
      startedAt: now(),
      updatedAt: now()
    }
    states.set(roomKey(session), state)
    return state
  }

  async function handleGameCommand(session, action, args) {
    const state = getState(session)

    if (!action || action === '帮助' || action === 'help') {
      await session.send(`🎭 猜人物：\n/猜人物 开始 [随机|${categoryNames()}]\n/猜人物 提示\n/猜人物 放弃\n/猜人物 结束\n\n开始后直接提问也可以，比如：\n“他是历史人物吗？”`)
      return
    }

    if (action === '开始' || action === 'start' || action === 'new') {
      const category = args && POOLS[args.trim()] ? args.trim() : '随机'
      const next = beginGame(session, category)
      await session.send(`🎲 新局开始。${introLine(next)}\n类别：${next.category}`)
      return
    }

    if (action === '提示' || action === 'hint') {
      if (!state) return session.send('还没有正在进行的局。先用 /猜人物 开始 开一局。')
      await session.send(`🔎 ${hintLine(state)}`)
      return
    }

    if (action === '放弃' || action === '结束' || action === 'stop' || action === 'end') {
      if (!state) return session.send('现在没有在玩的局。')
      states.delete(roomKey(session))
      await session.send(`好吧，这一局先收起来。答案是「${state.target.name}」。`)
      return
    }

    if (action === '类别' || action === 'category') {
      await session.send(`可选类别：${categoryNames()}。也可以直接用 /猜人物 开始 随机。`)
      return
    }

    await session.send('输入 /猜人物 帮助 看规则。')
  }

  ctx.command('猜人物 [action] [args:text]', '一个回答是/不是的人物猜谜游戏')
    .action(async ({ session }, action, args) => {
      await handleGameCommand(session, action, args)
    })

  ctx.middleware(async (session, next) => {
    let content = normalize(session.content)
    if (!content || content.includes('[norender]')) return next()

    const commandText = stripCommandPrefix(content)
    if (commandText === GAME_PREFIX || commandText.startsWith(`${GAME_PREFIX} `)) {
      const rest = commandText.slice(GAME_PREFIX.length).trim()
      const match = rest.match(/^(\S+)(?:\s+([\s\S]+))?$/)
      await handleGameCommand(session, match?.[1], match?.[2])
      return
    }

    if (content.startsWith('/')) return next()

    const state = getState(session)
    if (!state) return next()

    if (content.length < 2) return next()

    const analysis = await analyzeGameInput(state, content)
    if (analysis.intent === 'chat') return next()
    if (analysis.intent === 'hint') {
      state.updatedAt = now()
      await session.send(`🔎 ${hintLine(state)}`)
      return
    }
    if (analysis.intent === 'giveup') {
      states.delete(roomKey(session))
      await session.send(`好吧，这一局先收起来。答案是「${state.target.name}」。`)
      return
    }
    if (analysis.intent !== 'question') return next()

    state.questions += 1
    state.updatedAt = now()

    const aiVerdict = analysis.verdict || await judgeWithAi(state, content)
    const verdict = aiVerdict ? verdictToReply(state, aiVerdict) : evaluateQuestion(state, content)

    if (verdict.answer === 'guess') {
      states.delete(roomKey(session))
      session.send(verdict.line)
      return
    }
    const mood = state.questions <= 2
      ? '你可以继续顺着这条线摸下去。'
      : state.questions <= 5
        ? '已经有点接近了，别急着跳结论。'
        : '你这局问得很认真，我都开始替你捏一把汗了。'

    let reply = `${verdict.line} ${mood}`
    if (verdict.hint && state.questions >= 3) reply += ` ${verdict.hint}`

    session.send(reply.trim())
    return
  }, true)

  logger.info('人物猜谜就绪')
}
