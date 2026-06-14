# Koishi QQ Bot

一个基于 Koishi 的 QQ 机器人项目，集成 ChatLuna 对话能力，并扩展了个人助理、提醒、联网搜索、图片生成、语音处理和互动小游戏等功能。

## 功能

- QQ / OneBot 接入
- ChatLuna + DeepSeek 对话
- 每日提醒、延后提醒、完成提醒
- 待办和可控记忆管理
- 猜人物互动游戏
- 联网搜索
- 图片生成
- 语音识别与 TTS 接入
- 向量记忆检索

## 配置

复制 `.env.example` 为 `.env`，并填写对应密钥：

```bash
cp .env.example .env
```

常用环境变量：

- `DEEPSEEK_API_KEY`
- `SILICONFLOW_API_KEY`
- `TAVILY_API_KEY`
- `COZE_TOKEN`
- `KOISHI_WEATHER_CITY`

## 启动

```bash
yarn start
```

## 目录

- `external/arcueid-system/`：自定义插件
- `koishi.yml`：Koishi 插件配置
- `data/`：运行数据，本仓库不提交
- `.env`：本地密钥配置，本仓库不提交
