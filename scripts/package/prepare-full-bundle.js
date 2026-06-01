const fs = require('fs');
const os = require('os');
const path = require('path');
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

function copyProductionDependencyTree({
  sourceNodeModules,
  targetNodeModules,
  dependencyNames,
  seen = new Set()
}) {
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
    ].filter((name) =>
      fs.existsSync(path.join(getPackageDir(sourceNodeModules, name), 'package.json'))
    );

    copyProductionDependencyTree({
      sourceNodeModules,
      targetNodeModules,
      dependencyNames: childDependencies,
      seen
    });
  });
}

const VENDOR_PRUNE_DIR_NAMES = new Set([
  '.github',
  'benchmark',
  'benchmarks',
  'coverage',
  'demo',
  'demos',
  'doc',
  'docs',
  'example',
  'examples',
  'spec',
  'specs',
  'test',
  'tests',
  '__tests__'
]);

const VENDOR_PRUNE_FILE_NAMES = new Set([
  '.editorconfig',
  '.eslintignore',
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.json',
  '.gitattributes',
  '.gitignore',
  '.npmignore',
  '.prettierignore',
  '.prettierrc',
  '.prettierrc.json',
  'changelog',
  'changelog.md',
  'history',
  'history.md',
  'news',
  'news.md',
  'package-lock.json',
  'readme',
  'readme.md',
  'readme.txt',
  'tsconfig.json'
]);

const VENDOR_PRUNE_EXTENSIONS = new Set([
  '.cts',
  '.d.ts',
  '.iml',
  '.lock',
  '.map',
  '.markdown',
  '.md',
  '.mts',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml'
]);

function getRuntimeEntryText(packageJson = {}) {
  return JSON.stringify({
    main: packageJson.main,
    module: packageJson.module,
    browser: packageJson.browser,
    exports: packageJson.exports,
    bin: packageJson.bin
  });
}

function packageRuntimeReferencesSrc(packageJson = {}) {
  return /(?:^|["'./\\])src[\\/]/.test(getRuntimeEntryText(packageJson));
}

function hasCompiledRuntimeDir(packageDir) {
  return ['dist', 'lib', 'cjs', 'esm', 'build'].some((dirName) =>
    fs.existsSync(path.join(packageDir, dirName))
  );
}

function shouldPrunePackageSrcDir(packageDir, packageJson = {}) {
  return (
    fs.existsSync(path.join(packageDir, 'src')) &&
    hasCompiledRuntimeDir(packageDir) &&
    !packageRuntimeReferencesSrc(packageJson)
  );
}

function shouldPruneVendorFile(filePath) {
  const lowerName = path.basename(filePath).toLowerCase();
  if (VENDOR_PRUNE_FILE_NAMES.has(lowerName)) {
    return true;
  }
  if (/\.d\.[cm]?ts$/i.test(lowerName)) {
    return true;
  }
  return VENDOR_PRUNE_EXTENSIONS.has(path.extname(lowerName));
}

function findPackageDirs(rootDir) {
  const packageDirs = [];
  if (!fs.existsSync(rootDir)) {
    return packageDirs;
  }

  const visit = (dir) => {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      packageDirs.push(dir);
    }

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      visit(path.join(dir, entry.name));
    }
  };

  visit(rootDir);
  return packageDirs;
}

function pruneFilesRecursively(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return;
  }
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const targetPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      pruneFilesRecursively(targetPath);
      continue;
    }
    if (shouldPruneVendorFile(targetPath)) {
      fs.rmSync(targetPath, { force: true });
    }
  }
}

function pruneVendorPackageDevelopmentAssets(packageDir) {
  const packageJson = readPackageJson(packageDir);
  for (const dirName of VENDOR_PRUNE_DIR_NAMES) {
    const targetPath = path.join(packageDir, dirName);
    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }
  }
  if (shouldPrunePackageSrcDir(packageDir, packageJson)) {
    fs.rmSync(path.join(packageDir, 'src'), { recursive: true, force: true });
  }
  pruneFilesRecursively(packageDir);
}

function pruneCopiedVendorDevelopmentAssets(vendorDir) {
  findPackageDirs(vendorDir).forEach(pruneVendorPackageDevelopmentAssets);
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
  copyFileSync(
    path.join(scraperDir, 'package.json'),
    path.join(manifest.directories.scraperRoot, 'package.json')
  );
  copyFileSync(
    promptGuideFile,
    path.join(manifest.directories.scraperRoot, path.basename(promptGuideFile))
  );

  const scraperPackageJson = readPackageJson(scraperDir);
  copyProductionDependencyTree({
    sourceNodeModules: path.join(projectRoot, 'node_modules'),
    targetNodeModules: path.join(manifest.directories.scraperRoot, 'vendor'),
    dependencyNames: getProductionDependencyNames(scraperPackageJson)
  });
  pruneCopiedVendorDevelopmentAssets(path.join(manifest.directories.scraperRoot, 'vendor'));

  return {
    bundleRoot,
    manifest
  };
}

module.exports = {
  prepareFullBundle
};
