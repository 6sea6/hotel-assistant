const cheerio = require('cheerio');
const { normalizeText, pickFirst, toNumber, extractFirstMatch } = require('../../utils');
const { normalizeRoomCandidate } = require('../room-logic');
const { getBedTypeCounts } = require('../room-type-rules');

const ROOM_TITLE_SUFFIXES = [
  '大床房',
  '大床间',
  '双床房',
  '双床间',
  '双人房',
  '双人间',
  '家庭房',
  '家庭间',
  '三床房',
  '三人房',
  '三人间',
  '景观房',
  '景观间',
  '商务房',
  '商务间',
  '豪华房',
  '豪华间',
  '特惠房',
  '特惠间',
  '标准房',
  '标准间',
  '高级房',
  '高级间',
  '精品房',
  '精品间',
  '影音房',
  '影音间',
  '电竞房',
  '电竞间',
  '榻榻米房',
  '榻榻米间',
  '棋牌房',
  '棋牌间',
  '亲子房',
  '亲子间',
  '套房'
];
const ROOM_TITLE_PATTERN = new RegExp(
  `([\\u4e00-\\u9fa5A-Za-z0-9（）()·\\-]{2,40}(?:${ROOM_TITLE_SUFFIXES.join('|')}))`,
  'g'
);
const ROOM_TITLE_MATCHER = new RegExp(`(?:${ROOM_TITLE_SUFFIXES.join('|')})`);
const MIN_PLAUSIBLE_ROOM_PRICE = 50;

function isPlausibleRoomPrice(value) {
  const price = toNumber(value);
  return price !== null && price >= MIN_PLAUSIBLE_ROOM_PRICE;
}

function extractRoomSection(text) {
  const normalized = normalizeText(text);
  const startMarkers = ['选择房间', '房型摘要', '可住人数 今日价格', '立即确认', '登录看低价'];
  const endMarkers = [
    '地点',
    '服务及设施',
    '酒店政策',
    '酒店简介',
    '订房必读',
    '附近的酒店',
    '住客点评',
    '位置周边'
  ];

  let startIndex = -1;
  for (const marker of startMarkers) {
    const markerIndex = normalized.indexOf(marker);
    if (markerIndex !== -1 && (startIndex === -1 || markerIndex < startIndex)) {
      startIndex = markerIndex;
    }
  }

  if (startIndex === -1) {
    return normalized;
  }

  let endIndex = normalized.length;
  for (const marker of endMarkers) {
    const markerIndex = normalized.indexOf(marker, startIndex + 1);
    if (markerIndex !== -1 && markerIndex < endIndex) {
      endIndex = markerIndex;
    }
  }

  return normalized.slice(startIndex, endIndex);
}

function isLikelyValidRoomSnippet(snippet) {
  const text = normalizeText(snippet);
  const invalidMarkers = [
    '点评',
    '酒店简介',
    '宾馆索引',
    'imgIndex',
    'pictureId',
    'categoryId',
    '评论',
    '开业：',
    '客房数：',
    'commentCount',
    'feedbackList',
    'travelTypeText',
    'userInfo',
    'aiSummary',
    'ipLocation'
  ];
  if (invalidMarkers.some((marker) => text.includes(marker))) {
    return false;
  }

  const compactText = text.replace(/\s+/g, '');
  const hasRoomSignals =
    /房间详情|房型摘要|可住人数|今日价格|登录看低价|解锁优惠|\d人入住|\d+(?:\.\d+)?(?:平米|㎡)|\d张(?:1\.2米|1\.35米|1\.5米|1\.8米)/.test(
      compactText
    );

  return hasRoomSignals;
}

function extractPrices(snippet) {
  const matches = [
    ...String(snippet || '').matchAll(/[¥￥]\s*(\d+(?:\.\d+)?)/g),
    ...String(snippet || '').matchAll(/(?:CNY|RMB|USD)\s*(\d+(?:\.\d+)?)/gi),
    ...String(snippet || '').matchAll(
      /(?:未划线价格|实时标价|价格|总价|每晚|起价|salePrice|discountPrice|payAmount|totalPrice)[^\d]{0,12}(\d+(?:\.\d+)?)/gi
    )
  ];

  const numbers = matches.map((match) => toNumber(match[1])).filter(isPlausibleRoomPrice);

  return [...new Set(numbers)].sort((left, right) => left - right);
}

