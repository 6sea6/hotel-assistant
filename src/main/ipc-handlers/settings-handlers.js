const path = require('path');
const { dialog } = require('electron');
const { APP_CONFIG } = require('../config');
const appIconManager = require('../app-icon-manager');
const { normalizeAiProviderConfig } = require('../ai/provider-presets');
const { safeHandle } = require('../ipc-safe-handler');
const { assertAllowedValue } = require('../ipc-validators');
const { hasNormalizedValueChanged } = require('../normalization-utils');

const THEME_ALIAS_MAP = Object.freeze({
  light: 'cloud-white',
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

const SUPPORTED_SETTING_KEYS = Object.freeze([
  ...Object.keys(APP_CONFIG.STORE_DEFAULTS.settings),
  'showManualOnStartup'
]);

const OLD_HOTEL_CARD_VISIBLE_FIELDS = Object.freeze([
  'original_room_type',
  'address',
  'website',
  'total_price',
  'daily_price',
  'ctrip_score',
  'destination',
  'distance',
  'subway',
  'transport_time',
  'bus_route',
  'room_type',
  'room_count',
  'room_area',
  'days',
  'check_in_date',
  'check_out_date',
  'notes',
  'template',
  'cancel_policy',
  'window_status'
]);

const OLD_HOTEL_CARD_VISIBLE_FIELDS_V2 = Object.freeze([
  'original_room_type',
  'address',
  'website',
  'total_price',
  'daily_price',
  'ctrip_score',
  'distance',
  'subway',
  'transport_time',
  'bus_route',
  'room_type',
  'check_in_date',
  'check_out_date',
  'notes',
  'template'
]);

function registerSettingsHandlers({ ipcMain, cache, services }) {
  const { dataService, windowService } = services;
  const normalizeThemeSetting = (theme) => {
    const normalizedTheme = THEME_ALIAS_MAP[theme] || theme;
    return SUPPORTED_THEMES.has(normalizedTheme)
      ? normalizedTheme
      : APP_CONFIG.STORE_DEFAULTS.settings.theme;
  };

  const normalizeCollectBatchConcurrency = (value) => (Number(value) === 2 ? 2 : 1);

  const normalizeSettings = (settings = {}) => {
    const normalizedSettings = {
      ...APP_CONFIG.STORE_DEFAULTS.settings,
      ...settings
    };
    delete normalizedSettings.autoMatchTemplate;
    normalizedSettings.theme = normalizeThemeSetting(normalizedSettings.theme);
    normalizedSettings.ai_provider_config = normalizeAiProviderConfig(
      normalizedSettings.ai_provider_config
    );
    normalizedSettings.amapApiKey = String(normalizedSettings.amapApiKey || '').trim();
    normalizedSettings.collectBatchConcurrency = normalizeCollectBatchConcurrency(
      normalizedSettings.collectBatchConcurrency
    );

    if (
      Array.isArray(normalizedSettings.hotelCardVisibleFields) &&
      ((normalizedSettings.hotelCardVisibleFields.length === OLD_HOTEL_CARD_VISIBLE_FIELDS.length &&
        OLD_HOTEL_CARD_VISIBLE_FIELDS.every(
          (key, index) => normalizedSettings.hotelCardVisibleFields[index] === key
        )) ||
        (normalizedSettings.hotelCardVisibleFields.length ===
          OLD_HOTEL_CARD_VISIBLE_FIELDS_V2.length &&
          OLD_HOTEL_CARD_VISIBLE_FIELDS_V2.every(
            (key, index) => normalizedSettings.hotelCardVisibleFields[index] === key
          )))
    ) {
      normalizedSettings.hotelCardVisibleFields = [
        ...APP_CONFIG.STORE_DEFAULTS.settings.hotelCardVisibleFields
      ];
    }

    const managedReference = appIconManager.toManagedIconReference(
      normalizedSettings.app_icon_path
    );
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

    if (hasNormalizedValueChanged(rawSettings, settings)) {
      store.set('settings', settings);
    }

    return {
      store,
      settings
    };
  };

  // 获取设置
  safeHandle(ipcMain, 'settings:get', (_event, key) => {
    const settingKey = typeof key === 'string' ? key : '';
    const { settings } = getSettingsObject();
    return Object.prototype.hasOwnProperty.call(settings, settingKey) ? settings[settingKey] : null;
  });

  // 设置设置
  safeHandle(
    ipcMain,
    'settings:set',
    (_event, key, value) => {
      if (typeof key !== 'string' || !key.trim()) {
        return { success: false, error: '无效的设置项' };
      }
      const settingKey = key.trim();
      const keyError = assertAllowedValue(settingKey, SUPPORTED_SETTING_KEYS, '不支持的设置项');
      if (keyError) return keyError;

      const { store, settings } = getSettingsObject();
      settings[settingKey] = value;

      if (settingKey === 'app_icon_path') {
        const iconPath = value ? String(value) : '';
        settings.app_icon_file_name = value
          ? settings.app_icon_file_name ||
            path.basename(appIconManager.resolveStoredIconPath(iconPath) || iconPath)
          : '';
      }

      const normalizedSettings = normalizeSettings(settings);
      store.set('settings', normalizedSettings);
      cache.invalidate('settings');

      if (windowService) {
        if (settingKey === 'app_icon_path') {
          windowService.applyWindowIcon(normalizedSettings.app_icon_path);
        }
        if (settingKey === 'theme') {
          windowService.applyThemeAppearance(normalizedSettings.theme);
        }
      }

      return { success: true };
    },
    { fallbackError: '设置保存失败' }
  );

  // 获取所有设置
  safeHandle(ipcMain, 'settings:getAll', () => {
    const { settings } = getSettingsObject();
    return settings;
  });

  safeHandle(
    ipcMain,
    'settings:applyThemeAppearance',
    (_event, theme) => {
      if (!windowService) {
        return { success: false, error: 'windowService 不可用' };
      }

      return {
        success: true,
        ...windowService.applyThemeAppearance(normalizeThemeSetting(theme))
      };
    },
    { fallbackError: '主题应用失败' }
  );

  safeHandle(ipcMain, 'settings:getIconState', () => {
    const { settings } = getSettingsObject();
    return windowService.getIconState(settings.app_icon_path || '');
  });

  safeHandle(
    ipcMain,
    'settings:chooseAppIcon',
    async () => {
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
        const persistedIcon = appIconManager.persistCustomIcon(
          selectedPath,
          path.basename(selectedPath)
        );
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
    },
    { fallbackError: '图标应用失败' }
  );

  safeHandle(
    ipcMain,
    'settings:resetAppIcon',
    () => {
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
    },
    { fallbackError: '恢复默认图标失败' }
  );

  // 一次性恢复所有设置为默认值（含图标重置），避免多次 IPC 往返
  safeHandle(
    ipcMain,
    'settings:resetAll',
    () => {
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
    },
    { fallbackError: '恢复默认设置失败' }
  );
}

module.exports = registerSettingsHandlers;
