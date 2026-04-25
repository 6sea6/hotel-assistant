const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, nativeImage } = require('electron');
const { APP_CONFIG, getPaths } = require('./config');
const storeManager = require('./store-manager');
const appIconManager = require('./app-icon-manager');

const THEME_ALIAS_MAP = Object.freeze({
  light: 'cloud-white',
  dark: 'oak-brown',
  'changing-mode': 'colorful-mode'
});

const THEME_WINDOW_COLORS = Object.freeze({
  'totoro-blue': '#EEF4F9',
  'sweet-lime': '#EEF7F3',
  'grass-green': '#F2F7EB',
  'pineapple-yellow': '#FCF5DE',
  'oak-brown': '#F8F0E9',
  'cloud-white': '#FFFFFF',
  'autumn-gold': '#FFF8E7',
  'diehard-pink': '#FEF2F7',
  'grape-purple': '#F4F0FF',
  'colorful-mode': '#FFF7FB'
});

const THEME_TITLEBAR_COLORS = Object.freeze({
  'totoro-blue': '#6B8FB5',
  'sweet-lime': '#4E8C80',
  'grass-green': '#6A934A',
  'pineapple-yellow': '#C39A23',
  'oak-brown': '#8A6344',
  'cloud-white': '#FFFFFF',
  'autumn-gold': '#DDB457',
  'diehard-pink': '#E28EB0',
  'grape-purple': '#8A73D1',
  'colorful-mode': '#8A78F2'
});

const THEME_TITLEBAR_SYMBOL_COLORS = Object.freeze({
  'totoro-blue': '#FFFFFF',
  'sweet-lime': '#FFFFFF',
  'grass-green': '#FFFFFF',
  'pineapple-yellow': '#FFFBEF',
  'oak-brown': '#FFFFFF',
  'cloud-white': '#5A5F66',
  'autumn-gold': '#FFFCEF',
  'diehard-pink': '#FFFDFE',
  'grape-purple': '#FFFEFF',
  'colorful-mode': '#FFFDFE'
});

class WindowManager {
  constructor() {
    this.mainWindow = null;
    this.currentIconPath = '';
  }

  createNativeIconImage(iconPath = '') {
    const normalizedPath = typeof iconPath === 'string' ? iconPath.trim() : '';
    if (!normalizedPath || !fs.existsSync(normalizedPath)) {
      return null;
    }

    const iconImage = nativeImage.createFromPath(normalizedPath);
    if (!iconImage || iconImage.isEmpty()) {
      return null;
    }

    return iconImage;
  }

  getTaskbarIconPath(activeIconPath = '') {
    const normalizedPath = typeof activeIconPath === 'string' ? activeIconPath.trim() : '';

    if (normalizedPath && fs.existsSync(normalizedPath)) {
      const extension = path.extname(normalizedPath).toLowerCase();
      if (extension === '.ico' || extension === '.exe' || extension === '.dll') {
        return normalizedPath;
      }
    }

    const defaultIconPath = this.getDefaultIconPath();
    if (defaultIconPath) {
      const extension = path.extname(defaultIconPath).toLowerCase();
      if (extension === '.ico' || extension === '.exe' || extension === '.dll') {
        return defaultIconPath;
      }
    }

    if (app.isPackaged && process.execPath && fs.existsSync(process.execPath)) {
      return process.execPath;
    }

    return '';
  }

  syncTaskbarAppDetails(activeIconPath = '') {
    if (process.platform !== 'win32' || !app.isPackaged) {
      return;
    }

    if (!this.mainWindow || this.mainWindow.isDestroyed() || typeof this.mainWindow.setAppDetails !== 'function') {
      return;
    }

    const appDetails = {
      appId: APP_CONFIG.APP_USER_MODEL_ID
    };

    const taskbarIconPath = this.getTaskbarIconPath(activeIconPath);
    if (taskbarIconPath) {
      appDetails.appIconPath = taskbarIconPath;
      appDetails.appIconIndex = 0;
    }

    appDetails.relaunchCommand = process.execPath;
    appDetails.relaunchDisplayName = APP_CONFIG.WINDOW.TITLE;

    try {
      this.mainWindow.setAppDetails(appDetails);
    } catch (error) {
      console.warn('同步任务栏图标信息失败:', error.message);
    }
  }

  getStoredIconSettings() {
    try {
      const store = storeManager.getStore();
      const settings = store.get('settings') || {};
      return {
        app_icon_path: typeof settings.app_icon_path === 'string' ? settings.app_icon_path : '',
        app_icon_file_name: typeof settings.app_icon_file_name === 'string' ? settings.app_icon_file_name : ''
      };
    } catch (error) {
      return {
        app_icon_path: '',
        app_icon_file_name: ''
      };
    }
  }

  getStoredIconPath() {
    return this.getStoredIconSettings().app_icon_path;
  }

