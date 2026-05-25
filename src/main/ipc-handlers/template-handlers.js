const { isPlainObject, safeHandle, toErrorMessage } = require('../ipc-safe-handler');
const { normalizeHotelPayload } = require('../domain/hotel-normalizer');
const { normalizeTemplatePayload } = require('../domain/template-normalizer');
const { createHotelRepository } = require('../repositories/hotel-repository');
const { createTemplateRepository } = require('../repositories/template-repository');
const {
  clearTemplateFromHotels,
  syncTemplateToHotels
} = require('../services/template-sync-service');
const { idsEqual } = require('../../shared/id-utils');

/**
 * @typedef {import('../../shared/contracts').RawHotelRecord} RawHotelRecord
 * @typedef {import('../../shared/contracts').NormalizedHotelRecord} NormalizedHotelRecord
 * @typedef {import('../../shared/contracts').TemplateInfo} TemplateInfo
 * @typedef {import('../../shared/contracts').RawTemplateRecord} RawTemplateRecord
 * @typedef {import('../../shared/contracts').NormalizedTemplateRecord} NormalizedTemplateRecord
 * @typedef {import('../../shared/contracts').EntityId} EntityId
 */

// 通知渲染进程的工具函数
/**
 * @param {{isDestroyed: () => boolean, webContents: {send: (channel: string, data: unknown) => void}}|null} mainWindow
 * @param {string} channel
 * @param {unknown} data
 */
const notifyRenderer = (mainWindow, channel, data) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
};

/**
 * @param {{
 *   ipcMain: Pick<import('electron').IpcMain, 'handle'>,
 *   cache: {invalidate: (key: string) => void},
 *   services: {
 *     dataService: {getStore: () => any},
 *     windowService?: {getMainWindow?: () => any}
 *   }
 * }} context
 */
function registerTemplateHandlers({ ipcMain, cache, services }) {
  const { dataService, windowService } = services;
  const getMainWindow = () => windowService?.getMainWindow?.() || null;
  const getRepositories = () => {
    const store = dataService.getStore();
    const templateRepo = createTemplateRepository({
      store,
      normalizeTemplatePayload
    });
    const hotelRepo = createHotelRepository({
      store,
      normalizeHotelPayload
    });
    return { hotelRepo, templateRepo };
  };

  // 添加模板
  safeHandle(ipcMain, 'template:add', (_event, template) => {
    if (!isPlainObject(template)) {
      return { success: false, error: '无效的模板数据' };
    }

    const { templateRepo } = getRepositories();
    const newTemplate = templateRepo.add(template);
    cache.invalidate('templates');
    return newTemplate;
  });

  // 更新模板
  safeHandle(ipcMain, 'template:update', (_event, template) => {
    if (!isPlainObject(template)) {
      return { success: false, error: '无效的模板数据' };
    }
    const { templateRepo } = getRepositories();
    if (!templateRepo.hasValidId(template.id)) {
      return { success: false, error: '无效的模板 ID' };
    }

    const updatedTemplate = templateRepo.update(template);
    if (updatedTemplate) {
      cache.invalidate('templates');
      return updatedTemplate;
    }
    return null;
  });

  // 删除模板
  safeHandle(ipcMain, 'template:delete', (_event, id) => {
    const { hotelRepo, templateRepo } = getRepositories();
    if (!templateRepo.hasValidId(id)) {
      return { success: false, error: '无效的模板 ID' };
    }

    const templateId = /** @type {EntityId} */ (id);
    const deleteResult = templateRepo.deleteById(templateId);
    if (deleteResult.deletedCount === 0) {
      return { success: false, error: '未找到要删除的模板' };
    }

    const { affectedHotelCount } = clearTemplateFromHotels({ hotelRepo, templateId });
    if (affectedHotelCount > 0) {
      cache.invalidate('hotels');
    }
    cache.invalidate('templates');
    return {
      success: true,
      deletedCount: deleteResult.deletedCount,
      affectedHotelCount
    };
  });

  // 获取所有模板
  safeHandle(ipcMain, 'template:getAll', () => {
    return getRepositories().templateRepo.getAll();
  });

  // 模板更新后同步酒店数据并通知渲染进程
  safeHandle(ipcMain, 'template:updateAndSync', async (_event, template) => {
    if (!isPlainObject(template)) {
      return { success: false, error: '无效的模板数据' };
    }
    const { hotelRepo, templateRepo } = getRepositories();
    if (!templateRepo.hasValidId(template.id)) {
      return { success: false, error: '无效的模板 ID' };
    }
    const templatePayload = /** @type {Partial<RawTemplateRecord>} */ (template);
    const templateId = /** @type {EntityId} */ (template.id);

    try {
      console.log('[模板同步] 开始更新模板:', templatePayload.name, 'ID:', templateId);

      const oldTemplate = templateRepo.getById(templateId);
      if (!oldTemplate) {
        throw new Error('模板不存在');
      }
      console.log('[模板同步] 当前模板数量:', templateRepo.getAll().length);

      const syncedTemplate = templateRepo.update(templatePayload);
      if (!syncedTemplate) {
        throw new Error('模板不存在');
      }
      cache.invalidate('templates');

      console.log('[模板同步] 模板已更新:', syncedTemplate.name);
      console.log(
        '[模板同步] 目的地从',
        oldTemplate.destination,
        '改为',
        syncedTemplate.destination
      );

      // 同步更新所有使用该模板的酒店
      const hotels = hotelRepo.getAll();
      console.log('[模板同步] 当前酒店数量:', hotels.length);

      const templateIdStr = String(syncedTemplate.id);

      console.log('[模板同步] 查找使用模板', templateIdStr, '的酒店...');

      const matchedHotels = hotels.filter(
        (hotel) => hotel.template_id != null && idsEqual(hotel.template_id, syncedTemplate.id)
      );
      matchedHotels.forEach((hotel) =>
        console.log('[模板同步] ✓ 找到匹配酒店:', hotel.name, 'ID:', hotel.id)
      );
      const { affectedCount: updatedCount } = syncTemplateToHotels({
        hotelRepo,
        template: syncedTemplate
      });

      console.log('[模板同步] 共更新了', updatedCount, '个酒店');

      if (updatedCount > 0) {
        cache.invalidate('hotels');
        console.log('[模板同步] 酒店数据已保存');
      }

      // 通知渲染进程
      console.log('[模板同步] 发送 template:updated 事件');
      notifyRenderer(getMainWindow(), 'template:updated', {
        templateId: syncedTemplate.id,
        affectedCount: updatedCount,
        template: syncedTemplate
      });

      console.log('[模板同步] 完成');
      return { success: true, template: syncedTemplate, affectedCount: updatedCount };
    } catch (error) {
      console.error('模板更新失败:', error);
      return { success: false, error: toErrorMessage(error) };
    }
  });
}

module.exports = registerTemplateHandlers;
module.exports.normalizeTemplatePayload = normalizeTemplatePayload;
module.exports.idsEqual = idsEqual;
