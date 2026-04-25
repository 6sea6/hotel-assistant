const { migrateGuidePrompt } = require('./guide');
const { migrateProtectivePrompt } = require('./protective');

function migratePromptContent(type, content) {
  switch (type) {
    case 'guide':
      return migrateGuidePrompt(content);
    case 'protective':
      return migrateProtectivePrompt(content);
    default:
      return String(content || '');
  }
}

function migratePrompts(prompts) {
  if (!prompts || typeof prompts !== 'object') {
    return { prompts, changed: false };
  }

  const nextPrompts = { ...prompts };
  let changed = false;

  ['protective', 'guide', 'optimize'].forEach((type) => {
    if (!nextPrompts[type] || typeof nextPrompts[type].content !== 'string') {
      return;
    }

    const migratedContent = migratePromptContent(type, nextPrompts[type].content);
    if (migratedContent !== nextPrompts[type].content) {
      nextPrompts[type] = {
        ...nextPrompts[type],
        content: migratedContent
      };
      changed = true;
    }
  });

  return { prompts: nextPrompts, changed };
}

module.exports = {
  migratePromptContent,
  migratePrompts
};
