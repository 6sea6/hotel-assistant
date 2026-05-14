const crypto = require('crypto');
const {
  classifyCancelPolicy,
  rankRoomMatch
} = require('./scraper/room-logic');
const {
  normalizeText,
  sanitizeSensitiveData
} = require('./utils');
const { extractRoomOutputDetails } = require('./room-details');

const COMPACT_TEXT_LIMIT = 700;

function redactSensitiveText(text) {
  return String(text || '')
    .replace(/(bearer\s+)[a-z0-9._~+/-]+/gi, '$1[REDACTED]')
    .replace(/((?:api[-_]?key|token|secret|cookie|authorization|password)["'\s:=]+)([^"',\s}{\]]+)/gi, '$1[REDACTED]');
}

function compactText(value, limit = COMPACT_TEXT_LIMIT) {
  const text = redactSensitiveText(normalizeText(value));
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function firstTextValue(source, keys) {
  for (const key of keys) {
    const value = source && source[key];
    if (value !== null && value !== undefined && normalizeText(value) !== '') {
      return normalizeText(value);
    }
  }
  return '';
}

function extractRawPriceText(room = {}) {
  const explicit = firstTextValue(room, [
    'rawPriceText',
    'priceText',
    'price_text',
    'displayPrice',
    'display_price',
    'totalPriceText',
    'total_price_text'
  ]);
  if (explicit) return explicit;

  const raw = normalizeText(room.raw || room.text || '');
  const match = raw.match(/(?:￥|¥|CNY|RMB)?\s*(\d{2,6}(?:\.\d{1,2})?)\s*(?:元|起|\/晚|每晚)?/i);
  if (match) return match[0];
  return room.price !== null && room.price !== undefined ? String(room.price) : '';
}

function extractBedText(room = {}) {
  const explicit = firstTextValue(room, [
    'bedText',
    'bed_text',
    'bedTitle',
    'bed_title',
    'bedType',
    'bed_type'
  ]);
  if (explicit) return explicit;

  const raw = normalizeText(room.raw || room.text || '');
  const match = raw.match(/(?:床型|bedInfo|cpxBedInfo)[^，。；;]{0,80}/i);
  return match ? compactText(match[0], 120) : '';
}

function extractOccupancyText(room = {}) {
  const explicit = firstTextValue(room, [
    'rawOccupancyText',
    'occupancyText',
    'occupancy_text',
    'personText',
    'person_text'
  ]);
  if (explicit) return explicit;
  return room.occupancy !== null && room.occupancy !== undefined ? `${room.occupancy}人` : '';
}

function extractAreaText(room = {}) {
  const explicit = firstTextValue(room, ['rawAreaText', 'areaText', 'area_text', 'area']);
  if (explicit) return explicit;
  return '';
}

function buildCandidateId(index) {
  return `room-candidate-${String(index + 1).padStart(3, '0')}`;
}

function buildRawRoomCandidate(room = {}, index = 0) {
  return {
    id: buildCandidateId(index),
    rawRoomName: normalizeText(room.original_title || room.title),
    rawPriceText: extractRawPriceText(room),
    rawCancelPolicyText: normalizeText(room.cancelPolicy || ''),
    rawOccupancyText: extractOccupancyText(room),
    rawBedText: extractBedText(room),
    rawAreaText: extractAreaText(room),
    ratePlan: firstTextValue(room, ['ratePlan', 'rate_plan', 'ratePlanName', 'rate_plan_name']),
    source: normalizeText(room.source || ''),
    sourceField: firstTextValue(room, ['sourceField', 'source_field']) || 'room_candidates',
    compactRawText: compactText(room.raw || room.text || '')
  };
}

function buildEligibleRoomType(room = {}, index = 0, template = {}) {
  const price = room.price ?? null;
  return {
    id: buildCandidateId(index),
    roomName: normalizeText(room.original_title || room.title),
    normalizedRoomName: normalizeText(room.standard_title || room.title),
    price,
    totalPrice: room.total_price ?? price,
    cancelPolicy: normalizeText(room.cancelPolicy || ''),
    cancelPolicyType: classifyCancelPolicy(room.cancelPolicy),
    occupancy: room.occupancy ?? null,
    bedText: extractBedText(room),
    area: normalizeText(room.area || ''),
    windowStatus: normalizeText(room.windowStatus || ''),
    source: normalizeText(room.source || ''),
    matchScore: rankRoomMatch(room, template),
    matchReason: '符合模板人数、价格、取消规则和房型筛选规则。'
  };
}

function buildRejectedRoomType(room = {}, index = 0, evaluation = {}) {
  return {
    id: buildCandidateId(index),
    roomName: normalizeText(room.original_title || room.title),
    normalizedRoomName: normalizeText(room.standard_title || room.title),
    rawPriceText: extractRawPriceText(room),
    price: room.price ?? null,
    cancelPolicy: normalizeText(room.cancelPolicy || ''),
    cancelPolicyType: classifyCancelPolicy(room.cancelPolicy),
    occupancy: room.occupancy ?? null,
    bedText: extractBedText(room),
    area: normalizeText(room.area || ''),
    source: normalizeText(room.source || ''),
    rejectReason: evaluation.reason || '未通过当前筛选规则。',
    rejectReasonCode: evaluation.reasonCode || 'unknown'
  };
}

function pushNormalizeLog(logs, candidateId, field, rawValue, normalizedValue, templateValue, method) {
  logs.push({
    id: `normalize-${String(logs.length + 1).padStart(3, '0')}`,
    candidateId,
    field,
    rawValue: rawValue === null || rawValue === undefined ? '' : String(rawValue),
    normalizedValue: normalizedValue === null || normalizedValue === undefined ? '' : String(normalizedValue),
    matchedTemplate: templateValue === null || templateValue === undefined ? '' : String(templateValue),
    confidence: normalizedValue !== null && normalizedValue !== undefined && String(normalizedValue) !== '' ? 0.9 : 0.2,
    method
  });
}

function buildNormalizeLogs(roomCandidates = [], template = {}) {
  const logs = [];
  roomCandidates.forEach((room, index) => {
    const candidateId = buildCandidateId(index);
    pushNormalizeLog(
      logs,
      candidateId,
      'roomName',
      room.original_title || room.title || '',
      room.standard_title || '',
      template.room_type || '',
      'deriveStandardRoomType'
    );
    pushNormalizeLog(
      logs,
      candidateId,
      'price',
      extractRawPriceText(room),
      room.price ?? '',
      '',
      'toNumber'
    );
    pushNormalizeLog(
      logs,
      candidateId,
      'cancelPolicy',
      room.cancelPolicy || '',
      classifyCancelPolicy(room.cancelPolicy),
      '',
      'classifyCancelPolicy'
    );
    pushNormalizeLog(
      logs,
      candidateId,
      'occupancy',
      extractOccupancyText(room),
      room.occupancy ?? '',
      template.room_count || '',
      'inferOccupancy'
    );
    pushNormalizeLog(
      logs,
      candidateId,
      'area',
      extractAreaText(room),
      room.area || '',
      '',
      'normalizeText'
    );
  });
  return logs;
}

function buildSelectionLogs(evaluations = []) {
  return evaluations.map((evaluation, index) => ({
    id: `selection-${String(index + 1).padStart(3, '0')}`,
    candidateId: buildCandidateId(index),
    action: evaluation.action || 'rejected',
    score: evaluation.score ?? null,
    reason: evaluation.reason || '',
    reasonCode: evaluation.reasonCode || '',
    evidenceFields: Array.isArray(evaluation.evidenceFields) ? evaluation.evidenceFields : []
  }));
}

function splitNoteParts(value) {
  return normalizeText(value)
    .split(/\s*\|\s*/)
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function guessNotePartSource(notePart, roomDetails = {}, template = {}, pageSnapshot = {}) {
  if ((roomDetails.noteParts || []).includes(notePart)) {
    if (/早餐/.test(notePart)) {
      return '房型详情中的早餐信息';
    }
    if (/床型/.test(notePart)) {
      return '房型详情中的床型信息';
    }
    return '房型详情补充信息';
  }
  if (normalizeText(template.notes) && notePart === normalizeText(template.notes)) {
    return '模板备注';
  }
  if (/登录看低价|隐藏价格|价格仍被隐藏|页面未提取到明确房价|反爬限制/.test(notePart)) {
    return '价格区域或登录态检测结果';
  }
  if (/高德|公共交通|路线/.test(notePart)) {
    return '交通计算结果';
  }
  if (pageSnapshot && pageSnapshot.selected_room_price_locked) {
    return '页面价格锁定状态';
  }
  return '最终记录备注拼接结果';
}

function buildFinalHotelFieldLogs(finalHotels = [], candidates = [], eligibleIndexes = [], template = {}, pageSnapshot = {}) {
  const logs = [];
  const selectedCandidateIds = eligibleIndexes.map(({ index }) => ({
    index,
    candidateId: buildCandidateId(index)
  }));

  finalHotels.forEach((hotel, hotelIndex) => {
    const selected = selectedCandidateIds[hotelIndex] || selectedCandidateIds[0] || { index: hotelIndex, candidateId: buildCandidateId(hotelIndex) };
    const room = candidates[selected.index] || {};
    const roomDetails = extractRoomOutputDetails(room);
    const hotelId = hotel && hotel.id ? String(hotel.id) : `final-hotel-${String(hotelIndex + 1).padStart(3, '0')}`;

    if (hotel && hotel.room_area !== undefined && hotel.room_area !== null && normalizeText(hotel.room_area) !== '') {
      logs.push({
        id: `final-field-${String(logs.length + 1).padStart(3, '0')}`,
        hotelId,
        candidateId: selected.candidateId,
        field: 'room_area',
        value: normalizeText(hotel.room_area),
        source: roomDetails.areaValue !== null ? '房型详情面积解析' : '最终酒店记录',
        sourceField: roomDetails.areaValue !== null ? 'roomDetails.areaValue' : 'finalHotels.room_area',
        rawValue: normalizeText(room.area || extractAreaText(room) || hotel.room_area),
        explanation: roomDetails.areaValue !== null
          ? '写入面积来自房型结构化详情或原始房型文本中的面积信息。'
          : '写入面积存在于最终酒店记录，但未找到更早阶段的面积解析来源。',
        candidateRoomName: normalizeText(room.original_title || room.title || hotel.original_room_type || hotel.room_type)
      });
    }

    const noteParts = splitNoteParts(hotel && hotel.notes);
    noteParts.forEach((notePart) => {
      logs.push({
        id: `final-field-${String(logs.length + 1).padStart(3, '0')}`,
        hotelId,
        candidateId: selected.candidateId,
        field: 'notes',
        value: notePart,
        source: guessNotePartSource(notePart, roomDetails, template, pageSnapshot),
        sourceField: 'finalHotels.notes',
        rawValue: notePart,
        explanation: '该备注是最终酒店记录写入 notes 前的组成片段，用于复核备注是否来自模板、房型详情、登录价格状态或交通计算。',
        candidateRoomName: normalizeText(room.original_title || room.title || hotel.original_room_type || hotel.room_type)
      });
    });
  });

  return logs;
}

function summarizePageSnapshot(pageSnapshot = {}, roomCandidates = [], eligibleRooms = [], rejectedRooms = []) {
  const sources = Array.isArray(pageSnapshot.sources) ? pageSnapshot.sources : [];
  const apiSources = sources.filter((source) => /api|replay|edge/i.test(String(source.source || '')));
  const hasPriceArea = Boolean(pageSnapshot.room_price_visible)
    || sources.some((source) => source && source.room_price_visible);
  const hasLockedPriceHint = Boolean(pageSnapshot.selected_room_price_locked)
    || sources.some((source) => source && source.locked_price_detected);

  return {
    roomCardCount: sources
      .filter((source) => ['desktop', 'mobile', 'local-html'].includes(String(source.source || '')))
      .reduce((sum, source) => sum + (Number(source.room_candidates_count) || 0), 0),
    apiRoomCount: apiSources.reduce((sum, source) => sum + (Number(source.room_candidates_count) || 0), 0),
    rawCandidateCount: roomCandidates.length,
    eligibleCount: eligibleRooms.length,
    rejectedCount: rejectedRooms.length,
    hasPriceArea,
    hasLockedPriceHint,
    suspectedLoginPrice: hasLockedPriceHint || (roomCandidates.length > 0 && !hasPriceArea),
    expandedAllRooms: sources.some((source) => /edge|direct-room-list-replay/i.test(String(source.source || ''))),
    apiError: sources.map((source) => source && source.error).filter(Boolean).join('; '),
    sourceSummary: sources.map((source) => ({
      source: source.source || '',
      roomCandidatesCount: source.room_candidates_count ?? 0,
      roomPriceVisible: Boolean(source.room_price_visible),
      lockedPriceDetected: Boolean(source.locked_price_detected),
      spiderErrorCodes: Array.isArray(source.spider_error_codes) ? source.spider_error_codes : []
    }))
  };
}

function buildTaskMeta(meta = {}) {
  return {
    taskId: meta.taskId || '',
    url: meta.url || '',
    templateId: meta.templateId ?? null,
    templateName: meta.templateName || '',
    checkInDate: meta.checkInDate || '',
    checkOutDate: meta.checkOutDate || '',
    roomCount: meta.roomCount ?? null,
    guestCount: meta.guestCount ?? meta.roomCount ?? null,
    destination: meta.destination || '',
    outputFingerprint: ''
  };
}

function fingerprintReviewInput(reviewInput) {
  const stable = {
    ...reviewInput,
    taskMeta: {
      ...(reviewInput.taskMeta || {}),
      outputFingerprint: ''
    },
    userConcern: ''
  };
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(stable))
    .digest('hex');
}

function buildReviewInput({
  taskMeta,
  finalHotels,
  roomCandidates,
  evaluations,
  pageSnapshot,
  template,
  userConcern = ''
} = {}) {
  const candidates = Array.isArray(roomCandidates) ? roomCandidates : [];
  const safeEvaluations = Array.isArray(evaluations) ? evaluations : [];
  const eligibleIndexes = safeEvaluations
    .map((evaluation, index) => ({ evaluation, index }))
    .filter((item) => item.evaluation.action === 'selected');
  const rejectedIndexes = safeEvaluations
    .map((evaluation, index) => ({ evaluation, index }))
    .filter((item) => item.evaluation.action !== 'selected');
  const eligibleRoomTypes = eligibleIndexes.map(({ index }) => buildEligibleRoomType(candidates[index], index, template));
  const rejectedRoomTypes = rejectedIndexes.map(({ evaluation, index }) => buildRejectedRoomType(candidates[index], index, evaluation));
  const rawRoomCandidates = candidates.map(buildRawRoomCandidate);
  const normalizeLogs = buildNormalizeLogs(candidates, template);
  const selectionLogs = buildSelectionLogs(safeEvaluations);
  const finalHotelFieldLogs = buildFinalHotelFieldLogs(
    Array.isArray(finalHotels) ? finalHotels : [],
    candidates,
    eligibleIndexes,
    template,
    pageSnapshot
  );
  const reviewInput = sanitizeSensitiveData({
    taskMeta: buildTaskMeta(taskMeta),
    finalHotels: Array.isArray(finalHotels) ? finalHotels : [],
    eligibleRoomTypes,
    rejectedRoomTypes,
    rawRoomCandidates,
    normalizeLogs,
    selectionLogs,
    finalHotelFieldLogs,
    pageSnapshotSummary: summarizePageSnapshot(pageSnapshot, candidates, eligibleRoomTypes, rejectedRoomTypes),
    userConcern: normalizeText(userConcern)
  });

  reviewInput.taskMeta.outputFingerprint = fingerprintReviewInput(reviewInput);
  return reviewInput;
}

module.exports = {
  buildReviewInput,
  fingerprintReviewInput
};