  normalizeTheme(theme = '') {
    const normalizedTheme = THEME_ALIAS_MAP[theme] || theme;
    return THEME_WINDOW_COLORS[normalizedTheme]
      ? normalizedTheme
      : APP_CONFIG.STORE_DEFAULTS.settings.theme;
  }

  getThemeWindowBackground(theme = '') {
    return THEME_WINDOW_COLORS[this.normalizeTheme(theme)] || APP_CONFIG.WINDOW.BACKGROUND_COLOR;
  }

  getThemeTitleBarColor(theme = '') {
    return THEME_TITLEBAR_COLORS[this.normalizeTheme(theme)] || this.getThemeWindowBackground(theme);
  }

  getThemeTitleBarSymbolColor(theme = '') {
    return THEME_TITLEBAR_SYMBOL_COLORS[this.normalizeTheme(theme)] || '#FFFFFF';
  }

  getStoredTheme() {
    try {
      const store = storeManager.getStore();
      const settings = store.get('settings') || {};
      return this.normalizeTheme(settings.theme);
    } catch (error) {
      return APP_CONFIG.STORE_DEFAULTS.settings.theme;
    }
  }

  applyThemeAppearance(theme = '') {
    const normalizedTheme = this.normalizeTheme(theme);
    const backgroundColor = this.getThemeWindowBackground(normalizedTheme);
    const titleBarColor = this.getThemeTitleBarColor(normalizedTheme);
    const symbolColor = this.getThemeTitleBarSymbolColor(normalizedTheme);

    if (this.mainWindow && !this.mainWindow.isDestroyed() && typeof this.mainWindow.setBackgroundColor === 'function') {
      this.mainWindow.setBackgroundColor(backgroundColor);
    }

    return {
      theme: normalizedTheme,
      backgroundColor,
      titleBarColor,
      symbolColor
    };
  }

  emitWindowStateChanged(targetWindow = this.mainWindow) {
    if (!targetWindow || targetWindow.isDestroyed()) {
      return;
    }

    targetWindow.webContents.send('window:stateChanged', {
      isMaximized: targetWindow.isMaximized()
    });
  }

  getDefaultIconPath() {
    const paths = getPaths();
    const candidates = [];

    if (app.isPackaged) {
      const packagedDir = path.dirname(process.execPath);
      if (paths.PACKAGED_DEFAULT_ICON_NAME) {
        candidates.push(path.join(packagedDir, paths.PACKAGED_DEFAULT_ICON_NAME));
      }
      if (paths.PACKAGED_FALLBACK_ICON_NAME) {
        candidates.push(path.join(packagedDir, paths.PACKAGED_FALLBACK_ICON_NAME));
      }
    }

    candidates.push(paths.DEFAULT_APP_ICON, paths.FALLBACK_APP_ICON);
    return Array.from(new Set(candidates)).find((candidate) => candidate && fs.existsSync(candidate)) || '';
  }

  resolveIconPath(preferredPath = '') {
    const normalizedPreferredPath = typeof preferredPath === 'string' ? preferredPath.trim() : '';
    const resolvedPreferredPath = appIconManager.resolveStoredIconPath(normalizedPreferredPath);
    if (resolvedPreferredPath && fs.existsSync(resolvedPreferredPath)) {
      return resolvedPreferredPath;
    }

    const defaultIconPath = this.getDefaultIconPath();
    if (defaultIconPath) {
      return defaultIconPath;
    }

    return '';
  }

  applyWindowIcon(preferredPath = '') {
    const normalizedPreferredPath = typeof preferredPath === 'string' ? preferredPath.trim() : '';
    const preferredResolvedPath = appIconManager.resolveStoredIconPath(normalizedPreferredPath);
    const resolvedPath = this.resolveIconPath(preferredPath);
    if (!resolvedPath) {
      return { success: false, error: '未找到可用图标文件', path: '' };
    }

    const iconImage = this.createNativeIconImage(resolvedPath);
    if (!iconImage) {
      return { success: false, error: '图标文件无效或无法读取', path: resolvedPath };
    }

    if (this.mainWindow && !this.mainWindow.isDestroyed() && typeof this.mainWindow.setIcon === 'function') {
      this.mainWindow.setIcon(iconImage);
    }

    this.currentIconPath = resolvedPath;
    this.syncTaskbarAppDetails(resolvedPath);

    const isCustom = Boolean(
      normalizedPreferredPath && preferredResolvedPath && path.resolve(preferredResolvedPath) === path.resolve(resolvedPath)
    );

    return {
      success: true,
      path: normalizedPreferredPath || resolvedPath,
      activePath: resolvedPath,
      isCustom,
      isManaged: appIconManager.isManagedIconReference(normalizedPreferredPath),
      fileName: path.basename(resolvedPath)
    };
  }

