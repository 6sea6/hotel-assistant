const path = require('path');
const fs = require('fs');
const { DEFAULT_COMPARE_APP } = require('../constants');
const { requireSharedCompareAppModule } = require('./shared-module');
const {
  buildCompareAppDataPaths,
  getExplicitDataFolderOverride,
  resolveCompareAppDataFolder
} = requireSharedCompareAppModule('runtime-paths.js');

function getWorkspaceFallbackDir() {
  const candidates = [
    path.resolve(__dirname, '..', '..', '..', DEFAULT_COMPARE_APP.appFolderName),
    path.resolve(__dirname, '..', '..', '..', '1', DEFAULT_COMPARE_APP.appFolderName)
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function getCompareAppDataFolder(options = {}) {
  return resolveCompareAppDataFolder({
    env: options.env || process.env,
    appDataRoot: options.appDataRoot,
    appFolderName: DEFAULT_COMPARE_APP.appFolderName,
    pointerFileName: DEFAULT_COMPARE_APP.pointerFileName,
    storeFileName: DEFAULT_COMPARE_APP.storeFileName,
    fallbackWorkspaceDir: options.fallbackWorkspaceDir || getWorkspaceFallbackDir(),
    explicitWorkspaceDir: options.explicitWorkspaceDir,
    execPath: options.execPath || process.execPath,
    existsSync: options.existsSync
  });
}

function getCompareAppPaths(options = {}) {
  const dataFolder = getCompareAppDataFolder(options);
  return buildCompareAppDataPaths({
    dataFolder,
    storeFileName: DEFAULT_COMPARE_APP.storeFileName
  });
}

module.exports = {
  getCompareAppDataFolder,
  getCompareAppPaths,
  getExplicitDataFolderOverride,
  getWorkspaceFallbackDir
};
