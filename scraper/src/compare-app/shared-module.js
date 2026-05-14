const fs = require('fs');
const path = require('path');

function resolveSharedCompareAppModule(moduleFile, options = {}) {
  const existsSync = options.existsSync || fs.existsSync;
  const currentDir = options.currentDir || __dirname;
  const explicitSharedDir = options.sharedDir || process.env.HOTEL_COMPARE_SHARED_DIR || '';
  const resourcesPath = options.resourcesPath || process.resourcesPath || '';
  const candidates = [
    explicitSharedDir ? path.join(explicitSharedDir, moduleFile) : '',
    path.resolve(currentDir, '..', '..', '..', '1', 'shared', 'compare-app', moduleFile),
    path.resolve(currentDir, '..', '..', '..', 'shared', 'compare-app', moduleFile),
    resourcesPath ? path.join(resourcesPath, 'shared', 'compare-app', moduleFile) : ''
  ].filter(Boolean);

  const resolved = candidates.find((candidate) => existsSync(candidate));
  if (!resolved) {
    throw new Error(`无法解析比较助手共享模块：${moduleFile}`);
  }

  return resolved;
}

function requireSharedCompareAppModule(moduleFile) {
  return require(resolveSharedCompareAppModule(moduleFile));
}

module.exports = {
  requireSharedCompareAppModule,
  resolveSharedCompareAppModule
};
