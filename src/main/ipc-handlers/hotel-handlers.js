const { safeHandle } = require('../ipc-safe-handler');
const {
  assertEntityId,
  assertOptionalStringField,
  assertPlainObjectPayload,
  assertStringField
} = require('../ipc-validators');
const { normalizeHotelPayload } = require('../domain/hotel-normalizer');
const { createHotelRepository } = require('../repositories/hotel-repository');
const { idsEqual } = require('../../shared/id-utils');

/**
 * @typedef {import('../../shared/contracts').RawHotelRecord} RawHotelRecord
 * @typedef {import('../../shared/contracts').NormalizedHotelRecord} NormalizedHotelRecord
 * @typedef {import('../../shared/contracts').EntityId} EntityId
 * @typedef {{get: (key: string) => unknown, set: (key: string, value: unknown) => void}} HotelStore
 */

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
    const payloadError = assertPlainObjectPayload(hotel, '无效的宾馆数据');
    if (payloadError) return payloadError;
    const hotelPayload = /** @type {Partial<RawHotelRecord>} */ (hotel);
    const hotelRecord = /** @type {Record<string, unknown>} */ (hotel);
    const nameError = assertStringField(hotelRecord, 'name', '宾馆名称不能为空');
    if (nameError) return nameError;

    const newHotel = getHotelRepo().add(hotelPayload);
    cache.invalidate('hotels');
    console.log('[hotel:add] 添加宾馆:', newHotel.name, 'ID:', newHotel.id);
    return newHotel;
  });

  // 更新单个酒店
  safeHandle(ipcMain, 'hotel:update', (_event, hotel) => {
    const payloadError = assertPlainObjectPayload(hotel, '无效的宾馆数据');
    if (payloadError) return payloadError;
    const hotelPayload = /** @type {Partial<RawHotelRecord>} */ (hotel);
    const hotelRecord = /** @type {Record<string, unknown>} */ (hotel);
    const idPayloadError = assertEntityId(hotelPayload.id, '无效的宾馆 ID');
    if (idPayloadError) return idPayloadError;
    const nameError = assertOptionalStringField(hotelRecord, 'name', '宾馆名称不能为空', {
      allowEmpty: false
    });
    if (nameError) return nameError;

    const repo = getHotelRepo();
    if (!repo.hasValidId(hotelPayload.id)) {
      return { success: false, error: '无效的宾馆 ID' };
    }

    const updatedHotel = repo.update(hotelPayload);
    if (updatedHotel) {
      cache.invalidate('hotels');
      return updatedHotel;
    }
    return null;
  });

  // 批量更新酒店
  safeHandle(ipcMain, 'hotel:updateMultiple', (_event, hotels) => {
    if (!Array.isArray(hotels)) {
      return { success: false, error: '无效的批量宾馆数据' };
    }
    for (const hotel of hotels) {
      const payloadError = assertPlainObjectPayload(hotel, '无效的批量宾馆数据');
      if (payloadError) return payloadError;
      const hotelPayload = /** @type {Partial<RawHotelRecord>} */ (hotel);
      const hotelRecord = /** @type {Record<string, unknown>} */ (hotel);
      const idPayloadError = assertEntityId(hotelPayload.id, '无效的批量宾馆数据');
      if (idPayloadError) return idPayloadError;
      const nameError = assertOptionalStringField(hotelRecord, 'name', '宾馆名称不能为空', {
        allowEmpty: false
      });
      if (nameError) return nameError;
    }

    const repo = getHotelRepo();
    const hotelPayloads = /** @type {Array<Partial<RawHotelRecord>>} */ (hotels);
    if (hotelPayloads.some((hotel) => !repo.hasValidId(hotel.id))) {
      return { success: false, error: '无效的批量宾馆数据' };
    }

    const results = repo.updateMany(hotelPayloads);
    cache.invalidate('hotels');
    return results;
  });

  // 删除酒店
  safeHandle(ipcMain, 'hotel:delete', (_event, id) => {
    const idPayloadError = assertEntityId(id, '无效的宾馆 ID');
    if (idPayloadError) return idPayloadError;

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
    if (!Array.isArray(ids) || ids.some((id) => assertEntityId(id))) {
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

  // 获取酒店数据元信息（revision + count）
  safeHandle(ipcMain, 'hotel:getMeta', () => {
    return getHotelRepo().getMeta();
  });

  // 获取酒店数据 revision
  safeHandle(ipcMain, 'hotel:getRevision', () => {
    const meta = getHotelRepo().getMeta();
    return { revision: meta.revision, count: meta.count };
  });

  // 获取所有酒店 + 元信息
  safeHandle(ipcMain, 'hotel:getAllWithMeta', () => {
    const repo = getHotelRepo();
    const meta = repo.getMeta();
    return {
      revision: meta.revision,
      count: meta.count,
      hotels: repo.getAll()
    };
  });

  // 根据ID获取酒店
  safeHandle(ipcMain, 'hotel:getById', (_event, id) => {
    return getHotelRepo().getById(/** @type {EntityId} */ (id));
  });

  // 批量添加酒店
  safeHandle(ipcMain, 'hotel:addMultiple', (_event, hotels) => {
    if (!Array.isArray(hotels)) {
      return { success: false, error: '无效的批量宾馆数据' };
    }
    for (const hotel of hotels) {
      const payloadError = assertPlainObjectPayload(hotel, '无效的批量宾馆数据');
      if (payloadError) return payloadError;
      const hotelRecord = /** @type {Record<string, unknown>} */ (hotel);
      const nameError = assertStringField(hotelRecord, 'name', '宾馆名称不能为空');
      if (nameError) return nameError;
    }

    const repo = getHotelRepo();
    const hotelPayloads = /** @type {Array<Partial<RawHotelRecord>>} */ (hotels);
    const result = repo.addMany(hotelPayloads);
    cache.invalidate('hotels');
    return {
      success: true,
      addedCount: result.length,
      hotels: result
    };
  });

  // 批量 upsert 酒店
  safeHandle(ipcMain, 'hotel:upsertMultiple', (_event, hotels, options = {}) => {
    if (!Array.isArray(hotels)) {
      return { success: false, error: '无效的批量宾馆数据' };
    }
    for (const hotel of hotels) {
      const payloadError = assertPlainObjectPayload(hotel, '无效的批量宾馆数据');
      if (payloadError) return payloadError;
      const hotelRecord = /** @type {Record<string, unknown>} */ (hotel);
      const nameError = assertStringField(hotelRecord, 'name', '宾馆名称不能为空');
      if (nameError) return nameError;
    }

    const repo = getHotelRepo();
    const hotelPayloads = /** @type {Array<Partial<RawHotelRecord>>} */ (hotels);
    const result = repo.upsertMany(hotelPayloads, options);
    cache.invalidate('hotels');
    return {
      success: true,
      addedCount: result.added.length,
      updatedCount: result.updated.length,
      hotels: result.hotels,
      added: result.added,
      updated: result.updated
    };
  });
}

module.exports = registerHotelHandlers;
module.exports.normalizeHotelPayload = normalizeHotelPayload;
module.exports.idsEqual = idsEqual;
