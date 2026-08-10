const { h } = require('koishi')
const fs = require('fs')
const path = require('path')
const { config } = require('./config')
const { errorSummary, requestWithRetry } = require('./http-client')

module.exports.name = 'arcueid-vector-rag'

// ── Vector store (Float32Array-backed, pre-normalized) ──────────────
const DIM = config.rag.dimension   // BAAI/bge-m3

let numVectors = 0
let vectors = null   // Float32Array, flat layout: [v0[0..1023], v1[0..1023], …]
let texts = []        // parallel string array
let termIndex = new Map()

function storeSize() {
  return numVectors
}

const GENERIC_TERMS = new Set([
  '这个', '那个', '什么', '怎么', '为什么', '如何', '是否', '是不是', '可以', '知道',
  '介绍', '解释', '内容', '资料', '问题', '一下', '一些', '一个', '一种', '这里',
  '那里', '我们', '你们', '他们', '她们', '以及', '因为', '所以', '但是', '不过',
  '如果', '然后', '比较', '相关', '关于', '系统', '用户', '志贵',
])

function extractTerms(text, maxTerms = config.rag.termIndexMaxTermsPerText) {
  const value = String(text || '').toLowerCase()
  const terms = new Set()

  for (const match of value.matchAll(/[a-z0-9][a-z0-9_.-]{1,31}/gi)) {
    const token = match[0]
    if (!/^\d+$/.test(token)) terms.add(token)
    if (terms.size >= maxTerms) return [...terms]
  }

  const chineseChunks = value
    .replace(/[^\u4e00-\u9fff]+/g, ' ')
    .split(/\s+/)
    .map(part => part.trim())
    .filter(Boolean)

  for (const chunk of chineseChunks) {
    if (chunk.length >= 2 && chunk.length <= 12 && !GENERIC_TERMS.has(chunk)) {
      terms.add(chunk)
      if (terms.size >= maxTerms) return [...terms]
    }

    const maxGram = Math.min(4, chunk.length)
    for (let n = 2; n <= maxGram; n++) {
      for (let i = 0; i <= chunk.length - n; i++) {
        const term = chunk.slice(i, i + n)
        if (!GENERIC_TERMS.has(term)) terms.add(term)
        if (terms.size >= maxTerms) return [...terms]
      }
    }
  }

  return [...terms]
}

function addTextToTermIndex(text, index) {
  for (const term of extractTerms(text)) {
    let bucket = termIndex.get(term)
    if (!bucket) {
      bucket = new Set()
      termIndex.set(term, bucket)
    }
    bucket.add(index)
  }
}

function rebuildTermIndex(logger) {
  termIndex = new Map()
  for (let i = 0; i < texts.length; i++) addTextToTermIndex(texts[i], i)
  if (numVectors > 0) {
    logger.info(`【索引就绪】已为 ${numVectors} 条记忆建立 ${termIndex.size} 个候选词项`)
  }
}

function candidateIndices(query, maxCandidates) {
  if (!maxCandidates || maxCandidates <= 0 || !termIndex.size) return null

  const counts = new Map()
  for (const term of extractTerms(query, 80)) {
    const bucket = termIndex.get(term)
    if (!bucket) continue
    for (const idx of bucket) counts.set(idx, (counts.get(idx) || 0) + 1)
  }

  if (!counts.size) return null

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxCandidates)
    .map(([idx]) => idx)
}

function saveStore(binPath, textsPath) {
  // Write only the occupied portion of the buffer
  const byteLen = numVectors * DIM * 4
  const buf = Buffer.from(vectors.buffer, vectors.byteOffset, byteLen)
  fs.writeFileSync(binPath, buf)
  fs.writeFileSync(textsPath, JSON.stringify(texts), 'utf8')
}

