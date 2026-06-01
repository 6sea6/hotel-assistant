const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf-8');
}

test('hotel list responsibilities are split behind the existing facade', () => {
  const expectedModules = [
    'src/renderer/modules/hotel-list-controller.js',
    'src/renderer/modules/hotel-list-table-renderer.js',
    'src/renderer/modules/hotel-list-card-renderer.js',
    'src/renderer/modules/hotel-list-selection.js',
    'src/renderer/modules/hotel-list-empty-state.js',
    'src/renderer/modules/hotel-list-virtual-adapter.js'
  ];

  expectedModules.forEach((relativePath) => {
    assert.equal(fs.existsSync(path.join(projectRoot, relativePath)), true, relativePath);
  });

  const facade = readProjectFile('src/renderer/modules/hotel-list.js');
  [
    './hotel-list-controller.js',
    './hotel-list-table-renderer.js',
    './hotel-list-card-renderer.js',
    './hotel-list-selection.js',
    './hotel-list-empty-state.js',
    './hotel-list-virtual-adapter.js'
  ].forEach((importPath) => {
    assert.match(facade, new RegExp(importPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
});

test('scraper runner responsibilities are split behind the existing facade', () => {
  const expectedModules = [
    'src/main/ai/scraper-paths.js',
    'src/main/ai/scraper-task-input.js',
    'src/main/ai/refresh-runner.js',
    'src/main/ai/scraper-write-rollback.js'
  ];

  expectedModules.forEach((relativePath) => {
    assert.equal(fs.existsSync(path.join(projectRoot, relativePath)), true, relativePath);
  });

  const facade = readProjectFile('src/main/ai/scraper-runner.js');
  ['./scraper-paths', './scraper-task-input', './refresh-runner', './scraper-write-rollback'].forEach(
    (importPath) => {
      assert.match(facade, new RegExp(importPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  );

  const refreshRunner = readProjectFile('src/main/ai/refresh-runner.js');
  assert.match(refreshRunner, /async function refreshExistingCtripHotels/);
  assert.match(refreshRunner, /runRefreshHotelBatch/);
});
