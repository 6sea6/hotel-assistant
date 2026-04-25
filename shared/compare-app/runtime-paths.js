const fs = require('fs');
const path = require('path');
const {
  getAppDataRoot,
  getInstalledDataFolderPath,
  getLegacyDataFolderPath,
  getPointerFilePath,
  looksLikeManagedAppExecutable,
  pickFirstExistingPath,
  readPointerDataFolder
} = require('./data-folder');
const {
  BUNDLE_RESOURCE_MAP,
  PROMPT_CONTRACT,
  getBundledSkillTargetDir
} = require('./prompt-contract');

function normalizeText(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function getExplicitDataFolderOverride(env = process.env) {
  const explicitDataFolder = normalizeText(env.HOTEL_COMPARE_APP_DATA_DIR);
  return explicitDataFolder ? path.resolve(explicitDataFolder) : '';
}

function shouldPreferWorkspaceDataFolder(env = process.env) {
  return normalizeText(env.HOTEL_COMPARE_APP_USE_WORKSPACE).toLowerCase() !== 'false';
}

function getWorkspaceDataFolderCandidates(options = {}) {
  const {
    env = process.env,
    fallbackWorkspaceDir = '',
    explicitWorkspaceDir = normalizeText(env.HOTEL_COMPARE_APP_WORKSPACE_DIR)
  } = options;

  if (!shouldPreferWorkspaceDataFolder(env)) {
    return [];
  }

  const candidates = [
    explicitWorkspaceDir ? path.resolve(explicitWorkspaceDir) : '',
    fallbackWorkspaceDir ? path.resolve(fallbackWorkspaceDir) : ''
  ].filter(Boolean);

  return Array.from(new Set(candidates));
}

function hasCompareAppStore(folderPath, options = {}) {
  const { storeFileName = '', existsSync = fs.existsSync } = options;
  return Boolean(folderPath && storeFileName && existsSync(path.join(folderPath, storeFileName)));
}

function resolveCompareAppDataFolder(options = {}) {
  const {
    env = process.env,
    appDataRoot,
    appFolderName,
    pointerFileName,
    storeFileName,
    fallbackWorkspaceDir = '',
    explicitWorkspaceDir = normalizeText(env.HOTEL_COMPARE_APP_WORKSPACE_DIR),
    execPath = process.execPath,
    existsSync = fs.existsSync
  } = options;

  const explicitDataFolder = getExplicitDataFolderOverride(env);
  if (explicitDataFolder) {
    return explicitDataFolder;
  }

  const workspaceDataFolder = getWorkspaceDataFolderCandidates({
    env,
    fallbackWorkspaceDir,
    explicitWorkspaceDir
  }).find((candidatePath) => hasCompareAppStore(candidatePath, { storeFileName, existsSync }));
  if (workspaceDataFolder) {
    return workspaceDataFolder;
  }

  const pointerPath = getPointerFilePath({
    appDataRoot: getAppDataRoot(appDataRoot),
    pointerFileName
  });
  const pointedDataFolder = readPointerDataFolder(pointerPath);
  if (pointedDataFolder && existsSync(pointedDataFolder)) {
    return pointedDataFolder;
  }

  const installedDataFolder = looksLikeManagedAppExecutable(execPath)
    ? getInstalledDataFolderPath({
        execPath,
        appFolderName
      })
    : '';
  const legacyDataFolder = getLegacyDataFolderPath({
    appDataRoot: getAppDataRoot(appDataRoot),
    appFolderName
  });

  return pickFirstExistingPath([installedDataFolder, legacyDataFolder])
    || installedDataFolder
    || legacyDataFolder;
}

function buildCompareAppDataPaths(options = {}) {
  const {
    dataFolder,
    storeFileName,
    promptsFileName = PROMPT_CONTRACT.compareAppPromptsFileName
  } = options;

  return {
    dataFolder,
    storePath: path.join(dataFolder, storeFileName),
    promptsPath: path.join(dataFolder, promptsFileName)
  };
}

function getBundledResourcePath(resourcesPath, resourceDirName, ...segments) {
  return path.join(resourcesPath || '', resourceDirName, ...segments);
}

function getBundledResourcePaths(options = {}) {
  const {
    resourcesPath = process.resourcesPath || '',
    appDataPath,
    promptsFileName = PROMPT_CONTRACT.compareAppPromptsFileName,
    unifiedPromptFileName = PROMPT_CONTRACT.unifiedPromptFileName,
    bundleResourceMap = BUNDLE_RESOURCE_MAP,
    homeDir
  } = options;

  const scraperPath = getBundledResourcePath(resourcesPath, bundleResourceMap.scraperDirName);
  const skillSourcePath = getBundledResourcePath(resourcesPath, bundleResourceMap.skillDirName);
  const compareAppResourcePath = getBundledResourcePath(resourcesPath, bundleResourceMap.compareAppDirName);
  const bundledWorkDir = path.join(appDataPath, bundleResourceMap.runtimeWorkDirName);

  return {
    scraperPath,
    skillSourcePath,
    compareAppResourcePath,
    bundledWorkDir,
    promptSeedPath: path.join(compareAppResourcePath, promptsFileName),
    promptTargetPath: path.join(appDataPath, promptsFileName),
    unifiedPromptSourcePath: path.join(scraperPath, unifiedPromptFileName),
    unifiedPromptTargetPath: path.join(bundledWorkDir, unifiedPromptFileName),
    bundledSkillTargetPath: homeDir ? getBundledSkillTargetDir(homeDir) : ''
  };
}

function isBundledScraperAvailable(resourcePaths, existsSync = fs.existsSync) {
  return Boolean(resourcePaths && existsSync(path.join(resourcePaths.scraperPath, 'src', 'cli.js')));
}

module.exports = {
  buildCompareAppDataPaths,
  getBundledResourcePath,
  getBundledResourcePaths,
  getExplicitDataFolderOverride,
  getWorkspaceDataFolderCandidates,
  hasCompareAppStore,
  isBundledScraperAvailable,
  resolveCompareAppDataFolder,
  shouldPreferWorkspaceDataFolder
};
