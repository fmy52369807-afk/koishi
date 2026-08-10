function statusOf(error) {
  return Number(error?.response?.status || error?.status || 0);
}

function isRetryable(error) {
  const status = statusOf(error);
  if (status === 408 || status === 425 || status === 429 || status >= 500) return true;
  const code = String(error?.code || '').toUpperCase();
  return ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH'].includes(code)
    || /timeout|timed out|socket hang up|network/i.test(String(error?.message || error));
}

function errorSummary(error) {
  const status = statusOf(error);
  const data = error?.response?.data || error?.data;
  const detail = typeof data === 'string'
    ? data
    : data?.error?.message || data?.message || '';
  const message = detail || error?.message || String(error);
  return status ? `${status} ${message}` : message;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function requestWithRetry(ctx, method, url, data, options = {}, settings = {}) {
  const retries = Math.max(0, Number(settings.retries ?? 1));
  const retryDelayMs = Math.max(100, Number(settings.retryDelayMs ?? 800));
  const timeout = settings.timeout ?? options.timeout;
  let attempt = 0;

  while (true) {
    try {
      const requestOptions = timeout ? { ...options, timeout } : options;
      return method === 'get'
        ? await ctx.http.get(url, requestOptions)
        : await ctx.http[method](url, data, requestOptions);
    } catch (error) {
      if (attempt >= retries || !isRetryable(error)) throw error;
      const delay = retryDelayMs * (2 ** attempt);
      attempt += 1;
      await sleep(delay);
    }
  }
}

module.exports = {
  errorSummary,
  isRetryable,
  requestWithRetry,
  statusOf,
};
