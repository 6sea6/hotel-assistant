const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureDir } = require('./utils');

function createBuilderConfig({ projectRoot, mode, outputDir, extraResources = [] }) {
  const packageJsonPath = path.join(projectRoot, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  const buildConfig = {
    ...packageJson.build,
    directories: {
      ...packageJson.build.directories,
      output: outputDir
    },
    extraResources: [
      ...((packageJson.build && packageJson.build.extraResources) || []),
      ...(mode === '2' ? extraResources : [])
    ]
  };

  const tempDir = path.join(projectRoot, 'build', '_tmp-package-config');
  ensureDir(tempDir);
  const configPath = path.join(tempDir, `builder-config-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(configPath, `${JSON.stringify(buildConfig, null, 2)}\n`, 'utf-8');

  return {
    configPath,
    buildConfig,
    tempDir
  };
}

module.exports = {
  createBuilderConfig
};
