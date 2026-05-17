const { normalizeText, pickFirst, toNumber, extractFirstMatch } = require('../utils');
const {
  buildMobileUrl,
  parseHotelIdFromUrl,
  buildUrlOverridesFromTemplate
} = require('../ctrip-url');
const { normalizeRoomCandidate, mergeRoomCandidates } = require('./room-logic');
const {
  inferOccupancy,
  extractRelevantPricesFromSnippet,
  extractExcludedPricesFromSnippet,
  extractEmbeddedObject
} = require('./html-parser');

function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

const ROOM_DEBUG_OMIT_KEYS = new Set([
  'faciltityInfo',
  'facilityInfo',
  'physicalFacilityList',
  'wifiInfo'
]);

function stripRoomDebugPayload(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stripRoomDebugPayload(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const sanitized = {};
  for (const [key, childValue] of Object.entries(value)) {
    if (ROOM_DEBUG_OMIT_KEYS.has(key)) {
      continue;
    }
    sanitized[key] = stripRoomDebugPayload(childValue);
  }
  return sanitized;
}

function formatCompactDate(value) {
  return normalizeText(value).replace(/-/g, '');
}

function unwrapPriceValue(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    return toNumber(value);
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    for (const key of ['content', 'amount', 'value', 'price', 'number', 'display', 'total']) {
      const nested = value[key];
      if (nested !== null && nested !== undefined) {
        const result = unwrapPriceValue(nested);
        if (result !== null) return result;
      }
    }
  }
  return null;
}

function collectPositivePriceCandidates(values) {
  return values
    .map((value) => unwrapPriceValue(value))
    .filter((value) => value !== null && value > 0);
}

function extractOccupancyFromTagCollection(tags) {
  if (!Array.isArray(tags)) {
    return null;
  }

  for (const tag of tags) {
    const occupancy = pickFirst(
      toNumber(extractFirstMatch(tag && tag.tagTitle, /(\d)人入住/)),
      toNumber(extractFirstMatch(tag && tag.title, /(\d)人入住/)),
      toNumber(extractFirstMatch(tag && tag.name, /(\d)人入住/)),
      toNumber(extractFirstMatch(tag && tag.text, /(\d)人入住/)),
      toNumber(extractFirstMatch(tag && tag.content, /(\d)人入住/))
    );
    if (occupancy !== null) {
      return occupancy;
    }
  }

  return null;
}

function extractStructuredRecordOccupancy(record) {
  if (!record || typeof record !== 'object') {
    return null;
  }

  return pickFirst(
    record.guestCountInfo && toNumber(record.guestCountInfo.guestCount),
    toNumber(record.guestCount),
    toNumber(record.guestNum),
    toNumber(record.occupancy),
    extractOccupancyFromTagCollection(record.tagInfoList),
    extractOccupancyFromTagCollection(record.tags),
    toNumber(record.person),
    toNumber(record.adultCount),
    toNumber(record.capacity),
    toNumber(record.maxPerson)
  );
}

function extractStructuredRecordTotalPrice(record) {
  if (!record || typeof record !== 'object') {
    return null;
  }

  const preferredCandidates = collectPositivePriceCandidates([
    record.totalPriceInfo && record.totalPriceInfo.total,
    record.totalPriceInfo && record.totalPriceInfo.total && record.totalPriceInfo.total.content,
    record.totalPriceInfo && record.totalPriceInfo.total && record.totalPriceInfo.total.amount,
    record.priceInfo && record.priceInfo.totalPrice,
    record.priceDetail && record.priceDetail.totalPrice,
    record.subRoomInfo && record.subRoomInfo.totalPrice,
    record.totalPrice,
    record.payAmount
  ]);
  if (preferredCandidates.length > 0) {
    return Math.min(...preferredCandidates);
  }

  const fallbackCandidates = collectPositivePriceCandidates([
    record.comparingAmount,
    record.priceInfo && record.priceInfo.comparingAmount
  ]);
  if (fallbackCandidates.length > 0) {
    return Math.min(...fallbackCandidates);
  }

  return null;
}

