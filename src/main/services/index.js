const fs = require('fs');
const path = require('path');
const { createDataService } = require('./data-service');
const { createWindowService } = require('./window-service');

function createLazyService(factory) {
  let instance = null;

  return {
    get() {
      if (!instance) {
        instance = factory();
      }
      return instance;
    },
    hasInstance() {
      return Boolean(instance);
    }
  };
}

function defaultDetectBundledScraperResources() {
  const resourcesPath = process.resourcesPath || '';
  if (!resourcesPath) {
    return false;
  }

  return fs.existsSync(path.join(resourcesPath, 'scraper', 'src', 'cli.js'));
}

function createServiceContainer({
  cache,
  createAiService: createAiServiceOverride,
  createBundleService: createBundleServiceOverride,
  detectBundledScraperResources = defaultDetectBundledScraperResources
} = {}) {
  const dataService = createDataService();
  const windowService = createWindowService();
  const aiServiceSlot = createLazyService(() => {
    const factory = createAiServiceOverride || require('./ai-service').createAiService;
    return factory({ dataService, windowService });
  });
  const bundleServiceSlot = createLazyService(() => {
    const factory = createBundleServiceOverride || require('./bundle-service').createBundleService;
    return factory();
  });

  const services = {
    cache,
    dataService,
    windowService,
    getAiService() {
      return aiServiceSlot.get();
    },
    hasAiService() {
      return aiServiceSlot.hasInstance();
    },
    getBundleService() {
      return bundleServiceSlot.get();
    },
    hasBundleService() {
      return bundleServiceSlot.hasInstance();
    },
    hasBundledScraperResources() {
      return Boolean(detectBundledScraperResources());
    }
  };

  Object.defineProperties(services, {
    aiService: {
      enumerable: true,
      get() {
        return aiServiceSlot.get();
      }
    },
    bundleService: {
      enumerable: true,
      get() {
        return bundleServiceSlot.get();
      }
    }
  });

  return services;
}

module.exports = {
  createServiceContainer
};
