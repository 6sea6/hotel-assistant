const { safeHandle } = require('../ipc-safe-handler');
const {
  assertEntityId,
  assertOptionalStringField,
  assertPlainObjectPayload,
  assertStringField
} = require('../ipc-validators');
const { normalizeHotelPayload } = require('../domain/hotel-normalizer');
const { createHotelRepository } = require('../repositories/hotel-repository');
const { logMainDebug } = require('../debug-log');
const { idsEqual } = require('../../shared/id-utils');

/**
 * @typedef {import('../../shared/contracts').RawHotelRecord} RawHotelRecord
 * @typedef {import('../../shared/contracts').NormalizedHotelRecord} NormalizedHotelRecord
 * @typedef {import('../../shared/contracts').EntityId} EntityId
 * @typedef {{get: (key: string) => unknown, set: (key: string, value: unknown) => void}} HotelStore
 */

function validateHotelPayload(
  hotel,
  { objectError, idError = '', nameMode = 'none', nameError = '宾馆名称不能为空' }
) {
  const payloadError = assertPlainObjectPayload(hotel, objectError);
  if (payloadError) return { error: payloadError };

  const hotelPayload = /** @type {Partial<RawHotelRecord>} */ (hotel);
  const hotelRecord = /** @type {Record<string, unknown>} */ (hotel);

  if (idError) {
    const idPayloadError = assertEntityId(hotelPayload.id, idError);
    if (idPayloadError) return { error: idPayloadError };
  }

  if (nameMode === 'required') {
    const requiredNameError = assertStringField(hotelRecord, 'name', nameError);
    if (requiredNameError) return { error: requiredNameError };
  } else if (nameMode === 'optional') {
    const optionalNameError = assertOptionalStringField(hotelRecord, 'name', nameError, {
      allowEmpty: false
    });
    if (optionalNameError) return { error: optionalNameError };
  }

  return {
    payload: hotelPayload
  };
}

function validateHotelIdList(ids, error) {
  if (!Array.isArray(ids) || ids.some((id) => assertEntityId(id))) {
    return { success: false, error };
  }
  return null;
}

/**
 * @param {{
 *   ipcMain: Pick<import('electron').IpcMain, 'handle'>,
 *   services: {dataService: {getStore: () => HotelStore}}
 * }} context
 */
function registerHotelHandlers({ ipcMain, services }) {
  const { dataService } = services;
  const getHotelRepo = () =>
    createHotelRepository({
      store: dataService.getStore(),
      normalizeHotelPayload
    });

  // 添加酒店
  safeHandle(ipcMain, 'hotel:add', (_event, hotel) => {
    const validated = validateHotelPayload(hotel, {
      objectError: '无效的宾馆数据',
      nameMode: 'required'
    });
    if (validated.error) return validated.error;

    const newHotel = getHotelRepo().add(validated.payload);
    logMainDebug('[hotel:add] 添加宾馆:', newHotel.name, 'ID:', newHotel.id);
    return newHotel;
  });

  // 更新单个酒店
  safeHandle(ipcMain, 'hotel:update', (_event, hotel) => {
    const validated = validateHotelPayload(hotel, {
      objectError: '无效的宾馆数据',
      idError: '无效的宾馆 ID',
      nameMode: 'optional'
    });
    if (validated.error) return validated.error;

    const repo = getHotelRepo();
    if (!repo.hasValidId(validated.payload.id)) {
      return { success: false, error: '无效的宾馆 ID' };
    }

    const updatedHotel = repo.update(validated.payload);
    if (updatedHotel) {
      return updatedHotel;
    }
    return null;
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

    return {
      success: true,
      deletedCount: result.deletedCount
    };
  });

  safeHandle(ipcMain, 'hotel:deleteMultiple', (_event, ids = []) => {
    const idListError = validateHotelIdList(ids, '未选择有效的宾馆');
    if (idListError) return idListError;

    const repo = getHotelRepo();
    const requestedIds = /** @type {EntityId[]} */ (ids);
    const validIds = requestedIds.filter((id) => repo.hasValidId(id));
    if (validIds.length === 0) {
      return { success: false, error: '未选择有效的宾馆' };
    }

    const result = repo.deleteMany(validIds);
    if (result.deletedCount === 0) {
      return { success: false, error: '未找到要删除的宾馆' };
    }

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
}

module.exports = registerHotelHandlers;
module.exports.normalizeHotelPayload = normalizeHotelPayload;
module.exports.idsEqual = idsEqual;
