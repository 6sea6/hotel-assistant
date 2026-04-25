const path = require('path');
const { DEFAULT_COMPARE_APP_FILES } = require('./constants');

const PROMPT_TYPES = Object.freeze(['protective', 'guide', 'optimize']);

const BUNDLE_RESOURCE_MAP = Object.freeze({
  scraperDirName: 'scraper',
  skillDirName: 'skill',
  compareAppDirName: 'compare-app',
  runtimeWorkDirName: 'scraper-data'
});

const PROMPT_CONTRACT = Object.freeze({
  compareAppPromptsFileName: DEFAULT_COMPARE_APP_FILES.promptsFileName,
  unifiedPromptFileName: '00-后续AI统一提示词.md',
  bundledSkillName: 'hotel-data-filler',
  bundledSkillEntryFileName: 'SKILL.md',
  promptTypes: PROMPT_TYPES
});

function getBundledSkillTargetDir(homeDir) {
  return path.join(homeDir, '.workbuddy', 'skills', PROMPT_CONTRACT.bundledSkillName);
}

module.exports = {
  BUNDLE_RESOURCE_MAP,
  PROMPT_CONTRACT,
  PROMPT_TYPES,
  getBundledSkillTargetDir
};
