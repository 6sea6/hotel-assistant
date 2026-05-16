const {
  mergeHotelListCandidates,
  parseHotelListCandidatesFromHtml
} = require('./hotel-list-parser');
const {
  normalizeText,
  toNumber
} = require('../utils');
const { parseHotelIdFromUrl } = require('../ctrip-url');

const DEFAULT_EXCLUDE_HOTEL_TYPE_KEYWORDS = Object.freeze(['民宿', '客栈', '青年旅舍', '公寓']);
const DEFAULT_DESIRED_HOTEL_COUNT = 10;
const DEFAULT_MAX_PAGES = 1;
const DEFAULT_MAX_CANDIDATES_PER_PAGE = 80;

function normalizeKeywordList(value) {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => normalizeKeywordList(item))
      .filter(Boolean);
  }

  return String(value || '')
    .split(/[,，;；\n\r|]+/)
    .map((item) => normalizeText(item).toLowerCase())
    .filter(Boolean);
}

function hasAnyOwnValue(object, keys) {
  if (!object || typeof object !== 'object') {
    return false;
  }

  return keys.some((key) => Object.prototype.hasOwnProperty.call(object, key)
    && object[key] !== undefined
    && object[key] !== null);
}

function normalizePositiveInteger(value, fallback) {
  const numberValue = toNumber(value);
  if (!numberValue || numberValue <= 0) {
    return fallback;
  }

  return Math.max(1, Math.trunc(numberValue));
}

function normalizeScore(value) {
  const score = toNumber(value);
  if (score === null) {
    return null;
  }
  if (score > 0 && score <= 5) {
    return Number(score.toFixed(1));
  }
  if (score > 5 && score <= 10) {
    return Number((score / 2).toFixed(1));
  }
  return null;
}

function normalizeListPageFilterOptions(options = {}) {
  const minScore = toNumber(
    options.minScore
      ?? options.minRating
      ?? options.minimumScore
      ?? options['min-score']
      ?? options['min-rating']
  );
  const desiredHotelCount = normalizePositiveInteger(
    options.desiredHotelCount
      ?? options.targetCount
      ?? options.limit
      ?? options.maxHotels
      ?? options['desired-hotel-count']
      ?? options['target-count']
      ?? options['max-hotels'],
    DEFAULT_DESIRED_HOTEL_COUNT
  );
  const maxPages = normalizePositiveInteger(
    options.maxPages
      ?? options.pageLimit
      ?? options['max-pages']
      ?? options['page-limit'],
    DEFAULT_MAX_PAGES
  );
  const maxCandidatesPerPage = normalizePositiveInteger(
    options.maxCandidatesPerPage
      ?? options['max-candidates-per-page'],
    DEFAULT_MAX_CANDIDATES_PER_PAGE
  );
  const hasExplicitHotelTypes = hasAnyOwnValue(options, [
    'excludeHotelTypes',
    'excludeAccommodationKeywords',
    'excludeAccommodationTypes',
    'excludeTypeKeywords',
    'exclude_type_keywords',
    'exclude-hotel-types',
    'exclude-accommodation-keywords',
    'exclude-type-keywords'
  ]);
  const excludeHotelTypes = hasExplicitHotelTypes
    ? normalizeKeywordList(
      options.excludeHotelTypes
        ?? options.excludeAccommodationKeywords
        ?? options.excludeAccommodationTypes
        ?? options.excludeTypeKeywords
        ?? options.exclude_type_keywords
        ?? options['exclude-hotel-types']
        ?? options['exclude-accommodation-keywords']
        ?? options['exclude-type-keywords']
    )
    : [...DEFAULT_EXCLUDE_HOTEL_TYPE_KEYWORDS].map((item) => item.toLowerCase());
  const excludeKeywords = normalizeKeywordList(
    options.excludeKeywords
      ?? options.excludeNameKeywords
      ?? options.excludeHotelNameKeywords
      ?? options.exclude_name_keywords
      ?? options['exclude-keywords']
      ?? options['exclude-name-keywords']
      ?? options['exclude-hotel-name-keywords']
  );

  return {
    minScore,
    excludeKeywords,
    excludeHotelTypes,
    desiredHotelCount,
    targetCount: desiredHotelCount,
    maxPages,
    maxCandidatesPerPage,
    excludeNameKeywords: excludeKeywords,
    excludeAccommodationKeywords: excludeHotelTypes
  };
}

function normalizeTagArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean);
  }

  const text = normalizeText(value);
  return text ? [text] : [];
}

