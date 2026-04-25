const { buildGuidePrompt } = require('./guide');
const { buildOptimizePrompt } = require('./optimize');
const { buildProtectivePrompt } = require('./protective');

function getDefaultPrompt(type, context = {}) {
  switch (type) {
    case 'protective':
      return buildProtectivePrompt();
    case 'guide':
      return buildGuidePrompt(context);
    case 'optimize':
      return buildOptimizePrompt();
    default:
      return '';
  }
}

module.exports = {
  getDefaultPrompt
};
