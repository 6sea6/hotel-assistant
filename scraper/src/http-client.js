const axios = require('axios');

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_RETRIES = 1;
const DEFAULT_RETRY_DELAY_MS = 250;
const SENSITIVE_KEY_PATTERN = /(authorization|cookie|token|api[-_]?key|apikey|secret|password|key)$/i;

class HttpClientError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'HttpClientError';
    this.url = details.url;
    this.method = details.method;
    this.status = details.status;
    this.code = details.code;
    this.retryable = Boolean(details.retryable);
    this.cause = details.cause;
    this.responseSnippet = details.responseSnippet;
  }
}

function getHeaderEntry(headers, targetName) {
  if (!headers || typeof headers !== 'object') {
    return null;
  }

  const normalizedTarget = String(targetName).toLowerCase();
  const key = Object.keys(headers).find((headerName) => headerName.toLowerCase() === normalizedTarget);
  return key ? { key, value: headers[key] } : null;
}

function mergeHeaders(...headerSets) {
  const merged = {};
  const originalNames = new Map();

  for (const headers of headerSets) {
    if (!headers || typeof headers !== 'object') {
      continue;
    }

    for (const [key, value] of Object.entries(headers)) {
      if (value === undefined || value === null) {
        continue;
      }

      const normalizedKey = String(key).toLowerCase();
      const outputKey = originalNames.get(normalizedKey) || key;
      originalNames.set(normalizedKey, outputKey);
      merged[outputKey] = value;
    }
  }

  return merged;
}

function normalizeCookiePairs(cookieText) {
  return String(cookieText || '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);
}

function mergeCookieHeader(existingCookie, cookieHeader) {
  const pairs = [
    ...normalizeCookiePairs(existingCookie),
    ...normalizeCookiePairs(cookieHeader)
  ];
  return [...new Set(pairs)].join('; ');
}

function applyHeaderOptions(headers, options = {}) {
  const output = mergeHeaders(headers);

  if (options.userAgent) {
    const existingUserAgent = getHeaderEntry(output, 'user-agent');
    if (!existingUserAgent) {
      output['User-Agent'] = options.userAgent;
    }
  }

  if (options.cookieHeader) {
    const existingCookie = getHeaderEntry(output, 'cookie');
    const mergedCookie = mergeCookieHeader(existingCookie && existingCookie.value, options.cookieHeader);
    if (mergedCookie) {
      if (existingCookie) {
        output[existingCookie.key] = mergedCookie;
      } else {
        output.Cookie = mergedCookie;
      }
    }
  }

  return output;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function redactValue(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return '[REDACTED]';
}

function redactUrl(rawUrl) {
  if (!rawUrl) {
    return rawUrl;
  }

  try {
    const parsed = new URL(rawUrl);
    for (const key of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        parsed.searchParams.set(key, '[REDACTED]');
      }
    }
    return parsed.toString();
  } catch (_error) {
    return String(rawUrl).replace(/([?&][^=]*(?:token|key|secret|password)[^=]*=)[^&\s]+/gi, '$1[REDACTED]');
  }
}

function redactObject(input) {
  if (!input || typeof input !== 'object') {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map(redactObject);
  }

  return Object.fromEntries(Object.entries(input).map(([key, value]) => [
    key,
    SENSITIVE_KEY_PATTERN.test(key) ? redactValue(value) : redactObject(value)
  ]));
}

function stringifySnippet(data) {
  if (data === undefined || data === null) {
    return undefined;
  }

  let text;
  if (Buffer.isBuffer(data)) {
    text = data.toString('utf8');
  } else if (typeof data === 'string') {
    text = data;
  } else {
    try {
      text = JSON.stringify(redactObject(data));
    } catch (_error) {
      text = String(data);
    }
  }

  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}

function sanitizeErrorCause(error) {
  if (!error || typeof error !== 'object') {
    return error;
  }

  return {
    name: error.name,
    message: error.message,
    code: error.code,
    status: error.response && error.response.status
  };
}

function isRetryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

function isRetryableCode(code) {
  return [
    'ECONNABORTED',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ECONNREFUSED'
  ].includes(String(code || '').toUpperCase());
}

function isRetryableAxiosError(error) {
  const status = Number(error && error.response && error.response.status);
  if (status) {
    return isRetryableStatus(status);
  }
  return isRetryableCode(error && error.code);
}

function normalizeHttpError(error, context = {}) {
  if (error instanceof HttpClientError) {
    return error;
  }

  const method = String(context.method || (error && error.config && error.config.method) || 'GET').toUpperCase();
  const url = redactUrl(context.url || (error && error.config && error.config.url) || '');
  const status = error && error.response ? error.response.status : undefined;
  const code = error && error.code;
  const retryable = isRetryableAxiosError(error);
  const statusText = status ? `HTTP ${status}` : '';
  const reason = (error && error.message) || 'request failed';
  const suffix = [statusText, reason].filter(Boolean).join(': ');

  return new HttpClientError(`${method} ${url} failed${suffix ? ` (${suffix})` : ''}`, {
    method,
    url,
    status,
    code,
    retryable,
    cause: sanitizeErrorCause(error),
    responseSnippet: stringifySnippet(error && error.response && error.response.data)
  });
}

function toAxiosResponseType(responseType) {
  if (responseType === 'buffer') {
    return 'arraybuffer';
  }
  if (responseType === 'text') {
    return 'text';
  }
  return 'json';
}

function buildAxiosConfig(config = {}) {
  const method = String(config.method || 'GET').toUpperCase();
  const timeoutMs = Number(config.timeoutMs || config.timeout || DEFAULT_TIMEOUT_MS);
  const data = config.data !== undefined ? config.data : config.body;
  const headers = applyHeaderOptions(
    mergeHeaders(config.defaultHeaders, config.headers),
    {
      cookieHeader: config.cookieHeader,
      userAgent: config.userAgent
    }
  );

  const axiosConfig = {
    url: config.url,
    method,
    params: config.params,
    data,
    headers,
    timeout: timeoutMs,
    responseType: toAxiosResponseType(config.responseType || 'json')
  };

  if (typeof config.validateStatus === 'function') {
    axiosConfig.validateStatus = config.validateStatus;
  }

  return axiosConfig;
}

async function request(config = {}) {
  const axiosConfig = buildAxiosConfig(config);
  const retries = Math.max(0, Number(config.retries ?? DEFAULT_RETRIES));
  const retryDelayMs = Math.max(0, Number(config.retryDelayMs || DEFAULT_RETRY_DELAY_MS));
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await axios.request(axiosConfig);
      return {
        data: response.data,
        status: response.status,
        headers: response.headers || {},
        url: response.config && response.config.url ? response.config.url : axiosConfig.url
      };
    } catch (error) {
      const normalizedError = normalizeHttpError(error, {
        method: axiosConfig.method,
        url: axiosConfig.url
      });
      lastError = normalizedError;

      if (attempt >= retries || !normalizedError.retryable) {
        throw normalizedError;
      }

      await delay(retryDelayMs * (2 ** attempt));
    }
  }

  throw lastError;
}

function get(url, options = {}) {
  return request({
    ...options,
    url,
    method: 'GET'
  });
}

function post(url, data, options = {}) {
  return request({
    ...options,
    url,
    data,
    method: 'POST'
  });
}

module.exports = {
  DEFAULT_RETRIES,
  DEFAULT_RETRY_DELAY_MS,
  DEFAULT_TIMEOUT_MS,
  HttpClientError,
  get,
  mergeCookieHeader,
  mergeHeaders,
  normalizeHttpError,
  post,
  request
};