function loadStore(binPath, textsPath, jsonPath, logger) {
  // Fast path: binary format
  if (fs.existsSync(binPath) && fs.existsSync(textsPath)) {
    const binBuf = fs.readFileSync(binPath)
    vectors = new Float32Array(binBuf.buffer, binBuf.byteOffset, binBuf.byteLength / 4)
    numVectors = Math.floor(vectors.length / DIM)
    texts = JSON.parse(fs.readFileSync(textsPath, 'utf8'))
    logger.info(`【潜意识苏醒】从二进制索引加载 ${numVectors} 条记忆 (${(binBuf.byteLength / 1048576).toFixed(1)}MB)`)
    return
  }

  // One-time migration from legacy JSON
  if (fs.existsSync(jsonPath)) {
    logger.info('【格式迁移】检测到旧版 JSON 向量库，正在转换为高效格式...')
    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
    if (raw.length > 0) {
      numVectors = raw.length
      vectors = new Float32Array(numVectors * DIM)
      texts = new Array(numVectors)
      for (let i = 0; i < numVectors; i++) {
        const v = raw[i].vector
        let norm = 0
        for (let j = 0; j < DIM; j++) norm += v[j] * v[j]
        norm = Math.sqrt(norm) || 1
        const off = i * DIM
        for (let j = 0; j < DIM; j++) vectors[off + j] = v[j] / norm
        texts[i] = raw[i].text
      }
      saveStore(binPath, textsPath)
      logger.info(`【迁移完成】${numVectors} 条记忆已转为高效存储，旧 JSON 可手动删除`)
    }
  }
}

function appendToStore(newVectors, newTexts, binPath, textsPath) {
  const oldNum = numVectors
  const addCount = newVectors.length
  const newNum = oldNum + addCount
  const newStore = new Float32Array(newNum * DIM)
  if (vectors && oldNum > 0) newStore.set(vectors)

  for (let vi = 0; vi < addCount; vi++) {
    const v = newVectors[vi]
    let norm = 0
    for (let j = 0; j < DIM; j++) norm += v[j] * v[j]
    norm = Math.sqrt(norm) || 1
    const off = (oldNum + vi) * DIM
    for (let j = 0; j < DIM; j++) newStore[off + j] = v[j] / norm
  }

  vectors = newStore
  texts.push(...newTexts)
  numVectors = newNum
  newTexts.forEach((text, index) => addTextToTermIndex(text, oldNum + index))
  saveStore(binPath, textsPath)
}

function searchKnn(queryVec, k, threshold, candidates = null) {
  // Normalize query vector once
  let qNorm = 0
  for (let i = 0; i < DIM; i++) qNorm += queryVec[i] * queryVec[i]
  qNorm = Math.sqrt(qNorm) || 1
  const invNorm = 1 / qNorm

  // Top-k results, kept sorted descending (best first)
  const results = []

  const iterable = Array.isArray(candidates) && candidates.length ? candidates : null
  const length = iterable ? iterable.length : numVectors

  for (let n = 0; n < length; n++) {
    const i = iterable ? iterable[n] : n
    if (i < 0 || i >= numVectors) continue
    const off = i * DIM
    let dot = 0
    for (let j = 0; j < DIM; j++) {
      dot += (queryVec[j] * invNorm) * vectors[off + j]
    }
    if (dot < threshold) continue

    // Insert-sort into top-k
    if (results.length < k) {
      let pos = results.length
      for (; pos > 0 && results[pos - 1].score < dot; pos--) {
        results[pos] = results[pos - 1]
      }
      results[pos] = { idx: i, score: dot }
    } else if (dot > results[k - 1].score) {
      let pos = k - 1
      for (; pos > 0 && results[pos - 1].score < dot; pos--) {
        results[pos] = results[pos - 1]
      }
      results[pos] = { idx: i, score: dot }
    }
  }

  return results.map(r => ({ text: texts[r.idx], score: r.score }))
}

// ── Plugin ──────────────────────────────────────────────────────────

