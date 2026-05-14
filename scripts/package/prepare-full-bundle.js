const fs = require('fs');
const os = require('os');
const path = require('path');
const { PROMPT_CONTRACT } = require('../../shared/compare-app/prompt-contract');
const { copyDirSync, copyFileSync } = require('./utils');
const { getBundleManifest } = require('./bundle-manifest');

function findPromptGuideFile(scraperDir) {
  const entries = fs.readdirSync(scraperDir, { withFileTypes: true });
  const guide = entries.find((entry) => entry.isFile() && /^00-.*\.md$/i.test(entry.name));
  return guide ? path.join(scraperDir, guide.name) : '';
}

function getPackageDir(nodeModulesDir, packageName) {
  return path.join(nodeModulesDir, ...packageName.split('/'));
}

function readPackageJson(packageDir) {
  return JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf-8'));
}

function getProductionDependencyNames(packageJson = {}) {
  return Object.keys(packageJson.dependencies || {});
}

function copyProductionDependencyTree({ sourceNodeModules, targetNodeModules, dependencyNames, seen = new Set() }) {
  dependencyNames.forEach((dependencyName) => {
    if (!dependencyName || seen.has(dependencyName)) {
      return;
    }
    seen.add(dependencyName);

    const sourceDir = getPackageDir(sourceNodeModules, dependencyName);
    if (!fs.existsSync(path.join(sourceDir, 'package.json'))) {
      throw new Error(`未找到采集器依赖 ${dependencyName}，请先在根目录运行 npm install`);
    }

    const targetDir = getPackageDir(targetNodeModules, dependencyName);
    copyDirSync(sourceDir, targetDir);

    const dependencyPackage = readPackageJson(sourceDir);
    const childDependencies = [
      ...Object.keys(dependencyPackage.dependencies || {}),
      ...Object.keys(dependencyPackage.optionalDependencies || {})
    ].filter((name) => fs.existsSync(path.join(getPackageDir(sourceNodeModules, name), 'package.json')));

    copyProductionDependencyTree({
      sourceNodeModules,
      targetNodeModules,
      dependencyNames: childDependencies,
      seen
    });
  });
}

function prepareFullBundle({ projectRoot, scraperDir }) {
  const promptGuideFile = findPromptGuideFile(scraperDir);
  if (!fs.existsSync(path.join(scraperDir, 'src', 'cli.js'))) {
    throw new Error(`未找到采集器入口: ${path.join(scraperDir, 'src', 'cli.js')}`);
  }
  if (!promptGuideFile) {
    throw new Error(`未在 ${scraperDir} 找到统一提示词文件`);
  }

  const bundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-full-bundle-'));
  const manifest = getBundleManifest(bundleRoot);

  copyDirSync(path.join(scraperDir, 'src'), path.join(manifest.directories.scraperRoot, 'src'));
  copyFileSync(path.join(scraperDir, 'package.json'), path.join(manifest.directories.scraperRoot, 'package.json'));
  copyFileSync(path.join(scraperDir, 'README.md'), path.join(manifest.directories.scraperRoot, 'README.md'));
  copyFileSync(promptGuideFile, path.join(manifest.directories.scraperRoot, path.basename(promptGuideFile)));

  const scraperPackageJson = readPackageJson(scraperDir);
  copyProductionDependencyTree({
    sourceNodeModules: path.join(projectRoot, 'node_modules'),
    targetNodeModules: path.join(manifest.directories.scraperRoot, 'vendor'),
    dependencyNames: getProductionDependencyNames(scraperPackageJson)
  });

  return {
    bundleRoot,
    manifest
  };
}

module.exports = {
  prepareFullBundle
};
