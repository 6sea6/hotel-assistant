const cheerio = require('cheerio');
const {
  buildDesktopUrl,
  buildUrlOverridesFromTemplate,
  cleanExtractedUrl,
  extractUrlsFromText,
  parseHotelIdFromUrl
} = require('../ctrip-url');
const { extractFirstMatch, normalizeText, pickFirst, toNumber } = require('../utils');
const { extractJsonBlock, safeJsonParse } = require('./html-parser-modules/embedded-json');

const DEFAULT_LIST_TARGET_COUNT = 10;
const DEFAULT_LIST_MAX_PAGES = 3;
const MAX_JSON_WALK_NODES = 12000;

const HOTEL_NAME_PATTERN = /(酒店|宾馆|客栈|公寓|旅舍|民宿|青旅|度假|Hotel|Inn|Hostel|Apartment)/i;
const DETAIL_URL_PATTERN =
  /https?:\/\/[^\s"'<>]*(?:hotels\/\d+\.html|hoteldetail\/\d+\.html|hotels\/detail\/?[^\s"'<>]*hotelId=\d+)[^\s"'<>]*/gi;

function normalizeKeywordList(value) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeKeywordList(item)).filter(Boolean);
  }

  return String(value || '')
    .split(/[,，;；\n\r|]+/)
    .map((item) => normalizeText(item).toLowerCase())
    .filter(Boolean);
}

function normalizeListFilterOptions(options = {}) {
  const targetCount = toNumber(
    options.targetCount ??
      options.limit ??
      options.maxHotels ??
      options['target-count'] ??
      options['max-hotels']
  );
  const maxPages = toNumber(
    options.maxPages ?? options.pageLimit ?? options['max-pages'] ?? options['page-limit']
  );

  return {
    excludeAccommodationKeywords: normalizeKeywordList(
      options.excludeAccommodationKeywords ??
        options.excludeAccommodationTypes ??
        options.excludeTypeKeywords ??
        options['exclude-accommodation-keywords'] ??
        options['exclude-type-keywords']
    ),
    targetCount:
      targetCount && targetCount > 0
        ? Math.max(1, Math.trunc(targetCount))
        : DEFAULT_LIST_TARGET_COUNT,
    maxPages: maxPages && maxPages > 0 ? Math.max(1, Math.trunc(maxPages)) : DEFAULT_LIST_MAX_PAGES
  };
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

function normalizeDetailUrl(rawUrl, baseUrl, hotelId = '', template = {}) {
  const normalized = cleanExtractedUrl(rawUrl);
  const resolvedHotelId = parseHotelIdFromUrl(normalized) || normalizeText(hotelId);
  let detailUrl = '';

  if (normalized) {
    try {
      if (normalized.startsWith('//')) {
        detailUrl = `https:${normalized}`;
      } else if (/^https?:\/\//i.test(normalized)) {
        detailUrl = normalized;
      } else if (baseUrl) {
        detailUrl = new URL(normalized, baseUrl).toString();
      }
    } catch (_error) {
      detailUrl = '';
    }
  }

  if (!parseHotelIdFromUrl(detailUrl) && /^\d+$/.test(resolvedHotelId)) {
    detailUrl = `https://hotels.ctrip.com/hotels/detail/?hotelId=${resolvedHotelId}`;
  }

  const finalHotelId = parseHotelIdFromUrl(detailUrl);
  if (!finalHotelId) {
    return '';
  }

  return buildDesktopUrl(detailUrl, buildUrlOverridesFromTemplate(template));
}

function readStringByKey(object, keyPatterns, maxDepth = 3) {
  if (!object || typeof object !== 'object' || maxDepth < 0) {
    return '';
  }

  for (const [key, value] of Object.entries(object)) {
    if (!keyPatterns.some((pattern) => pattern.test(key))) {
      continue;
    }
    if (value !== null && value !== undefined && typeof value !== 'object') {
      const text = normalizeText(value);
      if (text) {
        return text;
      }
    }
  }

  for (const value of Object.values(object)) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    const nested = readStringByKey(value, keyPatterns, maxDepth - 1);
    if (nested) {
      return nested;
    }
  }

  return '';
}

function readNumberByKey(object, keyPatterns, maxDepth = 3) {
  if (!object || typeof object !== 'object' || maxDepth < 0) {
    return null;
  }

  for (const [key, value] of Object.entries(object)) {
    if (!keyPatterns.some((pattern) => pattern.test(key))) {
      continue;
    }
    const score = normalizeScore(value);
    if (score !== null) {
      return score;
    }
  }

  for (const value of Object.values(object)) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    const nested = readNumberByKey(value, keyPatterns, maxDepth - 1);
    if (nested !== null) {
      return nested;
    }
  }

  return null;
}

