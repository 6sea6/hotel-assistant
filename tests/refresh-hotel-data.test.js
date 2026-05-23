const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/* ============================================================
 * Helper: load renderer ES modules into Node for testing
 * ============================================================ */

let taskConsoleModuleUrl = '';
let aiAssistantModuleUrl = '';
let stateModuleUrl = '';

async function loadTaskConsoleModule() {
  if (!taskConsoleModuleUrl) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-refresh-task-console-'));
    const sourceDir = path.join(__dirname, '..', 'src', 'renderer', 'modules');
    fs.writeFileSync(path.join(tempRoot, 'package.json'), '{"type":"module"}\n', 'utf-8');
    fs.copyFileSync(path.join(sourceDir, 'dom-helpers.js'), path.join(tempRoot, 'dom-helpers.js'));
    fs.copyFileSync(
      path.join(sourceDir, 'ai-task-console.js'),
      path.join(tempRoot, 'ai-task-console.js')
    );
    taskConsoleModuleUrl = pathToFileURL(path.join(tempRoot, 'ai-task-console.js')).href;
    process.on('exit', () => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
  }
  return import(taskConsoleModuleUrl);
}

async function loadAiAssistantModules() {
  if (!aiAssistantModuleUrl) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-refresh-ai-assistant-'));
    const sourceDir = path.join(__dirname, '..', 'src', 'renderer', 'modules');
    fs.writeFileSync(path.join(tempRoot, 'package.json'), '{"type":"module"}\n', 'utf-8');
    [
      'actions.js',
      'ai-assistant.js',
      'ai-task-console.js',
      'custom-select.js',
      'dom-helpers.js',
      'notification.js',
      'state.js'
    ].forEach((fileName) => {
      fs.copyFileSync(path.join(sourceDir, fileName), path.join(tempRoot, fileName));
    });
    aiAssistantModuleUrl = pathToFileURL(path.join(tempRoot, 'ai-assistant.js')).href;
    stateModuleUrl = pathToFileURL(path.join(tempRoot, 'state.js')).href;
    process.on('exit', () => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
  }
  const [module, stateModule] = await Promise.all([
    import(aiAssistantModuleUrl),
    import(stateModuleUrl)
  ]);
  return { module, stateModule };
}

/* ============================================================
 * Test: index.html - refresh-all-hotel-data button
 * ============================================================ */

test('index.html: refresh-all-hotel-data button exists before clear-ai-task-records', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const refreshMatch = html.match(/data-action="refresh-all-hotel-data"/);
  assert.ok(refreshMatch, 'refresh-all-hotel-data button should exist');

  const refreshIndex = html.indexOf('data-action="refresh-all-hotel-data"');
  const clearIndex = html.indexOf('data-action="clear-ai-task-records"');
  assert.ok(refreshIndex < clearIndex, 'refresh button should appear before clear-ai-task-records');
});

test('index.html: refresh button has correct text', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  assert.ok(html.includes('更新数据'), 'Button should have text "更新数据"');
});

/* ============================================================
 * Test: app.module.js - ACTION_HANDLER for refresh-all-hotel-data
 * ============================================================ */

test('app.module.js: ACTION_HANDLERS includes refresh-all-hotel-data', () => {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'app.module.js'),
    'utf8'
  );
  assert.ok(
    code.includes("'refresh-all-hotel-data'"),
    'ACTION_HANDLERS should include refresh-all-hotel-data'
  );
  assert.ok(
    code.includes('enqueueRefreshHotelDataTask'),
    'Should import and call enqueueRefreshHotelDataTask'
  );
});

/* ============================================================
 * Test: ai-assistant.js - enqueueRefreshHotelDataTask
 * ============================================================ */

test('ai-assistant.js: exports enqueueRefreshHotelDataTask', async () => {
  const { module } = await loadAiAssistantModules();
  assert.equal(typeof module.enqueueRefreshHotelDataTask, 'function');
});

test('ai-assistant.js: createQueueTask supports taskKind parameter', async () => {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'modules', 'ai-assistant.js'),
    'utf8'
  );
  assert.ok(code.includes("taskKind = 'collect'"), 'Default taskKind should be collect');
  assert.ok(code.includes("taskKind === 'refresh-data'"), 'Should check for refresh-data taskKind');
  assert.ok(code.includes("'更新整个程序目前的宾馆数据'"), 'Refresh task should have specific title');
});

