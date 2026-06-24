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

function createServiceContainer({
  createAiService: createAiServiceOverride
} = {}) {
  const dataService = createDataService();
  const windowService = createWindowService();
  const aiServiceSlot = createLazyService(() => {
    const factory = createAiServiceOverride || require('./ai-service').createAiService;
    return factory({ dataService, windowService });
  });

  const services = {
    dataService,
    windowService,
    getAiService() {
      return aiServiceSlot.get();
    },
    hasAiService() {
      return aiServiceSlot.hasInstance();
    }
  };

  Object.defineProperties(services, {
    aiService: {
      enumerable: true,
      get() {
        return aiServiceSlot.get();
      }
    }
  });

  return services;
}

module.exports = {
  createServiceContainer
};
