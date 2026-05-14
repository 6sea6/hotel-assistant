const {
  isRestrictedPostConfirmationFreeCancellation,
  normalizeText,
  pickFirst,
  toNumber,
  extractFirstMatch
} = require('../utils');
const {
  deriveRoomTypeFromFallbackSignals,
  deriveRoomTypeFromStructuredBed
} = require('./room-type-rules');

function pickLowestPositiveNumber(...values) {
  const candidates = values
    .map((value) => toNumber(value))
    .filter((value) => value !== null && value > 0);

  return candidates.length > 0 ? Math.min(...candidates) : null;
}

function classifyCancelPolicy(cancelPolicy) {
  const text = normalizeText(String(cancelPolicy || ''));
  if (/不可取消|不可(随时)?取消|不支持取消|确认(后)?不(可|能)取消|一经确认.*不可(改|退)|预订(后)?不(可|能)(改|退)/.test(text)) return 'non_cancellable';
  if (isRestrictedPostConfirmationFreeCancellation(text)) return 'partial_cancellable';
  if (/可免费取消|可(随时)?取消|免费取消|允许取消/.test(text)) return 'free_cancellable';
  if (/部分取消|有条件取消|限时取消|变更/.test(text)) return 'partial_cancellable';
  return 'unknown';
}

function shouldCollectRoomByCancelPolicy(cancelPolicy) {
  const cancelType = classifyCancelPolicy(cancelPolicy);
  return cancelType !== 'non_cancellable' && cancelType !== 'partial_cancellable';
}

