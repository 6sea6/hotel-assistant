const { dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { APP_CONFIG, getPaths } = require('../config');
const appIconManager = require('../app-icon-manager');
const hotelStorage = require('../hotel-storage');
const hotelHandlers = require('./hotel-handlers');
const templateHandlers = require('./template-handlers');

const EXPORT_SCHEMA_VERSION = 3;
const normalizeHotelPayload = hotelHandlers.normalizeHotelPayload;
const normalizeTemplatePayload = templateHandlers.normalizeTemplatePayload;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getIdKey(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  return String(value);
}

function allocateImportedId(preferredId, usedIds, nextIdState) {
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

function normalizeImportedSettings(settings) {
  return {
    ...APP_CONFIG.STORE_DEFAULTS.settings,
    ...(isPlainObject(settings) ? settings : {})
  };
}

function buildTemplateInfoFromTemplate(template) {
  return {
    id: template.id,
    name: template.name,
    destination: template.destination,
    check_in_date: template.check_in_date,
    check_out_date: template.check_out_date,
    room_count: template.room_count
  };
}

function normalizeComparableText(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim().toLowerCase();
}

function buildTemplateDuplicateKey(template) {
  const normalizedTemplate = normalizeTemplatePayload(template);

  return JSON.stringify([
    normalizeComparableText(normalizedTemplate.name),
    normalizeComparableText(normalizedTemplate.destination),
    normalizeComparableText(normalizedTemplate.check_in_date),
    normalizeComparableText(normalizedTemplate.check_out_date),
    normalizedTemplate.room_count ?? ''
  ]);
}

function buildHotelDuplicateKey(hotel) {
  const normalizedHotel = normalizeHotelPayload(hotel);

  return JSON.stringify([
    normalizeComparableText(normalizedHotel.name),
    normalizeComparableText(normalizedHotel.address),
    normalizeComparableText(normalizedHotel.website),
    normalizedHotel.total_price ?? '',
    normalizedHotel.daily_price ?? '',
    normalizeComparableText(normalizedHotel.check_in_date),
    normalizeComparableText(normalizedHotel.check_out_date),
    normalizedHotel.days ?? '',
    normalizeComparableText(normalizedHotel.destination),
    normalizeComparableText(normalizedHotel.room_type),
    normalizeComparableText(normalizedHotel.original_room_type),
    normalizedHotel.room_count ?? '',
    normalizeComparableText(normalizedHotel.room_area)
  ]);
}

function processImportedTemplates(importedTemplates, existingTemplates = [], options = {}) {
  const skipDuplicates = Boolean(options.skipDuplicates);
  const nextIdState = options.nextIdState || { value: Date.now() };
  const usedIds = new Set(
    existingTemplates
      .map(template => getIdKey(template.id))
      .filter(id => id !== null)
  );
  const templateByDuplicateKey = new Map(
    existingTemplates.map(template => [buildTemplateDuplicateKey(template), template])
  );
  const templateByImportedId = new Map();
  const processedTemplates = [];
  let skippedCount = 0;

  for (const template of importedTemplates) {
    const normalizedTemplate = normalizeTemplatePayload(template);
    const originalIdKey = getIdKey(normalizedTemplate.id);
    const duplicateKey = buildTemplateDuplicateKey(normalizedTemplate);

    if (skipDuplicates && templateByDuplicateKey.has(duplicateKey)) {
      const matchedTemplate = templateByDuplicateKey.get(duplicateKey);
      if (originalIdKey) {
        templateByImportedId.set(originalIdKey, matchedTemplate);
      }
      skippedCount += 1;
      continue;
    }

    const finalTemplateId = allocateImportedId(normalizedTemplate.id, usedIds, nextIdState);
    const finalTemplate = normalizeTemplatePayload({
      ...normalizedTemplate,
      id: finalTemplateId
    }, normalizedTemplate);

    processedTemplates.push(finalTemplate);
    templateByDuplicateKey.set(duplicateKey, finalTemplate);
    if (originalIdKey) {
      templateByImportedId.set(originalIdKey, finalTemplate);
    }
  }

  return {
    processedTemplates,
    templateByDuplicateKey,
    templateByImportedId,
    skippedCount
  };
}

function resolveImportedHotelTemplate(normalizedHotel, templateByImportedId, templateByDuplicateKey) {
  const linkedTemplateIdKey = getIdKey(normalizedHotel.template_id)
    || getIdKey(normalizedHotel.template_info?.id);
  let matchedTemplate = linkedTemplateIdKey
    ? templateByImportedId.get(linkedTemplateIdKey)
    : null;

  if (!matchedTemplate && normalizedHotel.template_info) {
    matchedTemplate = templateByDuplicateKey.get(buildTemplateDuplicateKey(normalizedHotel.template_info));
  }

  if (!matchedTemplate) {
    return {
      template_id: normalizedHotel.template_id,
      template_info: normalizedHotel.template_info
    };
  }

  return {
    template_id: matchedTemplate.id,
    template_info: buildTemplateInfoFromTemplate(matchedTemplate)
  };
}

function processImportedHotels(importedHotels, existingHotels = [], options = {}) {
  const skipDuplicates = Boolean(options.skipDuplicates);
  const nextIdState = options.nextIdState || { value: Date.now() };
  const templateByImportedId = options.templateByImportedId || new Map();
  const templateByDuplicateKey = options.templateByDuplicateKey || new Map();
  const usedIds = new Set(
    existingHotels
      .map(hotel => getIdKey(hotel.id))
      .filter(id => id !== null)
  );
  const hotelDuplicateKeys = new Set(
    skipDuplicates
      ? existingHotels.map(hotel => buildHotelDuplicateKey(hotel))
      : []
  );
  const processedHotels = [];
  let skippedCount = 0;

  for (const hotel of importedHotels) {
    const normalizedHotel = normalizeHotelPayload(hotel);
    const resolvedTemplate = resolveImportedHotelTemplate(
      normalizedHotel,
      templateByImportedId,
      templateByDuplicateKey
    );
    const candidateHotel = normalizeHotelPayload({
      ...normalizedHotel,
      template_id: resolvedTemplate.template_id,
      template_info: resolvedTemplate.template_info
    });
    const duplicateKey = buildHotelDuplicateKey(candidateHotel);

    if (skipDuplicates && hotelDuplicateKeys.has(duplicateKey)) {
      skippedCount += 1;
      continue;
    }

    const finalHotelId = allocateImportedId(candidateHotel.id, usedIds, nextIdState);
    const finalHotel = normalizeHotelPayload({
      ...candidateHotel,
      id: finalHotelId
    }, candidateHotel);

    processedHotels.push(finalHotel);
    if (skipDuplicates) {
      hotelDuplicateKeys.add(duplicateKey);
    }
  }

  return {
    processedHotels,
    skippedCount
  };
}

function buildExportPayload(store) {
  const exportedAt = new Date().toISOString();
  const hotels = hotelStorage.compactHotels(
    hotelStorage.getExpandedHotelsFromStore(store, normalizeHotelPayload),
    normalizeHotelPayload
  );
  const templates = (store.get('templates') || []).map(template => normalizeTemplatePayload(template));
  const settings = normalizeImportedSettings(store.get('settings'));
  const customAppIcon = appIconManager.readCustomIconExportPayload(settings);

  return {
    hotels,
    templates,
    settings,
    exportedAt,
    appVersion: APP_CONFIG.VERSION,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    meta: {
      sourceApp: APP_CONFIG.NAME,
      appVersion: APP_CONFIG.VERSION,
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt,
      customAppIcon
    }
  };
}

// 导入来源约定为本应用自己导出的 JSON，因此这里重点做两件事：
// 1. 兼容旧版本导出的字段与 ID 类型；2. 任一环节失败时恢复导入前快照，避免半写入状态。
function normalizeImportedPayload(rawPayload) {
  if (!isPlainObject(rawPayload)) {
    throw new Error('导入文件格式不正确');
  }

  // 基本来源校验：必须包含 hotels 数组或 meta.sourceApp 标识
  const meta = isPlainObject(rawPayload.meta) ? rawPayload.meta : null;
  const hasHotelsArray = Array.isArray(rawPayload.hotels);
  const isKnownSource = meta && meta.sourceApp === APP_CONFIG.NAME;

  if (!hasHotelsArray && !isKnownSource) {
    throw new Error('无法识别导入文件，请确认是否为本应用导出的数据');
  }

  // hotels 内部结构校验
  let normalizedHotels = [];
  if (hasHotelsArray) {
    for (let i = 0; i < rawPayload.hotels.length; i++) {
      const h = rawPayload.hotels[i];
      if (!isPlainObject(h)) {
        throw new Error(`hotels[${i}] 不是有效的对象`);
      }

      if (isPlainObject(h.shared) || Array.isArray(h.rooms)) {
        if (!isPlainObject(h.shared)) {
          throw new Error(`hotels[${i}].shared 不是有效的对象`);
        }
        if (!Array.isArray(h.rooms)) {
          throw new Error(`hotels[${i}].rooms 不是有效的数组`);
        }
        for (let roomIndex = 0; roomIndex < h.rooms.length; roomIndex++) {
          if (!isPlainObject(h.rooms[roomIndex])) {
            throw new Error(`hotels[${i}].rooms[${roomIndex}] 不是有效的对象`);
          }
        }
      }
    }

    normalizedHotels = hotelStorage.expandStoredHotels(rawPayload.hotels, normalizeHotelPayload);

    for (let i = 0; i < normalizedHotels.length; i++) {
      const h = normalizedHotels[i];
      if (!h.name || typeof h.name !== 'string' || !h.name.trim()) {
        throw new Error(`hotels[${i}] 缺少必填字段 name`);
      }
    }
  }

  // templates 内部结构校验
  if (Array.isArray(rawPayload.templates)) {
    for (let i = 0; i < rawPayload.templates.length; i++) {
      const t = rawPayload.templates[i];
      if (!isPlainObject(t)) {
        throw new Error(`templates[${i}] 不是有效的对象`);
      }
      if (!t.name || typeof t.name !== 'string' || !t.name.trim()) {
        throw new Error(`templates[${i}] 缺少必填字段 name`);
      }
    }
  }

  return {
    hotels: normalizedHotels,
    templates: Array.isArray(rawPayload.templates)
      ? rawPayload.templates.map(template => normalizeTemplatePayload(template))
      : [],
    settings: normalizeImportedSettings(rawPayload.settings),
    customAppIcon: isPlainObject(rawPayload.meta?.customAppIcon)
      ? rawPayload.meta.customAppIcon
      : null,
    meta: meta
      ? meta
      : {
          sourceApp: rawPayload.sourceApp || APP_CONFIG.NAME,
          appVersion: rawPayload.appVersion || 'legacy',
          schemaVersion: rawPayload.schemaVersion || 1,
          exportedAt: rawPayload.exportedAt || null
        }
  };
}

function restoreSnapshot(store, snapshot) {
  store.set('hotels', snapshot.hotels);
  store.set('templates', snapshot.templates);
  store.set('settings', snapshot.settings);
}

function buildReplaceImportPayload(importedPayload) {
  const nextIdState = { value: Date.now() };
  const templateProcessingResult = processImportedTemplates(importedPayload.templates, [], {
    skipDuplicates: false,
    nextIdState
  });
  const hotelProcessingResult = processImportedHotels(importedPayload.hotels, [], {
    skipDuplicates: false,
    nextIdState,
    templateByImportedId: templateProcessingResult.templateByImportedId,
    templateByDuplicateKey: templateProcessingResult.templateByDuplicateKey
  });

  return {
    hotels: hotelProcessingResult.processedHotels,
    templates: templateProcessingResult.processedTemplates,
    settings: normalizeImportedSettings(importedPayload.settings),
    importStats: {
      addedHotelCount: hotelProcessingResult.processedHotels.length,
      skippedHotelCount: 0,
      addedTemplateCount: templateProcessingResult.processedTemplates.length,
      skippedTemplateCount: 0
    }
  };
}

function buildAppendImportPayload(snapshot, importedPayload) {
  const existingHotels = hotelStorage.expandStoredHotels(snapshot.hotels || [], normalizeHotelPayload);
  const existingTemplates = (snapshot.templates || []).map(template => normalizeTemplatePayload(template));
  const nextIdState = { value: Date.now() };
  const templateProcessingResult = processImportedTemplates(importedPayload.templates, existingTemplates, {
    skipDuplicates: true,
    nextIdState
  });
  const hotelProcessingResult = processImportedHotels(importedPayload.hotels, existingHotels, {
    skipDuplicates: true,
    nextIdState,
    templateByImportedId: templateProcessingResult.templateByImportedId,
    templateByDuplicateKey: templateProcessingResult.templateByDuplicateKey
  });

  return {
    hotels: [...existingHotels, ...hotelProcessingResult.processedHotels],
    templates: [...existingTemplates, ...templateProcessingResult.processedTemplates],
    settings: normalizeImportedSettings(snapshot.settings),
    importStats: {
      addedHotelCount: hotelProcessingResult.processedHotels.length,
      skippedHotelCount: hotelProcessingResult.skippedCount,
      addedTemplateCount: templateProcessingResult.processedTemplates.length,
      skippedTemplateCount: templateProcessingResult.skippedCount
    }
  };
}

function registerDataHandlers({ ipcMain, cache, services }) {
  const { dataService, windowService } = services;
  const getMainWindow = () => windowService?.getMainWindow?.() || null;

  // 导出数据
  ipcMain.handle('data:export', async () => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return { success: false };
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: 'hotel-data.json',
      filters: [{ name: 'JSON', extensions: [APP_CONFIG.FILE_EXTENSIONS.JSON] }, { name: 'All Files', extensions: ['*'] }]
    });
    if (result.filePath) {
      const store = dataService.getStore();
      const exportPayload = buildExportPayload(store);
      fs.writeFileSync(result.filePath, JSON.stringify(exportPayload, null, 2));
      return {
        success: true,
        path: result.filePath,
        hotelCount: exportPayload.hotels.length,
        templateCount: exportPayload.templates.length,
        meta: exportPayload.meta
      };
    }
    return { success: false };
  });

  // 导入数据
  ipcMain.handle('data:import', async (event, requestedMode = 'replace') => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return { success: false };
    const importMode = requestedMode === 'append' ? 'append' : 'replace';
    const result = await dialog.showOpenDialog(mainWindow, {
      filters: [{ name: 'JSON', extensions: [APP_CONFIG.FILE_EXTENSIONS.JSON] }, { name: 'All Files', extensions: ['*'] }],
      properties: ['openFile']
    });
    if (result.filePaths && result.filePaths[0]) {
      const store = dataService.getStore();
      const previousSnapshot = {
        hotels: store.get('hotels') || [],
        templates: store.get('templates') || [],
        settings: store.get('settings') || {}
      };
      const previousIconSnapshot = appIconManager.captureManagedIconSnapshot(previousSnapshot.settings);

      try {
        const rawText = fs.readFileSync(result.filePaths[0], 'utf-8');
        const importedPayload = normalizeImportedPayload(JSON.parse(rawText));
        const finalPayload = importMode === 'append'
          ? buildAppendImportPayload(previousSnapshot, importedPayload)
          : buildReplaceImportPayload(importedPayload);

        if (importMode === 'replace') {
          if (importedPayload.customAppIcon) {
            const restoredIcon = appIconManager.restoreExportedIcon(importedPayload.customAppIcon);
            finalPayload.settings.app_icon_path = restoredIcon.path;
            finalPayload.settings.app_icon_file_name = restoredIcon.fileName;
          } else if (appIconManager.isManagedIconReference(finalPayload.settings.app_icon_path)) {
            finalPayload.settings.app_icon_path = '';
            finalPayload.settings.app_icon_file_name = '';
          }
        }

        hotelStorage.setExpandedHotelsToStore(store, finalPayload.hotels, normalizeHotelPayload);
        store.set('templates', finalPayload.templates);
        store.set('settings', finalPayload.settings);
        cache.invalidate('');
        if (windowService) {
          windowService.applyThemeAppearance(finalPayload.settings.theme);
          windowService.applyWindowIcon(finalPayload.settings.app_icon_path || '');
        }

        return {
          success: true,
          mode: importMode,
          hotelCount: finalPayload.importStats?.addedHotelCount ?? finalPayload.hotels.length,
          templateCount: finalPayload.importStats?.addedTemplateCount ?? finalPayload.templates.length,
          skippedHotelCount: finalPayload.importStats?.skippedHotelCount || 0,
          skippedTemplateCount: finalPayload.importStats?.skippedTemplateCount || 0,
          meta: importedPayload.meta
        };
      } catch (error) {
        restoreSnapshot(store, previousSnapshot);
        appIconManager.restoreManagedIconSnapshot(previousIconSnapshot);
        if (windowService) {
          windowService.applyThemeAppearance(previousSnapshot.settings.theme);
          windowService.applyWindowIcon(previousSnapshot.settings.app_icon_path || '');
        }
        console.error('导入数据失败:', error);
        return { success: false, error: error.message };
      }
    }
    return { success: false };
  });

  // 导出排名图片
  ipcMain.handle('ranking:exportImage', async (event, imageBuffer) => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return { success: false };
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: 'hotel-ranking.png',
      filters: [
        { name: 'PNG', extensions: [APP_CONFIG.FILE_EXTENSIONS.PNG] },
        { name: 'JPEG', extensions: APP_CONFIG.FILE_EXTENSIONS.JPEG },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    if (result.filePath) {
      fs.writeFileSync(result.filePath, Buffer.from(imageBuffer, 'base64'));
      return { success: true, path: result.filePath };
    }
    return { success: false };
  });

  // 获取数据存储路径
  ipcMain.handle('data:getPath', () => {
    const store = dataService.getStore();
    return store.path;
  });

  // 获取数据文件夹路径
  ipcMain.handle('data:getFolderPath', () => {
    const dataFolderManager = dataService.getDataFolderManager();
    return dataFolderManager.getDataFolderPath();
  });

  // 在文件管理器中显示数据文件
  ipcMain.handle('data:showInFolder', () => {
    const store = dataService.getStore();
    shell.showItemInFolder(store.path);
    return { success: true };
  });

  // 更改数据存储位置（完整迁移整个文件夹）
  ipcMain.handle('data:changePath', async () => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return { success: false, error: '主窗口未找到' };

    const dataFolderManager = dataService.getDataFolderManager();
    const currentDataFolder = dataFolderManager.getDataFolderPath();

    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择数据存储位置',
      defaultPath: path.dirname(currentDataFolder),
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: '选择文件夹'
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    const selectedDir = result.filePaths[0];

    // 新的数据文件夹路径（在选择目录下创建"宾馆比较助手"文件夹）
    const paths = getPaths();
    const newDataFolder = path.join(selectedDir, paths.DATA_FOLDER_NAME);

    // 如果新路径和当前路径相同，不做任何操作
    if (path.resolve(newDataFolder) === path.resolve(currentDataFolder)) {
      return { success: false, samePath: true };
    }

    // 检查新位置是否已存在数据文件夹
    if (fs.existsSync(newDataFolder)) {
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: 'question',
        buttons: ['覆盖', '取消'],
        title: '文件夹已存在',
        message: '目标位置已存在"宾馆比较助手"文件夹，是否覆盖？',
        defaultId: 1,
        cancelId: 1
      });
      if (choice === 1) {
        return { success: false, canceled: true };
      }
      // 删除已存在的文件夹
      fs.rmSync(newDataFolder, { recursive: true, force: true });
    }

    try {
      // 确保当前数据文件夹存在
      dataFolderManager.ensureDataFolder(currentDataFolder);

      // 递归复制整个数据目录，避免把 assets 这类子目录当成文件复制。
      fs.cpSync(currentDataFolder, newDataFolder, { recursive: true, force: true });

      // 更新指针文件，指向新位置
      dataFolderManager.saveDataFolderPath(newDataFolder);

      // 重新初始化 store
      dataService.reinitializeStore(newDataFolder);

      // 清除缓存
      cache.invalidate('');

      // 询问是否删除旧文件夹
      const deleteOld = dialog.showMessageBoxSync(mainWindow, {
        type: 'question',
        buttons: ['删除', '保留'],
        title: '迁移完成',
        message: '数据已成功迁移到新位置。\n\n是否删除旧数据文件夹？',
        defaultId: 1,
        cancelId: 1
      });

      if (deleteOld === 0) {
        // 删除旧文件夹
        fs.rmSync(currentDataFolder, { recursive: true, force: true });
      }

      return { success: true, path: dataService.getStore().path, oldPath: currentDataFolder, deleted: deleteOld === 0 };
    } catch (error) {
      console.error('迁移数据失败:', error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = registerDataHandlers;