test('ai-assistant.js: refresh task does not require template or URL', async () => {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'modules', 'ai-assistant.js'),
    'utf8'
  );
  // enqueueRefreshHotelDataTask should not check for template or URL
  const refreshFnMatch = code.match(
    /async function enqueueRefreshHotelDataTask[\s\S]*?^}/m
  );
  assert.ok(refreshFnMatch, 'enqueueRefreshHotelDataTask should exist');
  const fnBody = refreshFnMatch[0];
  assert.ok(!fnBody.includes('findSelectedAiTemplate'), 'Should not check for template');
  assert.ok(!fnBody.includes('getSubmittedUrl'), 'Should not check for URL');
});

/* ============================================================
 * Test: ai-task-console.js - REFRESH_STEP_DEFINITIONS
 * ============================================================ */

test('ai-task-console.js: REFRESH_STEP_DEFINITIONS exists and has no transit step', async () => {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'modules', 'ai-task-console.js'),
    'utf8'
  );
  assert.ok(code.includes('REFRESH_STEP_DEFINITIONS'), 'Should define REFRESH_STEP_DEFINITIONS');

  // Extract REFRESH_STEP_DEFINITIONS
  const refreshStepsMatch = code.match(
    /REFRESH_STEP_DEFINITIONS\s*=\s*\[([\s\S]*?)\]/
  );
  assert.ok(refreshStepsMatch, 'REFRESH_STEP_DEFINITIONS should be array');
  const stepsContent = refreshStepsMatch[1];
  assert.ok(!stepsContent.includes('transit'), 'Refresh steps should NOT contain transit');
  assert.ok(stepsContent.includes('load-data'), 'Should have load-data step');
  assert.ok(stepsContent.includes('refresh'), 'Should have refresh step');
  assert.ok(stepsContent.includes('已接收更新任务'), 'Should have refresh-specific received title');
});

test('ai-task-console.js: refresh running view shows "正在更新数据"', async () => {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'modules', 'ai-task-console.js'),
    'utf8'
  );
  assert.ok(code.includes('正在更新数据'), 'Should show "正在更新数据"');
  assert.ok(code.includes('正在更新已有宾馆的房型与价格信息'), 'Should show refresh description');
});

test('ai-task-console.js: refresh completed view shows "更新完成"', async () => {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'modules', 'ai-task-console.js'),
    'utf8'
  );
  // Check for refresh success view
  assert.ok(code.includes("'更新完成'"), 'Should show "更新完成" title');
});

test('ai-task-console.js: refresh result analysis shows update statistics', async () => {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'modules', 'ai-task-console.js'),
    'utf8'
  );
  assert.ok(
    code.includes('totalHotelCount') && code.includes('updatedHotelCount'),
    'Should reference update statistics fields'
  );
  assert.ok(
    code.includes('updatedRoomTypeCount') && code.includes('deletedRoomTypeCount'),
    'Should reference room type count fields'
  );
  assert.ok(
    code.includes('skippedHotelCount'),
    'Should reference skipped hotel count'
  );
});

test('ai-task-console.js: getEventStepKey handles refresh events without transit', async () => {
  const { normalizeTaskState: _normalizeTaskState } = await loadTaskConsoleModule();
  // Verify by reading source that refresh events map to refresh steps
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'modules', 'ai-task-console.js'),
    'utf8'
  );
  assert.ok(code.includes("refresh:load-data"), 'Should map refresh:load-data event');
  assert.ok(code.includes("refresh:item-start"), 'Should map refresh:item-start event');
  assert.ok(code.includes("refresh:item-done"), 'Should map refresh:item-done event');
  assert.ok(code.includes("refresh:item-skipped"), 'Should map refresh:item-skipped event');
  assert.ok(code.includes("refresh:write"), 'Should map refresh:write event');
  assert.ok(code.includes("refresh:summary"), 'Should map refresh:summary event');
});

/* ============================================================
 * Test: preload.js - refreshHotelData IPC
 * ============================================================ */

test('preload.js: ai.refreshHotelData IPC is exposed', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'preload.js'), 'utf8');
  assert.ok(
    code.includes("refreshHotelData") && code.includes("ai:task:refresh-data"),
    'preload should expose refreshHotelData mapping to ai:task:refresh-data'
  );
});

/* ============================================================
 * Test: ai-handlers.js - refresh-data IPC handler
 * ============================================================ */

