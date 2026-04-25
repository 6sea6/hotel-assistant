const hotelHandlers = require('./hotel-handlers');
const hotelStorage = require('../hotel-storage');

const normalizeHotelPayload = hotelHandlers.normalizeHotelPayload;

// 通知渲染进程的工具函数
const notifyRenderer = (mainWindow, channel, data) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
};

function normalizeNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTemplateRoomCount(value) {
  const parsed = normalizeNullableNumber(value);
  if (parsed === null) {
    return null;
  }

  return Math.max(1, Math.min(3, parsed));
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

function normalizeTemplatePayload(template = {}, existingTemplate = {}) {
  const normalized = {
    ...existingTemplate,
    ...template,
  };

  normalized.id = normalizeIntegerLikeValue(normalized.id) ?? normalized.id;
  normalized.name = String(normalized.name || '').trim();
  normalized.destination = String(normalized.destination || '').trim();
  normalized.check_in_date = normalized.check_in_date || null;
  normalized.check_out_date = normalized.check_out_date || null;
  normalized.room_count = normalizeTemplateRoomCount(normalized.room_count) || 2;
  normalized.created_at = normalized.created_at || existingTemplate.created_at || new Date().toISOString();

  return normalized;
}

function registerTemplateHandlers({ ipcMain, cache, services }) {
  const { dataService, windowService } = services;
  const getMainWindow = () => windowService?.getMainWindow?.() || null;
  const getNormalizedTemplates = (store) => {
    const templates = store.get('templates') || [];
    const usedIds = new Set();
    const nextIdState = { value: Date.now() };
    let hasIdRepair = false;
    const normalizedTemplates = templates.map(template => {
      const normalizedTemplate = normalizeTemplatePayload(template);
      const normalizedIdKey = getIdKey(normalizedTemplate.id);

      if (!normalizedIdKey || usedIds.has(normalizedIdKey)) {
        normalizedTemplate.id = allocateUniqueId(normalizedTemplate.id, usedIds, nextIdState);
        hasIdRepair = true;
      } else {
        usedIds.add(normalizedIdKey);
      }

      return normalizedTemplate;
    });

    if (hasIdRepair || JSON.stringify(normalizedTemplates) !== JSON.stringify(templates)) {
      store.set('templates', normalizedTemplates);
    }

    return normalizedTemplates;
  };

  // 添加模板
  ipcMain.handle('template:add', (event, template) => {
    const store = dataService.getStore();
    const templates = getNormalizedTemplates(store);
    const usedIds = new Set(templates.map(item => String(item.id)));
    const nextIdState = { value: Date.now() };
    const newTemplate = normalizeTemplatePayload({
      id: allocateUniqueId(null, usedIds, nextIdState),
      ...template,
      created_at: new Date().toISOString()
    });
    templates.push(newTemplate);
    store.set('templates', templates);
    cache.invalidate('templates');
    return newTemplate;
  });

  // 更新模板
  ipcMain.handle('template:update', (event, template) => {
    const store = dataService.getStore();
    const templates = getNormalizedTemplates(store);
    const index = templates.findIndex(t => idsEqual(t.id, template.id));
    if (index !== -1) {
      templates[index] = normalizeTemplatePayload(template, templates[index]);
      store.set('templates', templates);
      cache.invalidate('templates');
      return templates[index];
    }
    return null;
  });

  // 删除模板
  ipcMain.handle('template:delete', (event, id) => {
    const idKey = getIdKey(id);
    if (!idKey || idKey === 'undefined' || idKey === 'null') {
      return { success: false, error: '无效的模板 ID' };
    }

    const store = dataService.getStore();
    const templates = getNormalizedTemplates(store);
    const afterTemplates = templates.filter(t => !idsEqual(t.id, id));

    if (afterTemplates.length === templates.length) {
      return { success: false, error: '未找到要删除的模板' };
    }

    const hotels = hotelStorage.getExpandedHotelsFromStore(store, normalizeHotelPayload);
    let affectedHotelCount = 0;
    const afterHotels = hotels.map(hotel => {
      if (!idsEqual(hotel.template_id, id) && !idsEqual(hotel.template_info?.id, id)) {
        return hotel;
      }

      affectedHotelCount += 1;
      return {
        ...hotel,
        template_id: null,
        template_info: null,
        updated_at: new Date().toISOString()
      };
    });

    store.set('templates', afterTemplates);
    if (affectedHotelCount > 0) {
      hotelStorage.setExpandedHotelsToStore(store, afterHotels, normalizeHotelPayload);
      cache.invalidate('hotels');
    }
    cache.invalidate('templates');
    return {
      success: true,
      deletedCount: templates.length - afterTemplates.length,
      affectedHotelCount
    };
  });

  // 获取所有模板
  ipcMain.handle('template:getAll', () => {
    const store = dataService.getStore();
    return getNormalizedTemplates(store);
  });

  // 模板更新后同步酒店数据并通知渲染进程
  ipcMain.handle('template:updateAndSync', async (event, template) => {
    try {
      console.log('[模板同步] 开始更新模板:', template.name, 'ID:', template.id);

      const store = dataService.getStore();
      const templates = getNormalizedTemplates(store);
      console.log('[模板同步] 当前模板数量:', templates.length);

      const index = templates.findIndex(t => idsEqual(t.id, template.id));

      if (index === -1) {
        throw new Error('模板不存在');
      }

      // 更新模板
      const oldTemplate = templates[index];
      templates[index] = normalizeTemplatePayload(template, templates[index]);
      const syncedTemplate = templates[index];
      store.set('templates', templates);
      cache.invalidate('templates');

      console.log('[模板同步] 模板已更新:', syncedTemplate.name);
      console.log('[模板同步] 目的地从', oldTemplate.destination, '改为', syncedTemplate.destination);

      // 准备模板信息
      const templateInfo = {
        id: syncedTemplate.id,
        name: syncedTemplate.name,
        destination: syncedTemplate.destination,
        check_in_date: syncedTemplate.check_in_date,
        check_out_date: syncedTemplate.check_out_date,
        room_count: syncedTemplate.room_count
      };

      // 同步更新所有使用该模板的酒店
      const hotels = hotelStorage.getExpandedHotelsFromStore(store, normalizeHotelPayload);
      console.log('[模板同步] 当前酒店数量:', hotels.length);

      let updatedCount = 0;
      const templateIdStr = String(syncedTemplate.id);

      console.log('[模板同步] 查找使用模板', templateIdStr, '的酒店...');

      for (const hotel of hotels) {
        if (hotel.template_id != null && idsEqual(hotel.template_id, syncedTemplate.id)) {
          console.log('[模板同步] ✓ 找到匹配酒店:', hotel.name, 'ID:', hotel.id);
          // 同步模板字段
          hotel.template_id = syncedTemplate.id;
          hotel.template_info = templateInfo;
          hotel.destination = syncedTemplate.destination;
          hotel.check_in_date = syncedTemplate.check_in_date;
          hotel.check_out_date = syncedTemplate.check_out_date;
          hotel.room_count = syncedTemplate.room_count;
          hotel.updated_at = new Date().toISOString();
          updatedCount++;
          console.log('[模板同步] 酒店', hotel.name, '目的地已更新为:', hotel.destination);
        }
      }

      console.log('[模板同步] 共更新了', updatedCount, '个酒店');

      if (updatedCount > 0) {
        hotelStorage.setExpandedHotelsToStore(store, hotels, normalizeHotelPayload);
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
      return { success: false, error: error.message };
    }
  });
}

module.exports = registerTemplateHandlers;
module.exports.normalizeTemplatePayload = normalizeTemplatePayload;
module.exports.idsEqual = idsEqual;
