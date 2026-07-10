const {
  buildDesktopUrl,
  buildUrlOverridesFromTemplate,
  classifyCtripHotelUrl,
  extractCtripUrlsFromInput,
  parseHotelIdFromUrl
} = require('./ctrip-url');
const {
  buildCtripListUrl,
  hasCtripUrlFilterSettings,
  normalizeCtripUrlFilterSettings,
  parseCtripListUrl
} = require('./ctrip-url-filters');
const { collectListPageCandidates } = require('./scraper/list-page-collector');
const { normalizeListPageFilterOptions } = require('./scraper/list-page-parser');
const { normalizeText } = require('./utils');

const DEFAULT_LIST_CANDIDATE_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_LIST_CANDIDATE_CACHE_ENTRIES = 32;
const listCandidateCache = new Map();

function durationSince(startedAt) {
  return Math.max(0, Date.now() - startedAt);
}

function cloneCacheValue(value) {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeListCacheTtlMs(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return DEFAULT_LIST_CANDIDATE_CACHE_TTL_MS;
  }
  return Math.floor(number);
}

function normalizeListUrlForCache(listUrl) {
  try {
    const normalized = new URL(String(listUrl || ''));
    normalized.hash = '';
    normalized.searchParams.sort();
    return normalized.toString();
  } catch (_error) {
    return String(listUrl || '').trim();
  }
}

function buildListCandidateCacheKey(listUrl, template = {}, rawFilters = {}) {
  return JSON.stringify({
    listUrl: normalizeListUrlForCache(listUrl),
    checkIn: template.check_in_date || template.checkIn || '',
    checkOut: template.check_out_date || template.checkOut || '',
    roomCount: Number(template.room_count || template.roomCount || 0),
    filters: normalizeListPageFilterOptions(rawFilters)
  });
}

function clearExpiredListCandidateCache(now = Date.now()) {
  for (const [key, entry] of listCandidateCache.entries()) {
    if (!entry || entry.expiresAt <= now) {
      listCandidateCache.delete(key);
    }
  }
}

function clearListCandidateCache() {
  listCandidateCache.clear();
}

function buildListCandidateCacheValue(result = {}) {
  const selected = (Array.isArray(result.selected) ? result.selected : []).map((candidate) => ({
    hotelId: candidate.hotelId || '',
    hotelName: candidate.hotelName || candidate.name || '',
    detailUrl: candidate.detailUrl || candidate.url || '',
    url: candidate.detailUrl || candidate.url || '',
    sourceOrder: Number(candidate.sourceOrder || 0),
    source: candidate.source || ''
  }));
  return {
    inputUrl: result.inputUrl || '',
    pageUrls: [],
    pages: [],
    filters: result.filters || {},
    candidates: selected,
    totalCandidates: Number(result.totalCandidates || selected.length),
    selected,
    rejected: [],
    detailUrls: selected.map((candidate) => candidate.detailUrl).filter(Boolean),
    errors: [],
    edgeFallbackUsed: Boolean(result.edgeFallbackUsed),
    performance: {
      totalMs: Number((result.performance && result.performance.totalMs) || 0)
    }
  };
}

async function collectHotelListCandidates(listUrl, template = {}, rawFilters = {}, options = {}) {
  if (typeof options.collectListPageCandidates === 'function') {
    return options.collectListPageCandidates(listUrl, template, rawFilters, options);
  }

  const cacheTtlMs = normalizeListCacheTtlMs(options.listCandidateCacheTtlMs);
  const cacheEnabled = options.listCandidateCache !== false && cacheTtlMs > 0;
  const now = Date.now();
  const cacheKey = buildListCandidateCacheKey(listUrl, template, rawFilters);
  if (cacheEnabled) {
    clearExpiredListCandidateCache(now);
    const cached = listCandidateCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      const result = cloneCacheValue(cached.value);
      result.performance = {
        ...(result.performance || {}),
        cacheHit: true,
        cacheAgeMs: Math.max(0, now - cached.createdAt),
        cacheTtlMs
      };
      return result;
    }
  }

  const result = await collectListPageCandidates(listUrl, template, rawFilters, options);
  if (
    cacheEnabled &&
    Array.isArray(result.selected) &&
    result.selected.length > 0 &&
    (!Array.isArray(result.errors) || result.errors.length === 0)
  ) {
    if (listCandidateCache.size >= MAX_LIST_CANDIDATE_CACHE_ENTRIES) {
      listCandidateCache.delete(listCandidateCache.keys().next().value);
    }
    listCandidateCache.set(cacheKey, {
      createdAt: now,
      expiresAt: now + cacheTtlMs,
      value: buildListCandidateCacheValue(result)
    });
  }
  result.performance = {
    ...(result.performance || {}),
    cacheHit: false,
    cacheAgeMs: 0,
    cacheTtlMs
  };
  return result;
}

