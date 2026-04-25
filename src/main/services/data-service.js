const path = require('path');
const { getPaths } = require('../config');

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
    getPromptsPath() {
      const paths = getPaths();
      return path.join(this.getDataFolderPath(), paths.PROMPTS_FILE);
    },
    reinitializeStore(cwd) {
      return getStoreManager().reinitialize(cwd);
    }
  };
}

module.exports = {
  createDataService
};
