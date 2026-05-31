const fs = require('fs');
const path = require('path');
const { getBundleManifest } = require('./bundle-manifest');

function getAllowedElectronLanguages() {
  const packageJsonPath = path.resolve(__dirname, '..', '..', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  return Array.isArray(packageJson.build && packageJson.build.electronLanguages)
    ? packageJson.build.electronLanguages
    : [];
}

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

function verifyElectronLocales(tempBuildDir) {
  const allowedLanguages = getAllowedElectronLanguages();
  const localesDir = path.join(tempBuildDir, 'win-unpacked', 'locales');
  if (allowedLanguages.length === 0 || !fs.existsSync(localesDir)) {
    return;
  }

  const allowedSet = new Set(allowedLanguages);
  const localeFiles = fs
    .readdirSync(localesDir)
    .filter((fileName) => path.extname(fileName) === '.pak');

  for (const language of allowedLanguages) {
    if (!localeFiles.includes(`${language}.pak`)) {
      throw new Error(`缺少 Electron 语言包: ${language}.pak`);
    }
  }

  const unexpectedLocales = localeFiles.filter(
    (fileName) => !allowedSet.has(path.basename(fileName, '.pak'))
  );
  if (unexpectedLocales.length > 0) {
    throw new Error(`不应存在的 Electron 语言包: ${unexpectedLocales.join(', ')}`);
  }
}

function verifyPackageLayout({ tempBuildDir }) {
  const resourcesDir = path.join(tempBuildDir, 'win-unpacked', 'resources');
  if (!fs.existsSync(resourcesDir)) {
    throw new Error(`未找到 unpacked resources 目录: ${resourcesDir}`);
  }

  const manifest = getBundleManifest(path.join(tempBuildDir, '_unused-manifest-root'));
  manifest.expectations.sharedResources.forEach((relativePath) =>
    assertExists(resourcesDir, relativePath)
  );
  (manifest.expectations.neverResources || []).forEach((relativePath) =>
    assertMissing(resourcesDir, relativePath)
  );

  manifest.expectations.fullOnlyResources.forEach((relativePath) =>
    assertExists(resourcesDir, relativePath)
  );
  verifyElectronLocales(tempBuildDir);

  return {
    resourcesDir,
    mode: '2'
  };
}

module.exports = {
  verifyPackageLayout
};
