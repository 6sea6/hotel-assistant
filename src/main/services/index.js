const { createBundleService } = require('./bundle-service');
const { createAiService } = require('./ai-service');
const { createDataService } = require('./data-service');
const { createWindowService } = require('./window-service');

function createServiceContainer({ cache } = {}) {
  const dataService = createDataService();
  const windowService = createWindowService();

  return {
    cache,
    aiService: createAiService({ dataService, windowService }),
    bundleService: createBundleService(),
    dataService,
    windowService
  };
}

module.exports = {
  createServiceContainer
};