function mergeRoomCandidates(roomBlocks) {
  const grouped = new Map();

  for (const room of roomBlocks) {
    const cancelType = classifyCancelPolicy(room.cancelPolicy);
    const key = `${room.title}-${room.occupancy || ''}-${cancelType}-${room.source || ''}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        ...room,
        prices: Array.isArray(room.prices) ? [...room.prices] : (room.price !== null ? [room.price] : []),
        cancelPolicyType: cancelType
      });
      continue;
    }

    const mergedPrices = [...new Set([...(existing.prices || []), ...(room.prices || []), existing.price, room.price].filter((value) => value !== null))]
      .sort((left, right) => left - right);

    existing.prices = mergedPrices;
    existing.price = mergedPrices.length > 0 ? mergedPrices[0] : existing.price;
    existing.price_locked = mergedPrices.length === 0 && (existing.price_locked || room.price_locked);
    existing.total_price = pickFirst(
      pickLowestPositiveNumber(existing.total_price, room.total_price),
      existing.total_price,
      room.total_price
    );
    const incomingCancelType = classifyCancelPolicy(room.cancelPolicy);
    const priority = { free_cancellable: 4, partial_cancellable: 3, unknown: 2, non_cancellable: 1 };
    if ((priority[incomingCancelType] || 0) > (priority[existing.cancelPolicyType || 0] || 0)) {
      existing.cancelPolicy = room.cancelPolicy;
      existing.cancelPolicyType = incomingCancelType;
    }
    if ((!existing.area || existing.area === '') && room.area) {
      existing.area = room.area;
    }
    if (!existing.standard_title && room.standard_title) {
      existing.standard_title = room.standard_title;
    }
    if (!existing.original_title && room.original_title) {
      existing.original_title = room.original_title;
    }
    if ((!existing.raw || existing.raw.length < room.raw.length) && room.raw) {
      existing.raw = room.raw;
      existing.text = room.text;
    }
  }

  return [...grouped.values()];
}

function extractBedSummary(room) {
  const raw = normalizeText(room && room.raw);
  return pickFirst(
    extractFirstMatch(raw, /"bedInfo"\s*:\s*\{[^{}]{0,200}?"title"\s*:\s*"([^"]{2,40})"/),
    extractFirstMatch(raw, /"cpxBedInfo"\s*:\s*\{[^{}]{0,200}?"title"\s*:\s*"([^"]{2,40})"/),
    extractFirstMatch(raw, /床型[^\u4e00-\u9fa5A-Za-z0-9（）()]*([^"',}{]{4,80})/),
    extractFirstMatch(raw, /(\d张(?:\d+(?:\.\d+)?米)?(?:上下铺|双人床|大床|特大床|单人床|小床|沙发床)(?:\d+(?:\.\d+)?米)?[^"',}{]{0,40})/),
    extractFirstMatch(raw, /((?:上下铺|双人床|大床|特大床|单人床|小床|沙发床)(?:\d+(?:\.\d+)?米)?[^"',}{]{0,40})/)
  );
}

function deriveStandardRoomType(room) {
  const title = normalizeText(room && room.title);

  const bedInfo = tryParseBedInfo(room);
  if (bedInfo) {
    return bedInfo;
  }

  const bedSummary = normalizeText(extractBedSummary(room));
  return deriveRoomTypeFromFallbackSignals({
    title,
    bedText: `${title} ${bedSummary}`
  });
}

function tryParseBedInfo(room) {
  try {
    const data = JSON.parse(room && room.text || '{}');
    const bedInfo = data && data.physicalRoom && data.physicalRoom.bedInfo;
    if (!bedInfo || !bedInfo.title) return null;

    const title = normalizeText(room && room.title);
    const bedTitle = normalizeText(bedInfo.title);
    const bedCount = toNumber(data && data.physicalRoom && data.physicalRoom.houseTypeInfo && data.physicalRoom.houseTypeInfo.bedCount);
    return deriveRoomTypeFromStructuredBed({ title, bedTitle, bedCount });
  } catch (e) {
    return null;
  }
}

function normalizeRoomCandidate(candidate) {
  if (!candidate) {
    return candidate;
  }

  const standardTitle = deriveStandardRoomType(candidate);
  return {
    ...candidate,
    standard_title: standardTitle,
    original_title: candidate.original_title || candidate.title
  };
}

function isPersistableRoomCandidate(room) {
  return Boolean(normalizeText(room && room.standard_title));
}

function isThreePersonEquivalentRoom(room) {
  const title = normalizeText((room && room.standard_title) || (room && room.title));
  const raw = normalizeText(room && room.raw);
  return /三人房|三床房|家庭房|套房/.test(title)
    || (/家庭房/.test(title) && /特大床|大床/.test(raw) && /单人床|小床|沙发床/.test(raw))
    || (/特大床|大床/.test(raw) && /单人床|小床|沙发床/.test(raw));
}

function rankRoomTypeMatch(room, template) {
  const roomType = normalizeText(template.room_type);
  if (!roomType) {
    return 0;
  }

  const roomTitle = normalizeText(room.standard_title || room.title);
  if (roomTitle.includes(roomType)) {
    return 8;
  }

  if (/三人房/.test(roomType) && isThreePersonEquivalentRoom(room)) {
    return 8;
  }

  return 0;
}

function rankRoomMatch(room, template) {
  let score = 0;
  const desiredOccupancy = Number(template.room_count) || null;
  score += rankRoomTypeMatch(room, template);
  if (desiredOccupancy && room.occupancy && Number(room.occupancy) === desiredOccupancy) {
    score += 12;
  }
  if (desiredOccupancy && room.occupancy && Number(room.occupancy) < desiredOccupancy) {
    score -= 8;
  }
  if (room.price !== null) {
    score += 4;
  }
  if (room.price_locked) {
    score += 1;
  }
  if (room.price !== null && !room.price_locked) {
    score += 6;
  }
  if (!normalizeText(template.room_type) && room.occupancy && Number(room.occupancy) === Number(template.room_count)) {
    score += 3;
  }
  if (desiredOccupancy >= 3 && /三人房|家庭房|套房/.test(normalizeText(room.standard_title || room.title))) {
    score += 4;
  }
  if (desiredOccupancy >= 3 && /家庭房/.test(normalizeText(room.standard_title || room.title)) && /特大床|大床/.test(normalizeText(room.raw)) && /单人床|小床|沙发床/.test(normalizeText(room.raw))) {
    score += 2;
  }
  if (/双床|大床|家庭|三床/.test(normalizeText(room.standard_title || room.title))) {
    score += 1;
  }
  return score;
}

function selectBestRoom(roomBlocks, template) {
  if (roomBlocks.length === 0) {
    return null;
  }

  return roomBlocks
    .map((room) => ({ room, score: rankRoomMatch(room, template) }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      const leftPrice = left.room.price ?? Number.MAX_SAFE_INTEGER;
      const rightPrice = right.room.price ?? Number.MAX_SAFE_INTEGER;
      return leftPrice - rightPrice;
    })[0]
    .room;
}

function isEffectivelyWindowed(windowStatus) {
  if (!windowStatus) return true;
  const s = normalizeText(windowStatus);
  if (/走廊|过道|内窗|天窗朝内/.test(s)) return false;
  return true;
}

function isAllowedOccupancy(room, desiredOccupancy, options = {}) {
  const occupancy = Number(room && room.occupancy) || 0;
  if (occupancy < desiredOccupancy) {
    return false;
  }
  if (desiredOccupancy > 0 && occupancy === desiredOccupancy) {
    return true;
  }
  if (
    desiredOccupancy === 3
    && occupancy === 4
    && Boolean(options.includeFourPersonRoomsForThreePersonTemplate)
  ) {
    return true;
  }
  return false;
}

const REJECT_REASON_TEXT = {
  missing_standard_room_type: '房型名称无法标准化，无法匹配模板房型规则。',
  price_missing_or_locked: '价格缺失或需要登录/解锁后才显示价格。',
  no_effective_window: '房型窗户信息不符合当前筛选规则。',
  occupancy_mismatch: '入住人数不匹配。',
  cancel_policy_excluded: '取消规则不符合写入规则。',
  duplicate_room: '与已保留候选房型重复。',
  score_below_threshold: '房型匹配分数低于当前规则。'
};

function buildRoomDedupeKey(room) {
  const cancelType = classifyCancelPolicy(room.cancelPolicy);
  return `${normalizeText(room.original_title || room.title)}-${normalizeText(room.standard_title)}-${room.price}-${Number(room.occupancy) || 0}-${cancelType}`;
}

function createRoomEvaluation(room, template, options, seen) {
  const desiredOccupancy = Number(template.room_count) || 1;
  const score = rankRoomMatch(room, template);
  const base = {
    room,
    score,
    action: 'selected',
    reason: '符合模板人数、价格、取消规则和房型筛选规则。',
    reasonCode: 'selected',
    evidenceFields: [
      'standard_title',
      'price',
      'occupancy',
      'cancelPolicy',
      'windowStatus'
    ]
  };

  const reject = (reasonCode, action = 'rejected', evidenceFields = base.evidenceFields) => ({
    ...base,
    action,
    reason: REJECT_REASON_TEXT[reasonCode] || reasonCode,
    reasonCode,
    evidenceFields
  });

  if (!normalizeText(room.standard_title)) {
    return reject('missing_standard_room_type', 'rejected', ['title', 'standard_title']);
  }
  if (room.price === null || room.price_locked) {
    return reject('price_missing_or_locked', 'rejected', ['price', 'price_locked']);
  }
  if (!isEffectivelyWindowed(room.windowStatus)) {
    return reject('no_effective_window', 'rejected', ['windowStatus']);
  }
  if (!isAllowedOccupancy(room, desiredOccupancy, options)) {
    return reject('occupancy_mismatch', 'rejected', ['occupancy', 'room_count']);
  }
  if (!shouldCollectRoomByCancelPolicy(room.cancelPolicy)) {
    return reject('cancel_policy_excluded', 'rejected', ['cancelPolicy']);
  }

  const dedupeKey = buildRoomDedupeKey(room);
  if (seen.has(dedupeKey)) {
    return reject('duplicate_room', 'deduped');
  }
  seen.add(dedupeKey);

  if (score < 0) {
    return reject('score_below_threshold', 'rejected', ['standard_title', 'occupancy', 'price']);
  }

  return base;
}

function buildRoomSelectionDiagnostics(roomBlocks, template, options = {}) {
  const seen = new Set();
  const evaluations = (Array.isArray(roomBlocks) ? roomBlocks : [])
    .map((room) => createRoomEvaluation(room, template, options, seen));
  const selectedEvaluations = evaluations
    .filter((item) => item.action === 'selected')
    .filter((item) => item.score >= 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      const leftPrice = left.room.price ?? Number.MAX_SAFE_INTEGER;
      const rightPrice = right.room.price ?? Number.MAX_SAFE_INTEGER;
      return leftPrice - rightPrice;
    });

  return {
    eligibleRooms: selectedEvaluations.map((item) => item.room),
    evaluations,
    selectionLogs: evaluations.map((item) => ({
      action: item.action,
      score: item.score,
      reason: item.reason,
      reasonCode: item.reasonCode,
      evidenceFields: item.evidenceFields
    }))
  };
}

function selectMatchingRooms(roomBlocks, template, options = {}) {
  return buildRoomSelectionDiagnostics(roomBlocks, template, options).eligibleRooms;
}

module.exports = {
  buildRoomSelectionDiagnostics,
  classifyCancelPolicy,
  deriveStandardRoomType,
  mergeRoomCandidates,
  normalizeRoomCandidate,
  isPersistableRoomCandidate,
  rankRoomMatch,
  selectBestRoom,
  selectMatchingRooms
};
