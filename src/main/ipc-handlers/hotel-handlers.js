const { HOTEL_EDITABLE_FIELDS, HOTEL_SYSTEM_FIELDS } = require('../config');
const { isPlainObject, safeHandle } = require('../ipc-safe-handler');
const { createHotelRepository } = require('../repositories/hotel-repository');
const { idsEqual, normalizeIntegerLikeValue } = require('../../shared/id-utils');

/**
 * @typedef {import('../../shared/contracts').RawHotelRecord} RawHotelRecord
 * @typedef {import('../../shared/contracts').NormalizedHotelRecord} NormalizedHotelRecord
 * @typedef {import('../../shared/contracts').TemplateInfo} TemplateInfo
 * @typedef {import('../../shared/contracts').EntityId} EntityId
 * @typedef {{get: (key: string) => unknown, set: (key: string, value: unknown) => void}} HotelStore
 */

const HOTEL_ALLOWED_FIELD_KEYS = new Set([
  ...HOTEL_EDITABLE_FIELDS.map((field) => field.key),
  ...HOTEL_SYSTEM_FIELDS.map((field) => field.key),
  'cancel_policy',
  'window_status'
]);

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeStringNumber(value) {
  if (value === null || value === undefined || value === '') return '';
  return String(value).trim();
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function normalizeNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * @param {Partial<TemplateInfo>|null|undefined} templateInfo
 * @returns {TemplateInfo|null}
 */
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

/**
 * @param {Partial<RawHotelRecord>} [hotel]
 * @param {Partial<RawHotelRecord>} [existingHotel]
 * @returns {NormalizedHotelRecord}
 */
function normalizeHotelPayload(hotel = {}, existingHotel = {}) {
  const normalized = {
    ...existingHotel,
    ...hotel
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

  return /** @type {NormalizedHotelRecord} */ (normalized);
}

/**
 * @param {{
 *   ipcMain: Pick<import('electron').IpcMain, 'handle'>,
 *   cache: {invalidate: (key: string) => void},
 *   services: {dataService: {getStore: () => HotelStore}}
 * }} context
 */
function registerHotelHandlers({ ipcMain, cache, services }) {
  const { dataService } = services;
  const getHotelRepo = () =>
    createHotelRepository({
      store: dataService.getStore(),
      normalizeHotelPayload
    });

  // 添加酒店
  safeHandle(ipcMain, 'hotel:add', (_event, hotel) => {
    if (!isPlainObject(hotel)) {
      return { success: false, error: '无效的宾馆数据' };
    }

    const newHotel = getHotelRepo().add(hotel);
    cache.invalidate('hotels');
    console.log('[hotel:add] 添加宾馆:', newHotel.name, 'ID:', newHotel.id);
    return newHotel;
  });

  // 更新单个酒店
  safeHandle(ipcMain, 'hotel:update', (_event, hotel) => {
    if (!isPlainObject(hotel)) {
      return { success: false, error: '无效的宾馆数据' };
    }
    const repo = getHotelRepo();
    if (!repo.hasValidId(hotel.id)) {
      return { success: false, error: '无效的宾馆 ID' };
    }

    const updatedHotel = repo.update(hotel);
    if (updatedHotel) {
      cache.invalidate('hotels');
      return updatedHotel;
    }
    return null;
  });

  // 批量更新酒店
  safeHandle(ipcMain, 'hotel:updateMultiple', (_event, hotels) => {
    if (!Array.isArray(hotels) || hotels.some((hotel) => !isPlainObject(hotel))) {
      return { success: false, error: '无效的批量宾馆数据' };
    }
    const repo = getHotelRepo();
    if (hotels.some((hotel) => !repo.hasValidId(hotel.id))) {
      return { success: false, error: '无效的批量宾馆数据' };
    }

    const results = repo.updateMany(hotels);
    cache.invalidate('hotels');
    return results;
  });

  // 删除酒店
  safeHandle(ipcMain, 'hotel:delete', (_event, id) => {
    const repo = getHotelRepo();
    if (!repo.hasValidId(id)) {
      return { success: false, error: '无效的宾馆 ID' };
    }

    const hotelId = /** @type {EntityId} */ (id);
    const result = repo.deleteById(hotelId);
    if (result.deletedCount === 0) {
      return { success: false, error: '未找到要删除的宾馆' };
    }

    cache.invalidate('hotels');
    return {
      success: true,
      deletedCount: result.deletedCount
    };
  });

  safeHandle(ipcMain, 'hotel:deleteMultiple', (_event, ids = []) => {
    if (!Array.isArray(ids)) {
      return { success: false, error: '未选择有效的宾馆' };
    }

    const repo = getHotelRepo();
    const validIds = /** @type {EntityId[]} */ (ids.filter((id) => repo.hasValidId(id)));
    if (validIds.length === 0) {
      return { success: false, error: '未选择有效的宾馆' };
    }

    const result = repo.deleteMany(validIds);
    if (result.deletedCount === 0) {
      return { success: false, error: '未找到要删除的宾馆' };
    }

    cache.invalidate('hotels');
    return {
      success: true,
      deletedCount: result.deletedCount
    };
  });

  // 获取所有酒店
  safeHandle(ipcMain, 'hotel:getAll', () => {
    return getHotelRepo().getAll();
  });

  // 根据ID获取酒店
  safeHandle(ipcMain, 'hotel:getById', (_event, id) => {
    return getHotelRepo().getById(/** @type {EntityId} */ (id));
  });
}

module.exports = registerHotelHandlers;
module.exports.normalizeHotelPayload = normalizeHotelPayload;
module.exports.idsEqual = idsEqual;