function normalizeListPageCandidate(candidate = {}, index = 0, options = {}) {
  const detailUrl = normalizeText(candidate.detailUrl || candidate.url || candidate.href);
  const hotelId = normalizeText(candidate.hotelId || parseHotelIdFromUrl(detailUrl));
  const hotelName = normalizeText(candidate.hotelName || candidate.name || candidate.title);
  const hotelType = normalizeText(candidate.hotelType || candidate.accommodationType || candidate.type || candidate.typeName);
  const badges = normalizeTagArray(candidate.badges || candidate.tags || candidate.tagNames);
  const visibleTags = normalizeTagArray(candidate.visibleTags || candidate.displayTags || candidate.highlightTags);
  const ctripScore = normalizeScore(candidate.ctripScore ?? candidate.score ?? candidate.rating);
  const sourceOrder = Number.isFinite(Number(candidate.sourceOrder))
    ? Number(candidate.sourceOrder)
    : (Number(options.sourceOrderOffset) || 0) + index + 1;

  return {
    hotelId,
    hotelName,
    ctripScore,
    detailUrl,
    badges,
    hotelType,
    visibleTags,
    sourceOrder,
    source: candidate.source || '',
    address: normalizeText(candidate.address),
    url: detailUrl,
    name: hotelName,
    score: ctripScore,
    accommodationType: hotelType
  };
}

function parseListPageCandidatesFromHtml(html, baseUrl, options = {}) {
  const filters = normalizeListPageFilterOptions(options.filters || options);
  const rawCandidates = parseHotelListCandidatesFromHtml(html, baseUrl, {
    template: options.template || {}
  });
  const cappedCandidates = rawCandidates.slice(0, filters.maxCandidatesPerPage);

  return cappedCandidates.map((candidate, index) => normalizeListPageCandidate(candidate, index, {
    sourceOrderOffset: options.sourceOrderOffset || 0
  }));
}

function containsAnyKeyword(value, keywords = []) {
  const text = normalizeText(value).toLowerCase();
  return keywords.find((keyword) => keyword && text.includes(keyword)) || '';
}

function mergeListPageCandidates(candidates = []) {
  const normalized = candidates.map((candidate, index) => normalizeListPageCandidate(candidate, index));
  const legacyMerged = mergeHotelListCandidates(normalized);
  const byKey = new Map();

  for (const candidate of normalized) {
    const key = candidate.hotelId || candidate.detailUrl;
    if (!key || byKey.has(key)) {
      continue;
    }
    byKey.set(key, candidate);
  }

  for (const candidate of legacyMerged) {
    const key = candidate.hotelId || candidate.url;
    if (!key || byKey.has(key)) {
      continue;
    }
    byKey.set(key, normalizeListPageCandidate(candidate));
  }

  return [...byKey.values()].sort((left, right) => left.sourceOrder - right.sourceOrder);
}

function filterListPageCandidates(candidates = [], rawFilters = {}) {
  const filters = normalizeListPageFilterOptions(rawFilters);
  const mergedCandidates = mergeListPageCandidates(candidates);
  const selected = [];
  const rejected = [];

  for (const candidate of mergedCandidates) {
    const nameText = [candidate.hotelName, ...candidate.visibleTags].join(' ');
    const typeText = [candidate.hotelType, ...candidate.badges, ...candidate.visibleTags].join(' ');
    const nameKeyword = containsAnyKeyword(nameText, filters.excludeKeywords);
    const typeKeyword = containsAnyKeyword(typeText, filters.excludeHotelTypes);
    let rejectReason = '';

    if (filters.minScore !== null && candidate.ctripScore === null) {
      rejectReason = 'score_missing';
    } else if (filters.minScore !== null && candidate.ctripScore < filters.minScore) {
      rejectReason = 'score_below_minimum';
    } else if (typeKeyword) {
      rejectReason = `hotel_type_keyword:${typeKeyword}`;
    } else if (nameKeyword) {
      rejectReason = `name_keyword:${nameKeyword}`;
    }

    if (rejectReason) {
      rejected.push({
        ...candidate,
        rejectReason
      });
      continue;
    }

    if (selected.length < filters.desiredHotelCount) {
      selected.push(candidate);
    } else {
      rejected.push({
        ...candidate,
        rejectReason: 'desired_hotel_count_reached'
      });
    }
  }

  return {
    filters,
    totalCandidates: mergedCandidates.length,
    selected,
    rejected,
    detailUrls: selected.map((candidate) => candidate.detailUrl).filter(Boolean)
  };
}

module.exports = {
  DEFAULT_EXCLUDE_HOTEL_TYPE_KEYWORDS,
  filterListPageCandidates,
  normalizeListPageCandidate,
  normalizeListPageFilterOptions,
  parseListPageCandidatesFromHtml
};
