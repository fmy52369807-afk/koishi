# Arcueid Koishi Assistant

一个基于 [Koishi](https://koishi.chat/) 与 ChatLuna 的角色化 AI 助手机器人。

项目当前以 **QQ / OneBot** 为主要接入方式，默认人格为“爱尔奎特”。除了日常对话，还集成了定时提醒、待办、个人记忆、联网搜索、图片理解与生成、语音转写与合成、本地知识库检索、猜人物小游戏，以及面向白名单群聊的主动上下文能力。

> 项目会将部分对话、图片、语音或搜索内容发送到所配置的第三方服务。公开部署前，请向用户说明数据处理范围，并确认相关服务的使用权限和条款。

## 功能

- QQ / OneBot 接入与 Koishi 控制台
- ChatLuna + DeepSeek 角色化对话
- 一次性和每日重复提醒，支持自然语言设置
- 待办管理：添加、列表、完成、编辑、删除、清理
- 可控个人记忆与白名单用户画像
- Tavily 联网搜索与结果上下文注入
- OpenAI 兼容图片生成，支持硅基流动兜底
- 自动识图与引用图片问答
- SiliconFlow 语音转写
- 自定义 TTS 语音输出
- `data/library/` 本地知识库向量检索
- 猜人物互动游戏
- 本地表情包替换
- 智能消息分段，减少长消息刷屏
- 白名单群聊历史上下文与主动回复约束

## 环境要求

- Node.js LTS
- Corepack
- Yarn `4.12.0`
- 一个可用的 OneBot 服务端和 QQ 机器人账号
- 至少一个可用的大语言模型 API

## 快速开始

```bash
git clone <你的仓库地址>
cd koishi
corepack enable
yarn install
cp .env.example .env
yarn start
```

编辑 `.env` 并填写至少以下配置：

```dotenv
KOISHI_ONEBOT_SELF_ID=你的机器人QQ号
DEEPSEEK_API_KEY=你的DeepSeek密钥
```

`koishi.yml` 已启用 OneBot 适配器，但连接端点、令牌或反向 WebSocket 参数取决于 OneBot 实现，请在 Koishi 控制台或配置文件中补充。

默认服务端口为 `5140`，端口冲突时可使用至 `5149`。生产环境不要将未受保护的控制台直接暴露到公网。

## 环境变量

### 基础配置

| 变量 | 说明 |
| --- | --- |
| `KOISHI_HOST` | Koishi 监听地址，建议本地部署使用 `127.0.0.1`。 |
| `KOISHI_CONSOLE_OPEN` | 设为 `true` 时自动打开控制台。 |
| `KOISHI_ONEBOT_SELF_ID` | 机器人自身 QQ 账号 ID。 |
| `KOISHI_WEATHER_CITY` | 时间和天气感知城市，默认 `武汉`。 |

### 模型与第三方服务

| 变量 | 用途 |
| --- | --- |
| `DEEPSEEK_API_KEY` | ChatLuna 对话、提醒措辞、猜人物和生图后的角色回复。 |
| `DEEPSEEK_MODEL` | DeepSeek 模型名，默认 `deepseek-v4-flash`。 |
| `SILICONFLOW_API_KEY` | 向量嵌入、语音转写、图片生成兜底和相关视觉配置。 |
| `TAVILY_API_KEY` | 联网搜索。 |
| `OPENAI_API_KEY` | OpenAI 兼容图片或视觉服务。 |
| `OPENAI_BASE_URL` | OpenAI 兼容 API 地址。 |
| `OPENAI_IMAGE_MODEL` | 图片生成模型，默认 `gpt-image-2`。 |
| `OPENAI_VISION_API_KEY` | 独立视觉模型密钥。 |
| `OPENAI_VISION_BASE_URL` | 独立视觉模型 API 地址。 |
| `OPENAI_VISION_MODEL` | 视觉模型名。 |
| `COZE_BOT_ID` / `COZE_TOKEN` | 可选 Coze 集成。 |

### TTS 与主动上下文

| 变量 | 说明 |
| --- | --- |
| `TTS_API_URL` | 自定义 TTS 服务地址，需返回 WAV 音频。 |
| `TTS_REF_AUDIO_PATH` | TTS 参考音频路径。 |
| `TTS_PROMPT_TEXT` | 与参考音频对应的提示文本。 |
| `TTS_PROMPT_LANG` / `TTS_TEXT_LANG` | TTS 提示语言和文本语言，默认 `zh`。 |
| `ACTIVELINK_GROUP_ID_1` | 主动上下文和用户画像群白名单。 |
| `ACTIVELINK_PRIVATE_ID_1` / `ACTIVELINK_PRIVATE_ID_2` | ActiveLink 私聊配置。 |
| `ACTIVELINK_PRIVATE_IDS` | 允许记录用户画像的私聊用户 ID。 |
| `PROACTIVE_CONTEXT_GROUPS` | 额外主动上下文群 ID 列表。 |
| `PROACTIVE_CONTEXT_LIMIT` | 群聊历史保留数量。 |
| `PROACTIVE_COOLDOWN_SECONDS` | 主动回复冷却时间。 |
| `PROACTIVE_TRIGGER_MESSAGES` | 主动回复触发消息数量。 |
| `VISION_MAX_IMAGES` | 单次最多分析图片数，默认 `2`。 |
| `VISION_TIMEOUT_MS` | 视觉请求超时，默认 `45000` 毫秒。 |

`.env.example` 提供基础模板；新增功能使用的可选变量请按上表补充。

## 使用方式

机器人命令前缀为 `/`。

### 提醒

```text
/提醒 设置 08:00 起床
/提醒 设置 每天 晚上10点 睡觉
/提醒 今天
/提醒 列表
/提醒 查看 1
/提醒 延后 1 10分钟
/提醒 完成 1
/提醒 编辑 1 09:00 新内容
/提醒 取消 1
/提醒 恢复 1
/提醒 删除 1
/提醒 诊断
```

也可以直接说：`半小时后提醒我取快递`、`明天上午九点提醒我开会` 或 `每天晚上十点提醒我睡觉`。提醒按 `Asia/Shanghai` 解析，并按“用户 + 当前会话”隔离。

### 待办和记忆

```text
/待办 添加 买牛奶；写报告
/待办 列表
/待办 完成 1
/待办 编辑 1 修改后的内容
/待办 删除 1
/待办 清理

/记忆 添加 我不喜欢太正式的语气
/记忆 列表
/记忆 查找 语气
/记忆 编辑 1 新内容
/记忆 忘记 1
```

### 搜索、图片和语音

```text
搜索 2026 年 Node.js 的最新 LTS 版本
空想具象化 月光下的城堡，水彩插画风格
```

发送图片或引用图片并提问即可触发视觉理解，例如 `这张图里有什么？`。收到语音或引用语音时会自动尝试转写；模型输出 `[语音]` 时会调用 TTS 并发送音频。

### 本地表情

将 `.jpg`、`.jpeg`、`.png` 或 `.gif` 放入 `data/memes/`，即可使用 `【表情：名称】` 或 `[表情:名称]` 替换为图片。

## 本地知识库

将资料放入 `data/library/`，然后以管理员权限执行：

```text
/公主学习
```

向量索引会写入 `data/vector_db.bin` 和 `data/vector_db_texts.json`。可以自然提问，也可以显式检索：

```text
查记忆 项目中的部署步骤是什么？
```

旧版 `data/vector_db.json` 迁移必须在机器人停止时执行：

```bash
node external/arcueid-system/migrate-vectors.js
```

## 项目结构

```text
.
├── .env.example
├── koishi.yml
├── package.json
├── split.js                         # 输出消息智能分段
├── MAINTENANCE.md                   # 运维说明
└── external/arcueid-system/
    ├── index.js                     # 本地表情替换
    ├── env-perception.js            # 时间和天气上下文
    ├── arcueid-hearing.js           # 语音转写
    ├── audio.js                     # TTS 输出
    ├── vision.js                    # 图片理解
    ├── image-gen.js                 # 图片生成
    ├── web-search.js                # Tavily 搜索
    ├── reminder.js                  # 提醒管理
    ├── personal-assistant.js        # 待办和个人记忆
    ├── arcueid-vector-rag.js        # 本地知识库 RAG
    ├── migrate-vectors.js           # 向量库迁移
    ├── guess-character.js           # 猜人物游戏
    ├── user-profile.js              # 用户画像
    ├── proactive-context.js         # 群聊历史和主动回复
    └── reply-style.js               # 回复风格分析与清洗
```

## 数据与运维

运行数据默认位于 `data/`：`data/koishi2.db` 保存提醒、待办、记忆和用户画像；`data/library/` 保存知识库原始资料；`data/vector_db.bin` 与 `data/vector_db_texts.json` 保存向量索引；`data/memes/` 保存本地表情素材。

- 不要在 Koishi 运行时手动编辑 SQLite 数据库。
- 不要提交 `.env`、数据库、向量索引、聊天记录或私有知识库。
- 定期备份数据库、知识库和向量索引。
- 主动群聊和用户画像只应对明确授权的群或用户启用。
- 图片、语音、搜索和对话可能会发送到已配置的第三方 API。

## 开发与验证

```bash
yarn install
NODE_ENV=development yarn start
```

检查 JavaScript 语法：

```bash
for file in split.js external/arcueid-system/*.js; do
  node --check "$file"
done
```

## 发布前检查

- [ ] 确认 `.env`、日志、数据库、向量文件和私有素材未被提交。
- [ ] 补充 OneBot 实际连接参数并保护 Koishi 控制台端口。
- [ ] 添加与项目声明一致的 `LICENSE` 文件。
- [ ] 将 `package.json` 中的脚手架名称 `@koishijs/boilerplate` 改为正式项目名称。
- [ ] 如需发布 npm，将 `private` 从 `true` 改为 `false`。
- [ ] 向群成员告知第三方 API、语音转写、图片理解和用户画像的数据处理方式。

## 许可证

项目元数据声明使用 `AGPL-3.0`。公开发布前，请在仓库根目录添加对应的 `LICENSE` 文件，并确认第三方依赖、模型、语音素材和图片服务符合各自的许可证与服务条款。