function buildDetailInput(url, template = {}, source = 'detail-input', listCandidate = null) {
  const detailUrl = buildDesktopUrl(url, buildUrlOverridesFromTemplate(template));
  return {
    url: detailUrl,
    hotelId: parseHotelIdFromUrl(detailUrl),
    source,
    listCandidate
  };
}

function pickCtripUrlFilterSettings(rawInput = {}) {
  const nested =
    rawInput.listUrlFilters ||
    rawInput.ctripUrlFilters ||
    rawInput.ctripListFilters ||
    rawInput.urlFilters ||
    null;
  if (nested && typeof nested === 'object' && hasCtripUrlFilterSettings(nested)) {
    return normalizeCtripUrlFilterSettings(nested);
  }

  const topLevel = {};
  [
    'priceMin',
    'priceMax',
    'starLevels',
    'sortMode',
    'freeCancel',
    'reviewCountMin',
    'ctripScoreMin',
    'accommodationTypeMode',
    'accommodationTypes',
    'roomTypes',
    'roomFeatures',
    'featureThemes'
  ].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(rawInput, key)) {
      topLevel[key] = rawInput[key];
    }
  });

  return hasCtripUrlFilterSettings(topLevel) ? normalizeCtripUrlFilterSettings(topLevel) : null;
}

async function expandCtripHotelInputs(rawInput = {}, template = {}, rawFilters = {}, options = {}) {
  const startedAt = Date.now();
  const inputUrls = extractCtripUrlsFromInput({
    ...rawInput,
    url: rawInput.url || rawInput.ctrip_url || rawInput['ctrip-url'] || template.ctrip_url
  });
  const urls = inputUrls.length ? inputUrls : template.ctrip_url ? [template.ctrip_url] : [];
  const details = [];
  const listResults = [];
  const skipped = [];
  const seenDetailUrls = new Set();
  const filters = normalizeListPageFilterOptions(rawFilters);
  const ctripUrlFilterSettings = pickCtripUrlFilterSettings(rawInput);
  const performance = {
    totalMs: 0,
    listCollectMs: 0,
    lists: []
  };
  let selectedFromLists = 0;

  const addDetail = (detail) => {
    if (!detail.url || seenDetailUrls.has(detail.url)) {
      return;
    }
    seenDetailUrls.add(detail.url);
    details.push(detail);
  };

  for (const url of urls) {
    const classification = classifyCtripHotelUrl(url);
    if (classification.type === 'detail') {
      addDetail(buildDetailInput(url, template, 'detail-input'));
      continue;
    }

    if (classification.type !== 'list') {
      skipped.push({
        url,
        reason: 'unsupported_ctrip_hotel_url'
      });
      continue;
    }

    const effectiveListUrl = ctripUrlFilterSettings
      ? buildCtripListUrl(url, ctripUrlFilterSettings)
      : url;
    let effectiveListFilters = '';
    try {
      effectiveListFilters = parseCtripListUrl(effectiveListUrl).listFiltersRaw || '';
    } catch (_error) {
      effectiveListFilters = '';
    }
    const remainingTarget = Math.max(1, filters.desiredHotelCount - selectedFromLists);
    const listStartedAt = Date.now();
    const listResult = await collectHotelListCandidates(
      effectiveListUrl,
      template,
      {
        ...filters,
        desiredHotelCount: remainingTarget,
        targetCount: remainingTarget
      },
      options
    );
    const listDurationMs = durationSince(listStartedAt);
    performance.listCollectMs += listDurationMs;
    performance.lists.push({
      inputUrl: url,
      effectiveListUrl,
      effectiveListFilters,
      ctripUrlFilterSettings,
      durationMs: listDurationMs,
      selectedCount: Array.isArray(listResult.selected) ? listResult.selected.length : 0,
      totalCandidates: Number(listResult.totalCandidates || 0),
      edgeFallbackUsed: Boolean(listResult.edgeFallbackUsed),
      collector: listResult.performance || null
    });
    listResults.push(listResult);
    selectedFromLists += listResult.selected.length;

    for (const candidate of listResult.selected) {
      addDetail(
        buildDetailInput(
          candidate.detailUrl || candidate.url,
          template,
          'list-prefilter',
          candidate
        )
      );
    }
  }

  const listCount = listResults.length;
  const detailInputCount = details.filter((item) => item.source === 'detail-input').length;
  const inputMode =
    listCount > 0 && detailInputCount > 0
      ? 'mixed'
      : listCount > 0
        ? 'list'
        : details.length > 1
          ? 'multi-detail'
          : 'detail';
  performance.totalMs = durationSince(startedAt);

  return {
    inputMode,
    requestedUrls: urls,
    hotelInputs: details,
    listResults,
    performance,
    skippedUrls: skipped,
    summary: {
      inputMode,
      requestedUrlCount: urls.length,
      detailInputCount,
      listInputCount: listCount,
      expandedHotelCount: details.length,
      listSelectedCount: details.filter((item) => item.source === 'list-prefilter').length,
      skippedUrlCount: skipped.length,
      listCandidateCount: listResults.reduce(
        (sum, item) => sum + (Number(item.totalCandidates) || 0),
        0
      ),
      listRejectedCount: listResults.reduce(
        (sum, item) => sum + (Array.isArray(item.rejected) ? item.rejected.length : 0),
        0
      ),
      filters,
      ctripUrlFilterSettings,
      performance
    }
  };
}