test('ai-handlers.js: registers ai:task:refresh-data handler', () => {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'main', 'ipc-handlers', 'ai-handlers.js'),
    'utf8'
  );
  assert.ok(
    code.includes("ai:task:refresh-data"),
    'Should register ai:task:refresh-data IPC handler'
  );
  assert.ok(
    code.includes('refreshHotelData'),
    'Should call getAiService().refreshHotelData'
  );
});

/* ============================================================
 * Test: ai-service.js - refreshHotelData method
 * ============================================================ */

test('ai-service.js: exports refreshHotelData method', () => {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'main', 'services', 'ai-service.js'),
    'utf8'
  );
  assert.ok(
    code.includes('async function refreshHotelData'),
    'Should define refreshHotelData function'
  );
  assert.ok(
    code.includes('refreshExistingCtripHotels'),
    'Should call refreshExistingCtripHotels'
  );
  assert.ok(
    code.includes("refresh_existing_ctrip_hotels"),
    'Should use refresh_existing_ctrip_hotels tool name in result'
  );
  assert.ok(
    code.includes('compactRefreshResult'),
    'Should compact refresh result'
  );
});

test('ai-service.js: refreshHotelData is in returned service object', () => {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'main', 'services', 'ai-service.js'),
    'utf8'
  );
  // Check that refreshHotelData appears in the return block (after the function definition)
  const returnBlockMatch = code.match(/return\s*\{[^}]*refreshHotelData[^}]*\}/s);
  assert.ok(returnBlockMatch, 'refreshHotelData should be in service return object');
});

/* ============================================================
 * Test: scraper-runner.js - refreshExistingCtripHotels
 * ============================================================ */

test('scraper-runner.js: exports refreshExistingCtripHotels', () => {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'main', 'ai', 'scraper-runner.js'),
    'utf8'
  );
  assert.ok(
    code.includes('async function refreshExistingCtripHotels'),
    'Should define refreshExistingCtripHotels function'
  );
  assert.ok(
    code.includes('refreshExistingCtripHotels'),
    'Should export refreshExistingCtripHotels'
  );
});

test('scraper-runner.js: refresh does not call getTransitInfo', () => {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'main', 'ai', 'scraper-runner.js'),
    'utf8'
  );
  // Find the refreshExistingCtripHotels function only
  const refreshStart = code.indexOf('async function refreshExistingCtripHotels');
  const refreshEnd = code.indexOf('module.exports', refreshStart);
  assert.ok(refreshStart > 0, 'Should find refreshExistingCtripHotels function');
  const fnBody = code.substring(refreshStart, refreshEnd);
  assert.ok(!fnBody.includes('getTransitInfo'), 'Should NOT call getTransitInfo');
  assert.ok(!fnBody.includes("emit('transit:start'"), 'Should NOT emit transit:start');
  assert.ok(!fnBody.includes("emit('transit:done'"), 'Should NOT emit transit:done');
});

test('scraper-runner.js: refresh preserves old fields', () => {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'main', 'ai', 'scraper-runner.js'),
    'utf8'
  );
  assert.ok(code.includes('PRESERVED_FIELDS_ON_REFRESH'), 'Should define preserved fields');
  assert.ok(code.includes("'distance'"), 'Should preserve distance');
  assert.ok(code.includes("'subway_station'"), 'Should preserve subway_station');
  assert.ok(code.includes("'subway_distance'"), 'Should preserve subway_distance');
  assert.ok(code.includes("'transport_time'"), 'Should preserve transport_time');
  assert.ok(code.includes("'bus_route'"), 'Should preserve bus_route');
  assert.ok(code.includes("'is_favorite'"), 'Should preserve is_favorite');
  assert.ok(code.includes("'notes'"), 'Should preserve notes');
});

test('scraper-runner.js: refresh uses overwriteExistingGroup', () => {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'main', 'ai', 'scraper-runner.js'),
    'utf8'
  );
  assert.ok(
    code.includes('overwriteExistingGroup: true'),
    'Should use overwriteExistingGroup for write strategy'
  );
});

test('scraper-runner.js: refresh skips hotels on collection failure', () => {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'main', 'ai', 'scraper-runner.js'),
    'utf8'
  );
  // Verify that collection failure leads to skipped status
  assert.ok(
    code.includes("status: 'skipped'"),
    'Should mark failed collections as skipped'
  );
  assert.ok(
    code.includes("status: 'failed'"),
    'Should mark error collections as failed'
  );
  assert.ok(
    code.includes("status: 'updated'"),
    'Should mark successful collections as updated'
  );
});