function extractStructuredRecordPrices(record) {
  if (!record || typeof record !== 'object') {
    return [];
  }

  const directCandidates = [
    record.totalPrice,
    record.payAmount,
    record.discountPrice,
    record.salePrice,
    record.displayPrice,
    record.minPrice,
    record.averagePrice,
    record.price,
    record.priceInfo && record.priceInfo.totalPrice,
    record.priceInfo && record.priceInfo.payAmount,
    record.priceInfo && record.priceInfo.displayPrice,
    record.priceInfo && record.priceInfo.price,
    record.totalPriceInfo && record.totalPriceInfo.total,
    record.totalPriceInfo && record.totalPriceInfo.total && record.totalPriceInfo.total.content,
    record.totalPriceInfo && record.totalPriceInfo.total && record.totalPriceInfo.total.amount,
    record.priceDetail && record.priceDetail.totalPrice,
    record.priceDetail && record.priceDetail.payAmount,
    record.subRoomInfo && record.subRoomInfo.displayPrice,
    record.subRoomInfo && record.subRoomInfo.totalPrice
  ]
    .map((value) => unwrapPriceValue(value))
    .filter((value) => value !== null && value > 0);

  if (Array.isArray(record.subRoomList)) {
    for (const subRoom of record.subRoomList) {
      directCandidates.push(
        ...[
          subRoom && subRoom.displayPrice,
          subRoom && subRoom.totalPrice,
          subRoom && subRoom.price,
          subRoom && subRoom.priceInfo && subRoom.priceInfo.displayPrice,
          subRoom && subRoom.priceInfo && subRoom.priceInfo.totalPrice,
          subRoom && subRoom.priceInfo && subRoom.priceInfo.price,
          subRoom && subRoom.totalPriceInfo && subRoom.totalPriceInfo.total
        ]
          .map((value) => unwrapPriceValue(value))
          .filter((value) => value !== null && value > 0)
      );
    }
  }

  return [...new Set(directCandidates)].sort((left, right) => left - right);
}

function collectVisiblePhysicalRoomIds(record) {
  const ids = new Set();
  const groups = [];

  if (Array.isArray(record && record.roomList)) {
    groups.push(...record.roomList);
  }
  if (record && record.compensatedRooms && Array.isArray(record.compensatedRooms.roomList)) {
    groups.push(...record.compensatedRooms.roomList);
  }

  for (const group of groups) {
    const physicalRoomId = normalizeText(
      String(pickFirst(group && group.key, group && group.physicalRoomId, group && group.id, ''))
    );
    if (physicalRoomId) {
      ids.add(physicalRoomId);
    }
  }

  return ids;
}

function hasVisibleTagSignals(tags) {
  return (
    Array.isArray(tags) &&
    tags.some((tag) =>
      Boolean(
        normalizeText(
          pickFirst(
            tag && tag.tagTitle,
            tag && tag.title,
            tag && tag.name,
            tag && tag.text,
            tag && tag.content
          )
        )
      )
    )
  );
}

function isExplicitlyHiddenSaleRoom(saleRoom) {
  if (!saleRoom || typeof saleRoom !== 'object') {
    return true;
  }

  if (
    saleRoom.visible === false ||
    saleRoom.isVisible === false ||
    saleRoom.isShow === false ||
    saleRoom.showSaleRoom === false ||
    saleRoom.display === false ||
    saleRoom.hidden === true
  ) {
    return true;
  }

  const snippet = normalizeText(JSON.stringify(saleRoom));
  return /已售完|满房|不可订|暂不可预订|已下架|不可售/.test(snippet);
}

function isFoldedRoomRecord(record) {
  if (!record || typeof record !== 'object') {
    return false;
  }

  return (
    record.isFoldStatus === true ||
    record.isFold === true ||
    record.isFold === 1 ||
    record.foldStatus === true ||
    record.foldStatus === 1
  );
}

function hasFallbackVisibilityEvidence(physicalRoom, saleRoom, visiblePhysicalRoomIds) {
  const physicalRoomId = normalizeText(
    String(
      pickFirst(
        physicalRoom && (physicalRoom.id || physicalRoom.physicalRoomId || physicalRoom.roomId),
        saleRoom && (saleRoom.physicalRoomId || saleRoom.physicRoomId || saleRoom.roomId),
        ''
      )
    )
  );

  if (physicalRoomId && visiblePhysicalRoomIds.has(physicalRoomId)) {
    return true;
  }

  if (saleRoom && saleRoom.bookingStatusInfo) {
    const remainRoomQuantity = toNumber(saleRoom.bookingStatusInfo.remainRoomQuantity);
    if (
      saleRoom.bookingStatusInfo.isBooking === true ||
      saleRoom.bookingStatusInfo.isHidePrice === true ||
      (remainRoomQuantity !== null && remainRoomQuantity > 0)
    ) {
      return true;
    }
  }

  return (
    extractStructuredRecordOccupancy(saleRoom) !== null ||
    hasVisibleTagSignals(saleRoom && saleRoom.tagInfoList) ||
    hasVisibleTagSignals(saleRoom && saleRoom.saleRoomCategoryList) ||
    hasVisibleTagSignals(physicalRoom && physicalRoom.physicalFacilityList)
  );
}

