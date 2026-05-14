const fs = require('fs');
const path = require('path');
const { DataFolderManager } = require('./utils');
const { requireSharedCompareAppModule } = require('./shared-compare-app');
const {
  BUNDLE_RESOURCE_MAP,
  PROMPT_CONTRACT
} = requireSharedCompareAppModule('prompt-contract.js');
const {
  getBundledResourcePaths,
  isBundledScraperAvailable
} = requireSharedCompareAppModule('runtime-paths.js');

function resolveBundledPaths(appDataPath = getBundledAppDataPath()) {
  return getBundledResourcePaths({
    resourcesPath: process.resourcesPath || '',
    appDataPath,
    unifiedPromptFileName: PROMPT_CONTRACT.unifiedPromptFileName,
    bundleResourceMap: BUNDLE_RESOURCE_MAP
  });
}

function getScraperPath() {
  return resolveBundledPaths().scraperPath;
}

function getBundledAppDataPath() {
  const dataFolderManager = new DataFolderManager();
  const dataFolder = dataFolderManager.getDataFolderPath();
  dataFolderManager.ensureDataFolder(dataFolder);
  return dataFolder;
}

function getBundledWorkDir() {
  return resolveBundledPaths().bundledWorkDir;
}

function getBundledUnifiedPromptSourcePath() {
  return resolveBundledPaths().unifiedPromptSourcePath;
}

function getBundledUnifiedPromptTargetPath() {
  return resolveBundledPaths().unifiedPromptTargetPath;
}

function isBundledWithScraper() {
  return isBundledScraperAvailable(resolveBundledPaths());
}

function copyFileSync(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function deployBundledUnifiedPrompt() {
  if (!isBundledWithScraper()) {
    return '';
  }

  const promptSourcePath = getBundledUnifiedPromptSourcePath();
  if (!fs.existsSync(promptSourcePath)) {
    return '';
  }

  const promptTargetPath = getBundledUnifiedPromptTargetPath();
  copyFileSync(promptSourcePath, promptTargetPath);
  return promptTargetPath;
}

function ensureBundledBootstrapResources() {
  if (!isBundledWithScraper()) {
    return;
  }

  ensureBundledRuntimeDirs();
  deployBundledUnifiedPrompt();
}

function ensureBundledRuntimeDirs() {
  if (!isBundledWithScraper()) return;

  const workDir = getBundledWorkDir();
  const runtimeDirs = [
    path.join(workDir, 'state', 'edge-profile'),
    path.join(workDir, 'output'),
    path.join(workDir, 'output', 'raw-pages')
  ];

  for (const dir of runtimeDirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function scheduleBundledSetup(delayMs = 0) {
  const timer = setTimeout(() => {
    try {
      setupBundledModules();
    } catch (error) {
      console.error('[bundled-setup] 初始化失败:', error);
    }
  }, Math.max(0, Number(delayMs) || 0));

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  return timer;
}

/**
 * 首次启动时自动部署捆绑的 AI 数据采集模块：
 * 1. 部署采集器规则说明文件到可写运行目录
 * 2. 确保 edge-profile 和 output 目录存在
 */
function setupBundledModules() {
  if (!isBundledWithScraper()) return;

  deployBundledUnifiedPrompt();
  ensureBundledRuntimeDirs();

  console.log('[bundled-setup] AI 数据采集模块初始化完成');
}

module.exports = {
  ensureBundledBootstrapResources,
  isBundledWithScraper,
  getScraperPath,
  ensureBundledRuntimeDirs,
  scheduleBundledSetup,
  setupBundledModules
};
