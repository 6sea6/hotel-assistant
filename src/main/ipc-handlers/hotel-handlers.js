const hotelStorage = require('../hotel-storage');
const { HOTEL_EDITABLE_FIELDS, HOTEL_SYSTEM_FIELDS } = require('../config');

const HOTEL_ALLOWED_FIELD_KEYS = new Set([
  ...HOTEL_EDITABLE_FIELDS.map((field) => field.key),
  ...HOTEL_SYSTEM_FIELDS.map((field) => field.key),
  'cancel_policy',
  'window_status'
]);

function normalizeStringNumber(value) {
  if (value === null || value === undefined || value === '') return '';
  return String(value).trim();
}

function normalizeNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeIntegerLikeValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isInteger(value)) return value;

  const normalizedText = String(value).trim();
  if (normalizedText === '') return null;

  return /^-?\d+$/.test(normalizedText) ? Number(normalizedText) : normalizedText;
}

function getIdKey(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function allocateUniqueId(preferredId, usedIds, nextIdState) {
  const preferredIdKey = getIdKey(preferredId);

  if (preferredIdKey && !usedIds.has(preferredIdKey)) {
    usedIds.add(preferredIdKey);
    return preferredId;
  }

  if (!Number.isInteger(nextIdState.value)) {
    nextIdState.value = Date.now();
  }

  while (usedIds.has(String(nextIdState.value))) {
    nextIdState.value += 1;
  }

  const allocatedId = nextIdState.value;
  usedIds.add(String(allocatedId));
  nextIdState.value += 1;
  return allocatedId;
}

function idsEqual(left, right) {
  return String(left) === String(right);
}

function normalizeTemplateInfo(templateInfo) {
  if (!templateInfo || typeof templateInfo !== 'object' || Array.isArray(templateInfo)) {
    return null;
  }

  return {
    id: normalizeIntegerLikeValue(templateInfo.id),
    name: String(templateInfo.name || '').trim(),
    destination: String(templateInfo.destination || '').trim(),
    check_in_date: templateInfo.check_in_date || null,
    check_out_date: templateInfo.check_out_date || null,
    room_count: normalizeNullableNumber(templateInfo.room_count) || null
  };
}

function normalizeHotelPayload(hotel = {}, existingHotel = {}) {
  const normalized = {
    ...existingHotel,
    ...hotel,
  };

  normalized.id = normalizeIntegerLikeValue(normalized.id) ?? normalized.id;
  normalized.name = String(normalized.name || '').trim();
  normalized.address = String(normalized.address || '').trim();
  normalized.website = String(normalized.website || '').trim();
  normalized.destination = String(normalized.destination || '').trim();
  normalized.subway_station = String(normalized.subway_station || '').trim();
  normalized.room_type = String(normalized.room_type || '').trim();
  normalized.original_room_type = String(normalized.original_room_type || '').trim();
  normalized.notes = String(normalized.notes || '').trim();

  normalized.total_price = normalizeNullableNumber(normalized.total_price);
  normalized.daily_price = normalizeNullableNumber(normalized.daily_price);
  normalized.days = normalizeNullableNumber(normalized.days);
  normalized.ctrip_score = normalizeNullableNumber(normalized.ctrip_score);
  normalized.room_count = normalizeNullableNumber(normalized.room_count) || 1;

  normalized.distance = normalizeStringNumber(normalized.distance);
  normalized.subway_distance = normalizeStringNumber(normalized.subway_distance);
  normalized.transport_time = normalizeStringNumber(normalized.transport_time);
  normalized.bus_route = String(normalized.bus_route || '').trim();
  normalized.room_area = normalizeStringNumber(normalized.room_area);

  normalized.check_in_date = normalized.check_in_date || null;
  normalized.check_out_date = normalized.check_out_date || null;
  normalized.template_id = normalizeIntegerLikeValue(normalized.template_id);
  normalized.template_info = normalizeTemplateInfo(normalized.template_info);
  if (normalized.template_id == null && normalized.template_info?.id != null) {
    normalized.template_id = normalized.template_info.id;
  }
  normalized.is_favorite = Number(normalized.is_favorite) === 1 ? 1 : 0;

  for (const key of Object.keys(normalized)) {
    if (!HOTEL_ALLOWED_FIELD_KEYS.has(key)) {
      delete normalized[key];
    }
  }

  return normalized;
}

function registerHotelHandlers({ ipcMain, cache, services }) {
  const { dataService } = services;
  const getNormalizedHotels = (store) => {
    const hotels = hotelStorage.getExpandedHotelsFromStore(store, normalizeHotelPayload);
    const usedIds = new Set();
    const nextIdState = { value: Date.now() };
    let hasIdRepair = false;
    const normalizedHotels = hotels.map(hotel => {
      const normalizedHotel = normalizeHotelPayload(hotel);
      const normalizedIdKey = getIdKey(normalizedHotel.id);

      if (!normalizedIdKey || usedIds.has(normalizedIdKey)) {
        normalizedHotel.id = allocateUniqueId(normalizedHotel.id, usedIds, nextIdState);
        hasIdRepair = true;
      } else {
        usedIds.add(normalizedIdKey);
      }

      return normalizedHotel;
    });

    if (hasIdRepair || JSON.stringify(normalizedHotels) !== JSON.stringify(hotels)) {
      hotelStorage.setExpandedHotelsToStore(store, normalizedHotels, normalizeHotelPayload);
    }

    return normalizedHotels;
  };

  // 添加酒店
  ipcMain.handle('hotel:add', (event, hotel) => {
    const store = dataService.getStore();
    const hotels = getNormalizedHotels(store);
    const usedIds = new Set(hotels.map(item => String(item.id)));
    const nextIdState = { value: Date.now() };
    const newHotel = normalizeHotelPayload({
      id: allocateUniqueId(null, usedIds, nextIdState),
      ...hotel,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    hotels.push(newHotel);
    hotelStorage.setExpandedHotelsToStore(store, hotels, normalizeHotelPayload);
    cache.invalidate('hotels');
    console.log('[hotel:add] 添加宾馆:', newHotel.name, 'ID:', newHotel.id);
    return newHotel;
  });

  // 更新单个酒店
  ipcMain.handle('hotel:update', (event, hotel) => {
    const store = dataService.getStore();
    const hotels = getNormalizedHotels(store);
    const index = hotels.findIndex(h => String(h.id) === String(hotel.id));

    if (index !== -1) {
      hotels[index] = normalizeHotelPayload({
        ...hotel,
        updated_at: new Date().toISOString()
      }, hotels[index]);
      hotelStorage.setExpandedHotelsToStore(store, hotels, normalizeHotelPayload);
      cache.invalidate('hotels');
      return hotels[index];
    }
    return null;
  });

  // 批量更新酒店
  ipcMain.handle('hotel:updateMultiple', (event, hotels) => {
    const store = dataService.getStore();
    const allHotels = getNormalizedHotels(store);
    const results = [];

    for (const hotel of hotels) {
      const index = allHotels.findIndex(h => String(h.id) === String(hotel.id));
      if (index !== -1) {
        allHotels[index] = normalizeHotelPayload({
          ...hotel,
          updated_at: new Date().toISOString()
        }, allHotels[index]);
        results.push(allHotels[index]);
      }
    }

    hotelStorage.setExpandedHotelsToStore(store, allHotels, normalizeHotelPayload);
    cache.invalidate('hotels');
    return results;
  });

  // 删除酒店
  ipcMain.handle('hotel:delete', (event, id) => {
    const idKey = getIdKey(id);
    if (!idKey || idKey === 'undefined' || idKey === 'null') {
      return { success: false, error: '无效的宾馆 ID' };
    }

    const store = dataService.getStore();
    const hotels = getNormalizedHotels(store);
    const afterHotels = hotels.filter(h => !idsEqual(h.id, id));

    if (afterHotels.length === hotels.length) {
      return { success: false, error: '未找到要删除的宾馆' };
    }

    hotelStorage.setExpandedHotelsToStore(store, afterHotels, normalizeHotelPayload);
    cache.invalidate('hotels');
    return {
      success: true,
      deletedCount: hotels.length - afterHotels.length
    };
  });

  ipcMain.handle('hotel:deleteMultiple', (event, ids = []) => {
    const idSet = new Set(
      ids
        .map(getIdKey)
        .filter(id => id && id !== 'undefined' && id !== 'null')
    );

    if (idSet.size === 0) {
      return { success: false, error: '未选择有效的宾馆' };
    }

    const store = dataService.getStore();
    const before = getNormalizedHotels(store);
    const after = before.filter(h => !idSet.has(String(h.id)));

    if (after.length === before.length) {
      return { success: false, error: '未找到要删除的宾馆' };
    }

    hotelStorage.setExpandedHotelsToStore(store, after, normalizeHotelPayload);
    cache.invalidate('hotels');
    return {
      success: true,
      deletedCount: before.length - after.length
    };
  });

  // 获取所有酒店
  ipcMain.handle('hotel:getAll', () => {
    const store = dataService.getStore();
    return getNormalizedHotels(store);
  });

  // 根据ID获取酒店
  ipcMain.handle('hotel:getById', (event, id) => {
    const store = dataService.getStore();
    const hotels = getNormalizedHotels(store);
    return hotels.find(h => idsEqual(h.id, id));
  });
}

module.exports = registerHotelHandlers;
module.exports.normalizeHotelPayload = normalizeHotelPayload;
module.exports.idsEqual = idsEqual;
