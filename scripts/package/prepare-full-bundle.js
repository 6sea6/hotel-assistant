const fs = require('fs');
const os = require('os');
const path = require('path');
const { getDefaultPrompt } = require('../../src/main/default-prompts');
const { APP_CONFIG } = require('../../src/main/config');
const { BUNDLE_RESOURCE_MAP, PROMPT_CONTRACT } = require('../../shared/compare-app/prompt-contract');
const { copyDirSync, copyFileSync, ensureDir } = require('./utils');
const { getBundleManifest } = require('./bundle-manifest');

function findPromptGuideFile(scraperDir) {
  const entries = fs.readdirSync(scraperDir, { withFileTypes: true });
  const guide = entries.find((entry) => entry.isFile() && /^00-.*\.md$/i.test(entry.name));
  return guide ? path.join(scraperDir, guide.name) : '';
}

function writePromptSeed(targetPath) {
  const defaultUpdatedAt = new Date(`${APP_CONFIG.RELEASE_DATE}T00:00:00.000Z`).toISOString();
  const prompts = {
    protective: {
      content: getDefaultPrompt('protective'),
      updatedAt: defaultUpdatedAt
    },
    guide: {
      content: getDefaultPrompt('guide', { dataPath: '当前数据目录中的 hotel-data.json' }),
      updatedAt: defaultUpdatedAt
    },
    optimize: {
      content: getDefaultPrompt('optimize'),
      updatedAt: defaultUpdatedAt
    }
  };

  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, `${JSON.stringify(prompts, null, 2)}\n`, 'utf-8');
}

function prepareFullBundle({ projectRoot, scraperDir }) {
  const skillDir = path.join(scraperDir, '.workbuddy', 'skills', PROMPT_CONTRACT.bundledSkillName);
  const promptGuideFile = findPromptGuideFile(scraperDir);
  if (!fs.existsSync(path.join(scraperDir, 'src', 'cli.js'))) {
    throw new Error(`未找到采集器入口: ${path.join(scraperDir, 'src', 'cli.js')}`);
  }
  if (!fs.existsSync(skillDir) || !fs.existsSync(path.join(skillDir, PROMPT_CONTRACT.bundledSkillEntryFileName))) {
    throw new Error(`未找到 Skill 目录: ${skillDir}`);
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

  copyDirSync(skillDir, manifest.directories.skillRoot);
  writePromptSeed(path.join(manifest.directories.compareAppRoot, PROMPT_CONTRACT.compareAppPromptsFileName));

  return {
    bundleRoot,
    manifest
  };
}

module.exports = {
  prepareFullBundle
};
