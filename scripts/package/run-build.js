const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const readline = require('readline/promises');
const { createBuilderConfig } = require('./create-builder-config');
const { getSetupArtifactName, normalizeAmapKeyMode } = require('./bundle-manifest');
const { prepareFullBundle } = require('./prepare-full-bundle');
const { verifyPackageLayout } = require('./verify-package-layout');
const { removeIfExists, resolveWindowsCommand, runCommand } = require('./utils');

function parseBuildOptions(argv = process.argv.slice(2), env = process.env) {
  const envAmapKeyMode = env.HOTEL_PACKAGE_AMAP_KEY_MODE || '';
  let amapKeyMode = normalizeAmapKeyMode(envAmapKeyMode || 'none');
  let hasExplicitAmapKeyMode = Boolean(envAmapKeyMode);
  let selectAmapKeyMode = false;

  for (const arg of argv) {
    const normalized = String(arg || '').trim();
    if (normalized === '--select-amap-key') {
      selectAmapKeyMode = true;
      continue;
    }
    if (normalized === '--no-amap-key' || normalized === '--without-amap-key') {
      amapKeyMode = 'none';
      hasExplicitAmapKeyMode = true;
      continue;
    }
    if (normalized === '--with-amap-key') {
      amapKeyMode = 'embedded';
      hasExplicitAmapKeyMode = true;
      continue;
    }
    const match = normalized.match(/^--amap-key(?:-mode)?=(.+)$/);
    if (match) {
      amapKeyMode = normalizeAmapKeyMode(match[1]);
      hasExplicitAmapKeyMode = true;
    }
  }

  return {
    amapKeyMode,
    selectAmapKeyMode: selectAmapKeyMode && !hasExplicitAmapKeyMode
  };
}

function runElectronBuilder({ projectRoot, configPath, outputDir, maxAttempts = 2 }) {
  const electronBuilderCli = path.join(projectRoot, 'node_modules', 'electron-builder', 'cli.js');
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      runCommand(
        process.execPath,
        [
          electronBuilderCli,
          '--win',
          'nsis',
          '--x64',
          '--publish',
          'never',
          '--config',
          configPath
        ],
        {
          cwd: projectRoot
        }
      );
      return;
    } catch (error) {
      if (attempt >= maxAttempts) {
        throw error;
      }
      console.warn(`electron-builder 第 ${attempt} 次运行失败，清理临时输出后重试...`);
      removeIfExists(outputDir);
      fs.mkdirSync(outputDir, { recursive: true });
    }
  }
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

async function selectAmapKeyMode(defaultMode = 'none', streams = {}) {
  const input = streams.input || process.stdin;
  const output = streams.output || process.stdout;
  const normalizedDefault = normalizeAmapKeyMode(defaultMode);

  if (!input.isTTY && !streams.force) {
    return normalizedDefault;
  }

  const rl = readline.createInterface({ input, output });
  try {
    output.write('\n请选择高德 API Key 打包模式：\n');
    output.write('  1. 不包含默认高德 Key（推荐公开发布）\n');
    output.write('  2. 包含默认高德 Key\n');
    const answer = String(await rl.question('请输入 1 或 2（默认 1）：')).trim();
    return answer === '2' ? 'embedded' : 'none';
  } finally {
    rl.close();
  }
}

function printHeader(version, options = {}) {
  const divider = '='.repeat(48);
  console.log(divider);
  console.log(`  宾馆比较助手打包工具 v${version}`);
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

function isAsciiPath(targetPath) {
  return [...String(targetPath || '')].every((char) => char.charCodeAt(0) <= 0x7f);
}

function getAsciiTempBaseDir(env = process.env) {
  const systemDrive = env.SystemDrive || env.SYSTEMDRIVE || 'C:';
  const candidates = [
    os.tmpdir(),
    env.PUBLIC && path.join(env.PUBLIC, 'HotelComparisonBuildTemp'),
    path.join(systemDrive, 'Temp', 'HotelComparisonBuildTemp')
  ].filter(Boolean);

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (!isAsciiPath(resolved)) {
      continue;
    }
    try {
      fs.mkdirSync(resolved, { recursive: true });
      fs.accessSync(resolved, fs.constants.W_OK);
      return resolved;
    } catch (_error) {
      // Continue to the next ASCII-only writable location.
    }
  }

  throw new Error('未找到可写的纯 ASCII 临时目录，无法安全运行 Windows 安装包构建');
}