function buildCandidateFromRoomMapping(physicalRoom, saleRoom, subRoom, source) {
  if (isFoldedRoomRecord(saleRoom) || isFoldedRoomRecord(subRoom)) {
    return null;
  }

  const title = normalizeText(
    pickFirst(
      physicalRoom && physicalRoom.name,
      physicalRoom && physicalRoom.roomName,
      saleRoom && saleRoom.name,
      saleRoom && saleRoom.roomName,
      saleRoom && saleRoom.displayName,
      saleRoom && saleRoom.title
    )
  );
  const rawRecord = {
    physicalRoom,
    saleRoom,
    subRoom
  };
  const snippet = normalizeText(JSON.stringify(stripRoomDebugPayload(rawRecord)));
  const prices = [
    ...extractStructuredRecordPrices(physicalRoom),
    ...extractStructuredRecordPrices(saleRoom),
    ...extractStructuredRecordPrices(subRoom)
  ];
  const effectivePrices = [...new Set(prices)].sort((left, right) => left - right);
  const isPriceLocked = Boolean(
    (saleRoom && saleRoom.bookingStatusInfo && saleRoom.bookingStatusInfo.isHidePrice) ||
    /登录看低价|解锁优惠/.test(snippet)
  );
  const hasRoomIdentity =
    Boolean(title) &&
    Boolean(
      (physicalRoom && (physicalRoom.id || physicalRoom.physicalRoomId || physicalRoom.roomId)) ||
      (saleRoom &&
        (saleRoom.id || saleRoom.roomId || saleRoom.physicalRoomId || saleRoom.roomCode)) ||
      (subRoom && (subRoom.key || subRoom.sRoomId || subRoom.skey || subRoom.roomToken))
    );

  if (!hasRoomIdentity || (!isPriceLocked && effectivePrices.length === 0)) {
    return null;
  }

  const cancelInfo = saleRoom && saleRoom.cancelInfo ? saleRoom.cancelInfo : null;
  const cancelPolicy = cancelInfo && cancelInfo.title ? normalizeText(cancelInfo.title) : '';
  const windowInfo = physicalRoom && physicalRoom.windowInfo ? physicalRoom.windowInfo : null;
  const windowStatus = windowInfo && windowInfo.title ? normalizeText(windowInfo.title) : '';
  const totalPrice = pickFirst(
    extractStructuredRecordTotalPrice(saleRoom),
    extractStructuredRecordTotalPrice(subRoom),
    extractStructuredRecordTotalPrice(physicalRoom)
  );

  return normalizeRoomCandidate({
    title,
    text: snippet,
    occupancy: pickFirst(
      extractStructuredRecordOccupancy(saleRoom),
      extractStructuredRecordOccupancy(subRoom),
      extractStructuredRecordOccupancy(physicalRoom),
      inferOccupancy(title, snippet)
    ),
    prices: effectivePrices,
    price: effectivePrices.length > 0 ? effectivePrices[0] : null,
    total_price: totalPrice,
    area: pickFirst(
      physicalRoom && physicalRoom.area,
      physicalRoom && physicalRoom.roomArea,
      saleRoom && saleRoom.area,
      saleRoom && saleRoom.roomArea,
      extractFirstMatch(snippet, /(\d+(?:\.\d+)?)\s*(?:平米|㎡)/)
    ),
    price_locked: effectivePrices.length === 0 && isPriceLocked,
    cancelPolicy,
    windowStatus,
    raw: snippet,
    source
  });
}

