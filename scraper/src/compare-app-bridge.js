const { getCompareAppDataFolder, getExplicitDataFolderOverride } = require('./compare-app/path-resolver');
const {
  appendHotelsToStore,
  appendHotelToStore,
  buildTemplateInfo,
  findTemplateInStore
} = require('./compare-app/hotel-merge');
const {
  getCompareAppStorePath,
  loadCompareAppStore
} = require('./compare-app/store-repository');

module.exports = {
  appendHotelsToStore,
  appendHotelToStore,
  buildTemplateInfo,
  findTemplateInStore,
  getExplicitDataFolderOverride,
  getCompareAppDataFolder,
  getCompareAppStorePath,
  loadCompareAppStore
};
