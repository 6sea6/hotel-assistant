const fs = require('fs');
const path = require('path');
const { createBuilderConfig } = require('./create-builder-config');
const { prepareFullBundle } = require('./prepare-full-bundle');
const { verifyPackageLayout } = require('./verify-package-layout');
const { removeIfExists, runCommand } = require('./utils');

function runNodeScriptIfPresent(scriptPath, cwd) {
  if (!fs.existsSync(scriptPath)) return;
  runCommand(process.execPath, [scriptPath], { cwd });
}

function runElectronBuilderDirectoryBuild({ projectRoot, configPath }) {
  const electronBuilderCli = path.join(projectRoot, 'node_modules', 'electron-builder', 'cli.js');
  runCommand(
    process.execPath,
    [electronBuilderCli, '--win', '--x64', '--dir', '--publish', 'never', '--config', configPath],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        CSC_IDENTITY_AUTO_DISCOVERY: 'false'
      }
    }
  );
}

function main() {
  if (process.platform !== 'win32') {
    console.log('Windows packaging smoke test skipped: this script only runs on Windows.');
    return;
  }

  const projectRoot = path.resolve(__dirname, '..', '..');
  const scraperDir = path.join(projectRoot, 'scraper');
  const outputDir = path.join(projectRoot, 'dist-smoke');
  let builderConfig = null;
  let preparedBundle = null;

  try {
    runNodeScriptIfPresent(path.join(projectRoot, 'scripts', 'sync-build-assets.js'), projectRoot);
    removeIfExists(outputDir);

    preparedBundle = prepareFullBundle({
      projectRoot,
      scraperDir
    });

    builderConfig = createBuilderConfig({
      projectRoot,
      outputDir,
      extraResources: preparedBundle.manifest.extraResources
    });

    builderConfig.buildConfig.win = {
      ...(builderConfig.buildConfig.win || {}),
      signAndEditExecutable: false
    };
    builderConfig.buildConfig.directories.output = outputDir;
    fs.writeFileSync(
      builderConfig.configPath,
      `${JSON.stringify(builderConfig.buildConfig, null, 2)}\n`,
      'utf-8'
    );

    runElectronBuilderDirectoryBuild({
      projectRoot,
      configPath: builderConfig.configPath
    });

    verifyPackageLayout({
      tempBuildDir: outputDir
    });

    console.log('Windows packaging smoke test passed.');
  } finally {
    if (builderConfig && builderConfig.configPath) {
      removeIfExists(builderConfig.configPath);
    }
    if (process.env.KEEP_SMOKE_BUILD !== 'true') {
      removeIfExists(outputDir);
    }
    if (preparedBundle && preparedBundle.bundleRoot) {
      removeIfExists(preparedBundle.bundleRoot);
    }
  }
}

main();
