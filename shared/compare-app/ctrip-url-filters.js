const PRICE_FILTER_PATTERN = /^15~Range\*15\*(\d+)~(\d+|max)$/i;

const STAR_LEVEL_FILTERS = Object.freeze({
  2: '16~2*16*2',
  3: '16~3*16*3',
  4: '16~4*16*4',
  5: '16~5*16*5'
});

const SORT_MODE_TO_FILTER = Object.freeze({
  popularity: '17~1*17*1',
  price_low: '17~3*17*3',
  review_high: '17~6*17*6'
});

const FILTER_TO_SORT_MODE = Object.freeze(
  Object.fromEntries(Object.entries(SORT_MODE_TO_FILTER).map(([mode, filter]) => [filter, mode]))
);

const FREE_CANCEL_FILTER = '23~10*23*10';

const REVIEW_COUNT_TO_FILTER = Object.freeze({
  100: '25~5*25*100',
  200: '25~6*25*200',
  500: '25~7*25*500'
});

const FILTER_TO_REVIEW_COUNT = Object.freeze(
  Object.fromEntries(
    Object.entries(REVIEW_COUNT_TO_FILTER).map(([count, filter]) => [filter, Number(count)])
  )
);

const SCORE_MIN_TO_FILTER = Object.freeze({
  4: '6~3*6*3',
  4.5: '6~4*6*4',
  4.7: '6~11*6*11'
});

const FILTER_TO_SCORE_MIN = Object.freeze(
  Object.fromEntries(
    Object.entries(SCORE_MIN_TO_FILTER).map(([score, filter]) => [filter, Number(score)])
  )
);

const CONTROLLED_SETTING_KEYS = Object.freeze([
  'priceMin',
  'priceMax',
  'starLevels',
  'sortMode',
  'freeCancel',
  'reviewCountMin',
  'ctripScoreMin'
]);

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function normalizeFilterPart(part) {
  return String(part || '').trim();
}

