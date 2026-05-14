function getStoreManager() {
  return require('../store-manager');
}

function createDataService() {
  return {
    getStore() {
      return getStoreManager().getStore();
    },
    getDataFolderManager() {
      return getStoreManager().getDataFolderManager();
    },
    getDataFolderPath() {
      return this.getDataFolderManager().getDataFolderPath();
    },
    getStorePath() {
      return this.getStore().path;
    },
    reinitializeStore(cwd) {
      return getStoreManager().reinitialize(cwd);
    }
  };
}

module.exports = {
  createDataService
};
