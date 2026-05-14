const fs = require('fs');
const os = require('os');
const path = require('path');
const { BUNDLE_RESOURCE_MAP, PROMPT_CONTRACT } = require('../../shared/compare-app/prompt-contract');
const { copyDirSync, copyFileSync } = require('./utils');
const { getBundleManifest } = require('./bundle-manifest');

function findPromptGuideFile(scraperDir) {
  const entries = fs.readdirSync(scraperDir, { withFileTypes: true });
  const guide = entries.find((entry) => entry.isFile() && /^00-.*\.md$/i.test(entry.name));
  return guide ? path.join(scraperDir, guide.name) : '';
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

  if (fs.existsSync(path.join(scraperDir, 'examples'))) {
    copyDirSync(path.join(scraperDir, 'examples'), path.join(manifest.directories.scraperRoot, 'examples'));
  }
  if (fs.existsSync(path.join(scraperDir, 'node_modules'))) {
    copyDirSync(path.join(scraperDir, 'node_modules'), path.join(manifest.directories.scraperRoot, 'node_modules'));
  }

  return {
    bundleRoot,
    manifest
  };
}

module.exports = {
  prepareFullBundle
};
