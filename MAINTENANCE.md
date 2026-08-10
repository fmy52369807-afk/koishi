# Koishi Maintenance Notes

## Runtime

- Default server host is `127.0.0.1`. Set `KOISHI_HOST=0.0.0.0` only when the console is protected by firewall, reverse proxy auth, or an internal network.
- Docker deployments should bind the host port explicitly, for example `127.0.0.1:5140:5140`. If the service must listen on `0.0.0.0` inside the container, keep the host-side bind local or protected by a reverse proxy.
- Console auto-open is disabled by default. Set `KOISHI_CONSOLE_OPEN=true` for local desktop use.
- SQLite uses `data/koishi2.db`.

## Environment Variables

- `external/arcueid-system/config.js` is the source of truth for defaults and validation.
- `.env.example` contains the complete current variable list. Keep `.env` private.
- `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`, `DEEPSEEK_TIMEOUT_MS`: DeepSeek API calls.
- `CHATLUNA_MODEL`: ChatLuna model identifier, including provider prefix.
- `SILICONFLOW_API_KEY`, `SILICONFLOW_BASE_URL`, `SILICONFLOW_EMBEDDING_MODEL`, `SILICONFLOW_ASR_MODEL`, `SILICONFLOW_IMAGE_MODEL`: SiliconFlow services.
- `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_IMAGE_MODEL`: OpenAI-compatible image generation.
- `OPENAI_VISION_API_KEY`, `OPENAI_VISION_BASE_URL`, `OPENAI_VISION_MODEL`: vision service. SiliconFlow can be used as the default backend.
- `TAVILY_API_KEY`, `TAVILY_API_URL`: web search.
- `TTS_API_URL`, `TTS_REF_AUDIO_PATH`, `TTS_PROMPT_TEXT`, `TTS_PROMPT_LANG`, `TTS_TEXT_LANG`: custom TTS.
- `API_TIMEOUT_MS`, `API_RETRY_COUNT`, `API_RETRY_DELAY_MS`: shared retry policy.
- `REMINDER_*`: reminder polling and post-send context retention.
- `PROACTIVE_*` and `ACTIVELINK_*`: group/private allowlists, context length, trigger frequency, and cooldown.
- `PROACTIVE_INITIAL_PROBABILITY`, `PROACTIVE_CHECK_INTERVAL_SECONDS`, `PROACTIVE_INITIAL_DELAY_SECONDS`: proactive polling rhythm.
- `RAG_*`: vector dimension, threshold, chunking, cache, and candidate pruning.
- `SPLIT_*`: outgoing message segmentation thresholds and delays.
- `KOISHI_WEATHER_CITY`, `WEATHER_*`: weather context.

## Data Notes

- `data/vector_db.bin` and `data/vector_db_texts.json` are the active vector store files.
- `data/archive/` is for old local data kept for rollback or inspection.
- Avoid editing `data/koishi2.db` while Koishi is running.

## Plugin Map

- `external/arcueid-system/reminder.js`: reminders and reminder CRUD.
- `external/arcueid-system/guess-character.js`: yes/no character guessing game.
- `external/arcueid-system/arcueid-vector-rag.js`: local library ingestion and vector retrieval.
- `external/arcueid-system/audio.js`: `[语音]` TTS output.
- `external/arcueid-system/image-gen.js`: image generation.
- `external/arcueid-system/web-search.js`: Tavily-backed search context injection.
- `external/arcueid-system/env-perception.js`: time and weather context injection.
- `external/arcueid-system/config.js`: validated shared configuration.
- `external/arcueid-system/http-client.js`: timeout, retry, and redacted error summaries for external APIs.
- `external/arcueid-system/personal-assistant.js`: todo CRUD and controllable personal memory.
- `external/arcueid-system/index.js`: local meme replacement.
- `split.js`: outgoing message splitting.

## External Services

All current HTTP integrations use the shared client helper. It applies per-service timeouts, bounded exponential retries for transient failures, and concise error logging. A provider outage should disable or degrade the affected feature instead of exposing credentials or crashing the whole process.

When adding a new provider:

1. Add its URL, model, key, timeout, and retry behavior to `config.js`.
2. Call it through `http-client.js`.
3. Add the variable to `.env.example` and this file.
4. Return a user-facing fallback when the provider is unavailable.

## RAG

The vector store remains a local binary/text pair for simple deployments. Queries use a lightweight term index to reduce the number of vectors considered before cosine KNN, while falling back to a full scan when no useful terms are available. Rebuild the index after changing embedding model or vector dimension; use `migrate-vectors.js` for legacy JSON data.

## Security

- Keep `KOISHI_HOST=127.0.0.1` unless a firewall, reverse proxy, or private network protects the service.
- For Docker, do not publish `5140` as `0.0.0.0:5140` unless the host firewall or reverse proxy authentication is already in place.
- Do not expose the Koishi console without authentication.
- Never commit `.env`, `data/`, logs, user profiles, chat history, or private media.
- Keep image/audio upload sizes bounded at the adapter or reverse-proxy layer.
- Do not log API keys, full request URLs containing secrets, or complete user messages unless debugging is explicitly enabled.
- Keep proactive replies and user-profile collection restricted to explicit allowlists.
- Back up `data/koishi2.db`, the library, and vector files before migrations or large imports.
