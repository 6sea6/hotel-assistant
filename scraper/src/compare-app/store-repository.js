const { requireSharedCompareAppModule } = require('./shared-module');
const { BASE_COMPARE_APP_SETTINGS } = requireSharedCompareAppModule('constants.js');
const { createDefaultStore } = require('../constants');
const { readJsonFile, writeJsonFile } = require('../utils');
const { getCompareAppDataFolder, getCompareAppPaths } = require('./path-resolver');

function getCompareAppStorePath(options = {}) {
  return getCompareAppPaths(options).storePath;
}

function loadCompareAppStore(options = {}) {
  const filePath = getCompareAppStorePath(options);
  const store = readJsonFile(filePath, createDefaultStore());
  const normalizedSettings = {
    ...BASE_COMPARE_APP_SETTINGS,
    ...((store && store.settings) || {})
  };
  delete normalizedSettings.autoMatchTemplate;

  if (JSON.stringify(normalizedSettings) !== JSON.stringify((store && store.settings) || {})) {
    store.settings = normalizedSettings;
    writeJsonFile(filePath, store);
  }

  return store;
}

function saveCompareAppStore(store, options = {}) {
  writeJsonFile(getCompareAppStorePath(options), store);
}

module.exports = {
  getCompareAppDataFolder,
  getCompareAppStorePath,
  loadCompareAppStore,
  saveCompareAppStore
};
