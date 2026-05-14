const test = require('node:test');
const assert = require('node:assert/strict');

const { createServiceContainer } = require('../src/main/services');

test('service container wires stable main-process service façades', () => {
  const cache = { name: 'cache' };
  const services = createServiceContainer({ cache });

  assert.equal(services.cache, cache);
  assert.equal(typeof services.dataService.getStore, 'function');
  assert.equal(typeof services.dataService.getDataFolderManager, 'function');
  assert.equal(typeof services.getAiService, 'function');
  assert.equal(typeof services.hasAiService, 'function');
  assert.equal(typeof services.getBundleService, 'function');
  assert.equal(typeof services.hasBundleService, 'function');
  assert.equal(typeof services.hasBundledScraperResources, 'function');
  assert.equal(typeof services.windowService.createWindow, 'function');
  assert.equal(typeof services.windowService.getMainWindow, 'function');
});

test('service container lazily creates AI and bundle services', () => {
  let aiCreateCount = 0;
  let bundleCreateCount = 0;
  const services = createServiceContainer({
    createAiService({ dataService, windowService }) {
      aiCreateCount += 1;
      return {
        dataService,
        windowService,
        getProviderConfig() {},
        sendChat() {}
      };
    },
    createBundleService() {
      bundleCreateCount += 1;
      return {
        ensureBootstrapResources() {},
        scheduleSetup() {}
      };
    },
    detectBundledScraperResources() {
      return true;
    }
  });

  assert.equal(aiCreateCount, 0);
  assert.equal(bundleCreateCount, 0);
  assert.equal(services.hasAiService(), false);
  assert.equal(services.hasBundleService(), false);
  assert.equal(services.hasBundledScraperResources(), true);

  const aiService = services.getAiService();
  assert.equal(aiCreateCount, 1);
  assert.equal(services.hasAiService(), true);
  assert.equal(services.aiService, aiService);
  assert.equal(aiCreateCount, 1);

  const bundleService = services.getBundleService();
  assert.equal(bundleCreateCount, 1);
  assert.equal(services.hasBundleService(), true);
  assert.equal(services.bundleService, bundleService);
  assert.equal(bundleCreateCount, 1);
});
