function envString(name, fallback = '') {
  const value = process.env[name];
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text === '' ? fallback : text;
}

function envInt(name, fallback, options = {}) {
  const value = parseInt(envString(name, ''), 10);
  if (!Number.isFinite(value)) return fallback;
  if (options.min !== undefined && value < options.min) return fallback;
  if (options.max !== undefined && value > options.max) return fallback;
  return value;
}

function envFloat(name, fallback, options = {}) {
  const value = parseFloat(envString(name, ''));
  if (!Number.isFinite(value)) return fallback;
  if (options.min !== undefined && value < options.min) return fallback;
  if (options.max !== undefined && value > options.max) return fallback;
  return value;
}

function envBool(name, fallback = false) {
  const value = envString(name, '');
  if (!value) return fallback;
  if (/^(1|true|yes|on)$/i.test(value)) return true;
  if (/^(0|false|no|off)$/i.test(value)) return false;
  return fallback;
}

function envList(name, fallback = '') {
  return envString(name, fallback)
    .split(/[,\s]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function trimBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

const deepseekBaseUrl = trimBaseUrl(envString('DEEPSEEK_BASE_URL', 'https://api.deepseek.com/v1'));
const siliconFlowBaseUrl = trimBaseUrl(envString('SILICONFLOW_BASE_URL', 'https://api.siliconflow.cn/v1'));
const openaiBaseUrl = trimBaseUrl(envString('OPENAI_BASE_URL', 'https://api.openai.com/v1'));
const visionBaseUrl = trimBaseUrl(envString('OPENAI_VISION_BASE_URL', `${siliconFlowBaseUrl}`));

const config = {
  http: {
    timeoutMs: envInt('API_TIMEOUT_MS', 45000, { min: 1000 }),
    retries: envInt('API_RETRY_COUNT', 1, { min: 0, max: 5 }),
    retryDelayMs: envInt('API_RETRY_DELAY_MS', 800, { min: 100 }),
  },

  deepseek: {
    apiKey: envString('DEEPSEEK_API_KEY'),
    baseUrl: deepseekBaseUrl,
    chatUrl: `${deepseekBaseUrl}/chat/completions`,
    model: envString('DEEPSEEK_MODEL', 'deepseek-v4-flash'),
    timeoutMs: envInt('DEEPSEEK_TIMEOUT_MS', 45000, { min: 1000 }),
  },

  siliconFlow: {
    apiKey: envString('SILICONFLOW_API_KEY'),
    baseUrl: siliconFlowBaseUrl,
    embeddingUrl: `${siliconFlowBaseUrl}/embeddings`,
    embeddingModel: envString('SILICONFLOW_EMBEDDING_MODEL', 'BAAI/bge-m3'),
    asrUrl: `${siliconFlowBaseUrl}/audio/transcriptions`,
    asrModel: envString('SILICONFLOW_ASR_MODEL', 'FunAudioLLM/SenseVoiceSmall'),
    imageUrl: `${siliconFlowBaseUrl}/images/generations`,
    imageModel: envString('SILICONFLOW_IMAGE_MODEL', 'Kwai-Kolors/Kolors'),
    timeoutMs: envInt('SILICONFLOW_TIMEOUT_MS', 45000, { min: 1000 }),
  },

  image: {
    openaiApiKey: envString('OPENAI_API_KEY'),
    openaiBaseUrl,
    openaiGenerationUrl: `${openaiBaseUrl}/images/generations`,
    openaiModel: envString('OPENAI_IMAGE_MODEL', 'gpt-image-2'),
    size: envString('OPENAI_IMAGE_SIZE', '1024x1024'),
    timeoutMs: envInt('IMAGE_GENERATION_TIMEOUT_MS', 90000, { min: 5000 }),
    downloadTimeoutMs: envInt('IMAGE_DOWNLOAD_TIMEOUT_MS', 30000, { min: 1000 }),
  },

  vision: {
    explicitApiKey: envString('OPENAI_VISION_API_KEY'),
    apiKey: envString('OPENAI_VISION_API_KEY')
      || (/siliconflow\.cn/i.test(visionBaseUrl) ? envString('SILICONFLOW_API_KEY') : '')
      || envString('OPENAI_API_KEY'),
    baseUrl: visionBaseUrl,
    chatUrl: `${visionBaseUrl}/chat/completions`,
    model: envString('OPENAI_VISION_MODEL', 'Qwen/Qwen3-VL-8B-Instruct'),
    maxImages: envInt('VISION_MAX_IMAGES', 2, { min: 1, max: 10 }),
    timeoutMs: envInt('VISION_TIMEOUT_MS', 45000, { min: 1000 }),
    imageFetchTimeoutMs: envInt('VISION_IMAGE_FETCH_TIMEOUT_MS', 12000, { min: 1000 }),
    inlineRemoteImages: envBool('VISION_INLINE_REMOTE_IMAGES', false),
  },

  tavily: {
    apiKey: envString('TAVILY_API_KEY'),
    url: envString('TAVILY_API_URL', 'https://api.tavily.com/search'),
    timeoutMs: envInt('TAVILY_TIMEOUT_MS', 20000, { min: 1000 }),
    cacheTtlMs: envInt('TAVILY_CACHE_TTL_MS', 2 * 60 * 60 * 1000, { min: 60000 }),
    cooldownMs: envInt('TAVILY_COOLDOWN_MS', 30000, { min: 0 }),
    maxResults: envInt('TAVILY_MAX_RESULTS', 5, { min: 1, max: 20 }),
  },

  tts: {
    apiBaseUrl: envString('TTS_API_URL'),
    refAudioPath: envString('TTS_REF_AUDIO_PATH'),
    promptText: envString('TTS_PROMPT_TEXT'),
    promptLang: envString('TTS_PROMPT_LANG', 'zh'),
    textLang: envString('TTS_TEXT_LANG', 'zh'),
    timeoutMs: envInt('TTS_TIMEOUT_MS', 60000, { min: 1000 }),
  },

  proactive: {
    contextLimit: envInt('PROACTIVE_CONTEXT_LIMIT', 20, { min: 3, max: 100 }),
    triggerMessages: envInt('PROACTIVE_TRIGGER_MESSAGES', 12, { min: 1, max: 200 }),
    cooldownSeconds: envInt('PROACTIVE_COOLDOWN_SECONDS', 300, { min: 0 }),
    initialProbability: envFloat('PROACTIVE_INITIAL_PROBABILITY', 0.2, { min: 0, max: 1 }),
    checkIntervalSeconds: envInt('PROACTIVE_CHECK_INTERVAL_SECONDS', 10, { min: 1, max: 300 }),
    initialDelaySeconds: envInt('PROACTIVE_INITIAL_DELAY_SECONDS', 1, { min: 0, max: 60 }),
    groupIds: unique([
      ...envList('ACTIVELINK_GROUP_IDS'),
      ...envList('ACTIVELINK_GROUP_ID_1'),
      ...envList('PROACTIVE_CONTEXT_GROUPS'),
    ]),
    privateIds: unique([
      ...envList('ACTIVELINK_PRIVATE_ID_1'),
      ...envList('ACTIVELINK_PRIVATE_ID_2'),
      ...envList('ACTIVELINK_PRIVATE_IDS'),
    ]),
  },

  reminder: {
    checkIntervalMs: envInt('REMINDER_CHECK_INTERVAL_MS', 60000, { min: 10000 }),
    contextTtlMs: envInt('REMINDER_CONTEXT_TTL_MS', 15 * 60 * 1000, { min: 60000 }),
  },

  rag: {
    dimension: envInt('RAG_VECTOR_DIM', 1024, { min: 1 }),
    threshold: envFloat('RAG_SIMILARITY_THRESHOLD', 0.5, { min: 0, max: 1 }),
    topK: envInt('RAG_TOP_K', 3, { min: 1, max: 20 }),
    chunkSize: envInt('RAG_CHUNK_SIZE', 500, { min: 100 }),
    chunkOverlap: envInt('RAG_CHUNK_OVERLAP', 100, { min: 0 }),
    queryCacheTtlMs: envInt('RAG_QUERY_CACHE_TTL_MS', 10 * 60 * 1000, { min: 60000 }),
    maxCandidates: envInt('RAG_MAX_CANDIDATES', 3000, { min: 0 }),
    termIndexMaxTermsPerText: envInt('RAG_TERM_INDEX_MAX_TERMS_PER_TEXT', 240, { min: 20, max: 2000 }),
  },

  split: {
    naturalMinChars: envInt('SPLIT_NATURAL_MIN_CHARS', 34, { min: 1 }),
    naturalMaxChars: envInt('SPLIT_NATURAL_MAX_CHARS', 110, { min: 1 }),
    naturalPartMaxChars: envInt('SPLIT_NATURAL_PART_MAX_CHARS', 45, { min: 1 }),
    mergeMaxChars: envInt('SPLIT_MERGE_MAX_CHARS', 40, { min: 1 }),
    naturalDelayMs: envInt('SPLIT_NATURAL_DELAY_MS', 1200, { min: 0 }),
    longDelayMs: envInt('SPLIT_LONG_DELAY_MS', 2000, { min: 0 }),
  },

  weather: {
    city: envString('KOISHI_WEATHER_CITY', '武汉'),
    retryMs: envInt('WEATHER_RETRY_MS', 5 * 60 * 1000, { min: 60000 }),
    refreshMs: envInt('WEATHER_REFRESH_MS', 60 * 60 * 1000, { min: 60000 }),
    timeoutMs: envInt('WEATHER_TIMEOUT_MS', 8000, { min: 1000 }),
  },
};

module.exports = {
  config,
  envBool,
  envFloat,
  envInt,
  envList,
  envString,
  trimBaseUrl,
};
