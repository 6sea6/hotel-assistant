const fs = require('fs');
const path = require('path');
const { getBundleManifest } = require('./bundle-manifest');

function assertExists(baseDir, relativePath) {
  const fullPath = path.join(baseDir, relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`缺少打包资源: ${relativePath}`);
  }
}

function assertMissing(baseDir, relativePath) {
  const fullPath = path.join(baseDir, relativePath);
  if (fs.existsSync(fullPath)) {
    throw new Error(`不应存在的打包资源: ${relativePath}`);
  }
}

function verifyPackageLayout({ tempBuildDir, mode }) {
  const resourcesDir = path.join(tempBuildDir, 'win-unpacked', 'resources');
  if (!fs.existsSync(resourcesDir)) {
    throw new Error(`未找到 unpacked resources 目录: ${resourcesDir}`);
  }

  const manifest = getBundleManifest(path.join(tempBuildDir, '_unused-manifest-root'));
  manifest.expectations.sharedResources.forEach((relativePath) => assertExists(resourcesDir, relativePath));

  if (mode === '2') {
    manifest.expectations.fullOnlyResources.forEach((relativePath) => assertExists(resourcesDir, relativePath));
  } else {
    manifest.expectations.baseOnlyAbsentResources.forEach((relativePath) => assertMissing(resourcesDir, relativePath));
  }

  return {
    resourcesDir,
    mode
  };
}

module.exports = {
  verifyPackageLayout
};
