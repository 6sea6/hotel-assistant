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
  normalizeCtripUrlFilterSettings
} = require('./ctrip-url-filters');
const {
  captureListHtmlPagesWithEdge,
  collectListPageCandidates
} = require('./scraper/list-page-collector');
const { normalizeListPageFilterOptions } = require('./scraper/list-page-parser');
const { normalizeText } = require('./utils');

function durationSince(startedAt) {
  return Math.max(0, Date.now() - startedAt);
}

async function collectHotelListCandidates(listUrl, template = {}, rawFilters = {}, options = {}) {
  if (typeof options.collectListPageCandidates === 'function') {
    return options.collectListPageCandidates(listUrl, template, rawFilters, options);
  }

  return collectListPageCandidates(listUrl, template, rawFilters, options);
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
    'ctripScoreMin'
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
      performance
    }
  };
}

function normalizeListFiltersFromArgs(args = {}) {
  const listFilters =
    args.listFilters && typeof args.listFilters === 'object' ? args.listFilters : {};
  return normalizeListPageFilterOptions({
    ...listFilters,
    excludeHotelTypes:
      args.excludeHotelTypes ??
      args.excludeAccommodationKeywords ??
      args.excludeAccommodationTypes ??
      args.excludeTypeKeywords ??
      args['exclude-hotel-types'] ??
      args['exclude-accommodation-keywords'] ??
      args['exclude-type-keywords'] ??
      listFilters.excludeHotelTypes ??
      listFilters.excludeAccommodationKeywords,
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

function hasMultipleHotelInputs(expandedInputs = {}) {
  return Array.isArray(expandedInputs.hotelInputs) && expandedInputs.hotelInputs.length > 1;
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

module.exports = {
  buildDetailInput,
  captureListHtmlPagesWithEdge,
  collectHotelListCandidates,
  describeExpandedInput,
  expandCtripHotelInputs,
  hasMultipleHotelInputs,
  normalizeListFiltersFromArgs
};
