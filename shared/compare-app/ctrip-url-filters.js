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

const ACCOMMODATION_TYPE_FILTERS = Object.freeze({
  酒店: '75~TAG_495*75*495',
  民宿: '75~TAG_510*75*510',
  青年旅馆: '75~TAG_519*75*519',
  酒店公寓: '75~TAG_505*75*505',
  公寓: '75~TAG_513*75*513',
  别墅: '75~TAG_507*75*507',
  特色酒店: '75~TAG_1308*75*1308',
  度假村: '75~TAG_497*75*497',
  度假屋: '75~TAG_514*75*514',
  特色住宿: '75~TAG_521*75*521',
  胶囊旅馆: '75~TAG_520*75*520',
  乡村民宿: '75~TAG_517*75*517',
  客栈: '75~TAG_506*75*506',
  露营地: '75~TAG_523*75*523',
  木屋: '75~TAG_524*75*524',
  家庭旅馆: '75~TAG_503*75*503',
  旅馆: '75~TAG_499*75*499',
  农家乐: '75~TAG_509*75*509'
});

const ROOM_TYPE_FILTERS = Object.freeze({
  大床房: '4~1*4*1',
  双床房: '4~2*4*2',
  单人床房: '4~4*4*4',
  三床房: '4~6*4*6',
  特大床房: '4~3*4*3',
  多床房: '4~5*4*5'
});

const ROOM_FEATURE_FILTERS = Object.freeze({
  家庭房: '81~1188*81*1188',
  复式loft房: '81~1587*81*1587',
  影音房: '81~1192*81*1192',
  亲子主题房: '81~679*81*679',
  棋牌房: '81~873*81*873',
  整栋: '81~1395*81*1395',
  套房: '81~1309*81*1309',
  电竞房: '81~952*81*952',
  情侣房: '81~1186*81*1186',
  私汤房: '81~1174*81*1174',
  江河景房: '81~671*81*671',
  水床房: '81~834*81*834',
  阳台房: '81~1581*81*1581',
  独栋别墅: '81~14477*81*14477',
  榻榻米房: '81~1583*81*1583',
  圆床房: '81~835*81*835',
  湖景房: '81~1061*81*1061',
  自营影音房: '81~1191*81*1191',
  自营亲子房: '81~1185*81*1185',
  自营电玩房: '81~14815*81*14815',
  山景房: '81~1062*81*1062',
  自营舒睡房: '81~1190*81*1190'
});

const FEATURE_THEME_FILTERS = Object.freeze({
  电竞酒店: '1~771*1*771',
  迷人江景: '1~1198*1*1198',
  亲子酒店: '1~1150*1*1150',
  窗外好景: '1~643*1*643',
  拍照出片: '1~619*1*619',
  浪漫之旅: '1~1187*1*1187',
  网红泳池: '1~102*1*102',
  动人夜景: '1~696*1*696',
  湖畔美居: '1~673*1*673',
  设计师酒店: '1~112*1*112',
  自助入住: '1~1320*1*1320',
  低碳酒店: '1~1393*1*1393',
  宜人山色: '1~1212*1*1212',
  历史名宅: '1~644*1*644',
  露营: '1~1151*1*1151',
  无烟酒店: '1~33261*1*33261',
  美食酒店: '1~612*1*612'
});

const FILTER_GROUPS = Object.freeze({
  accommodationTypes: ACCOMMODATION_TYPE_FILTERS,
  roomTypes: ROOM_TYPE_FILTERS,
  roomFeatures: ROOM_FEATURE_FILTERS,
  featureThemes: FEATURE_THEME_FILTERS
});

const FILTER_TO_SELECTION = Object.freeze(
  Object.fromEntries(
    Object.entries(FILTER_GROUPS).flatMap(([groupKey, filters]) =>
      Object.entries(filters).map(([label, filter]) => [filter, { groupKey, label }])
    )
  )
);

