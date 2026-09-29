const { requireSharedCompareAppModule } = require('./compare-app/shared-module');
const { BASE_COMPARE_APP_SETTINGS, DEFAULT_COMPARE_APP_FILES, createBaseCompareAppStore } =
  requireSharedCompareAppModule('constants.js');

const DEFAULT_AMAP_KEY = '';

const DEFAULT_STORE = createBaseCompareAppStore();

function createDefaultStore() {
  return {
    hotels: [],
    templates: [],
    settings: {
      ...BASE_COMPARE_APP_SETTINGS
    }
  };
}

const DEFAULT_COMPARE_APP = {
  ...DEFAULT_COMPARE_APP_FILES
};

module.exports = {
  DEFAULT_AMAP_KEY,
  createDefaultStore,
  DEFAULT_STORE,
  DEFAULT_COMPARE_APP
};
