const { dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { APP_CONFIG, getPaths } = require('../config');
const appIconManager = require('../app-icon-manager');
const hotelStorage = require('../hotel-storage');
const { normalizeHotelPayload } = require('../domain/hotel-normalizer');
const { assertString, safeHandle, toErrorMessage } = require('../ipc-safe-handler');
const {
  buildAppendImportPayload,
  buildExportPayload,
  buildReplaceImportPayload,
  normalizeImportedPayload,
  restoreSnapshot
} = require('../services/data-transfer-service');
const {
  buildTargetDataFolder,
  deleteOldDataFolder,
  isSameResolvedPath,
  migrateDataFolder,
  prepareTargetFolder
} = require('../services/data-folder-migration-service');

/**
 * @param {{
 *   ipcMain: {handle: (channel: string, handler: Function) => void},
 *   cache: {invalidate: (key: string) => void},
 *   services: {
 *     dataService: {getStore: () => any, getDataFolderManager: () => any, reinitializeStore: (folder: string) => void},
 *     windowService?: any
 *   }
 * }} context
 */
function registerDataHandlers({ ipcMain, cache, services }) {
  const { dataService, windowService } = services;
  const getMainWindow = () => windowService?.getMainWindow?.() || null;

  // 导出数据
  safeHandle(ipcMain, 'data:export', async () => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return { success: false };
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: 'hotel-data.json',
      filters: [
        { name: 'JSON', extensions: [APP_CONFIG.FILE_EXTENSIONS.JSON] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    if (result.filePath) {
      const store = dataService.getStore();
      const exportPayload = buildExportPayload(store, { appIconManager });
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
  safeHandle(ipcMain, 'data:import', async (_event, requestedMode = 'replace') => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return { success: false };
    const importMode = requestedMode === 'append' ? 'append' : 'replace';
    const result = await dialog.showOpenDialog(mainWindow, {
      filters: [
        { name: 'JSON', extensions: [APP_CONFIG.FILE_EXTENSIONS.JSON] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    if (result.filePaths && result.filePaths[0]) {
      const store = dataService.getStore();
      const previousSnapshot = {
        hotels: store.get('hotels') || [],
        templates: store.get('templates') || [],
        settings: store.get('settings') || {}
      };
      const previousIconSnapshot = appIconManager.captureManagedIconSnapshot(
        previousSnapshot.settings
      );

      try {
        const rawText = fs.readFileSync(result.filePaths[0], 'utf-8');
        const importedPayload = normalizeImportedPayload(JSON.parse(rawText));
        const finalPayload =
          importMode === 'append'
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
          templateCount:
            finalPayload.importStats?.addedTemplateCount ?? finalPayload.templates.length,
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
        return { success: false, error: toErrorMessage(error) };
      }
    }
    return { success: false };
  });

  // 导出排名图片
  safeHandle(ipcMain, 'ranking:exportImage', async (_event, imageBuffer) => {
    const imageData = assertString(imageBuffer).trim();
    if (!imageData) {
      return { success: false, error: '无效的图片数据' };
    }

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
      fs.writeFileSync(result.filePath, Buffer.from(imageData, 'base64'));
      return { success: true, path: result.filePath };
    }
    return { success: false };
  });

  // 获取数据存储路径
  safeHandle(ipcMain, 'data:getPath', () => {
    const store = dataService.getStore();
    return store.path;
  });

  // 获取数据文件夹路径
  safeHandle(ipcMain, 'data:getFolderPath', () => {
    const dataFolderManager = dataService.getDataFolderManager();
    return dataFolderManager.getDataFolderPath();
  });

  // 在文件管理器中显示数据文件
  safeHandle(ipcMain, 'data:showInFolder', () => {
    const store = dataService.getStore();
    if (!store.path) {
      throw new Error('数据文件路径不存在');
    }
    shell.showItemInFolder(store.path);
    return { success: true };
  });

  // 更改数据存储位置（完整迁移整个文件夹）
  safeHandle(ipcMain, 'data:changePath', async () => {
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
    const newDataFolder = buildTargetDataFolder(selectedDir, paths);

    // 如果新路径和当前路径相同，不做任何操作
    if (isSameResolvedPath(newDataFolder, currentDataFolder)) {
      return { success: false, samePath: true };
    }

    // 检查新位置是否已存在数据文件夹
    const targetPreparation = prepareTargetFolder({
      fs,
      targetFolder: newDataFolder,
      overwrite: false
    });
    if (targetPreparation.exists) {
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
      prepareTargetFolder({
        fs,
        targetFolder: newDataFolder,
        overwrite: true
      });
    }

    try {
      const migrationResult = migrateDataFolder({
        fs,
        dataFolderManager,
        dataService,
        currentDataFolder,
        targetDataFolder: newDataFolder
      });

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
        deleteOldDataFolder({ fs, oldPath: currentDataFolder });
      }

      return {
        success: true,
        path: migrationResult.path,
        oldPath: currentDataFolder,
        deleted: deleteOld === 0
      };
    } catch (error) {
      console.error('迁移数据失败:', error);
      return { success: false, error: toErrorMessage(error) };
    }
  });
}

module.exports = registerDataHandlers;
