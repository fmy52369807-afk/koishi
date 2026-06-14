#!/usr/bin/env node
/**
 * One-shot migration: vector_db.json → vector_db.bin + vector_db_texts.json
 *
 * Usage: node external/arcueid-system/migrate-vectors.js
 *
 * Run this while the bot is STOPPED to avoid memory contention.
 * After successful migration you may delete the old vector_db.json to free 168MB disk.
 */
const fs = require('fs')
const path = require('path')

const DIM = 1024
const BASE = path.resolve(__dirname, '..', '..')
const JSON_PATH = path.join(BASE, 'data/vector_db.json')
const BIN_PATH = path.join(BASE, 'data/vector_db.bin')
const TEXTS_PATH = path.join(BASE, 'data/vector_db_texts.json')

console.log('=== 向量库格式迁移工具 ===\n')

if (!fs.existsSync(JSON_PATH)) {
  console.error('❌ 未找到 data/vector_db.json，无需迁移。')
  process.exit(1)
}

if (fs.existsSync(BIN_PATH) && fs.existsSync(TEXTS_PATH)) {
  console.log('⚠️  二进制格式已存在，跳过迁移。')
  console.log('   如需重新迁移请先删除 data/vector_db.bin 和 data/vector_db_texts.json')
  process.exit(0)
}

const stat = fs.statSync(JSON_PATH)
console.log(`📖 读取旧版 JSON: ${(stat.size / 1048576).toFixed(1)} MB`)
console.log('   (这一步会暂时占用较多内存，请耐心等待...)')

let raw
try {
  raw = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'))
} catch (e) {
  console.error('❌ JSON 解析失败:', e.message)
  process.exit(1)
}

console.log(`   解析成功，共 ${raw.length} 条记录`)
console.log('🔄 正在转换格式并预归一化向量...')

const numVectors = raw.length
const vectors = new Float32Array(numVectors * DIM)
const texts = new Array(numVectors)

let reported = 0
for (let i = 0; i < numVectors; i++) {
  const v = raw[i].vector
  let norm = 0
  for (let j = 0; j < DIM; j++) norm += v[j] * v[j]
  norm = Math.sqrt(norm) || 1
  const off = i * DIM
  for (let j = 0; j < DIM; j++) vectors[off + j] = v[j] / norm
  texts[i] = raw[i].text

  if (i > 0 && (i % 5000 === 0 || i === numVectors - 1)) {
    console.log(`   进度: ${i + 1}/${numVectors} (${((i + 1) / numVectors * 100).toFixed(0)}%)`)
    reported = i
  }
}

// Free the JSON object to help GC
raw = null
if (global.gc) global.gc()

console.log(`💾 写入二进制向量: ${(numVectors * DIM * 4 / 1048576).toFixed(1)} MB`)
const byteLen = numVectors * DIM * 4
fs.writeFileSync(BIN_PATH, Buffer.from(vectors.buffer, vectors.byteOffset, byteLen))

console.log(`💾 写入文本索引: ${(numVectors * 0.5 / 1024).toFixed(1)} KB (估计)`)
fs.writeFileSync(TEXTS_PATH, JSON.stringify(texts), 'utf8')

const binStat = fs.statSync(BIN_PATH)
const txtStat = fs.statSync(TEXTS_PATH)
console.log(`\n✅ 迁移完成！`)
console.log(`   vector_db.bin:         ${(binStat.size / 1048576).toFixed(1)} MB`)
console.log(`   vector_db_texts.json:  ${(txtStat.size / 1048576).toFixed(1)} MB`)
console.log(`   总计:                   ${((binStat.size + txtStat.size) / 1048576).toFixed(1)} MB`)
console.log(`\n💡 提示: 确认 bot 正常启动后可删除旧的 data/vector_db.json (168 MB)`)