function readDetailUrlFromObject(object, maxDepth = 3) {
  if (!object || typeof object !== 'object' || maxDepth < 0) {
    return '';
  }

  for (const [key, value] of Object.entries(object)) {
    if (value === null || value === undefined || typeof value === 'object') {
      continue;
    }
    const text = String(value);
    if (!/url|link|href|jump|detail/i.test(key) && !/hotels|hoteldetail/i.test(text)) {
      continue;
    }
    const hotelId = parseHotelIdFromUrl(text);
    if (hotelId) {
      return text;
    }
  }

  for (const value of Object.values(object)) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    const nested = readDetailUrlFromObject(value, maxDepth - 1);
    if (nested) {
      return nested;
    }
  }

  return '';
}

function readHotelIdFromObject(object) {
  if (!object || typeof object !== 'object') {
    return '';
  }

  const strongKeys = [
    'hotelId',
    'hotelID',
    'hotelid',
    'hotel_id',
    'masterHotelId',
    'masterHotelID',
    'masterhotelid',
    'master_hotel_id',
    'hotelBasicId'
  ];

  for (const key of strongKeys) {
    const value = object[key];
    const text = normalizeText(value);
    if (/^\d{3,}$/.test(text)) {
      return text;
    }
  }

  const looseId = normalizeText(object.id);
  const name = readStringByKey(object, [/hotel.*name/i, /^name$/i, /^title$/i], 1);
  if (/^\d{3,}$/.test(looseId) && HOTEL_NAME_PATTERN.test(name)) {
    return looseId;
  }

  return '';
}

function extractCandidateFromObject(object, baseUrl, template = {}) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) {
    return null;
  }

  const rawUrl = readDetailUrlFromObject(object, 2);
  const hotelId = parseHotelIdFromUrl(rawUrl) || readHotelIdFromObject(object);
  const detailUrl = normalizeDetailUrl(rawUrl, baseUrl, hotelId, template);
  if (!detailUrl) {
    return null;
  }

  const name = readStringByKey(
    object,
    [/hotel.*name/i, /name.*hotel/i, /^displayName$/i, /^name$/i, /^title$/i],
    2
  );
  const address = readStringByKey(
    object,
    [/address/i, /position.*name/i, /zone.*name/i, /business.*name/i, /location.*name/i],
    2
  );
  const score = readNumberByKey(
    object,
    [/comment.*score/i, /review.*score/i, /rating.*all/i, /^rating$/i, /^score$/i, /user.*rating/i],
    2
  );
  const accommodationType = readStringByKey(
    object,
    [
      /hotel.*type/i,
      /accommodation.*type/i,
      /property.*type/i,
      /type.*name/i,
      /star.*name/i,
      /level.*name/i,
      /^tagName$/i
    ],
    2
  );

  if (!name && !address && score === null) {
    return null;
  }

  return {
    hotelId: parseHotelIdFromUrl(detailUrl),
    url: detailUrl,
    name: normalizeText(name),
    score,
    accommodationType: normalizeText(accommodationType),
    address: normalizeText(address),
    source: 'embedded-json'
  };
}

function walkJsonForCandidates(root, baseUrl, template = {}) {
  const candidates = [];
  const visited = new WeakSet();
  let visitedCount = 0;

  const visit = (value) => {
    if (!value || typeof value !== 'object' || visitedCount > MAX_JSON_WALK_NODES) {
      return;
    }
    if (visited.has(value)) {
      return;
    }
    visited.add(value);
    visitedCount += 1;

    if (!Array.isArray(value)) {
      const candidate = extractCandidateFromObject(value, baseUrl, template);
      if (candidate) {
        candidates.push(candidate);
      }
    }

    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      visit(child);
    }
  };

  visit(root);
  return candidates;
}