function extractRelevantPricesFromSnippet(snippet) {
  const source = String(snippet || '');
  const regex = /[¥￥]\s*(\d+(?:\.\d+)?)/g;
  const excludedContextMarkers = [
    '取消',
    '罚款',
    '加餐',
    '早餐',
    '加床',
    '儿童',
    '每份',
    '每人',
    '费用',
    '餐食'
  ];
  const prices = [];

  for (const match of source.matchAll(regex)) {
    const start = Math.max(0, (match.index || 0) - 20);
    const end = Math.min(source.length, (match.index || 0) + match[0].length + 20);
    const context = source.slice(start, end);
    if (excludedContextMarkers.some((marker) => context.includes(marker))) {
      continue;
    }
    const value = toNumber(match[1]);
    if (isPlausibleRoomPrice(value)) {
      prices.push(value);
    }
  }

  return [...new Set(prices)].sort((left, right) => left - right);
}

function extractExcludedPricesFromSnippet(snippet) {
  const source = String(snippet || '');
  const regex = /[¥￥]\s*(\d+(?:\.\d+)?)/g;
  const excludedContextMarkers = [
    '取消',
    '罚款',
    '加餐',
    '早餐',
    '加床',
    '儿童',
    '每份',
    '每人',
    '费用',
    '餐食'
  ];
  const prices = [];

  for (const match of source.matchAll(regex)) {
    const start = Math.max(0, (match.index || 0) - 24);
    const end = Math.min(source.length, (match.index || 0) + match[0].length + 24);
    const context = source.slice(start, end);
    if (!excludedContextMarkers.some((marker) => context.includes(marker))) {
      continue;
    }
    const value = toNumber(match[1]);
    if (value !== null) {
      prices.push(value);
    }
  }

  return new Set(prices);
}

function inferOccupancy(title, snippet) {
  const normalizedTitle = normalizeText(title);
  if (/三人房|三床房|3人/.test(normalizedTitle)) {
    return 3;
  }
  if (/家庭房/.test(normalizedTitle)) {
    return 3;
  }
  if (/套房/.test(normalizedTitle)) {
    return pickFirst(toNumber(extractFirstMatch(snippet, /(\d)人入住/)), 3);
  }
  if (/双床房|双床/.test(normalizedTitle)) {
    return 2;
  }
  if (/大床房|大床/.test(normalizedTitle)) {
    return 2;
  }
  return toNumber(extractFirstMatch(snippet, /(\d)人入住/));
}

function isCanonicalRoomTitle(title) {
  return ROOM_TITLE_MATCHER.test(normalizeText(title));
}

function inferOccupancyFromBedSummary(title, snippet) {
  const normalizedText = normalizeText(`${title || ''} ${snippet || ''}`);
  const { singleBedCount, doubleBedCount, queenBedCount, bunkBedCount } =
    getBedTypeCounts(normalizedText);
  const doubleLikeCount = doubleBedCount + queenBedCount;

  if (singleBedCount >= 3 && doubleLikeCount === 0 && bunkBedCount === 0) {
    return 3;
  }
  if (doubleLikeCount >= 1 && singleBedCount >= 1) {
    return 3;
  }
  if (singleBedCount >= 2 && doubleLikeCount === 0 && bunkBedCount === 0) {
    return 2;
  }
  if (doubleLikeCount >= 2 && singleBedCount === 0 && bunkBedCount === 0) {
    return 4;
  }
  if (doubleLikeCount >= 1 && singleBedCount === 0 && bunkBedCount === 0) {
    return 2;
  }
  return null;
}

function extractStaticRoomCandidatesFromHtml(html) {
  const source = String(html || '');
  if (!source) {
    return [];
  }

  const titles = new Set();
  for (const match of source.matchAll(
    /\\?"(?:imgTitle|roomTypeName)\\?"\s*:\s*\\?"([^"\\]{2,80})\\?"/g
  )) {
    const title = normalizeText(match[1]);
    if (title && isCanonicalRoomTitle(title)) {
      titles.add(title);
    }
  }

  const roomListMatch = source.match(/\\?"roomList\\?"\s*:\s*\[(.*?)\]/s);
  if (roomListMatch) {
    for (const nameMatch of roomListMatch[1].matchAll(
      /\\?"name\\?"\s*:\s*\\?"([^"\\]{2,80})\\?"/g
    )) {
      const title = normalizeText(nameMatch[1]);
      if (title && isCanonicalRoomTitle(title)) {
        titles.add(title);
      }
    }
  }

  return [...titles].map((title) =>
    normalizeRoomCandidate({
      title,
      text: title,
      occupancy: inferOccupancy(title, title),
      prices: [],
      price: null,
      area: '',
      price_locked: false,
      raw: title,
      source: 'static-html'
    })
  );
}

