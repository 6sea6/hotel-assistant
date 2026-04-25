const Store = require('electron-store');
const { APP_CONFIG, getPaths } = require('./config');
const { DataFolderManager } = require('./utils');

class StoreManager {
  constructor() {
    this.store = null;
    this.initialized = false;
    this.dataFolderManager = new DataFolderManager();
  }

  // 懒加载初始化 store
  initialize() {
    if (!this.initialized) {
      const paths = getPaths();
      const dataFolder = this.dataFolderManager.getDataFolderPath();
      this.dataFolderManager.ensureDataFolder(dataFolder);

      this.store = new Store({
        name: paths.STORE_NAME,
        cwd: dataFolder,
        defaults: APP_CONFIG.STORE_DEFAULTS
      });

      this.initialized = true;
    }
    return this.store;
  }

  // 获取 store 实例
  getStore() {
    return this.initialize();
  }

  // 重新初始化（用于数据路径变更）
  reinitialize(cwd) {
    const paths = getPaths();
    this.store = new Store({
      name: paths.STORE_NAME,
      cwd: cwd,
      defaults: APP_CONFIG.STORE_DEFAULTS
    });
    this.initialized = true;
    return this.store;
  }

  // 获取数据文件夹管理器
  getDataFolderManager() {
    return this.dataFolderManager;
  }
}

module.exports = new StoreManager();