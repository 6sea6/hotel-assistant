const { createBundleService } = require('./bundle-service');
const { createDataService } = require('./data-service');
const { createPromptService } = require('./prompt-service');
const { createWindowService } = require('./window-service');

function createServiceContainer({ cache } = {}) {
  const dataService = createDataService();
  const windowService = createWindowService();

  return {
    cache,
    bundleService: createBundleService(),
    dataService,
    promptService: createPromptService({ dataService }),
    windowService
  };
}

module.exports = {
  createServiceContainer
};