function dedupeRoomBlocks(blocks) {
  const deduped = [];
  const seen = new Set();
  for (const block of blocks) {
    const key = `${block.title}-${block.occupancy || ''}-${block.price || ''}-${block.price_locked ? 'locked' : 'open'}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(block);
  }
  return deduped;
}

function findRoomBlocksFromText(text) {
  const compactText = extractRoomSection(text);
  const matches = [...compactText.matchAll(ROOM_TITLE_PATTERN)];
  const blocks = [];

  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const next = matches[index + 1];
    const start = current.index;
    const end = next ? next.index : Math.min(compactText.length, start + 260);
    const snippet = compactText.slice(start, end);

    if (!isLikelyValidRoomSnippet(snippet)) {
      continue;
    }

    const prices = extractPrices(snippet);
    blocks.push(
      normalizeRoomCandidate({
        title: normalizeText(current[1]),
        text: snippet,
        occupancy: pickFirst(
          toNumber(extractFirstMatch(snippet, /可住人数\s*(\d)/)),
          toNumber(extractFirstMatch(snippet, /(\d)人入住/)),
          inferOccupancyFromBedSummary(current[1], snippet),
          inferOccupancy(current[1], snippet)
        ),
        prices,
        price: prices.length > 0 ? prices[0] : null,
        area: pickFirst(
          extractFirstMatch(snippet, /(\d+(?:\.\d+)?)\s*(?:平米|㎡)/),
          extractFirstMatch(snippet, /面积\s*(\d+(?:\.\d+)?)/)
        ),
        price_locked: prices.length === 0 && /登录看低价|解锁优惠/.test(snippet),
        raw: snippet
      })
    );
  }

  return dedupeRoomBlocks(blocks);
}

function findRoomBlocksFromStructuredText(text) {
  const compactText = normalizeText(text);
  const matches = [...compactText.matchAll(ROOM_TITLE_PATTERN)];
  const blocks = [];

  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const next = matches[index + 1];
    const start = current.index;
    const end = next ? next.index : Math.min(compactText.length, start + 360);
    const snippet = compactText.slice(start, end);
    if (!isLikelyValidRoomSnippet(snippet)) {
      continue;
    }

    const occupancy = pickFirst(
      toNumber(
        extractFirstMatch(
          snippet,
          /(?:person|adultCount|capacity|入住人数|可住人数)[^\d]{0,12}(\d)/i
        )
      ),
      toNumber(extractFirstMatch(snippet, /(\d)人入住/)),
      inferOccupancyFromBedSummary(current[1], snippet),
      inferOccupancy(current[1], snippet)
    );
    const area = pickFirst(
      extractFirstMatch(snippet, /(?:area|roomArea|面积)[^\d]{0,12}(\d+(?:\.\d+)?)/i),
      extractFirstMatch(snippet, /(\d+(?:\.\d+)?)\s*(?:平米|㎡)/)
    );

    const prices = extractPrices(snippet);
    blocks.push(
      normalizeRoomCandidate({
        title: normalizeText(current[1]),
        text: snippet,
        occupancy,
        prices,
        price: prices.length > 0 ? prices[0] : null,
        area,
        price_locked: prices.length === 0 && /登录看低价|解锁优惠/.test(snippet),
        raw: snippet
      })
    );
  }

  return blocks;
}

function findRoomBlocksFromHtml(html) {
  const $ = cheerio.load(html);
  const scriptTexts = $('script')
    .map((_, element) => $(element).html() || '')
    .get();
  const combinedScriptText = normalizeText(scriptTexts.join(' '));
  const bodyText = normalizeText($('body').text());

  const candidates = [
    ...findRoomBlocksFromText(bodyText),
    ...findRoomBlocksFromStructuredText(combinedScriptText),
    ...extractStaticRoomCandidatesFromHtml(combinedScriptText)
  ];

  return dedupeRoomBlocks(candidates);
}

module.exports = {
  extractExcludedPricesFromSnippet,
  extractRelevantPricesFromSnippet,
  findRoomBlocksFromHtml,
  findRoomBlocksFromStructuredText,
  inferOccupancy
};