function createTempBuildDir() {
  return fs.mkdtempSync(path.join(getAsciiTempBaseDir(), 'hotel-comparison-output-'));
}

function createAsciiBuildWorkspace(projectRoot) {
  const workspaceRoot = fs.mkdtempSync(path.join(getAsciiTempBaseDir(), 'hotel-comparison-build-'));
  const projectAliasRoot = path.join(workspaceRoot, 'project');
  const tempBuildDir = path.join(workspaceRoot, 'output');
  const configDir = path.join(workspaceRoot, 'config');

  fs.symlinkSync(projectRoot, projectAliasRoot, process.platform === 'win32' ? 'junction' : 'dir');
  fs.mkdirSync(tempBuildDir, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });

  return {
    workspaceRoot,
    projectAliasRoot,
    tempBuildDir,
    configDir
  };
}

function removeAsciiBuildWorkspace(workspace) {
  if (!workspace) {
    return;
  }
  if (workspace.projectAliasRoot && fs.existsSync(workspace.projectAliasRoot)) {
    fs.unlinkSync(workspace.projectAliasRoot);
  }
  removeIfExists(workspace.workspaceRoot);
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..', '..');
  const scraperDir = path.resolve(projectRoot, 'scraper');
  const buildWorkspace = createAsciiBuildWorkspace(projectRoot);
  const { projectAliasRoot, tempBuildDir, configDir } = buildWorkspace;
  const buildOptions = parseBuildOptions();

  let preparedBundle = null;
  let builderConfig = null;

  try {
    if (buildOptions.selectAmapKeyMode) {
      buildOptions.amapKeyMode = await selectAmapKeyMode(buildOptions.amapKeyMode);
    }

    syncAppInfo(projectRoot);
    const { APP_INFO } = require('../../src/shared/app-info.generated');
    const version = APP_INFO.version;

    printHeader(version, buildOptions);
    console.log('[1/1] 开始打包\n');

    console.log('正在检查依赖...');
    ensureNodeModules(projectRoot);

    console.log('正在同步构建资源...');
    syncBuildAssets(projectRoot);

    console.log('正在准备内置采集模块资源...');
    preparedBundle = prepareFullBundle({
      projectRoot,
      scraperDir,
      amapKeyMode: buildOptions.amapKeyMode,
      tempBaseDir: buildWorkspace.workspaceRoot
    });

    console.log('正在生成打包配置...');
    builderConfig = createBuilderConfig({
      projectRoot: projectAliasRoot,
      outputDir: tempBuildDir,
      extraResources: preparedBundle.manifest.extraResources,
      configDir
    });
    useAsciiInstallerArtifactName({
      builderConfig,
      version
    });

    console.log('正在运行 electron-builder...');
    runElectronBuilder({
      projectRoot: projectAliasRoot,
      configPath: builderConfig.configPath,
      outputDir: tempBuildDir
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
    if (preparedBundle && preparedBundle.bundleRoot) {
      removeIfExists(preparedBundle.bundleRoot);
    }
    removeAsciiBuildWorkspace(buildWorkspace);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  createAsciiBuildWorkspace,
  createTempBuildDir,
  getAmapKeyModeLabel,
  getAsciiTempBaseDir,
  isAsciiPath,
  parseBuildOptions,
  removeAsciiBuildWorkspace,
  selectAmapKeyMode
};
