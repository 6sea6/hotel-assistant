const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createBuilderConfig } = require('./create-builder-config');
const { getSetupArtifactName, normalizeAmapKeyMode } = require('./bundle-manifest');
const { prepareFullBundle } = require('./prepare-full-bundle');
const { verifyPackageLayout } = require('./verify-package-layout');
const { removeIfExists, resolveWindowsCommand, runCommand } = require('./utils');

function parseBuildOptions(argv = process.argv.slice(2), env = process.env) {
  let amapKeyMode = normalizeAmapKeyMode(env.HOTEL_PACKAGE_AMAP_KEY_MODE || 'embedded');

  for (const arg of argv) {
    const normalized = String(arg || '').trim();
    if (normalized === '--no-amap-key' || normalized === '--without-amap-key') {
      amapKeyMode = 'none';
      continue;
    }
    if (normalized === '--with-amap-key') {
      amapKeyMode = 'embedded';
      continue;
    }
    const match = normalized.match(/^--amap-key(?:-mode)?=(.+)$/);
    if (match) {
      amapKeyMode = normalizeAmapKeyMode(match[1]);
    }
  }

  return {
    amapKeyMode
  };
}

function runElectronBuilder({ projectRoot, configPath }) {
  const electronBuilderBin = path.join(
    projectRoot,
    'node_modules',
    '.bin',
    resolveWindowsCommand('electron-builder')
  );
  runCommand(
    electronBuilderBin,
    ['--win', 'nsis', '--x64', '--publish', 'never', '--config', configPath],
    {
      cwd: projectRoot
    }
  );
}

function copyFinalInstaller({ projectRoot, tempBuildDir, version, amapKeyMode }) {
  const distDir = path.join(projectRoot, 'dist');
  fs.mkdirSync(distDir, { recursive: true });

  const setupName = getSetupArtifactName(version, { amapKeyMode });
  const targetPath = path.join(distDir, setupName);
  const lastSetupFilePath = path.join(distDir, 'last-successful-setup.txt');
  const sourceEntry = fs
    .readdirSync(tempBuildDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && entry.name.toLowerCase().endsWith('.exe') && /setup/i.test(entry.name)
    )
    .map((entry) => ({
      name: entry.name,
      fullPath: path.join(tempBuildDir, entry.name),
      stat: fs.statSync(path.join(tempBuildDir, entry.name))
    }))
    .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs)[0];

  if (!sourceEntry) {
    throw new Error(`未在 ${tempBuildDir} 找到安装包 exe`);
  }

  removeIfExists(targetPath);
  fs.copyFileSync(sourceEntry.fullPath, targetPath);
  fs.writeFileSync(
    lastSetupFilePath,
    `${path.relative(projectRoot, targetPath).replaceAll('/', '\\')}\r\n`,
    'utf-8'
  );

  return targetPath;
}

function useAsciiInstallerArtifactName({ builderConfig, version }) {
  builderConfig.buildConfig.artifactName = `hotel-comparison-app-${version}-setup.\${ext}`;
  fs.writeFileSync(
    builderConfig.configPath,
    `${JSON.stringify(builderConfig.buildConfig, null, 2)}\n`,
    'utf-8'
  );
}

function getAmapKeyModeLabel(amapKeyMode) {
  return normalizeAmapKeyMode(amapKeyMode) === 'none' ? '不含默认高德 Key' : '包含默认高德 Key';
}

function printHeader(version, options = {}) {
  const divider = '='.repeat(48);
  console.log(divider);
  console.log(`  宾馆比较终极版打包工具 v${version}`);
  console.log(`  高德 Key 模式：${getAmapKeyModeLabel(options.amapKeyMode)}`);
  console.log(divider);
  console.log('');
}

function ensureNodeModules(projectRoot) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
  const scraperPackageJsonPath = path.join(projectRoot, 'scraper', 'package.json');
  const scraperPackageJson = fs.existsSync(scraperPackageJsonPath)
    ? JSON.parse(fs.readFileSync(scraperPackageJsonPath, 'utf-8'))
    : {};
  const requiredPackages = [
    ...Object.keys(packageJson.dependencies || {}),
    ...Object.keys(scraperPackageJson.dependencies || {})
  ];
  const hasAllPackages = requiredPackages.every((packageName) =>
    fs.existsSync(path.join(projectRoot, 'node_modules', ...packageName.split('/'), 'package.json'))
  );

  if (fs.existsSync(path.join(projectRoot, 'node_modules')) && hasAllPackages) {
    return;
  }

  runCommand(
    resolveWindowsCommand('npm'),
    [
      'ci',
      '--prefer-offline',
      '--no-audit',
      '--progress=false',
      '--fund=false',
      '--loglevel=error'
    ],
    {
      cwd: projectRoot
    }
  );
}

function syncBuildAssets(projectRoot) {
  runCommand(process.execPath, [path.join(projectRoot, 'scripts', 'sync-build-assets.js')], {
    cwd: projectRoot
  });
}

function syncAppInfo(projectRoot) {
  runCommand(process.execPath, [path.join(projectRoot, 'scripts', 'sync-app-info.js')], {
    cwd: projectRoot
  });
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..', '..');
  const scraperDir = path.resolve(projectRoot, 'scraper');
  const tempBuildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-verify-build-'));
  const buildOptions = parseBuildOptions();

  let preparedBundle = null;
  let builderConfig = null;

  try {
    syncAppInfo(projectRoot);
    const { APP_INFO } = require('../../src/shared/app-info.generated');
    const version = APP_INFO.version;

    printHeader(version, buildOptions);
    console.log('[1/1] 开始打包\n');

    console.log('正在检查依赖...');
    ensureNodeModules(projectRoot);

    console.log('正在同步构建资源...');
    syncBuildAssets(projectRoot);

    console.log('正在准备完整版采集模块资源...');
    preparedBundle = prepareFullBundle({
      projectRoot,
      scraperDir,
      amapKeyMode: buildOptions.amapKeyMode
    });

    console.log('正在生成打包配置...');
    builderConfig = createBuilderConfig({
      projectRoot,
      outputDir: tempBuildDir,
      extraResources: preparedBundle.manifest.extraResources
    });
    useAsciiInstallerArtifactName({
      builderConfig,
      version
    });

    console.log('正在运行 electron-builder...');
    runElectronBuilder({
      projectRoot,
      configPath: builderConfig.configPath
    });

    console.log('正在校验安装包资源...');
    verifyPackageLayout({
      tempBuildDir
    });

    const finalInstaller = copyFinalInstaller({
      projectRoot,
      tempBuildDir,
      version,
      amapKeyMode: buildOptions.amapKeyMode
    });

    const refreshScript = path.join(projectRoot, 'scripts', 'refresh-shell-icons.ps1');
    if (fs.existsSync(refreshScript)) {
      spawnSync(
        'powershell',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', refreshScript, finalInstaller],
        { cwd: projectRoot, stdio: 'inherit' }
      );
    }

    console.log(`\n打包完成：${finalInstaller}`);
  } catch (error) {
    console.error('\n打包失败：', error.message || error);
    process.exitCode = 1;
  } finally {
    if (builderConfig && builderConfig.configPath) {
      removeIfExists(builderConfig.configPath);
    }
    if (tempBuildDir) {
      removeIfExists(tempBuildDir);
    }
    if (preparedBundle && preparedBundle.bundleRoot) {
      removeIfExists(preparedBundle.bundleRoot);
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  getAmapKeyModeLabel,
  parseBuildOptions
};
