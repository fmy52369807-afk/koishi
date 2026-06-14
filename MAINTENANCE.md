# Koishi Maintenance Notes

## Runtime

- Default server host is `127.0.0.1`. Set `KOISHI_HOST=0.0.0.0` only when the console is protected by firewall, reverse proxy auth, or an internal network.
- Console auto-open is disabled by default. Set `KOISHI_CONSOLE_OPEN=true` for local desktop use.
- SQLite uses `data/koishi2.db`.

## Environment Variables

- `DEEPSEEK_API_KEY`: ChatLuna and reminder wording.
- `SILICONFLOW_API_KEY`: embeddings, speech transcription, and image generation.
- `TAVILY_API_KEY`: web search.
- `COZE_TOKEN`: Coze integration if enabled.
- `TTS_API_URL`: custom TTS endpoint, for example `http://host:port/tts`.
- `TTS_REF_AUDIO_PATH`: reference audio path understood by the TTS service.
- `TTS_PROMPT_TEXT`: prompt text matching the reference audio.
- `TTS_PROMPT_LANG`: default `zh`.
- `TTS_TEXT_LANG`: default `zh`.
- `KOISHI_WEATHER_CITY`: default `武汉`.

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
- `external/arcueid-system/personal-assistant.js`: todo CRUD and controllable personal memory.
- `external/arcueid-system/index.js`: local meme replacement.
- `split.js`: outgoing message splitting.
