const test = require('node:test');
const assert = require('node:assert/strict');

const { createServiceContainer } = require('../src/main/services');

test('service container wires stable main-process service façades', () => {
  const cache = { name: 'cache' };
  const services = createServiceContainer({ cache });

  assert.equal(services.cache, cache);
  assert.equal(typeof services.dataService.getStore, 'function');
  assert.equal(typeof services.dataService.getDataFolderManager, 'function');
  assert.equal(typeof services.promptService.getPromptsFilePath, 'function');
  assert.equal(typeof services.promptService.loadPrompt, 'function');
  assert.equal(typeof services.bundleService.ensureBootstrapResources, 'function');
  assert.equal(typeof services.bundleService.scheduleSetup, 'function');
  assert.equal(typeof services.windowService.createWindow, 'function');
  assert.equal(typeof services.windowService.getMainWindow, 'function');
});
