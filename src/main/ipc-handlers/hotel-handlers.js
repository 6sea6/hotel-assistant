const { isPlainObject, safeHandle } = require('../ipc-safe-handler');
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
