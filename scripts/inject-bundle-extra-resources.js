const fs = require('fs');
const path = require('path');

const packageJsonPath = path.join(process.cwd(), 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

if (!packageJson.build) {
  packageJson.build = {};
}

const extraResources = Array.isArray(packageJson.build.extraResources)
  ? packageJson.build.extraResources
  : [];

const addEntry = (entry) => {
  const exists = extraResources.some((item) => item && item.to === entry.to);
  if (!exists) {
    extraResources.push(entry);
  }
};

addEntry({
  from: '_bundle/scraper',
  to: 'scraper',
  filter: ['**/*', '!state/**', '!output/**'],
});

addEntry({
  from: '_bundle/skill',
  to: 'skill',
});

addEntry({
  from: 'build/compare-app/ai-prompts.json',
  to: 'compare-app/ai-prompts.json',
});

packageJson.build.extraResources = extraResources;
fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
