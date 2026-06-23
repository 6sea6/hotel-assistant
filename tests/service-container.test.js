const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createServiceContainer } = require('../src/main/services');

test('service container wires stable main-process service façades', () => {
  const services = createServiceContainer();

  assert.equal(typeof services.dataService.getStore, 'function');
  assert.equal(typeof services.dataService.getDataFolderManager, 'function');
  assert.equal(typeof services.getAiService, 'function');
  assert.equal(typeof services.hasAiService, 'function');
  assert.equal(typeof services.hasBundledScraperResources, 'function');
  assert.equal(typeof services.windowService.createWindow, 'function');
  assert.equal(typeof services.windowService.getMainWindow, 'function');
});

test('service container lazily creates AI service', () => {
  let aiCreateCount = 0;
  const services = createServiceContainer({
    createAiService({ dataService, windowService }) {
      aiCreateCount += 1;
      return {
        dataService,
        windowService,
        getProviderConfig() {},
        startTask() {}
      };
    },
    detectBundledScraperResources() {
      return true;
    }
  });

  assert.equal(aiCreateCount, 0);
  assert.equal(services.hasAiService(), false);
  assert.equal(services.hasBundledScraperResources(), true);

  const aiService = services.getAiService();
  assert.equal(aiCreateCount, 1);
  assert.equal(services.hasAiService(), true);
  assert.equal(services.aiService, aiService);
  assert.equal(aiCreateCount, 1);
});

test('AI service non-collection APIs do not load the scraper runner', () => {
  const aiServicePath = path.join(__dirname, '..', 'src', 'main', 'services', 'ai-service.js');
  const lazyLoaderPath = path.join(__dirname, '..', 'src', 'main', 'ai', 'scraper-lazy-loader.js');
  const scraperRunnerPath = path.join(__dirname, '..', 'src', 'main', 'ai', 'scraper-runner.js');

  [aiServicePath, lazyLoaderPath, scraperRunnerPath].forEach((filePath) => {
    delete require.cache[require.resolve(filePath)];
  });

  const { createAiService } = require(aiServicePath);
  assert.equal(require.cache[require.resolve(scraperRunnerPath)], undefined);

  const service = createAiService({
    dataService: {
      getStore() {
        return {
          get(key) {
            return key === 'settings' ? {} : null;
          },
          set() {}
        };
      },
      getDataFolderPath() {
        return 'E:/tmp/hotel-data';
      }
    },
    windowService: {
      getMainWindow() {
        return null;
      }
    }
  });

  service.getProviderConfig();
  service.getProviderPresets();
  service.getTaskStatus();

  assert.equal(require.cache[require.resolve(scraperRunnerPath)], undefined);
});