function collectJsonRootsFromScripts(html) {
  const $ = cheerio.load(html || '');
  const roots = [];
  const addParsed = (value) => {
    if (value && typeof value === 'object') {
      roots.push(value);
    }
  };

  $('script').each((_, element) => {
    const type = normalizeText($(element).attr('type')).toLowerCase();
    const text = $(element).html() || '';
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    if (/json/.test(type) || /^[{[]/.test(trimmed)) {
      addParsed(safeJsonParse(trimmed));
    }

    [
      '__NEXT_DATA__',
      '__INITIAL_STATE__',
      '__INITIAL_DATA__',
      'window.__INITIAL_STATE__',
      'window.__INITIAL_DATA__',
      '"hotelList"',
      '"hotelListInfo"',
      '"hotelListResponse"',
      '"hotelInfos"',
      '"hotelListData"'
    ].forEach((marker) => {
      addParsed(safeJsonParse(extractJsonBlock(text, marker, '{', '}')));
      addParsed(safeJsonParse(extractJsonBlock(text, marker, '[', ']')));
    });
  });

  return roots;
}

function parseScoreFromText(text) {
  const normalized = normalizeText(text);
  return pickFirst(
    normalizeScore(
      extractFirstMatch(normalized, /([0-9](?:\.[0-9])?)\s*(?:分|点评|好评|超棒|很好|不错|棒)/)
    ),
    normalizeScore(extractFirstMatch(normalized, /评分[:：]?\s*([0-9](?:\.[0-9])?)/))
  );
}

function findTextByClassPattern($, root, pattern) {
  const matched = $(root)
    .find('[class]')
    .filter((_, element) => pattern.test($(element).attr('class') || ''))
    .first();
  return normalizeText(matched.text());
}

function readAttributeHotelId($element) {
  const directKeys = [
    'data-offline-hotelid',
    'data-offline-hotelId',
    'data-hotelid',
    'data-hotel-id',
    'data-masterhotelid',
    'data-master-hotel-id'
  ];

  for (const key of directKeys) {
    const text = normalizeText($element.attr(key));
    if (/^\d{3,}$/.test(text)) {
      return text;
    }
  }

  const exposure = normalizeText($element.attr('data-exposure'));
  if (exposure) {
    const parsed = safeJsonParse(exposure.replace(/&quot;/g, '"'));
    const id = readHotelIdFromObject(parsed) || readHotelIdFromObject(parsed && parsed.data);
    if (id) {
      return id;
    }
  }

  return '';
}

function parseScoreFromStructuredCard($, element) {
  const scoreText = findTextByClassPattern($, element, /(^|\s)(score|comment-score)(\s|$|-|_)/i);
  const ariaScore = $(element)
    .find('[aria-label]')
    .map((_, child) => $(child).attr('aria-label') || '')
    .get()
    .find((label) => /(?:out of|评分|分)/i.test(label));
  return pickFirst(
    normalizeScore(scoreText),
    parseScoreFromText(ariaScore),
    parseScoreFromText($(element).text())
  );
}

function extractStructuredCardCandidates(html, baseUrl, template = {}) {
  const $ = cheerio.load(html || '');
  const candidates = [];
  const selector = [
    '[data-offline-hotelid]',
    '[data-offline-hotelId]',
    '[data-hotelid]',
    '[data-hotel-id]',
    '[data-masterhotelid]',
    '[data-master-hotel-id]',
    '[data-exposure*="masterhotelid"]'
  ].join(',');

  $(selector).each((_, element) => {
    const $element = $(element);
    const hotelId = readAttributeHotelId($element);
    const detailUrl = normalizeDetailUrl('', baseUrl, hotelId, template);
    if (!detailUrl) {
      return;
    }

    const text = normalizeText($element.text());
    const name =
      normalizeText($element.find('.hotelName').first().text()) ||
      findTextByClassPattern($, element, /hotel-name|hotel_title|hotel-title/i) ||
      extractFirstMatch(
        text,
        /([\u4e00-\u9fa5A-Za-z0-9（）()·\- ]{2,80}(?:酒店|宾馆|客栈|公寓|旅舍|民宿|青旅|度假村|Hotel|Inn|Hostel|Apartment))/i
      );
    const accommodationType = extractFirstMatch(
      text,
      /(酒店|宾馆|客栈|公寓|旅舍|民宿|青旅|度假村|Hotel|Inn|Hostel|Apartment)/i
    );
    const address = findTextByClassPattern($, element, /position|address|location/i);

    candidates.push({
      hotelId: parseHotelIdFromUrl(detailUrl),
      url: detailUrl,
      name: normalizeText(name),
      score: parseScoreFromStructuredCard($, element),
      accommodationType: normalizeText(accommodationType),
      address: normalizeText(address),
      source: 'html-structured-card'
    });
  });

  return candidates;
}

function extractAnchorCandidates(html, baseUrl, template = {}) {
  const $ = cheerio.load(html || '');
  const candidates = [];

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href') || '';
    const hotelId = parseHotelIdFromUrl(href);
    if (!hotelId) {
      return;
    }
    const text = normalizeText($(element).text());
    const parentText = normalizeText($(element).parent().text()).slice(0, 600);
    const detailUrl = normalizeDetailUrl(href, baseUrl, hotelId, template);
    if (!detailUrl) {
      return;
    }

    candidates.push({
      hotelId: parseHotelIdFromUrl(detailUrl),
      url: detailUrl,
      name: HOTEL_NAME_PATTERN.test(text) ? text : '',
      score: parseScoreFromText(parentText),
      accommodationType: extractFirstMatch(
        parentText,
        /(酒店|宾馆|客栈|公寓|旅舍|民宿|青旅|度假村)/
      ),
      address: '',
      source: 'html-anchor'
    });
  });

  return candidates;
}

