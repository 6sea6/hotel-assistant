const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createBuilderConfig } = require('./create-builder-config');
const { getSetupArtifactName } = require('./bundle-manifest');
const { prepareFullBundle } = require('./prepare-full-bundle');
const { verifyPackageLayout } = require('./verify-package-layout');
const {
  removeIfExists,
  resolveWindowsCommand,
  runCommand
} = require('./utils');

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

function runPowerShellScript(scriptPath, cwd) {
  runCommand('powershell', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath
  ], { cwd });
}

function runElectronBuilder({ projectRoot, configPath }) {
  const electronBuilderBin = path.join(projectRoot, 'node_modules', '.bin', resolveWindowsCommand('electron-builder'));
  runCommand(electronBuilderBin, ['--win', 'nsis', '--x64', '--publish', 'never', '--config', configPath], {
    cwd: projectRoot
  });
}

function copyFinalInstaller({ projectRoot, tempBuildDir, version, mode }) {
  const distDir = path.join(projectRoot, 'dist');
  fs.mkdirSync(distDir, { recursive: true });

  const setupName = getSetupArtifactName(mode, version);
  const targetPath = path.join(distDir, setupName);
  const lastSetupFilePath = path.join(distDir, 'last-successful-setup.txt');
  const sourceEntry = fs.readdirSync(tempBuildDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.exe') && /setup/i.test(entry.name))
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

function ensureNodeModules(projectRoot) {
  if (fs.existsSync(path.join(projectRoot, 'node_modules'))) {
    return;
  }

  runCommand(resolveWindowsCommand('npm'), ['ci', '--prefer-offline', '--no-audit', '--progress=false', '--fund=false', '--loglevel=error'], {
    cwd: projectRoot
  });
}

function main() {
  const argv = process.argv.slice(2);
  const mode = getArgValue(argv, '--mode', '-m') || argv[0] || '1';
  const projectRoot = path.resolve(__dirname, '..', '..');
  const scraperDir = path.resolve(projectRoot, '..', '2');
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
  const version = packageJson.version;
  const tempBuildDir = path.join(projectRoot, `dist-verify-build-${process.pid}-${Date.now()}`);

  let preparedBundle = null;
  let builderConfig = null;

  try {
    ensureNodeModules(projectRoot);
    runPowerShellScript(path.join(projectRoot, 'scripts', 'sync-build-assets.ps1'), projectRoot);

    if (mode === '2') {
      preparedBundle = prepareFullBundle({
        projectRoot,
        scraperDir
      });
    }

    builderConfig = createBuilderConfig({
      projectRoot,
      mode,
      outputDir: tempBuildDir,
      extraResources: preparedBundle ? preparedBundle.manifest.extraResources : []
    });

    runElectronBuilder({
      projectRoot,
      configPath: builderConfig.configPath
    });

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
      spawnSync('powershell', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        refreshScript,
        finalInstaller
      ], { cwd: projectRoot, stdio: 'inherit' });
    }

    console.log(finalInstaller);
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