const CONTROLLED_SETTING_KEYS = Object.freeze([
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

function splitSelectionValues(value) {
  return Array.isArray(value) ? value : String(value || '').split(/[,，;；\s|]+/);
}

function normalizeSelectionList(value, filters = {}) {
  const filterToLabel = Object.fromEntries(
    Object.entries(filters).map(([label, filter]) => [filter, label])
  );
  const seen = new Set();
  const result = [];

  for (const item of splitSelectionValues(value)) {
    const text = normalizeFilterPart(item);
    if (!text) continue;
    const label =
      Object.prototype.hasOwnProperty.call(filters, text)
        ? text
        : filterToLabel[text] ||
          Object.entries(filters).find(([, filter]) => {
            const escaped = filter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (text === filter) return true;
            return new RegExp(`(?:^|[~*])${String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[~*])`).test(filter) ||
              new RegExp(`^${escaped}$`).test(text);
          })?.[0] ||
          '';
    if (!label || seen.has(label)) continue;
    seen.add(label);
    result.push(label);
  }

  return result;
}

function normalizeAccommodationTypeMode(value) {
  return String(value || '').trim() === 'exclude' ? 'exclude' : 'include';
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
      : undefined,
    accommodationTypeMode: hasOwn(settings, 'accommodationTypeMode')
      ? normalizeAccommodationTypeMode(settings.accommodationTypeMode)
      : undefined,
    accommodationTypes: hasOwn(settings, 'accommodationTypes')
      ? normalizeSelectionList(settings.accommodationTypes, ACCOMMODATION_TYPE_FILTERS)
      : undefined,
    roomTypes: hasOwn(settings, 'roomTypes')
      ? normalizeSelectionList(settings.roomTypes, ROOM_TYPE_FILTERS)
      : undefined,
    roomFeatures: hasOwn(settings, 'roomFeatures')
      ? normalizeSelectionList(settings.roomFeatures, ROOM_FEATURE_FILTERS)
      : undefined,
    featureThemes: hasOwn(settings, 'featureThemes')
      ? normalizeSelectionList(settings.featureThemes, FEATURE_THEME_FILTERS)
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
    ctripScoreMin: null,
    accommodationTypeMode: 'include',
    accommodationTypes: [],
    roomTypes: [],
    roomFeatures: [],
    featureThemes: []
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

    if (FILTER_TO_SELECTION[part]) {
      const { groupKey, label } = FILTER_TO_SELECTION[part];
      if (!knownSettings[groupKey].includes(label)) {
        knownSettings[groupKey].push(label);
      }
      detectedKnownFilterKeys.add(groupKey);
      if (groupKey === 'accommodationTypes') {
        detectedKnownFilterKeys.add('accommodationTypeMode');
      }
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
  if (hasOwn(settings, 'accommodationTypes') && /^75~/.test(part)) {
    return true;
  }
  if (hasOwn(settings, 'roomTypes') && /^4~/.test(part)) {
    return true;
  }
  if (hasOwn(settings, 'roomFeatures') && /^81~/.test(part)) {
    return true;
  }
  if (hasOwn(settings, 'featureThemes') && /^1~/.test(part)) {
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

function buildSelectionFilterParts(selectedLabels = [], filters = {}) {
  return selectedLabels.map((label) => filters[label]).filter(Boolean);
}

function buildAccommodationTypeFilterParts(settings = {}) {
  if (!hasOwn(settings, 'accommodationTypes')) {
    return [];
  }

  const selected = normalizeSelectionList(settings.accommodationTypes, ACCOMMODATION_TYPE_FILTERS);
  if (!selected.length) {
    return [];
  }

  const mode = normalizeAccommodationTypeMode(settings.accommodationTypeMode);
  const labels =
    mode === 'exclude'
      ? Object.keys(ACCOMMODATION_TYPE_FILTERS).filter((label) => !selected.includes(label))
      : selected;
  return buildSelectionFilterParts(labels, ACCOMMODATION_TYPE_FILTERS);
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

  parts.push(...buildAccommodationTypeFilterParts(settings));
  if (Array.isArray(settings.roomTypes)) {
    parts.push(...buildSelectionFilterParts(settings.roomTypes, ROOM_TYPE_FILTERS));
  }
  if (Array.isArray(settings.roomFeatures)) {
    parts.push(...buildSelectionFilterParts(settings.roomFeatures, ROOM_FEATURE_FILTERS));
  }
  if (Array.isArray(settings.featureThemes)) {
    parts.push(...buildSelectionFilterParts(settings.featureThemes, FEATURE_THEME_FILTERS));
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
  ACCOMMODATION_TYPE_FILTERS,
  CONTROLLED_SETTING_KEYS,
  FEATURE_THEME_FILTERS,
  FILTER_TO_REVIEW_COUNT,
  FILTER_TO_SCORE_MIN,
  FILTER_TO_SORT_MODE,
  FREE_CANCEL_FILTER,
  PRICE_FILTER_PATTERN,
  REVIEW_COUNT_TO_FILTER,
  ROOM_FEATURE_FILTERS,
  ROOM_TYPE_FILTERS,
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