module.exports.apply = (ctx) => {
  const logger = ctx.logger('阿卡夏之眼')
  const API_KEY = config.siliconFlow.apiKey
  const queryCache = new Map()
  const QUERY_CACHE_TTL = config.rag.queryCacheTtlMs
  const RAG_PREFIX = '查记忆'
  const RAG_KEYWORDS = /谁|什么|怎么|为什么|为何|哪|如何|介绍|解释|总结|回忆|记得|知道|资料|书|内容|讲讲|说说|查|搜索|找/

  const binPath = path.resolve(ctx.baseDir, 'data/vector_db.bin')
  const textsPath = path.resolve(ctx.baseDir, 'data/vector_db_texts.json')
  const jsonPath = path.resolve(ctx.baseDir, 'data/vector_db.json')   // legacy
  const libDir = path.resolve(ctx.baseDir, 'data/library')

  if (!API_KEY) {
    logger.warn('SILICONFLOW_API_KEY 未配置，向量学习与记忆检索将不可用。')
  }

  if (!fs.existsSync(libDir)) fs.mkdirSync(libDir, { recursive: true })

  loadStore(binPath, textsPath, jsonPath, logger)
  rebuildTermIndex(logger)

  // ── chunking ──────────────────────────────────────────────────
  function chunkText(text, size = config.rag.chunkSize, overlap = config.rag.chunkOverlap) {
    text = text.replace(/\s+/g, ' ')
    const chunks = []
    const step = Math.max(1, size - overlap)
    for (let i = 0; i < text.length; i += step) {
      chunks.push(text.slice(i, i + size))
    }
    return chunks
  }

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

  ctx.setInterval(() => {
    const now = Date.now()
    for (const [key, value] of queryCache) {
      if (now - value.ts > QUERY_CACHE_TTL) queryCache.delete(key)
    }
  }, 600000)

  function shouldSearchMemory(content) {
    const text = content.replace(/<at[^>]*\/>/g, '').trim()
    if (text.startsWith(RAG_PREFIX)) return true
    if (text.length < 12) return false
    if (text.includes('[系统') || text.includes('<system>')) return false
    return RAG_KEYWORDS.test(text)
  }

  async function embedText(input) {
    const cacheKey = input.trim().toLowerCase()
    const cached = queryCache.get(cacheKey)
    if (cached && Date.now() - cached.ts < QUERY_CACHE_TTL) {
      return cached.vector
    }

    const response = await requestWithRetry(ctx, 'post', config.siliconFlow.embeddingUrl, {
      model: config.siliconFlow.embeddingModel,
      input
    }, { headers: { 'Authorization': `Bearer ${API_KEY}` } }, {
      timeout: config.siliconFlow.timeoutMs,
      retries: config.http.retries,
      retryDelayMs: config.http.retryDelayMs,
    })

    const vector = response.data[0].embedding
    queryCache.set(cacheKey, { vector, ts: Date.now() })
    return vector
  }

  // ── 公主学习 command ──────────────────────────────────────────
  ctx.command('公主学习', '吸收大图书馆(data/library)内的所有知识', { authority: 3 })
    .action(async ({ session }) => {
      if (!API_KEY) return '【系统提示】向量服务还没有配置 API Key，暂时不能学习图书馆。'
      session.send('【系统】白姬正在前往大图书馆翻阅群书，这可能需要很长时间，请耐心等待...')

      let pdf, EPub, htmlToText
      try {
        pdf = require('pdf-parse')
        htmlToText = require('html-to-text')
        EPub = require('epub2').EPub
      } catch (e) {
        return '【缺少结界材料】志贵，你忘记在 SSH 终端运行 `npm install pdf-parse epub2 html-to-text` 了！'
      }

      const files = fs.readdirSync(libDir)
      let allChunks = []
      // Track file names per chunk for source attribution
      let chunkSources = []

      for (const file of files) {
        const filePath = path.join(libDir, file)
        const ext = path.extname(file).toLowerCase()
        let rawText = ''

        try {
          if (ext === '.txt') {
            rawText = fs.readFileSync(filePath, 'utf8')
          } else if (ext === '.pdf') {
            const pdfData = await pdf(fs.readFileSync(filePath))
            rawText = pdfData.text
          } else if (ext === '.epub') {
            rawText = await new Promise((resolve, reject) => {
              const epub = new EPub(filePath, '/', '/')
              epub.on('end', () => {
                let fullText = ''
                let count = 0
                epub.flow.forEach((chapter) => {
                  epub.getChapter(chapter.id, (err, text) => {
                    if (!err && text) fullText += htmlToText.convert(text) + '\n'
                    count++
                    if (count === epub.flow.length) resolve(fullText)
                  })
                })
              })
              epub.on('error', reject)
              epub.parse()
            })
          } else {
            continue
          }

          if (rawText.length > 10) {
            const chunks = chunkText(rawText)
            chunks.forEach(c => {
              allChunks.push(`《${file}》的内容：${c}`)
              chunkSources.push(file)
            })
            logger.info(`【解析成功】${file}，切分出 ${chunks.length} 个记忆碎片`)
          }
        } catch (err) {
          logger.error(`【解析失败】${file}:`, err.message)
        }
      }

      if (allChunks.length === 0) return '【空空如也】大图书馆里没有找到支持的TXT、PDF或EPUB文件哦。'

      // Resume from existing store size
      const startIndex = storeSize()
      if (startIndex >= allChunks.length) {
        return '【系统提示】志贵，这些书我已经吃过啦，不需要再吃一遍了哦！'
      }

      if (startIndex > 0) {
        logger.info(`【记忆继承】已有 ${startIndex} 条记忆，从第 ${startIndex} 条继续...`)
        session.send(`【系统】检测到已有记忆（${startIndex}条），正在启动断点续传...`)
      }

      session.send(`【系统】解析完毕，共提取了 ${allChunks.length} 个记忆碎片。开始向潜意识注入向量...`)

      // Temporary buffer for this batch
      const batchVectors = []
      const batchTexts = []

      try {
        for (let i = startIndex; i < allChunks.length; i++) {
          const chunk = allChunks[i]

          const response = await requestWithRetry(ctx, 'post', config.siliconFlow.embeddingUrl, {
            model: config.siliconFlow.embeddingModel,
            input: chunk
          }, { headers: { 'Authorization': `Bearer ${API_KEY}` } }, {
            timeout: config.siliconFlow.timeoutMs,
            retries: Math.max(config.http.retries, 3),
            retryDelayMs: Math.max(config.http.retryDelayMs, 2000),
          })
          batchVectors.push(response.data[0].embedding)
          batchTexts.push(chunk)

          if (i % 20 === 0) logger.info(`【吞噬进度】已向量化 ${i}/${allChunks.length} ...`)

          // Flush every 50 chunks to disk
          if (batchVectors.length >= 50) {
            appendToStore(batchVectors.splice(0), batchTexts.splice(0), binPath, textsPath)
            logger.info(`【自动存档】${storeSize()}/${allChunks.length} 已持久化`)
          }

          await sleep(100)
        }

        // Final flush
        if (batchVectors.length > 0) {
          appendToStore(batchVectors, batchTexts, binPath, textsPath)
        }

        logger.info(`【吞噬完成】总计 ${storeSize()} 条记忆已存入向量索引`)
        return `【吞噬完成】呼~ 志贵！大图书馆里所有的书我都背下来啦！（共录入 ${allChunks.length} 条绝对记忆）`
      } catch (err) {
        logger.error(`吃书失败: ${errorSummary(err)}`)
        if (batchVectors.length > 0) {
          appendToStore(batchVectors, batchTexts, binPath, textsPath)
        }
        return '【系统错误】遇到无法自动修复的异常，但进度已安全保存，可随时再次下达吃书指令。'
      }
    })

  // ── 检索 middleware ────────────────────────────────────────────
  ctx.middleware(async (session, next) => {
    if (!session.content || session.content.includes('[norender]')) return next()
    if (session.content.trim() === '白姬吃书' || session.content.trim() === '公主学习') return next()

    if (storeSize() === 0) return next()
    if (!API_KEY) return next()

    const rawContent = session.content.toString()
    if (!shouldSearchMemory(rawContent)) return next()

    const explicitSearch = rawContent.trim().startsWith(RAG_PREFIX)
    const queryText = explicitSearch ? rawContent.trim().slice(RAG_PREFIX.length).trim() : rawContent
    if (!queryText) return next()

    try {
      const queryVector = await embedText(queryText)
      const candidates = candidateIndices(queryText, config.rag.maxCandidates)
      const topMatches = searchKnn(queryVector, config.rag.topK, config.rag.threshold, candidates)
      if (candidates?.length) {
        logger.debug(`【候选裁剪】${candidates.length}/${storeSize()} 条记忆进入向量精排`)
      }

      if (topMatches.length > 0) {
        let injectedContext = '\n\n[系统暗门/阿卡夏记忆：志贵的话语触发了以下潜意识回忆：]\n'
        topMatches.forEach(m => injectedContext += `- ${m.text}\n`)

        session.content += injectedContext.trimEnd() + '\n[系统强制指令：你的回复将被直接用于语音合成(TTS)。必须输出纯文本！绝对禁止使用 <p>、<br> 等任何 HTML 标签！绝对禁止使用 Markdown 排版！]'

        logger.info(`【共鸣】触发深层记忆，最高匹配度：${topMatches[0].score.toFixed(2)}`)
      }
    } catch (err) {
      logger.error(`【记忆读取失败】${errorSummary(err)}`)
    }

    return next()
  }, true)

  // ── 清理 HTML 标签 ────────────────────────────────────────────
  ctx.on('before-send', (session) => {
    if (typeof session.content === 'string') {
      session.content = session.content
        .replace(/<\/?p>/ig, '')
        .replace(/<br\s*\/?>/ig, '\n')
        .trim()
    }
  })
}