function collectCandidatesFromRoomMapping(record, source = 'api-json') {
  if (!record || !record.saleRoomMap || !record.physicRoomMap) {
    return [];
  }

  const candidates = [];
  const groups = [];
  const referencedSaleRoomKeys = new Set();
  const visiblePhysicalRoomIds = collectVisiblePhysicalRoomIds(record);
  if (Array.isArray(record.roomList)) {
    groups.push(...record.roomList);
  }
  if (record.compensatedRooms && Array.isArray(record.compensatedRooms.roomList)) {
    groups.push(...record.compensatedRooms.roomList);
  }

  for (const group of groups) {
    const physicalRoomId = String(
      group && pickFirst(group.key, group.physicalRoomId, group.id, '')
    );
    const physicalRoom =
      record.physicRoomMap[physicalRoomId] ||
      record.physicRoomMap[toNumber(physicalRoomId)] ||
      null;
    const subRoomList = Array.isArray(group && group.subRoomList) ? group.subRoomList : [];

    for (const subRoom of subRoomList) {
      const saleRoomKey = pickFirst(
        subRoom && subRoom.skey,
        subRoom && subRoom.key,
        subRoom && subRoom.roomToken
      );
      if (saleRoomKey) {
        referencedSaleRoomKeys.add(saleRoomKey);
      }
      const saleRoom = record.saleRoomMap[saleRoomKey] || null;
      const candidate = buildCandidateFromRoomMapping(physicalRoom, saleRoom, subRoom, source);
      if (candidate) {
        candidates.push(candidate);
      }
    }
  }

  for (const [saleRoomKey, saleRoom] of Object.entries(record.saleRoomMap || {})) {
    if (!saleRoom || referencedSaleRoomKeys.has(saleRoomKey)) {
      continue;
    }

    const physicalRoomId = String(
      pickFirst(saleRoom.physicalRoomId, saleRoom.physicRoomId, saleRoom.roomId, '')
    );
    if (!physicalRoomId) {
      continue;
    }

    const physicalRoom =
      record.physicRoomMap[physicalRoomId] ||
      record.physicRoomMap[toNumber(physicalRoomId)] ||
      null;
    if (!physicalRoom) {
      continue;
    }
    if (
      isExplicitlyHiddenSaleRoom(saleRoom) ||
      !hasFallbackVisibilityEvidence(physicalRoom, saleRoom, visiblePhysicalRoomIds)
    ) {
      continue;
    }

    const syntheticSubRoom = {
      key: physicalRoomId,
      skey: saleRoomKey,
      sRoomId: pickFirst(saleRoom.id, saleRoom.saleRoomId, saleRoom.sRoomId),
      roomToken: pickFirst(saleRoom.roomToken, saleRoom.roomCode, saleRoomKey),
      displayPrice: pickFirst(
        saleRoom.displayPrice,
        saleRoom.priceInfo && saleRoom.priceInfo.displayPrice,
        saleRoom.priceInfo && saleRoom.priceInfo.price
      )
    };
    const candidate = buildCandidateFromRoomMapping(
      physicalRoom,
      saleRoom,
      syntheticSubRoom,
      source
    );
    if (candidate) {
      candidates.push(candidate);
    }
  }

  return candidates;
}

function buildRoomCandidateFromRecord(record, source = '') {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return null;
  }
  if (isFoldedRoomRecord(record)) {
    return null;
  }

  const title = normalizeText(
    pickFirst(
      record.roomName,
      record.physicalRoomName,
      record.physicRoomName,
      record.name,
      record.title,
      record.roomTypeName,
      record.saleRoomName,
      record.displayName
    )
  );
  const snippet = normalizeText(JSON.stringify(stripRoomDebugPayload(record)));
  const invalidTitleMarkers = [
    '政策',
    '费用',
    '收费',
    '加床',
    '早餐',
    '确认',
    '取消',
    '餐食',
    '付款',
    '发票',
    '儿童',
    '入住人数'
  ];
  const canonicalRoomTitle =
    /大床房|双床房|家庭房|三人房|三床房|套房|标准房|高级房|豪华房|商务房|景观房|特惠房|精品房|影音房|棋牌/i.test(
      title
    );
  const structuredPriceCandidates = extractStructuredRecordPrices(record);
  const isPriceLocked = Boolean(
    (record.bookingStatusInfo && record.bookingStatusInfo.isHidePrice) ||
    /登录看低价|解锁优惠/.test(snippet)
  );
  const allowSnippetPriceFallback = !/^(?:api-json|edge-cdp)$/.test(source);
  const prices = [
    ...new Set(
      structuredPriceCandidates.length > 0
        ? structuredPriceCandidates
        : allowSnippetPriceFallback
          ? extractRelevantPricesFromSnippet(snippet)
          : []
    )
  ].sort((left, right) => left - right);
  const excludedPrices = extractExcludedPricesFromSnippet(snippet);
  const filteredPrices = prices.filter((value) => !excludedPrices.has(value));
  const hasRoomIdentity =
    Boolean(title) &&
    !invalidTitleMarkers.some((marker) => title.includes(marker)) &&
    (canonicalRoomTitle ||
      record.roomId ||
      record.physicRoomId ||
      record.physicalRoomId ||
      record.saleRoomId ||
      record.roomTypeId ||
      record.roomToken ||
      record.roomNo);

  if (!hasRoomIdentity || (!isPriceLocked && filteredPrices.length === 0 && prices.length === 0)) {
    return null;
  }

  const effectivePrices = filteredPrices.length > 0 ? filteredPrices : prices;

  const cancelInfo = record && record.cancelInfo ? record.cancelInfo : null;
  const cancelPolicy = cancelInfo && cancelInfo.title ? normalizeText(cancelInfo.title) : '';
  const windowInfo = record && record.windowInfo ? record.windowInfo : null;
  const windowStatus = windowInfo && windowInfo.title ? normalizeText(windowInfo.title) : '';
  const totalPrice = extractStructuredRecordTotalPrice(record);

  return normalizeRoomCandidate({
    title,
    text: snippet,
    occupancy: pickFirst(extractStructuredRecordOccupancy(record), inferOccupancy(title, snippet)),
    prices: effectivePrices,
    price: effectivePrices[0],
    total_price: totalPrice,
    area: pickFirst(
      record.area,
      record.roomArea,
      extractFirstMatch(snippet, /(\d+(?:\.\d+)?)\s*(?:平米|㎡)/)
    ),
    price_locked: effectivePrices.length === 0 && isPriceLocked,
    cancelPolicy,
    windowStatus,
    raw: snippet,
    source
  });
}