  getIconState(preferredPath = '') {
    const storedIconSettings = this.getStoredIconSettings();
    const normalizedPreferredPath = typeof preferredPath === 'string' && preferredPath.trim()
      ? preferredPath.trim()
      : storedIconSettings.app_icon_path;
    const customIconPath = appIconManager.resolveStoredIconPath(normalizedPreferredPath);
    const hasCustomIcon = Boolean(customIconPath && fs.existsSync(customIconPath));
    const resolvedPath = this.resolveIconPath(normalizedPreferredPath);

    return {
      isCustom: hasCustomIcon,
      isManaged: appIconManager.isManagedIconReference(normalizedPreferredPath),
      customPath: normalizedPreferredPath,
      activePath: resolvedPath,
      fileName: storedIconSettings.app_icon_file_name || (customIconPath ? path.basename(customIconPath) : ''),
      missingCustomIcon: Boolean(normalizedPreferredPath && !hasCustomIcon),
      defaultPath: this.getDefaultIconPath()
    };
  }

  localizeDevTools() {
    const devToolsContents = this.mainWindow?.webContents?.devToolsWebContents;
    if (!devToolsContents || devToolsContents.isDestroyed()) return;

    const script = `(() => {
      const setPreferredLanguage = () => {
        try {
          if (window.InspectorFrontendHost?.setPreference) {
            window.InspectorFrontendHost.setPreference('language', 'zh-CN');
          }
        } catch (error) {}

        try {
          const rawPreferences = localStorage.getItem('preferences');
          const preferences = rawPreferences ? JSON.parse(rawPreferences) : {};
          if (preferences.language !== 'zh-CN') {
            preferences.language = 'zh-CN';
            localStorage.setItem('preferences', JSON.stringify(preferences));
          }
        } catch (error) {}
      };

      const clickChineseSwitch = () => {
        const labels = [
          'Switch DevTools to Chinese',
          'Always match Chrome\'s language',
          '切换 DevTools 为中文',
          '始终匹配 Chrome 的语言'
        ];
        const candidates = Array.from(document.querySelectorAll('button, [role="button"]'));
        const target = candidates.find((element) => labels.some((label) => (element.textContent || '').includes(label)));
        if (target) target.click();
      };

      setPreferredLanguage();
      clickChineseSwitch();
    })();`;

    devToolsContents.executeJavaScript(script).catch(() => {});
  }

  createWindow() {
    const paths = getPaths();
    const storedIconPath = this.getStoredIconSettings().app_icon_path;
    const storedTheme = this.getStoredTheme();
    const resolvedIconPath = this.resolveIconPath(storedIconPath);
    const resolvedIconImage = this.createNativeIconImage(resolvedIconPath);
    const useCustomWindowControls = process.platform === 'win32';
    this.mainWindow = new BrowserWindow({
      width: APP_CONFIG.WINDOW.WIDTH,
      height: APP_CONFIG.WINDOW.HEIGHT,
      minWidth: APP_CONFIG.WINDOW.MIN_WIDTH,
      minHeight: APP_CONFIG.WINDOW.MIN_HEIGHT,
      show: false,
      backgroundColor: this.getThemeWindowBackground(storedTheme),
      autoHideMenuBar: process.platform === 'win32',
      frame: useCustomWindowControls ? false : undefined,
      thickFrame: useCustomWindowControls ? true : undefined,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: paths.PRELOAD_SCRIPT,
        sandbox: false,
        webSecurity: true,
        spellcheck: false
      },
      title: APP_CONFIG.WINDOW.TITLE,
      icon: resolvedIconImage || undefined
    });

    this.syncTaskbarAppDetails(resolvedIconPath);

    if (resolvedIconPath) {
      this.applyWindowIcon(storedIconPath);
    }

    this.mainWindow.loadFile(paths.RENDERER_HTML);

    const applyDevToolsLocale = () => {
      this.localizeDevTools();
      setTimeout(() => this.localizeDevTools(), 200);
      setTimeout(() => this.localizeDevTools(), 900);
    };

    this.mainWindow.webContents.on('devtools-opened', () => {
      applyDevToolsLocale();
    });

    this.mainWindow.once('ready-to-show', () => {
      this.applyThemeAppearance(storedTheme);
      this.applyWindowIcon(storedIconPath);
      this.emitWindowStateChanged(this.mainWindow);
      this.mainWindow.show();
    });

    this.mainWindow.on('maximize', () => this.emitWindowStateChanged(this.mainWindow));
    this.mainWindow.on('unmaximize', () => this.emitWindowStateChanged(this.mainWindow));

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });

    return this.mainWindow;
  }

  getMainWindow() {
    return this.mainWindow;
  }

  // 处理应用激活事件
  handleActivate() {
    if (BrowserWindow.getAllWindows().length === 0) {
      this.createWindow();
    }
  }
}

module.exports = new WindowManager();
