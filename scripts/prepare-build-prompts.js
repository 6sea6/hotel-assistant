const fs = require('fs');
const path = require('path');

const { getDefaultPrompt } = require('../src/main/default-prompts');
const { APP_CONFIG } = require('../src/main/config');

const projectRoot = path.resolve(__dirname, '..');
const outputDir = path.join(projectRoot, 'build', 'compare-app');
const outputPath = path.join(outputDir, 'ai-prompts.json');
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

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(prompts, null, 2)}\n`, 'utf-8');

console.log(`[prepare-build-prompts] 已生成 ${outputPath}`);
