const fs = require('fs');
const path = require('path');
const { requireSharedCompareAppModule } = require('./shared-compare-app');
const { DEFAULT_COMPARE_APP_FILES } = requireSharedCompareAppModule('constants.js');
const {
  getInstalledDataFolderPath,
  getLegacyDataFolderPath: getLegacyCompareAppDataFolderPath,
  getPointerFilePath,
  readPointerData,
  writePointerDataFolder
} = requireSharedCompareAppModule('data-folder.js');

// 缓存管理
class DataCache {
  constructor(ttl = 5000) {
    this.cache = new Map();
    this.ttl = ttl;
  }

  get(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.time < this.ttl) {
      return cached.data;
    }
    return null;
  }

  set(key, data) {
    this.cache.set(key, { data, time: Date.now() });
  }

  delete(key) {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }

  invalidate(pattern) {
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
      }
    }
  }
}

// 数据文件夹管理
class DataFolderManager {
  constructor() {
    const { app } = require('electron');
    this.pointerFilePath = getPointerFilePath({
      appDataRoot: app.getPath('appData'),
      pointerFileName: DEFAULT_COMPARE_APP_FILES.pointerFileName
    });
    this.dataFolderName = DEFAULT_COMPARE_APP_FILES.appFolderName;
  }

  isPackagedApp() {
    try {
      return Boolean(require('electron').app.isPackaged);
    } catch (_error) {
      return false;
    }
  }

  getPointerSource() {
    return this.isPackagedApp() ? 'packaged' : 'development';
  }

  getPointerAppId() {
    return 'com.hotel.comparison.desktop';
  }

  readDataFolderPointer() {
    return readPointerData(this.pointerFilePath);
  }

  isTrustedPointer(pointer) {
    if (!pointer || !pointer.dataFolder) {
      return false;
    }

    // 开发环境：继续兼容旧指针和新指针，避免影响开发调试。
    if (!this.isPackagedApp()) {
      return true;
    }

    // 正式安装版：只信任正式版自己写过的指针。
    // 这样可以避免开发环境留下的旧 hotel-app-pointer.json 污染新安装应用。
    return pointer.source === 'packaged' && pointer.appId === this.getPointerAppId();
  }

  // 读取数据文件夹路径（从指针文件）
  readDataFolderPath() {
    const pointer = this.readDataFolderPointer();
    return this.isTrustedPointer(pointer) ? pointer.dataFolder : null;
  }

  // 保存数据文件夹路径（写入指针文件）
  saveDataFolderPath(folderPath) {
    writePointerDataFolder(this.pointerFilePath, folderPath, {
      source: this.getPointerSource(),
      appId: this.getPointerAppId(),
      appVersion: require('./config').APP_CONFIG.VERSION
    });
  }

  getLegacyDataFolderPath() {
    return getLegacyCompareAppDataFolderPath({
      appDataRoot: require('electron').app.getPath('appData'),
      appFolderName: this.dataFolderName
    });
  }

  getPackagedDefaultDataFolderPath() {
    const { app } = require('electron');
    if (!app.isPackaged) {
      return '';
    }
    return getInstalledDataFolderPath({
      executableDir: path.dirname(process.execPath),
      appFolderName: this.dataFolderName
    });
  }

  canUseDataFolder(folderPath) {
    if (!folderPath) {
      return false;
    }

    try {
      fs.mkdirSync(folderPath, { recursive: true });
      fs.accessSync(folderPath, fs.constants.R_OK | fs.constants.W_OK);
      return true;
    } catch (error) {
      console.warn('默认数据目录不可写，回退到 AppData:', folderPath, error.message);
      return false;
    }
  }

  getDefaultDataFolderPath() {
    const packagedPath = this.getPackagedDefaultDataFolderPath();
    if (this.canUseDataFolder(packagedPath)) {
      return packagedPath;
    }
    return this.getLegacyDataFolderPath();
  }

  // 获取当前数据文件夹路径
  getDataFolderPath() {
    const customPath = this.readDataFolderPath();
    if (customPath) {
      return customPath;
    }
    return this.getDefaultDataFolderPath();
  }

  // 确保数据文件夹存在
  ensureDataFolder(folderPath) {
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }
  }
}

// 通知渲染进程的工具函数
const notifyRenderer = (mainWindow, channel, data) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
};

module.exports = {
  DataCache,
  DataFolderManager,
  notifyRenderer
};
