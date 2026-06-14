const { h } = require('koishi')
const fs = require('fs')
const path = require('path')

module.exports.name = 'arcueid-local-meme'

module.exports.apply = (ctx) => {
  const memeFolder = path.resolve(ctx.baseDir, 'data/memes')

  if (!fs.existsSync(memeFolder)) {
    fs.mkdirSync(memeFolder, { recursive: true })
  }

  ctx.on('before-send', (session) => {
    if (!session.content || session.content.includes('[norender]')) return

    const memeRegexp = /[\[【]表情[:：]([^\]】]+)[\]】]/g

    if (memeRegexp.test(session.content)) {
      session.content = session.content.replace(memeRegexp, (match, keyword) => {
        const cleanKeyword = keyword.trim()
        const extensions = ['.jpg', '.png', '.gif', '.jpeg']
        let foundPath = null
        let foundExt = ''

        for (const ext of extensions) {
          const testPath = path.join(memeFolder, `${cleanKeyword}${ext}`)
          if (fs.existsSync(testPath)) {
            foundPath = testPath
            foundExt = ext
            break
          }
        }

        if (foundPath) {
          // 【核心魔法：将图片碾碎成 Base64 数据流直传，QQ 绝对不会报错！】
          const mimeType = foundExt === '.png' ? 'image/png' : foundExt === '.gif' ? 'image/gif' : 'image/jpeg'
          const imageBuffer = fs.readFileSync(foundPath)
          const base64 = imageBuffer.toString('base64')
          
          return h.image(`data:${mimeType};base64,${base64}`).toString()
        } else {
          // 如果本地没找到对应的表情包，就静默吞掉这个标签，不发乱码
          return '' 
        }
      })
    }
  })
}