function extractRegexUrlCandidates(html, baseUrl, template = {}) {
  const source = String(html || '');
  const candidates = [];
  const matches = [...source.matchAll(DETAIL_URL_PATTERN)];

  for (const match of matches) {
    const rawUrl = cleanExtractedUrl(match[0]);
    const hotelId = parseHotelIdFromUrl(rawUrl);
    const detailUrl = normalizeDetailUrl(rawUrl, baseUrl, hotelId, template);
    if (!detailUrl) {
      continue;
    }

    const index = match.index || 0;
    const nearby = normalizeText(
      source.slice(Math.max(0, index - 500), Math.min(source.length, index + 900))
    );
    candidates.push({
      hotelId: parseHotelIdFromUrl(detailUrl),
      url: detailUrl,
      name:
        extractFirstMatch(
          nearby,
          /([\u4e00-\u9fa5A-Za-z0-9（）()·\- ]{2,80}(?:酒店|宾馆|客栈|公寓|旅舍|民宿|青旅|度假村|Hotel|Inn|Hostel|Apartment))/i
        ) || '',
      score: parseScoreFromText(nearby),
      accommodationType: extractFirstMatch(nearby, /(酒店|宾馆|客栈|公寓|旅舍|民宿|青旅|度假村)/),
      address: '',
      source: 'html-url'
    });
  }

  return candidates;
}

function mergeHotelListCandidates(candidates = []) {
  const byKey = new Map();

  for (const candidate of candidates) {
    if (!candidate || !candidate.url) {
      continue;
    }
    const hotelId = parseHotelIdFromUrl(candidate.url) || candidate.hotelId || '';
    const key = hotelId || normalizeText(candidate.url);
    if (!key) {
      continue;
    }

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        hotelId,
        url: candidate.url,
        name: normalizeText(candidate.name),
        score: normalizeScore(candidate.score),
        accommodationType: normalizeText(candidate.accommodationType),
        address: normalizeText(candidate.address),
        source: candidate.source || ''
      });
      continue;
    }

    byKey.set(key, {
      ...existing,
      name: existing.name || normalizeText(candidate.name),
      score:
        existing.score !== null && existing.score !== undefined
          ? existing.score
          : normalizeScore(candidate.score),
      accommodationType: existing.accommodationType || normalizeText(candidate.accommodationType),
      address: existing.address || normalizeText(candidate.address),
      source: [...new Set([existing.source, candidate.source].filter(Boolean))].join('+')
    });
  }

  return [...byKey.values()];
}

function parseHotelListCandidatesFromHtml(html, baseUrl, options = {}) {
  const template = options.template || {};
  const jsonCandidates = collectJsonRootsFromScripts(html).flatMap((root) =>
    walkJsonForCandidates(root, baseUrl, template)
  );
  const urlCandidates = extractUrlsFromText(html)
    .filter((url) => parseHotelIdFromUrl(url))
    .map((url) => ({
      hotelId: parseHotelIdFromUrl(url),
      url: normalizeDetailUrl(url, baseUrl, parseHotelIdFromUrl(url), template),
      name: '',
      score: null,
      accommodationType: '',
      address: '',
      source: 'text-url'
    }));

  return mergeHotelListCandidates([
    ...jsonCandidates,
    ...extractStructuredCardCandidates(html, baseUrl, template),
    ...extractAnchorCandidates(html, baseUrl, template),
    ...extractRegexUrlCandidates(html, baseUrl, template),
    ...urlCandidates
  ]);
}

function containsAnyKeyword(value, keywords = []) {
  const text = normalizeText(value).toLowerCase();
  return keywords.find((keyword) => keyword && text.includes(keyword)) || '';
}

function applyListPrefilter(candidates = [], rawFilters = {}) {
  const filters = normalizeListFilterOptions(rawFilters);
  const mergedCandidates = mergeHotelListCandidates(candidates);
  const selected = [];
  const rejected = [];

  for (const candidate of mergedCandidates) {
    const score = normalizeScore(candidate.score);
    const typeKeyword = containsAnyKeyword(
      candidate.accommodationType,
      filters.excludeAccommodationKeywords
    );
    let rejectReason = '';

    if (typeKeyword) {
      rejectReason = `accommodation_keyword:${typeKeyword}`;
    }

    const normalizedCandidate = {
      ...candidate,
      score
    };

    if (rejectReason) {
      rejected.push({
        ...normalizedCandidate,
        rejectReason
      });
      continue;
    }

    if (selected.length < filters.targetCount) {
      selected.push(normalizedCandidate);
    } else {
      rejected.push({
        ...normalizedCandidate,
        rejectReason: 'target_count_reached'
      });
    }
  }

  return {
    filters,
    totalCandidates: mergedCandidates.length,
    selected,
    rejected
  };
}

module.exports = {
  applyListPrefilter,
  mergeHotelListCandidates,
  normalizeListFilterOptions,
  parseHotelListCandidatesFromHtml
};