function collectRoomCandidatesFromPayload(payload, template, seen = new Set()) {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  if (seen.has(payload)) {
    return [];
  }
  seen.add(payload);

  const candidates = [];
  const record = payload;
  const mappedCandidates = collectCandidatesFromRoomMapping(record, 'api-json');
  if (mappedCandidates.length > 0) {
    candidates.push(...mergeRoomCandidates(mappedCandidates));
  }
  const directCandidate = buildRoomCandidateFromRecord(record, 'api-json');
  if (directCandidate) {
    candidates.push(directCandidate);
  }

  if (Array.isArray(record.roomList) && record.saleRoomMap && record.physicRoomMap) {
    const roomList = collectCandidatesFromRoomMapping(record, 'edge-cdp');
    candidates.push(...mergeRoomCandidates(roomList));
  }

  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') {
      candidates.push(...collectRoomCandidatesFromPayload(value, template, seen));
    }
  }

  return candidates;
}

function extractRoomReplayContext(parsedSources, url, template) {
  const desktopSource =
    parsedSources.find((item) => item.source === 'desktop') || parsedSources[0] || null;
  const mobileSource = parsedSources.find((item) => item.source === 'mobile') || null;
  const desktopHtml = desktopSource ? desktopSource.html : '';
  const mobileHtml = mobileSource ? mobileSource.html : '';
  const cookieHeader = [
    ...new Set(
      parsedSources
        .flatMap((item) => String(item.cookieHeader || '').split(';'))
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ].join('; ');
  const hotelId = toNumber(parseHotelIdFromUrl(url));
  const roomListSeed = extractEmbeddedObject(desktopHtml, '"ssrHotelRoomListRequest":');
  const detailRequestParam = extractEmbeddedObject(mobileHtml, '"detailRequestParam":');
  const detailResponse = extractEmbeddedObject(mobileHtml, '"detailResponse":');
  const urlQuery = extractEmbeddedObject(mobileHtml, '"urlQuery":');
  const isOversea = Boolean(
    detailResponse &&
    detailResponse.data &&
    detailResponse.data.hotelBaseInfo &&
    detailResponse.data.hotelBaseInfo.isOversea
  );
  const searchSeed = deepClone(
    roomListSeed && roomListSeed.search ? roomListSeed.search : roomListSeed
  );
  const compactCheckIn = formatCompactDate(
    template.check_in_date || (urlQuery && urlQuery.checkIn) || ''
  );
  const compactCheckOut = formatCompactDate(
    template.check_out_date || (urlQuery && urlQuery.checkOut) || ''
  );
  const adult =
    Number(template.room_count) ||
    toNumber(searchSeed && searchSeed.adult) ||
    toNumber(detailRequestParam && detailRequestParam.adult) ||
    1;

  return {
    hotelId,
    isOversea,
    mobileUrl: mobileSource
      ? mobileSource.url
      : buildMobileUrl(url, buildUrlOverridesFromTemplate(template)),
    searchSeed,
    detailRequestParam,
    detailResponse,
    compactCheckIn,
    compactCheckOut,
    adult,
    cookieHeader
  };
}

module.exports = {
  deepClone,
  formatCompactDate,
  collectRoomCandidatesFromPayload,
  extractRoomReplayContext
};
