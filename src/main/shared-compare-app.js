const fs = require('fs');
const path = require('path');

function resolveSharedCompareAppPath(moduleFile, options = {}) {
  const currentDir = options.currentDir || __dirname;
  const existsSync = options.existsSync || fs.existsSync;
  const resourcesPath = options.resourcesPath || process.resourcesPath || '';
  const packagedAdjacentPath = path.resolve(currentDir, '..', '..', '..', 'shared', 'compare-app', moduleFile);

  const workspacePath = path.resolve(currentDir, '..', '..', 'shared', 'compare-app', moduleFile);
  if (existsSync(workspacePath)) {
    return workspacePath;
  }

  if (existsSync(packagedAdjacentPath)) {
    return packagedAdjacentPath;
  }

  if (resourcesPath) {
    const packagedPath = path.join(resourcesPath, 'shared', 'compare-app', moduleFile);
    if (existsSync(packagedPath)) {
      return packagedPath;
    }
  }

  throw new Error(`Cannot resolve shared compare-app module: ${moduleFile}`);
}

function requireSharedCompareAppModule(moduleFile) {
  return require(resolveSharedCompareAppPath(moduleFile));
}

module.exports = {
  requireSharedCompareAppModule,
  resolveSharedCompareAppPath
};
