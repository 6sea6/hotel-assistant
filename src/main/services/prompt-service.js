const fs = require('fs');
const path = require('path');
const { getPaths } = require('../config');
const { getDefaultPrompt } = require('../default-prompts');
const { migratePrompts } = require('../prompt-migration');

function createPromptService({ dataService }) {
  return {
    getPromptsFilePath() {
      return dataService.getPromptsPath();
    },
    loadPrompt(type) {
      try {
        const promptsPath = this.getPromptsFilePath();
        if (fs.existsSync(promptsPath)) {
          let prompts = JSON.parse(fs.readFileSync(promptsPath, 'utf-8'));
          const migration = migratePrompts(prompts);
          if (migration.changed) {
            prompts = migration.prompts;
            fs.writeFileSync(promptsPath, JSON.stringify(prompts, null, 2));
          }
          if (prompts[type] && prompts[type].content) {
            return prompts[type];
          }
        }
      } catch (error) {
        console.error('读取AI提示词失败:', error);
      }

      const paths = getPaths();
      return {
        content: getDefaultPrompt(type, {
          dataPath: path.join(dataService.getDataFolderPath(), `${paths.STORE_NAME}.json`)
        }),
        updatedAt: null,
        isDefault: true
      };
    },
    savePrompt(type, content) {
      try {
        const promptsPath = this.getPromptsFilePath();
        let prompts = {};

        if (fs.existsSync(promptsPath)) {
          prompts = JSON.parse(fs.readFileSync(promptsPath, 'utf-8'));
        }

        prompts[type] = {
          content,
          updatedAt: new Date().toISOString()
        };

        fs.writeFileSync(promptsPath, JSON.stringify(prompts, null, 2));
        return { success: true };
      } catch (error) {
        console.error('保存AI提示词失败:', error);
        return { success: false, error: error.message };
      }
    }
  };
}

module.exports = {
  createPromptService
};
