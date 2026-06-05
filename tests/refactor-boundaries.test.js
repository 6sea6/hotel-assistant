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
    'src/renderer/modules/hotel-list-model.js',
    'src/renderer/modules/hotel-list-filter-options.js',
    'src/renderer/modules/hotel-list-patch.js',
    'src/renderer/modules/hotel-list-render-orchestrator.js',
    'src/renderer/modules/rule-delete-controller.js',
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
    './hotel-list-model.js',
    './hotel-list-filter-options.js',
    './hotel-list-patch.js',
    './hotel-list-render-orchestrator.js',
    './rule-delete-controller.js',
    './hotel-list-selection.js',
    './hotel-list-empty-state.js',
    './hotel-list-virtual-adapter.js'
  ].forEach((importPath) => {
    assert.match(facade, new RegExp(importPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  const controller = readProjectFile('src/renderer/modules/hotel-list-controller.js');
  [
    './hotel-list-filter-options.js',
    './hotel-list-render-orchestrator.js',
    './rule-delete-controller.js'
  ].forEach((importPath) => {
    assert.match(controller, new RegExp(importPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
  assert.doesNotMatch(controller, /function getSortedVisibleHotels\(/);
  assert.doesNotMatch(controller, /function patchHotelCards\(/);
  assert.doesNotMatch(controller, /function renderHotelList\(/);
  assert.doesNotMatch(controller, /function getRuleDeleteThresholds\(/);
  assert.doesNotMatch(controller, /export async function confirmRuleDelete\(/);
  assert.doesNotMatch(controller, /visibleHotelsCache\.(data|filtersKey|hitCount|missCount)/);
  assert.ok(
    controller.split(/\r?\n/).length <= 460,
    'hotel-list-controller.js should stay focused'
  );

  const renderOrchestrator = readProjectFile(
    'src/renderer/modules/hotel-list-render-orchestrator.js'
  );
  assert.match(renderOrchestrator, /\.\/hotel-list-model\.js/);
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

test('virtual scrollbar drag path avoids synchronous layout work on pointermove', () => {
  const adapter = readProjectFile('src/renderer/modules/hotel-list-virtual-adapter.js');
  const scrollbarStart = adapter.indexOf('function createCustomVirtualScrollbar');
  const scrollbarEnd = adapter.indexOf('/* ---- 虚拟滚动：卡片视图 ---- */');
  assert.ok(scrollbarStart > 0, 'Should find custom scrollbar implementation');
  assert.ok(scrollbarEnd > scrollbarStart, 'Should find custom scrollbar implementation end');

  const scrollbarBody = adapter.slice(scrollbarStart, scrollbarEnd);
  const pointerMoveStart = scrollbarBody.indexOf('function handlePointerMove');
  const pointerMoveEnd = scrollbarBody.indexOf('function stopDragging', pointerMoveStart);
  assert.ok(pointerMoveStart > 0, 'Should find pointermove handler');
  assert.ok(pointerMoveEnd > pointerMoveStart, 'Should find pointermove handler end');

  const pointerMoveBody = scrollbarBody.slice(pointerMoveStart, pointerMoveEnd);
  assert.match(scrollbarBody, /let dragMetrics = null/);
  assert.match(scrollbarBody, /let thumbUpdateRafId = 0/);
  assert.match(scrollbarBody, /let dragScrollRafId = 0/);
  assert.match(scrollbarBody, /function scheduleThumbRender/);
  assert.match(scrollbarBody, /function scheduleDragScroll/);
  assert.doesNotMatch(pointerMoveBody, /getScrollMetrics\(\)/);
  assert.doesNotMatch(pointerMoveBody, /update\(\)/);
  assert.doesNotMatch(pointerMoveBody, /setScrollTopSafely\(/);
  assert.match(pointerMoveBody, /dragMetrics/);
  assert.match(pointerMoveBody, /scheduleDragScroll\(targetScrollTop\)/);
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

  const hotelTableCss = readProjectFile('src/renderer/styles/pages/hotel-table.css');
  assert.doesNotMatch(hotelTableCss, /\.ai-|\.task-|\.settings-prefilter|\.list-prefilter/);
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
  [
    './scraper-paths',
    './scraper-task-input',
    './refresh-runner',
    './scraper-write-rollback'
  ].forEach((importPath) => {
    assert.match(facade, new RegExp(importPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  const refreshRunner = readProjectFile('src/main/ai/refresh-runner.js');
  assert.match(refreshRunner, /async function refreshExistingCtripHotels/);
  assert.match(refreshRunner, /runRefreshHotelBatch/);
});

test('Ctrip detail capture strategy is expressed as reusable steps and a plan table', () => {
  const scraper = readProjectFile('scraper/src/ctrip-scraper.js');

  [
    'runHtmlCaptureStep',
    'runEdgeSupplementStep',
    'runApiReplayStep',
    'runSequentialCapturePlan'
  ].forEach((functionName) => {
    assert.match(scraper, new RegExp(`function ${functionName}\\b`));
  });

  assert.match(scraper, /const CAPTURE_STRATEGY_PLANS\s*=/);
  assert.match(scraper, /CAPTURE_STRATEGY_PLANS\.edgePreferred/);
  assert.match(scraper, /CAPTURE_STRATEGY_PLANS\.htmlFirst/);
});

test('Ctrip list page collector is split into URL Edge and strategy modules', () => {
  const expectedModules = [
    'scraper/src/scraper/list-page-url-builder.js',
    'scraper/src/scraper/list-page-edge-capture.js',
    'scraper/src/scraper/list-page-prefilter-strategy.js'
  ];

  expectedModules.forEach((relativePath) => {
    assert.equal(fs.existsSync(path.join(projectRoot, relativePath)), true, relativePath);
  });

  const collector = readProjectFile('scraper/src/scraper/list-page-collector.js');
  [
    './list-page-url-builder',
    './list-page-parser',
    './list-page-edge-capture',
    './list-page-prefilter-strategy'
  ].forEach((importPath) => {
    assert.match(collector, new RegExp(importPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  assert.ok(collector.split(/\r?\n/).length <= 260, 'list-page-collector.js should stay thin');
  assert.doesNotMatch(collector, /function fetchListApiPagesInEdgeSession/);
  assert.doesNotMatch(collector, /function dispatchCdpWheelScroll/);
  assert.doesNotMatch(collector, /function normalizeEdgePageDecision/);
});

test('Ctrip Edge network capture splits target DOM and capture runner modules', () => {
  const expectedModules = [
    'scraper/src/scraper/edge-capture-modules/edge-target-session.js',
    'scraper/src/scraper/edge-capture-modules/edge-target-capture.js',
    'scraper/src/scraper/edge-capture-modules/edge-dom-extract.js'
  ];

  expectedModules.forEach((relativePath) => {
    assert.equal(fs.existsSync(path.join(projectRoot, relativePath)), true, relativePath);
  });

  const networkCapture = readProjectFile(
    'scraper/src/scraper/edge-capture-modules/network-capture.js'
  );
  ['./edge-target-session', './edge-target-capture', './edge-dom-extract'].forEach((importPath) => {
    assert.match(networkCapture, new RegExp(importPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  assert.doesNotMatch(networkCapture, /function runEdgeTargetCapture\(/);
  assert.doesNotMatch(networkCapture, /function extractEdgeDomRoomCandidates\(/);
  assert.doesNotMatch(networkCapture, /Target\.getTargets/);
  assert.doesNotMatch(networkCapture, /Target\.createTarget/);
  assert.ok(networkCapture.split(/\r?\n/).length <= 520, 'network-capture.js should stay focused');
});

test('Ctrip list Edge capture splits CDP session network and scroll policy modules', () => {
  const expectedModules = [
    'scraper/src/scraper/list-page-cdp-session.js',
    'scraper/src/scraper/list-page-network-drain.js',
    'scraper/src/scraper/list-page-scroll-policy.js'
  ];

  expectedModules.forEach((relativePath) => {
    assert.equal(fs.existsSync(path.join(projectRoot, relativePath)), true, relativePath);
  });

  const edgeCapture = readProjectFile('scraper/src/scraper/list-page-edge-capture.js');
  ['./list-page-cdp-session', './list-page-network-drain', './list-page-scroll-policy'].forEach(
    (importPath) => {
      assert.match(edgeCapture, new RegExp(importPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  );

  assert.doesNotMatch(edgeCapture, /function getEdgeWebSocket\(/);
  assert.doesNotMatch(edgeCapture, /function drainListNetworkResponses\(/);
  assert.doesNotMatch(edgeCapture, /function dispatchCdpWheelScroll\(/);
  assert.ok(
    edgeCapture.split(/\r?\n/).length <= 430,
    'list-page-edge-capture.js should stay focused'
  );
});

test('settings UI is split behind a thin compatibility facade', () => {
  const expectedModules = [
    'src/renderer/modules/settings-form-ui.js',
    'src/renderer/modules/personalization-ui.js',
    'src/renderer/modules/data-transfer-ui.js',
    'src/renderer/modules/list-prefilter-ui.js'
  ];

  expectedModules.forEach((relativePath) => {
    assert.equal(fs.existsSync(path.join(projectRoot, relativePath)), true, relativePath);
  });

  const facade = readProjectFile('src/renderer/modules/settings-ui.js');
  [
    './settings-form-ui.js',
    './personalization-ui.js',
    './data-transfer-ui.js',
    './list-prefilter-ui.js'
  ].forEach((importPath) => {
    assert.match(facade, new RegExp(importPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  assert.ok(facade.split(/\r?\n/).length <= 90, 'settings-ui.js should remain a thin facade');
  assert.doesNotMatch(facade, /function normalizeListPrefilterSettingValue/);
  assert.doesNotMatch(facade, /function applyAppIconState/);
  assert.doesNotMatch(facade, /function focusImportTransferOption/);
});

test('low-risk modals are stored in templates and mounted on demand', () => {
  const indexHtml = readProjectFile('src/renderer/index.html');
  const uiUtils = readProjectFile('src/renderer/modules/ui-utils.js');

  [
    'templateModal',
    'ruleDeleteModal',
    'hotelDetailsModal',
    'dataTransferModal',
    'aboutModal',
    'manualModal'
  ].forEach((modalId) => {
    assert.match(indexHtml, new RegExp(`<template[^>]+data-modal-template="${modalId}"`));
  });

  assert.match(uiUtils, /ensureModalTemplateMounted/);
});

test('renderer entry lazy-loads heavy infrequent modules', () => {
  const appModule = readProjectFile('src/renderer/app.module.js');

  ['./modules/ai-assistant.js', './modules/ranking-image.js'].forEach((modulePath) => {
    const escaped = modulePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(appModule, new RegExp(`import\\(['"]${escaped}['"]\\)`));
    assert.doesNotMatch(appModule, new RegExp(`from ['"]${escaped}['"]`));
  });
});

test('ranking image export uses an on-demand count chooser', () => {
  const indexHtml = readProjectFile('src/renderer/index.html');
  const appModule = readProjectFile('src/renderer/app.module.js');
  const rankingImage = readProjectFile('src/renderer/modules/ranking-image.js');

  assert.match(indexHtml, /data-modal-template="rankingExportModal"/);
  [5, 10, 20, 50].forEach((count) => {
    assert.match(indexHtml, new RegExp(`value="${count}"`));
  });
  assert.match(indexHtml, /id="rankingExportCustomCount"/);

  assert.match(appModule, /openRankingImageExportModal/);
  assert.match(appModule, /confirmRankingImageExport/);
  assert.match(rankingImage, /function normalizeRankingExportLimit/);
  assert.match(rankingImage, /sortedHotels\.slice\(0,\s*exportLimit\)/);
});