function splitListFilters(value) {
  return String(value || '')
    .split(',')
    .map(normalizeFilterPart)
    .filter(Boolean);
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toIntegerOrNull(value, options = {}) {
  const number = toNumberOrNull(value);
  if (number === null) {
    return null;
  }

  const integer = Math.trunc(number);
  if (options.min !== undefined && integer < options.min) {
    return null;
  }
  if (options.max !== undefined && integer > options.max) {
    return null;
  }
  return integer;
}

function normalizePriceMax(value) {
  if (
    String(value || '')
      .trim()
      .toLowerCase() === 'max'
  ) {
    return 'max';
  }

  return toIntegerOrNull(value, { min: 0 });
}

function normalizeStarLevels(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(/[,，;；\s|]+/);
  const seen = new Set();
  const levels = [];

  for (const item of values) {
    const level = toIntegerOrNull(item, { min: 2, max: 5 });
    if (level === null || seen.has(level)) {
      continue;
    }
    seen.add(level);
    levels.push(level);
  }

  return levels;
}

function normalizeSortMode(value) {
  const mode = String(value || '').trim();
  return Object.prototype.hasOwnProperty.call(SORT_MODE_TO_FILTER, mode) ? mode : null;
}

function normalizeReviewCountMin(value) {
  const count = toIntegerOrNull(value);
  return Object.prototype.hasOwnProperty.call(REVIEW_COUNT_TO_FILTER, count) ? count : null;
}

function normalizeCtripScoreMin(value) {
  const score = toNumberOrNull(value);
  if (score === null) {
    return null;
  }
  const normalized = Number(score.toFixed(1));
  return Object.prototype.hasOwnProperty.call(SCORE_MIN_TO_FILTER, normalized) ? normalized : null;
}

function normalizeCtripUrlFilterSettings(settings = {}) {
  return {
    priceMin: hasOwn(settings, 'priceMin')
      ? toIntegerOrNull(settings.priceMin, { min: 0 })
      : undefined,
    priceMax: hasOwn(settings, 'priceMax') ? normalizePriceMax(settings.priceMax) : undefined,
    starLevels: hasOwn(settings, 'starLevels')
      ? normalizeStarLevels(settings.starLevels)
      : undefined,
    sortMode: hasOwn(settings, 'sortMode') ? normalizeSortMode(settings.sortMode) : undefined,
    freeCancel: hasOwn(settings, 'freeCancel') ? Boolean(settings.freeCancel) : undefined,
    reviewCountMin: hasOwn(settings, 'reviewCountMin')
      ? normalizeReviewCountMin(settings.reviewCountMin)
      : undefined,
    ctripScoreMin: hasOwn(settings, 'ctripScoreMin')
      ? normalizeCtripScoreMin(settings.ctripScoreMin)
      : undefined
  };
}

function hasCtripUrlFilterSettings(settings = {}) {
  return CONTROLLED_SETTING_KEYS.some((key) => hasOwn(settings, key));
}

function isKnownStarFilter(part) {
  return Object.values(STAR_LEVEL_FILTERS).includes(part);
}

function isStarFilter(part) {
  return /^16~/.test(part);
}

function isKnownSortFilter(part) {
  return Object.prototype.hasOwnProperty.call(FILTER_TO_SORT_MODE, part);
}

function isSortFilter(part) {
  return /^17~/.test(part);
}

function isKnownReviewCountFilter(part) {
  return Object.prototype.hasOwnProperty.call(FILTER_TO_REVIEW_COUNT, part);
}

function isKnownScoreFilter(part) {
  return Object.prototype.hasOwnProperty.call(FILTER_TO_SCORE_MIN, part);
}

function readKnownFilterSettings(parts = []) {
  const knownSettings = {
    priceMin: null,
    priceMax: null,
    starLevels: [],
    sortMode: null,
    freeCancel: false,
    reviewCountMin: null,
    ctripScoreMin: null
  };
  const unknownFilters = [];
  const detectedKnownFilterKeys = new Set();

  for (const rawPart of parts) {
    const part = normalizeFilterPart(rawPart);
    const priceMatch = part.match(PRICE_FILTER_PATTERN);
    if (priceMatch) {
      knownSettings.priceMin = Number(priceMatch[1]);
      knownSettings.priceMax =
        priceMatch[2].toLowerCase() === 'max' ? 'max' : Number(priceMatch[2]);
      detectedKnownFilterKeys.add('priceMin');
      detectedKnownFilterKeys.add('priceMax');
      continue;
    }

    if (isKnownStarFilter(part)) {
      const level = Number(part.match(/^16~(\d)\*16\*\d$/)[1]);
      if (!knownSettings.starLevels.includes(level)) {
        knownSettings.starLevels.push(level);
      }
      detectedKnownFilterKeys.add('starLevels');
      continue;
    }

    if (isKnownSortFilter(part)) {
      knownSettings.sortMode = FILTER_TO_SORT_MODE[part];
      detectedKnownFilterKeys.add('sortMode');
      continue;
    }

    if (part === FREE_CANCEL_FILTER) {
      knownSettings.freeCancel = true;
      detectedKnownFilterKeys.add('freeCancel');
      continue;
    }

    if (isKnownReviewCountFilter(part)) {
      knownSettings.reviewCountMin = FILTER_TO_REVIEW_COUNT[part];
      detectedKnownFilterKeys.add('reviewCountMin');
      continue;
    }

    if (isKnownScoreFilter(part)) {
      knownSettings.ctripScoreMin = FILTER_TO_SCORE_MIN[part];
      detectedKnownFilterKeys.add('ctripScoreMin');
      continue;
    }

    if (part) {
      unknownFilters.push(part);
    }
  }

  knownSettings.starLevels.sort((left, right) => left - right);
  return {
    knownSettings,
    unknownFilters,
    detectedKnownFilterKeys: [...detectedKnownFilterKeys]
  };
}

function parseCtripListUrl(rawUrl) {
  const originalUrl = String(rawUrl || '').trim();
  const parsed = new URL(originalUrl);
  const listFiltersRaw = parsed.searchParams.get('listFilters') || '';
  const listFilterParts = splitListFilters(listFiltersRaw);
  const queryParams = {};

  parsed.searchParams.forEach((value, key) => {
    if (key !== 'listFilters') {
      queryParams[key] = value;
    }
  });

  const { knownSettings, unknownFilters, detectedKnownFilterKeys } =
    readKnownFilterSettings(listFilterParts);

  return {
    originalUrl,
    baseUrl: `${parsed.origin}${parsed.pathname}`,
    queryParams,
    listFiltersRaw,
    listFilterParts,
    knownSettings,
    unknownFilters,
    detectedKnownFilterKeys,
    hasKnownFilters: detectedKnownFilterKeys.length > 0
  };
}

function shouldRemoveExistingFilter(part, settings = {}) {
  if (
    (hasOwn(settings, 'priceMin') || hasOwn(settings, 'priceMax')) &&
    PRICE_FILTER_PATTERN.test(part)
  ) {
    return true;
  }
  if (hasOwn(settings, 'starLevels') && isStarFilter(part)) {
    return true;
  }
  if (hasOwn(settings, 'sortMode') && isSortFilter(part)) {
    return true;
  }
  if (hasOwn(settings, 'freeCancel') && part === FREE_CANCEL_FILTER) {
    return true;
  }
  if (hasOwn(settings, 'reviewCountMin') && isKnownReviewCountFilter(part)) {
    return true;
  }
  if (hasOwn(settings, 'ctripScoreMin') && isKnownScoreFilter(part)) {
    return true;
  }
  return false;
}

function buildPriceFilter(settings = {}) {
  if (!hasOwn(settings, 'priceMin') && !hasOwn(settings, 'priceMax')) {
    return '';
  }

  const min = toIntegerOrNull(settings.priceMin, { min: 0 });
  const max = normalizePriceMax(settings.priceMax);
  if (min === null && max === null) {
    return '';
  }

  const priceMin = min === null ? 0 : min;
  const priceMax = max === null ? 'max' : max;
  return `15~Range*15*${priceMin}~${priceMax}`;
}

function buildKnownFilterParts(rawSettings = {}) {
  const settings = normalizeCtripUrlFilterSettings(rawSettings);
  const parts = [];
  const priceFilter = buildPriceFilter(settings);
  if (priceFilter) {
    parts.push(priceFilter);
  }

  if (Array.isArray(settings.starLevels)) {
    for (const level of settings.starLevels) {
      if (STAR_LEVEL_FILTERS[level]) {
        parts.push(STAR_LEVEL_FILTERS[level]);
      }
    }
  }

  if (settings.sortMode && SORT_MODE_TO_FILTER[settings.sortMode]) {
    parts.push(SORT_MODE_TO_FILTER[settings.sortMode]);
  }

  if (settings.freeCancel === true) {
    parts.push(FREE_CANCEL_FILTER);
  }

  if (settings.reviewCountMin && REVIEW_COUNT_TO_FILTER[settings.reviewCountMin]) {
    parts.push(REVIEW_COUNT_TO_FILTER[settings.reviewCountMin]);
  }

  if (settings.ctripScoreMin && SCORE_MIN_TO_FILTER[settings.ctripScoreMin]) {
    parts.push(SCORE_MIN_TO_FILTER[settings.ctripScoreMin]);
  }

  return parts;
}

function mergeCtripFilters(existingFilters = [], settings = {}) {
  const normalizedExisting = (
    Array.isArray(existingFilters) ? existingFilters : splitListFilters(existingFilters)
  )
    .map(normalizeFilterPart)
    .filter(Boolean);
  const preserved = normalizedExisting.filter(
    (part) => !shouldRemoveExistingFilter(part, settings)
  );
  return [...preserved, ...buildKnownFilterParts(settings)];
}

function buildCtripListUrl(baseUrl, settings = {}) {
  const parsed = new URL(String(baseUrl || '').trim());
  const existingFilters = splitListFilters(parsed.searchParams.get('listFilters') || '');
  const mergedFilters = mergeCtripFilters(existingFilters, settings);

  if (mergedFilters.length > 0) {
    parsed.searchParams.set('listFilters', mergedFilters.join(','));
  } else {
    parsed.searchParams.delete('listFilters');
  }

  return parsed.toString();
}

module.exports = {
  CONTROLLED_SETTING_KEYS,
  FILTER_TO_REVIEW_COUNT,
  FILTER_TO_SCORE_MIN,
  FILTER_TO_SORT_MODE,
  FREE_CANCEL_FILTER,
  PRICE_FILTER_PATTERN,
  REVIEW_COUNT_TO_FILTER,
  SCORE_MIN_TO_FILTER,
  SORT_MODE_TO_FILTER,
  STAR_LEVEL_FILTERS,
  buildCtripListUrl,
  hasCtripUrlFilterSettings,
  mergeCtripFilters,
  normalizeCtripUrlFilterSettings,
  parseCtripListUrl,
  splitListFilters
};
