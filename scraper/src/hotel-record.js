const { buildTemplateInfo } = require('./compare-app-bridge');
const { extractRoomOutputDetails } = require('./room-details');
const {
  createTimestampId,
  differenceInDays,
  normalizePlaceName,
  normalizeText,
  toNumber,
  toStringNumber
} = require('./utils');

function normalizeRouteText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function buildRoomTotalPrice(room, days) {
  const explicitTotalPrice = toNumber(room && room.total_price);
  if (explicitTotalPrice !== null) {
    return explicitTotalPrice;
  }

  const dailyPrice = toNumber(room && room.price);
  return dailyPrice !== null && days ? Number((dailyPrice * days).toFixed(2)) : dailyPrice;
}

function appendUniqueNote(parts, value) {
  const text = normalizeText(value);
  if (!text || parts.includes(text)) {
    return;
  }

  parts.push(text);
}

function buildNotes(
  template,
  scraped,
  transit,
  roomOverride,
  roomDetails = extractRoomOutputDetails(roomOverride || (scraped && scraped.room) || {})
) {
  const parts = [];
  const room = roomOverride || (scraped && scraped.room) || {};
  const hasDestination = Boolean(normalizePlaceName(template && template.destination));
  const selectedRoomLocked = roomOverride
    ? Boolean(room && room.price_locked)
    : Boolean(scraped && scraped.page_snapshot && scraped.page_snapshot.selected_room_price_locked);
  const selectedRoomHasPrice = Boolean(
    room &&
    ((room.price !== null && room.price !== undefined) ||
      (Array.isArray(room.prices) && room.prices.length > 0))
  );
  const spiderErrorCodes = Array.from(
    new Set(
      ((scraped && scraped.page_snapshot && scraped.page_snapshot.sources) || [])
        .flatMap((source) =>
          Array.isArray(source && source.spider_error_codes) ? source.spider_error_codes : []
        )
        .filter((value) => value !== null && value !== undefined && value !== '')
    )
  );

  appendUniqueNote(parts, template && template.notes);
  for (const detailNote of roomDetails.noteParts || []) {
    appendUniqueNote(parts, detailNote);
  }

  if (selectedRoomLocked) {
    appendUniqueNote(
      parts,
      '警告: 当前匹配房型被携程标记为“登录看低价/隐藏价格”，该目标房型在当前抓取会话下价格仍不可见。'
    );
  }

  if (!room || room.price === null || room.price === undefined) {
    appendUniqueNote(
      parts,
      selectedRoomLocked
        ? '警告: 已识别到目标房型，但价格仍被隐藏；如需真实房价，通常需要端内进一步确认或人工复核。'
        : '警告: 页面未提取到明确房价，可能需要登录、验证码或人工复核。'
    );
  }

  if (spiderErrorCodes.length > 0 && !selectedRoomHasPrice) {
    appendUniqueNote(
      parts,
      `警告: 携程房型接口触发反爬限制，错误码 ${spiderErrorCodes.join(', ')}，本次未能获取可用房价。`
    );
  }

  if (hasDestination && transit && !transit.route) {
    appendUniqueNote(parts, '警告: 高德未返回公共交通路线，请检查酒店地址和目的地是否可精确解析。');
  }

  return parts.join(' | ');
}

function createRecordContext(template, transit, matchedTemplate, now = new Date().toISOString()) {
  return {
    now,
    route: transit && transit.route ? transit.route : null,
    nearestSubway: transit && transit.nearestSubway ? transit.nearestSubway : null,
    days:
      differenceInDays(template && template.check_in_date, template && template.check_out_date) ||
      (template && template.days),
    templateInfo: buildTemplateInfo(matchedTemplate)
  };
}

function buildRecordFromRoom(template, scraped, matchedTemplate, room, context, options = {}) {
  const roomDetails = extractRoomOutputDetails(room);
  const dailyPrice = toNumber(room && room.price);
  const totalPrice = buildRoomTotalPrice(room, context.days);
  const roomOccupancy = toNumber(room && room.occupancy);
  const templateRoomCount =
    toNumber(
      (matchedTemplate && matchedTemplate.room_count) || (template && template.room_count)
    ) || 1;

  return {
    id: createTimestampId(),
    name: normalizeText(scraped && scraped.hotel_name),
    address: normalizeText(scraped && scraped.address),
    website: template && template.ctrip_url,
    total_price: totalPrice,
    daily_price: dailyPrice,
    check_in_date: (template && template.check_in_date) || null,
    check_out_date: (template && template.check_out_date) || null,
    days: context.days || null,
    ctrip_score: toNumber(scraped && scraped.ctrip_score),
    destination: normalizePlaceName(
      (matchedTemplate && matchedTemplate.destination) || (template && template.destination)
    ),
    distance: context.route ? toStringNumber(context.route.distanceKm, 1) : '',
    subway_station:
      context.nearestSubway && context.nearestSubway.distanceKm <= 1.5
        ? context.nearestSubway.name
        : '无',
    subway_distance:
      context.nearestSubway && context.nearestSubway.distanceKm <= 1.5
        ? String(context.nearestSubway.distanceKm)
        : '0',
    transport_time: context.route ? String(context.route.durationMinutes) : '',
    bus_route: context.route ? normalizeRouteText(context.route.busRoute) : '',
    room_type: normalizeText(
      (room && room.standard_title) || (room && room.title) || (template && template.room_type)
    ),
    original_room_type: normalizeText((room && room.original_title) || (room && room.title)) || '',
    room_count: roomOccupancy || templateRoomCount,
    room_area: toStringNumber(
      roomDetails.areaValue !== null ? roomDetails.areaValue : room && room.area,
      0
    ),
    notes: options.useRoomOverrideInNotes
      ? buildNotes(template, scraped, context, room, roomDetails)
      : buildNotes(template, scraped, context, undefined, roomDetails),
    cancel_policy: normalizeText(room && room.cancelPolicy) || '',
    window_status: normalizeText(room && room.windowStatus) || '',
    is_favorite: 0,
    template_id: matchedTemplate ? matchedTemplate.id : (template && template.template_id) || null,
    template_info: context.templateInfo,
    created_at: context.now,
    updated_at: context.now
  };
}

function buildHotelRecord(template, scraped, transit, matchedTemplate) {
  const room = (scraped && scraped.room) || {};
  const context = createRecordContext(template, transit, matchedTemplate);
  return buildRecordFromRoom(template, scraped, matchedTemplate, room, context);
}

function buildEligibleRoomRecords(template, scraped, transit, matchedTemplate) {
  const eligibleRooms = Array.isArray(scraped && scraped.eligible_rooms)
    ? scraped.eligible_rooms
    : [];
  if (eligibleRooms.length === 0) {
    return [];
  }

  const context = createRecordContext(template, transit, matchedTemplate);
  return eligibleRooms.map((room) =>
    buildRecordFromRoom(template, scraped, matchedTemplate, room, context, {
      useRoomOverrideInNotes: true
    })
  );
}

module.exports = {
  buildHotelRecord,
  buildEligibleRoomRecords
};
