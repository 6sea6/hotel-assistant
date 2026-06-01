const path = require('path');
const {
  TRAILING_URL_PUNCTUATION,
  INLINE_URL_TEXT_SEPARATOR
} = require('../../shared/url-constants');

function isCtripHotelUrl(url) {
  try {
    let cleaned = String(url || '')
      .replace(/&amp;/g, '&')
      .trim();
    const inlineTextIndex = cleaned.search(INLINE_URL_TEXT_SEPARATOR);
    if (inlineTextIndex > 0) {
      cleaned = cleaned.slice(0, inlineTextIndex);
    }
    while (TRAILING_URL_PUNCTUATION.test(cleaned)) {
      cleaned = cleaned.replace(TRAILING_URL_PUNCTUATION, '');
    }
    const parsed = new URL(cleaned);
    const host = parsed.hostname.toLowerCase();
    const href = parsed.href.toLowerCase();
    return /(^|\.)ctrip\.com$/.test(host) && /hotel|hotels/.test(href);
  } catch (error) {
    return false;
  }
}

function extractUrlsFromText(value) {
  const values = Array.isArray(value) ? value : [value];
  const urls = [];
  const seen = new Set();

  for (const item of values) {
    const text = String(item || '');
    const matches = text.match(/https?:\/\/[^\s"'<>]+/gi) || [];
    for (const match of matches) {
      let cleaned = match.replace(/&amp;/g, '&').trim();
      const inlineTextIndex = cleaned.search(INLINE_URL_TEXT_SEPARATOR);
      if (inlineTextIndex > 0) {
        cleaned = cleaned.slice(0, inlineTextIndex);
      }
      while (TRAILING_URL_PUNCTUATION.test(cleaned)) {
        cleaned = cleaned.replace(TRAILING_URL_PUNCTUATION, '');
      }
      if (!cleaned || seen.has(cleaned)) {
        continue;
      }
      seen.add(cleaned);
      urls.push(cleaned);
    }
  }

  return urls;
}

function getCtripHotelInputUrls(input = {}) {
  const rawValues = [input.url, input.urls, input.text, input.inputText];
  return extractUrlsFromText(rawValues).filter(isCtripHotelUrl);
}

function normalizeBatchConcurrency(value) {
  return Number(value) === 2 ? 2 : 1;
}

function buildScraperArgs(input, workDir) {
  const args = {
    url: input.url,
    urls: Array.isArray(input.urls) ? input.urls.join('\n') : input.urls,
    text: input.text || input.inputText || '',
    listFilters:
      input.listFilters && typeof input.listFilters === 'object' ? input.listFilters : undefined,
    listUrlFilters:
      input.listUrlFilters && typeof input.listUrlFilters === 'object'
        ? input.listUrlFilters
        : undefined,
    'auto-edge': true,
    'edge-user-data-dir': path.join(workDir, 'state', 'edge-profile'),
    'edge-profile-directory': 'Default',
    'edge-debugging-port': 9222,
    latestRun: path.join(workDir, 'output', 'latest-run.json')
  };

  if (input.templateId !== null && input.templateId !== undefined && input.templateId !== '') {
    args.templateId = input.templateId;
  }
  if (input.templateName) {
    args.templateName = input.templateName;
  }

  if (input.targetCount !== null && input.targetCount !== undefined && input.targetCount !== '') {
    args.targetCount = input.targetCount;
  }
  if (
    input.maxCandidatesPerPage !== null &&
    input.maxCandidatesPerPage !== undefined &&
    input.maxCandidatesPerPage !== ''
  ) {
    args.maxCandidatesPerPage = input.maxCandidatesPerPage;
  }
  if (
    input.desiredHotelCount !== null &&
    input.desiredHotelCount !== undefined &&
    input.desiredHotelCount !== ''
  ) {
    args.desiredHotelCount = input.desiredHotelCount;
  }
  if (input.excludeHotelTypes) {
    args.excludeHotelTypes = input.excludeHotelTypes;
  }
  if (input.excludeAccommodationKeywords) {
    args.excludeAccommodationKeywords = input.excludeAccommodationKeywords;
  }
  if (
    input.amapKey !== null &&
    input.amapKey !== undefined &&
    String(input.amapKey).trim() !== ''
  ) {
    args.amapKey = String(input.amapKey).trim();
  }
  const batchConcurrency = normalizeBatchConcurrency(input.batchConcurrency);
  if (batchConcurrency > 1) {
    args['batch-concurrency'] = batchConcurrency;
  }
  [
    'priceMin',
    'priceMax',
    'starLevels',
    'sortMode',
    'freeCancel',
    'reviewCountMin',
    'ctripScoreMin'
  ].forEach((key) => {
    if (input[key] !== undefined) {
      args[key] = input[key];
    }
  });

  return args;
}

function assertSafeWriteResult(result) {
  if (!result || result.success !== true) {
    return {
      ok: false,
      reason: result && result.error ? result.error : '采集失败，未写入。'
    };
  }

  if (!Number.isFinite(Number(result.eligibleCount)) || Number(result.eligibleCount) <= 0) {
    return {
      ok: false,
      reason: '没有符合模板人数、价格和房型规则的候选房型，未写入。'
    };
  }

  if (result.totalPrice === null || result.totalPrice === undefined || result.totalPrice === '') {
    return {
      ok: false,
      reason: '未采集到有效价格，未写入。'
    };
  }

  return {
    ok: true,
    reason: ''
  };
}

function emitScraperEvent(context = {}, type, message, details = {}) {
  if (typeof context.onEvent !== 'function') {
    return;
  }

  context.onEvent({
    type,
    message,
    details,
    at: new Date().toISOString()
  });
}

function assertNotCancelled(signal) {
  if (signal && signal.aborted) {
    throw new Error('任务已取消');
  }
}

function isTaskCancelled(error, signal) {
  if (signal && signal.aborted) {
    return true;
  }

  const message = error && error.message ? error.message : String(error || '');
  return /任务已取消/.test(message) || (error && error.name === 'AbortError');
}

module.exports = {
  assertNotCancelled,
  assertSafeWriteResult,
  buildScraperArgs,
  emitScraperEvent,
  getCtripHotelInputUrls,
  isCtripHotelUrl,
  isTaskCancelled,
  normalizeBatchConcurrency
};
