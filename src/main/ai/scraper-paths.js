const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const Module = require('module');
const {
  ensureBundledBootstrapResources,
  getScraperPath,
  isBundledWithScraper
} = require('../bundled-setup');

const scraperModuleCache = new Map();

function resolveEmbeddedScraperPath(options = {}) {
  return path.resolve(options.currentDir || __dirname, '..', '..', '..', 'scraper');
}

function resolveScraperPath(options = {}) {
  const existsSync = options.existsSync || fs.existsSync;
  let bundledAvailable = false;
  try {
    bundledAvailable =
      typeof options.isBundledWithScraper === 'function'
        ? options.isBundledWithScraper()
        : isBundledWithScraper();
  } catch (error) {
    bundledAvailable = false;
  }
  const bundledScraperPath = bundledAvailable
    ? typeof options.getScraperPath === 'function'
      ? options.getScraperPath()
      : getScraperPath()
    : '';
  const candidates = [
    bundledAvailable ? bundledScraperPath : '',
    resolveEmbeddedScraperPath(options),
    process.resourcesPath ? path.join(process.resourcesPath, 'scraper') : ''
  ].filter(Boolean);

  const resolved = candidates.find((candidate) =>
    existsSync(path.join(candidate, 'src', 'task-runner.js'))
  );
  if (!resolved) {
    throw new Error('未找到内置采集器，请确认项目内 scraper 目录或完整版采集资源存在。');
  }

  return resolved;
}

function resolveSharedCompareAppDir() {
  return path.resolve(__dirname, '..', '..', '..', 'shared', 'compare-app');
}

function resolveScraperWorkDir(dataFolderPath, scraperPath = resolveScraperPath()) {
  if (isBundledWithScraper()) {
    return path.join(dataFolderPath, 'scraper-data');
  }

  return scraperPath;
}

function ensureScraperRuntimeDirs(workDir) {
  if (isBundledWithScraper()) {
    ensureBundledBootstrapResources();
  }

  [
    path.join(workDir, 'state', 'edge-profile'),
    path.join(workDir, 'output'),
    path.join(workDir, 'output', 'raw-pages')
  ].forEach((dir) => fs.mkdirSync(dir, { recursive: true }));
}

function applyScraperVendorPath(scraperPath) {
  const vendorPath = path.join(scraperPath, 'vendor');
  if (!fs.existsSync(vendorPath)) {
    return () => {};
  }

  const previousNodePath = process.env.NODE_PATH;
  const currentPaths = previousNodePath
    ? previousNodePath.split(path.delimiter).filter(Boolean)
    : [];
  if (!currentPaths.includes(vendorPath)) {
    process.env.NODE_PATH = [vendorPath, ...currentPaths].join(path.delimiter);
    Module._initPaths();
  }

  return () => {
    if (previousNodePath === undefined) {
      delete process.env.NODE_PATH;
    } else {
      process.env.NODE_PATH = previousNodePath;
    }
    Module._initPaths();
  };
}

async function withScraperEnvironment(dataFolderPath, scraperPath, task) {
  const previousDataDir = process.env.HOTEL_COMPARE_APP_DATA_DIR;
  const previousSharedDir = process.env.HOTEL_COMPARE_SHARED_DIR;
  const restoreVendorPath = applyScraperVendorPath(scraperPath);

  process.env.HOTEL_COMPARE_APP_DATA_DIR = dataFolderPath;
  process.env.HOTEL_COMPARE_SHARED_DIR = resolveSharedCompareAppDir();

  try {
    return await task();
  } finally {
    if (previousDataDir === undefined) {
      delete process.env.HOTEL_COMPARE_APP_DATA_DIR;
    } else {
      process.env.HOTEL_COMPARE_APP_DATA_DIR = previousDataDir;
    }

    if (previousSharedDir === undefined) {
      delete process.env.HOTEL_COMPARE_SHARED_DIR;
    } else {
      process.env.HOTEL_COMPARE_SHARED_DIR = previousSharedDir;
    }
    restoreVendorPath();
  }
}

async function loadScraperModule(scraperPath, moduleFile) {
  const modulePath = path.join(scraperPath, 'src', moduleFile);
  const cacheKey = path.resolve(modulePath);
  if (!scraperModuleCache.has(cacheKey)) {
    scraperModuleCache.set(
      cacheKey,
      import(pathToFileURL(modulePath).href)
        .then((module) => module.default || module)
        .catch((error) => {
          scraperModuleCache.delete(cacheKey);
          const message = error && error.message ? error.message : String(error || '未知错误');
          throw new Error(`采集模块加载失败（${moduleFile}）：${message}`);
        })
    );
  }

  return scraperModuleCache.get(cacheKey);
}

function resolveRootPerfLogDir() {
  return path.resolve('logs', 'perf');
}

module.exports = {
  ensureScraperRuntimeDirs,
  loadScraperModule,
  resolveEmbeddedScraperPath,
  resolveRootPerfLogDir,
  resolveScraperPath,
  resolveScraperWorkDir,
  withScraperEnvironment
};
