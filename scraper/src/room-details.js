const { normalizeText, pickFirst, toNumber } = require('./utils');

function safeParseJson(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function getRoomPayload(room) {
  if (!room || typeof room !== 'object') {
    return null;
  }

  if (room.raw && typeof room.raw === 'object' && !Array.isArray(room.raw)) {
    return room.raw;
  }

  return safeParseJson(room.raw)
    || safeParseJson(room.text)
    || null;
}

function normalizeAreaValue(value) {
  const parsed = toNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function extractAreaValue(room, payload) {
  const physicalRoom = payload && payload.physicalRoom ? payload.physicalRoom : payload;
  const saleRoom = payload && payload.saleRoom ? payload.saleRoom : null;
  const areaValue = normalizeAreaValue(pickFirst(
    room && room.area,
    physicalRoom && physicalRoom.area,
    physicalRoom && physicalRoom.roomArea,
    physicalRoom && physicalRoom.areaInfo && physicalRoom.areaInfo.title,
    payload && payload.area,
    payload && payload.roomArea,
    payload && payload.areaInfo && payload.areaInfo.title,
    saleRoom && saleRoom.area,
    saleRoom && saleRoom.roomArea
  ));

  if (areaValue !== null) {
    return areaValue;
  }

  const rawText = normalizeText(
    room && (room.raw || room.text)
      ? String(room.raw || room.text)
      : ''
  );
  const rawMatch = rawText.match(/(\d+(?:\.\d+)?)(?:\s*[–-]\s*\d+(?:\.\d+)?)?\s*(?:平方米|平米|㎡|m²)/i);
  return rawMatch ? normalizeAreaValue(rawMatch[0]) : null;
}

function collectBedDetailTexts(bedInfo) {
  if (!bedInfo || typeof bedInfo !== 'object') {
    return [];
  }

  const detailGroups = bedInfo.cpxBedInfo && Array.isArray(bedInfo.cpxBedInfo.bedDetail)
    ? bedInfo.cpxBedInfo.bedDetail
    : [];
  const detailTexts = [];

  for (const group of detailGroups) {
    const lines = Array.isArray(group && group.detail)
      ? group.detail.map((item) => normalizeText(item)).filter(Boolean)
      : [];
    if (lines.length === 0) {
      continue;
    }

    const roomName = normalizeText(group && group.roomName);
    if (roomName && detailGroups.length > 1) {
      detailTexts.push(`${roomName}：${lines.join('；')}`);
      continue;
    }

    detailTexts.push(lines.join('；'));
  }

  return detailTexts;
}

function extractBedNote(room, payload) {
  const physicalRoom = payload && payload.physicalRoom ? payload.physicalRoom : payload;
  const bedInfo = pickFirst(
    physicalRoom && physicalRoom.bedInfo,
    payload && payload.bedInfo
  );

  const detailTexts = collectBedDetailTexts(bedInfo);
  if (detailTexts.length > 0) {
    return `床型：${detailTexts.join('；')}`;
  }

  const summary = normalizeText(bedInfo && bedInfo.title);
  return summary ? `床型：${summary}` : '';
}

function normalizeMealExtra(value) {
  const text = normalizeText(value);
  if (!text) {
    return '';
  }

  return text
    .replace(/^加餐信息[:：]?\s*/i, '可加购')
    .replace(/每份/g, '/份');
}

function extractMealNote(payload) {
  const saleRoom = payload && payload.saleRoom ? payload.saleRoom : payload;
  const mealTitle = normalizeText(pickFirst(
    saleRoom && saleRoom.mealInfo && saleRoom.mealInfo.title,
    payload && payload.mealInfo && payload.mealInfo.title
  ));

  const mealHover = normalizeText(
    saleRoom && saleRoom.mealInfo && Array.isArray(saleRoom.mealInfo.hover)
      ? saleRoom.mealInfo.hover.join('；')
      : ''
  );
  const extendParam = safeParseJson(
    saleRoom && saleRoom.availParam && typeof saleRoom.availParam.extendParam === 'string'
      ? saleRoom.availParam.extendParam
      : ''
  );
  const mealExtra = normalizeMealExtra(pickFirst(
    extendParam && extendParam.mealDesc,
    mealHover && mealHover !== mealTitle ? mealHover : ''
  ));

  if (!mealTitle && !mealExtra) {
    return '';
  }

  if (mealTitle && mealExtra && !mealExtra.includes(mealTitle)) {
    return `早餐：${mealTitle}（${mealExtra}）`;
  }

  return `早餐：${mealTitle || mealExtra}`;
}

function extractRoomOutputDetails(room) {
  const payload = getRoomPayload(room);
  const noteParts = [];

  if (payload) {
    const bedNote = extractBedNote(room, payload);
    if (bedNote) {
      noteParts.push(bedNote);
    }

    const mealNote = extractMealNote(payload);
    if (mealNote) {
      noteParts.push(mealNote);
    }
  }

  return {
    areaValue: extractAreaValue(room, payload),
    noteParts
  };
}

module.exports = {
  extractRoomOutputDetails
};
