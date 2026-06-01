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

test('hotel virtual adapter shares list and card render plumbing', () => {
  const adapter = readProjectFile('src/renderer/modules/hotel-list-virtual-adapter.js');
  const listStart = adapter.indexOf('export function renderVirtualHotelListView');
  const cardStart = adapter.indexOf('export function renderVirtualHotelCardGrid');
  const selectStart = adapter.indexOf('export function syncVirtualSelectAllCheckboxState');
  assert.ok(listStart > 0, 'Should find list virtual renderer entry');
  assert.ok(cardStart > listStart, 'Should find card virtual renderer entry');
  assert.ok(selectStart > cardStart, 'Should find end of card renderer section');

  const listBody = adapter.slice(listStart, cardStart);
  const cardBody = adapter.slice(cardStart, selectStart);

  assert.match(adapter, /function renderVirtualHotelCollection/);
  assert.match(listBody, /renderVirtualHotelCollection\(/);
  assert.match(cardBody, /renderVirtualHotelCollection\(/);
  assert.equal(
    (adapter.match(/= createSmoothWheelController\(scrollContainer/g) || []).length,
    1,
    'list/card should share smooth wheel setup'
  );
  assert.equal(
    (adapter.match(/saveScrollMemory\(\{/g) || []).length,
    1,
    'list/card should share scroll memory save logic'
  );
});

test('AI assistant task page is split into payload queue template and event modules', () => {
  const expectedModules = [
    'src/renderer/modules/ai-task-payload.js',
    'src/renderer/modules/ai-task-queue.js',
    'src/renderer/modules/ai-template-picker.js',
    'src/renderer/modules/ai-task-events.js'
  ];

  expectedModules.forEach((relativePath) => {
    assert.equal(fs.existsSync(path.join(projectRoot, relativePath)), true, relativePath);
  });

  const assistant = readProjectFile('src/renderer/modules/ai-assistant.js');
  [
    './ai-task-payload.js',
    './ai-task-queue.js',
    './ai-template-picker.js',
    './ai-task-events.js'
  ].forEach((importPath) => {
    assert.match(assistant, new RegExp(importPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  assert.doesNotMatch(assistant, /function buildTaskPayload/);
  assert.doesNotMatch(assistant, /function createQueueTask/);
  assert.doesNotMatch(assistant, /function setupAiTemplatePicker/);
});

test('renderer CSS is split into token theme component and page layers', () => {
  const expectedStyleFiles = [
    'src/renderer/styles/tokens.css',
    'src/renderer/styles/themes.css',
    'src/renderer/styles/components/app-shell.css',
    'src/renderer/styles/components/modal-form.css',
    'src/renderer/styles/components/custom-select.css',
    'src/renderer/styles/components/view-controls.css',
    'src/renderer/styles/components/notifications.css',
    'src/renderer/styles/components/virtual-scroll.css',
    'src/renderer/styles/pages/hotel-cards.css',
    'src/renderer/styles/pages/app-modals.css',
    'src/renderer/styles/pages/ai-assistant.css',
    'src/renderer/styles/pages/settings-prefilter.css',
    'src/renderer/styles/pages/manual.css',
    'src/renderer/styles/pages/hotel-table.css'
  ];

  expectedStyleFiles.forEach((relativePath) => {
    assert.equal(fs.existsSync(path.join(projectRoot, relativePath)), true, relativePath);
  });

  const manifest = readProjectFile('src/renderer/styles.css');
  const imports = [...manifest.matchAll(/@import\s+url\('([^']+)'\);/g)].map((match) => match[1]);

  assert.deepEqual(imports, [
    './styles/tokens.css',
    './styles/themes.css',
    './styles/components/app-shell.css',
    './styles/pages/hotel-cards.css',
    './styles/components/modal-form.css',
    './styles/pages/app-modals.css',
    './styles/pages/ai-assistant.css',
    './styles/components/custom-select.css',
    './styles/pages/settings-prefilter.css',
    './styles/pages/manual.css',
    './styles/components/view-controls.css',
    './styles/pages/hotel-table.css',
    './styles/components/notifications.css',
    './styles/components/virtual-scroll.css'
  ]);
  assert.ok(manifest.split(/\r?\n/).length <= 24, 'styles.css should stay as a thin manifest');
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