function normalizeListFiltersFromArgs(args = {}) {
  const listFilters =
    args.listFilters && typeof args.listFilters === 'object' ? args.listFilters : {};
  return normalizeListPageFilterOptions({
    ...listFilters,
    desiredHotelCount:
      args.desiredHotelCount ??
      args.targetCount ??
      args['desired-hotel-count'] ??
      args['target-count'] ??
      args.limit ??
      listFilters.desiredHotelCount ??
      listFilters.targetCount,
    maxCandidatesPerPage:
      args.maxCandidatesPerPage ??
      args['max-candidates-per-page'] ??
      listFilters.maxCandidatesPerPage
  });
}

function describeExpandedInput(expandedInputs = {}) {
  const summary = expandedInputs.summary || {};
  const parts = [
    `模式=${summary.inputMode || expandedInputs.inputMode || ''}`,
    `输入URL=${summary.requestedUrlCount ?? 0}`,
    `展开酒店=${summary.expandedHotelCount ?? 0}`
  ];
  if (summary.listInputCount) {
    parts.push(`列表页=${summary.listInputCount}`);
    parts.push(`前筛候选=${summary.listCandidateCount ?? 0}`);
    parts.push(`前筛排除=${summary.listRejectedCount ?? 0}`);
  }
  return parts.map(normalizeText).filter(Boolean).join('，');
}

function buildListResultsSummary(listResults = []) {
  return listResults.map((result) => ({
    inputUrl: result.inputUrl || '',
    selectedCount: Array.isArray(result.selected) ? result.selected.length : 0,
    totalCandidates: Number(result.totalCandidates || 0),
    rejectedCount: Array.isArray(result.rejected) ? result.rejected.length : 0,
    edgeFallbackUsed: Boolean(result.edgeFallbackUsed),
    htmlFetchMs: result.performance ? result.performance.htmlFetchMs : 0,
    edgeFallbackMs: result.performance ? result.performance.edgeFallbackMs : 0,
    totalMs: result.performance ? result.performance.totalMs : 0,
    errors: Array.isArray(result.errors)
      ? result.errors.map((e) => e.error || '').filter(Boolean)
      : []
  }));
}

module.exports = {
  DEFAULT_LIST_CANDIDATE_CACHE_TTL_MS,
  buildListResultsSummary,
  clearListCandidateCache,
  describeExpandedInput,
  expandCtripHotelInputs,
  normalizeListFiltersFromArgs
};
