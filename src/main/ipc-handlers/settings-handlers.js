const path = require('path');
const { dialog } = require('electron');
const { APP_CONFIG } = require('../config');
const appIconManager = require('../app-icon-manager');

const THEME_ALIAS_MAP = Object.freeze({
  light: 'cloud-white',
  dark: 'oak-brown',
  'changing-mode': 'colorful-mode'
});

const SUPPORTED_THEMES = new Set([
  'totoro-blue',
  'sweet-lime',
  'grass-green',
  'pineapple-yellow',
  'oak-brown',
  'cloud-white',
  'autumn-gold',
  'diehard-pink',
  'grape-purple',
  'colorful-mode'
]);

function registerSettingsHandlers({ ipcMain, cache, services }) {
  const { dataService, windowService } = services;
  const normalizeThemeSetting = (theme) => {
    const normalizedTheme = THEME_ALIAS_MAP[theme] || theme;
    return SUPPORTED_THEMES.has(normalizedTheme)
      ? normalizedTheme
      : APP_CONFIG.STORE_DEFAULTS.settings.theme;
  };

  const normalizeSettings = (settings = {}) => {
    const normalizedSettings = {
      ...APP_CONFIG.STORE_DEFAULTS.settings,
      ...settings
    };
    delete normalizedSettings.autoMatchTemplate;
    normalizedSettings.theme = normalizeThemeSetting(normalizedSettings.theme);

    const managedReference = appIconManager.toManagedIconReference(normalizedSettings.app_icon_path);
    if (managedReference) {
      normalizedSettings.app_icon_path = managedReference;
    }

    if (!normalizedSettings.app_icon_path) {
      normalizedSettings.app_icon_file_name = '';
    } else if (!normalizedSettings.app_icon_file_name) {
      const resolvedPath = appIconManager.resolveStoredIconPath(normalizedSettings.app_icon_path);
      normalizedSettings.app_icon_file_name = resolvedPath
        ? path.basename(resolvedPath)
        : path.basename(normalizedSettings.app_icon_path);
    }

    return normalizedSettings;
  };

  const getSettingsObject = () => {
    const store = dataService.getStore();
    const rawSettings = store.get('settings') || {};
    const settings = normalizeSettings(rawSettings);

    if (JSON.stringify(settings) !== JSON.stringify(rawSettings)) {
      store.set('settings', settings);
    }

    return {
      store,
      settings
    };
  };

  // 获取设置
  ipcMain.handle('settings:get', (event, key) => {
    const { settings } = getSettingsObject();
    return settings.hasOwnProperty(key) ? settings[key] : null;
  });

  // 设置设置
  ipcMain.handle('settings:set', (event, key, value) => {
    const { store, settings } = getSettingsObject();
    settings[key] = value;

    if (key === 'app_icon_path') {
      settings.app_icon_file_name = value
        ? (settings.app_icon_file_name || path.basename(appIconManager.resolveStoredIconPath(value) || value))
        : '';
    }

    const normalizedSettings = normalizeSettings(settings);
    store.set('settings', normalizedSettings);
    cache.invalidate('settings');

    if (windowService) {
      if (key === 'app_icon_path') {
        windowService.applyWindowIcon(normalizedSettings.app_icon_path);
      }
      if (key === 'theme') {
        windowService.applyThemeAppearance(normalizedSettings.theme);
      }
    }

    return { success: true };
  });

  // 获取所有设置
  ipcMain.handle('settings:getAll', () => {
    const { settings } = getSettingsObject();
    return settings;
  });

  ipcMain.handle('settings:applyThemeAppearance', (event, theme) => {
    if (!windowService) {
      return { success: false, error: 'windowService 不可用' };
    }

    return {
      success: true,
      ...windowService.applyThemeAppearance(theme)
    };
  });

  ipcMain.handle('settings:getIconState', () => {
    const { settings } = getSettingsObject();
    return windowService.getIconState(settings.app_icon_path || '');
  });

  ipcMain.handle('settings:chooseAppIcon', async () => {
    const { store, settings } = getSettingsObject();
    const mainWindow = windowService?.getMainWindow?.() || null;

    const result = await dialog.showOpenDialog(mainWindow || undefined, {
      title: '选择应用图标',
      properties: ['openFile'],
      filters: [
        { name: '图标文件', extensions: ['ico', 'png', 'jpg', 'jpeg', 'bmp', 'webp'] },
        { name: '全部文件', extensions: ['*'] }
      ]
    });

    if (result.canceled || !result.filePaths.length) {
      return { success: false, canceled: true };
    }

    const selectedPath = result.filePaths[0];
    const previousIconSnapshot = appIconManager.captureManagedIconSnapshot(settings);

    try {
      const persistedIcon = appIconManager.persistCustomIcon(selectedPath, path.basename(selectedPath));
      const applied = windowService.applyWindowIcon(persistedIcon.path);
      if (!applied.success) {
        throw new Error(applied.error || '图标应用失败');
      }

      settings.app_icon_path = persistedIcon.path;
      settings.app_icon_file_name = persistedIcon.fileName;
      store.set('settings', normalizeSettings(settings));
      cache.invalidate('settings');

      return {
        success: true,
        path: persistedIcon.path,
        activePath: persistedIcon.activePath,
        originalPath: selectedPath,
        fileName: persistedIcon.fileName,
        state: windowService.getIconState(persistedIcon.path)
      };
    } catch (error) {
      appIconManager.restoreManagedIconSnapshot(previousIconSnapshot);
      if (settings.app_icon_path) {
        windowService.applyWindowIcon(settings.app_icon_path);
      } else {
        windowService.applyWindowIcon('');
      }

      return {
        success: false,
        error: error.message || '图标应用失败'
      };
    }
  });

  ipcMain.handle('settings:resetAppIcon', () => {
    const { store, settings } = getSettingsObject();
    settings.app_icon_path = '';
    settings.app_icon_file_name = '';
    appIconManager.removeManagedIcon();
    store.set('settings', normalizeSettings(settings));
    cache.invalidate('settings');

    const applied = windowService.applyWindowIcon('');
    if (!applied.success) {
      return { success: false, error: applied.error || '恢复默认图标失败' };
    }

    return {
      success: true,
      state: windowService.getIconState('')
    };
  });

  // 一次性恢复所有设置为默认值（含图标重置），避免多次 IPC 往返
  ipcMain.handle('settings:resetAll', () => {
    const { store } = getSettingsObject();

    const defaultSettings = { ...APP_CONFIG.STORE_DEFAULTS.settings };
    appIconManager.removeManagedIcon();
    store.set('settings', normalizeSettings(defaultSettings));
    cache.invalidate('settings');

    const applied = windowService.applyWindowIcon('');
    if (windowService) {
      windowService.applyThemeAppearance(defaultSettings.theme);
    }

    return {
      success: applied.success !== false,
      settings: defaultSettings,
      iconState: windowService.getIconState('')
    };
  });
}

module.exports = registerSettingsHandlers;