/* ============================================================
 * Test: task-runner.js - skipTransit support
 * ============================================================ */

test('task-runner.js: skipTransit flag is supported', () => {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'scraper', 'src', 'task-runner.js'),
    'utf8'
  );
  assert.ok(
    code.includes('skipTransit') || code.includes('skip-transit'),
    'Should check skipTransit or skip-transit flag'
  );
});

test('task-runner.js: skipTransit skips getTransitInfo call', () => {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'scraper', 'src', 'task-runner.js'),
    'utf8'
  );
  // Find the section around transit:start
  const transitSection = code.substring(
    code.indexOf("emit('transit:start'"),
    code.indexOf("emit('transit:start'") + 2000
  );
  // Verify that transit is conditional
  assert.ok(
    code.includes('if (!skipTransit)'),
    'Transit call should be guarded by skipTransit check'
  );
});

test('task-runner.js: skipTransit does not emit transit:start', () => {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'scraper', 'src', 'task-runner.js'),
    'utf8'
  );
  assert.ok(
    code.includes("if (!skipTransit)") && code.includes("emit('transit:start'"),
    'transit:start should only be emitted when skipTransit is false'
  );
});

/* ============================================================
 * Test: hotel-record.js - transit null handling
 * ============================================================ */

test('hotel-record.js: transit fields default to empty when transit is null', () => {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'scraper', 'src', 'hotel-record.js'),
    'utf8'
  );
  // When transit is null/undefined, fields should default to ''
  assert.ok(
    code.includes("context.route ? toStringNumber(context.route.distanceKm, 1) : ''"),
    'distance should default to empty string when route is null'
  );
  assert.ok(
    code.includes("context.route ? String(context.route.durationMinutes) : ''"),
    'transport_time should default to empty string when route is null'
  );
});

/* ============================================================
 * Test: hotel-merge.js - overwriteExistingGroup support
 * ============================================================ */

test('hotel-merge.js: appendHotelsToStore supports overwriteExistingGroup', () => {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'scraper', 'src', 'compare-app', 'hotel-merge.js'),
    'utf8'
  );
  assert.ok(
    code.includes('overwriteExistingGroup'),
    'Should support overwriteExistingGroup option'
  );
  assert.ok(
    code.includes('overwriteHotelsToStore'),
    'Should have overwriteHotelsToStore function'
  );
});

test('hotel-merge.js: overwriteHotelsToStore replaces entire group', () => {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'scraper', 'src', 'compare-app', 'hotel-merge.js'),
    'utf8'
  );
  assert.ok(
    code.includes("groupedHotels[existingGroupIndex] = sanitizedGroup"),
    'Should replace entire group for existing hotels'
  );
});

/* ============================================================
 * Test: normal collect tasks are not affected
 * ============================================================ */

test('normal collect: BASE_STEP_DEFINITIONS still has transit step', async () => {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'modules', 'ai-task-console.js'),
    'utf8'
  );
  const baseMatch = code.match(
    /BASE_STEP_DEFINITIONS\s*=\s*\[([\s\S]*?)\]/
  );
  assert.ok(baseMatch, 'BASE_STEP_DEFINITIONS should exist');
  assert.ok(baseMatch[1].includes('transit'), 'BASE_STEP_DEFINITIONS should still have transit');
  assert.ok(baseMatch[1].includes('scrape'), 'BASE_STEP_DEFINITIONS should still have scrape');
});

test('normal collect: getTransitInfo is still called when skipTransit is false', () => {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'scraper', 'src', 'task-runner.js'),
    'utf8'
  );
  assert.ok(
    code.includes('getTransitInfo('),
    'getTransitInfo should still be called for normal tasks'
  );
  assert.ok(
    code.includes("emit('transit:start'"),
    'transit:start should still be emitted for normal tasks'
  );
});

test('normal collect: enqueueAiCollectTask still requires template and URL', async () => {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'modules', 'ai-assistant.js'),
    'utf8'
  );
  const collectFnMatch = code.match(
    /async function enqueueAiCollectTask[\s\S]*?^}/m
  );
  assert.ok(collectFnMatch, 'enqueueAiCollectTask should exist');
  assert.ok(
    collectFnMatch[0].includes('findSelectedAiTemplate'),
    'enqueueAiCollectTask should still check for template'
  );
  assert.ok(
    collectFnMatch[0].includes('getSubmittedUrl'),
    'enqueueAiCollectTask should still check for URL'
  );
});
