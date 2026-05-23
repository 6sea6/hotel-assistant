const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const readline = require('readline');
const { createBuilderConfig } = require('./create-builder-config');
const { getSetupArtifactName } = require('./bundle-manifest');
const { prepareFullBundle } = require('./prepare-full-bundle');
const { verifyPackageLayout } = require('./verify-package-layout');
const { removeIfExists, resolveWindowsCommand, runCommand } = require('./utils');

function getArgValue(argv, ...keys) {
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (keys.includes(value)) {
      return argv[index + 1] || '';
    }
    for (const key of keys) {
      if (value.startsWith(`${key}=`)) {
        return value.slice(key.length + 1);
      }
    }
  }
  return '';
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

function copyFinalInstaller({ projectRoot, tempBuildDir, version, mode }) {
  const distDir = path.join(projectRoot, 'dist');
  fs.mkdirSync(distDir, { recursive: true });

  const setupName = getSetupArtifactName(mode, version);
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

function promptBuildMode(version) {
  const divider = '='.repeat(48);
  console.log(divider);
  console.log(`  宾馆比较终极版打包工具 v${version}`);
  console.log(divider);
  console.log('');
  console.log('[1/2] 选择打包模式');
  console.log('');
  console.log('  1. 基础版安装包');
  console.log('  2. 完整版安装包（包含采集模块资源）');
  console.log('');

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question('请选择打包模式（1/2，默认 1）：', (answer) => {
      rl.close();
      const trimmed = answer.trim();
      resolve(trimmed === '2' ? '2' : '1');
    });
  });
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

async function main() {
  const argv = process.argv.slice(2);
  const argMode = getArgValue(argv, '--mode', '-m') || argv[0] || '';
  const projectRoot = path.resolve(__dirname, '..', '..');
  const scraperDir = path.resolve(projectRoot, 'scraper');
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
  const version = packageJson.version;
  const tempBuildDir = path.join(projectRoot, `dist-verify-build-${process.pid}-${Date.now()}`);

  const mode = argMode || (await promptBuildMode(version));

  let preparedBundle = null;
  let builderConfig = null;

  try {
    console.log('\n[2/2] 开始打包\n');

    console.log('正在检查依赖...');
    ensureNodeModules(projectRoot);

    console.log('正在同步构建资源...');
    syncBuildAssets(projectRoot);

    if (mode === '2') {
      console.log('正在准备完整版采集模块资源...');
      preparedBundle = prepareFullBundle({
        projectRoot,
        scraperDir
      });
    }

    console.log('正在生成打包配置...');
    builderConfig = createBuilderConfig({
      projectRoot,
      mode,
      outputDir: tempBuildDir,
      extraResources: preparedBundle ? preparedBundle.manifest.extraResources : []
    });

    console.log('正在运行 electron-builder...');
    runElectronBuilder({
      projectRoot,
      configPath: builderConfig.configPath
    });

    console.log('正在校验安装包资源...');
    verifyPackageLayout({
      tempBuildDir,
      mode
    });

    const finalInstaller = copyFinalInstaller({
      projectRoot,
      tempBuildDir,
      version,
      mode
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

main();
