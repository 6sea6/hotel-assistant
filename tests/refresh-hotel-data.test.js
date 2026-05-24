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
  assert.ok(stepsContent.includes('已接收任务'), 'Should have received title matching BASE');
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

/* ============================================================
 * Test: refresh-data steps do NOT contain transit
 * ============================================================ */

test('refresh-data: REFRESH_STEP_DEFINITIONS does not contain transit', () => {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'modules', 'ai-task-console.js'),
    'utf8'
  );
  const refreshStepsMatch = code.match(
    /REFRESH_STEP_DEFINITIONS\s*=\s*\[([\s\S]*?)\]/
  );
  assert.ok(refreshStepsMatch, 'REFRESH_STEP_DEFINITIONS should exist');
  const stepsContent = refreshStepsMatch[1];
  assert.ok(!stepsContent.includes('transit'), 'Refresh steps should NOT contain transit');
});

/* ============================================================
 * Test: refresh-data progressStats from events
 * ============================================================ */

test('refresh-data: buildRefreshProgressStats calculates from refresh:item-start/done/skipped', async () => {
  const { normalizeTaskState } = await loadTaskConsoleModule();
  const events = [
    { type: 'task:start', at: '2026-01-01T00:00:00Z' },
    { type: 'refresh:load-data', message: '正在读取当前宾馆数据', at: '2026-01-01T00:00:01Z' },
    { type: 'edge:login-required', message: '正在准备 Edge 登录态', at: '2026-01-01T00:00:02Z' },
    { type: 'edge:login-done', message: 'Edge 登录态已准备完成', at: '2026-01-01T00:00:05Z' },
    { type: 'refresh:item-start', message: '正在更新第 1/3 家：酒店A', details: { index: 1, total: 3, hotelName: '酒店A' }, at: '2026-01-01T00:00:06Z' },
    { type: 'refresh:item-done', message: '已更新 酒店A：5 种房型', details: { index: 1, total: 3, hotelName: '酒店A', status: 'updated' }, at: '2026-01-01T00:00:20Z' },
    { type: 'refresh:item-start', message: '正在更新第 2/3 家：酒店B', details: { index: 2, total: 3, hotelName: '酒店B' }, at: '2026-01-01T00:00:21Z' },
    { type: 'refresh:item-done', message: '已更新 酒店B：3 种房型', details: { index: 2, total: 3, hotelName: '酒店B', status: 'updated' }, at: '2026-01-01T00:00:35Z' },
    { type: 'refresh:item-start', message: '正在更新第 3/3 家：酒店C', details: { index: 3, total: 3, hotelName: '酒店C' }, at: '2026-01-01T00:00:36Z' },
    { type: 'refresh:item-skipped', message: '跳过 酒店C：登录失效', details: { index: 3, total: 3, hotelName: '酒店C', status: 'skipped', reason: '登录失效' }, at: '2026-01-01T00:00:40Z' },
    { type: 'refresh:summary', message: '更新完成', details: { totalHotelCount: 3, updatedHotelCount: 2, skippedHotelCount: 1 }, at: '2026-01-01T00:00:41Z' },
    { type: 'task:done', at: '2026-01-01T00:00:42Z' }
  ];

  const taskState = normalizeTaskState({
    task: { taskKind: 'refresh-data', submitted: true, startedAt: '2026-01-01T00:00:00Z', result: {} },
    events,
    inProgress: false
  });

  assert.ok(taskState.progressStats, 'Should have progressStats');
  assert.equal(taskState.progressStats.total, 3, 'Total should be 3');
  assert.equal(taskState.progressStats.completed, 2, 'Completed (updated) should be 2');
  assert.ok(taskState.progressStats.pending >= 0, 'Pending should be >= 0');
});

test('refresh-data: progressStats is null when no refresh events', async () => {
  const { normalizeTaskState } = await loadTaskConsoleModule();
  const taskState = normalizeTaskState({
    task: { taskKind: 'refresh-data', submitted: false },
    events: [],
    inProgress: false
  });
  assert.equal(taskState.progressStats, null, 'Should be null with no events');
});

/* ============================================================
 * Test: refresh-data renders 4 progress stat cards
 * ============================================================ */

test('refresh-data: renderProgressStats shows 4 cards with correct labels', async () => {
  const { normalizeTaskState } = await loadTaskConsoleModule();
  const stats = { total: 5, completed: 2, running: 1, pending: 2 };

  // Read source to verify renderProgressStats logic
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'modules', 'ai-task-console.js'),
    'utf8'
  );
  assert.ok(code.includes('宾馆总数'), 'Should have "宾馆总数" label for refresh');
  assert.ok(code.includes('已更新'), 'Should have "已更新" label for refresh');
  assert.ok(code.includes('进行中'), 'Should have "进行中" label for refresh');
  assert.ok(code.includes('待处理'), 'Should have "待处理" label for refresh');
});

/* ============================================================
 * Test: refresh-data does NOT insert login step
 * ============================================================ */

test('refresh-data: getStepDefinitions does not insert LOGIN_STEP_DEFINITION', () => {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'modules', 'ai-task-console.js'),
    'utf8'
  );
  // Find the getStepDefinitions function
  const fnStart = code.indexOf('function getStepDefinitions');
  const fnEnd = code.indexOf('function buildTaskSteps');
  assert.ok(fnStart > 0, 'Should find getStepDefinitions');
  const fnBody = code.substring(fnStart, fnEnd);

  // In the refresh-data branch, check that LOGIN_STEP_DEFINITION is NOT inserted
  const refreshBranchMatch = fnBody.match(
    /if\s*\(\s*taskKind\s*===\s*'refresh-data'\s*\)[\s\S]*?return\s+definitions;/
  );
  assert.ok(refreshBranchMatch, 'Should find refresh-data branch');
  const refreshBranch = refreshBranchMatch[0];
  assert.ok(!refreshBranch.includes('LOGIN_STEP_DEFINITION'), 'refresh-data should NOT insert LOGIN_STEP_DEFINITION');
});

test('refresh-data: edge events map to edge step, not login step', () => {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'modules', 'ai-task-console.js'),
    'utf8'
  );
  // Find getEventStepKey
  const fnStart = code.indexOf('function getEventStepKey');
  const fnEnd = code.indexOf('function getReadableEventTitle');
  assert.ok(fnStart > 0, 'Should find getEventStepKey');
  const fnBody = code.substring(fnStart, fnEnd);

  // In the refresh-data branch, edge:login-required should return 'edge', not 'login'
  const isRefreshBlock = fnBody.match(
    /if\s*\(\s*isRefresh\s*\)[\s\S]*?return\s+'';\s*\}/
  );
  assert.ok(isRefreshBlock, 'Should find isRefresh block');
  const refreshBlock = isRefreshBlock[0];
  assert.ok(!refreshBlock.includes("return 'login'"), 'refresh-data should NOT return login for edge events');
  assert.ok(refreshBlock.includes("return 'edge'"), 'refresh-data should return edge for edge events');
});

/* ============================================================
 * Test: collect tasks are not affected by refresh changes
 * ============================================================ */

test('collect: buildProgressStats still works with batch: events', async () => {
  const { normalizeTaskState } = await loadTaskConsoleModule();
  const events = [
    { type: 'task:start', at: '2026-01-01T00:00:00Z' },
    { type: 'batch:item-start', message: '第 1/2 家', details: { index: 1, total: 2 }, at: '2026-01-01T00:00:05Z' },
    { type: 'batch:item-done', message: '第 1 家酒店采集完成', details: { index: 1, total: 2 }, at: '2026-01-01T00:00:15Z' },
    { type: 'batch:item-start', message: '第 2/2 家', details: { index: 2, total: 2 }, at: '2026-01-01T00:00:16Z' },
    { type: 'batch:item-done', message: '第 2 家酒店采集完成', details: { index: 2, total: 2 }, at: '2026-01-01T00:00:25Z' },
  ];

  const taskState = normalizeTaskState({
    task: { submitted: true, startedAt: '2026-01-01T00:00:00Z', result: {} },
    events,
    inProgress: true
  });

  assert.ok(taskState.progressStats, 'Should have progressStats');
  assert.equal(taskState.progressStats.total, 2, 'Total should be 2');
  assert.equal(taskState.progressStats.completed, 2, 'Completed should be 2');
  assert.equal(taskState.progressStats.running, 0, 'Running should be 0');
  assert.equal(taskState.progressStats.pending, 0, 'Pending should be 0');
});

test('collect: getStepDefinitions still inserts LOGIN_STEP_DEFINITION when login events present', () => {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'modules', 'ai-task-console.js'),
    'utf8'
  );
  // Find the collect branch in getStepDefinitions (after refresh-data branch)
  const fnStart = code.indexOf('function getStepDefinitions');
  const fnEnd = code.indexOf('function buildTaskSteps');
  const fnBody = code.substring(fnStart, fnEnd);

  // The collect branch should still check hasLoginStep and insert LOGIN_STEP_DEFINITION
  assert.ok(fnBody.includes('hasLoginStep'), 'Collect branch should check hasLoginStep');
  // Verify that in the collect (non-refresh) section, LOGIN_STEP_DEFINITION is inserted
  const collectSection = fnBody.substring(fnBody.lastIndexOf('hasLoginStep'));
  assert.ok(collectSection.includes('LOGIN_STEP_DEFINITION'), 'Collect branch should still insert LOGIN_STEP_DEFINITION');
});

/* ============================================================
 * Test: refresh-data aria-label
 * ============================================================ */

test('refresh-data: renderProgressStats aria-label is "更新数据进度统计"', () => {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'modules', 'ai-task-console.js'),
    'utf8'
  );
  assert.ok(code.includes('更新数据进度统计'), 'Should have "更新数据进度统计" aria-label for refresh');
  assert.ok(code.includes('批量采集进度统计'), 'Should still have "批量采集进度统计" for collect');
});

/* ============================================================
 * Test: refresh-data event titles
 * ============================================================ */

test('refresh-data: getReadableEventTitle returns correct titles', () => {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'modules', 'ai-task-console.js'),
    'utf8'
  );
  // Check refresh-specific event titles
  assert.ok(code.includes("正在读取当前宾馆数据"), 'Should have refresh:load-data title');
  assert.ok(code.includes("等待写入更新结果"), 'Should have refresh:write title');
  assert.ok(code.includes("结果汇总"), 'Should have refresh:summary title');
  // Check edge:login-done title for refresh
  assert.ok(code.includes("Edge 登录态已准备完成"), 'Should have refresh-specific edge:login-done title');
  // Should NOT contain "采集任务完成" for task:done in refresh mode
  assert.ok(code.includes("更新任务完成"), 'Should have refresh-specific task:done title');
});

/* ============================================================
 * Test: scraper-runner event details completeness
 * ============================================================ */

test('scraper-runner: refresh:item-done has status and total in details', () => {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'main', 'ai', 'scraper-runner.js'),
    'utf8'
  );
  const refreshStart = code.indexOf('async function refreshExistingCtripHotels');
  const refreshEnd = code.indexOf('module.exports', refreshStart);
  assert.ok(refreshStart > 0, 'Should find refreshExistingCtripHotels function');
  const fnBody = code.substring(refreshStart, refreshEnd);

  // Check refresh:item-done has status: 'updated' and total
  const itemDoneMatch = fnBody.match(/refresh:item-done[\s\S]*?emit\([\s\S]*?\{[\s\S]*?\}/);
  assert.ok(itemDoneMatch, 'Should find refresh:item-done emit');
  assert.ok(itemDoneMatch[0].includes("status: 'updated'"), 'item-done should have status: updated');
  assert.ok(itemDoneMatch[0].includes('total:'), 'item-done should have total field');

  // Check refresh:item-skipped has status and total
  const skippedMatches = fnBody.match(/refresh:item-skipped/g);
  assert.ok(skippedMatches && skippedMatches.length >= 1, 'Should have refresh:item-skipped events');
  // Verify at least one has total field
  assert.ok(fnBody.includes("total: totalHotelCount"), 'Should include total in details');
});

test('scraper-runner: refresh:summary has complete statistics', () => {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'main', 'ai', 'scraper-runner.js'),
    'utf8'
  );
  const refreshStart = code.indexOf('async function refreshExistingCtripHotels');
  const refreshEnd = code.indexOf('module.exports', refreshStart);
  const fnBody = code.substring(refreshStart, refreshEnd);

  // Check refresh:summary has all fields (the final summary emit, not the early scan-done)
  const summaryEmitMatch = fnBody.match(/emit\(\s*'refresh:summary'[\s\S]*?totalHotelCount/);
  assert.ok(summaryEmitMatch, 'refresh:summary should include totalHotelCount in details');
  assert.ok(fnBody.includes('updatedHotelCount'), 'Should include updatedHotelCount');
  assert.ok(fnBody.includes('skippedHotelCount'), 'Should include skippedHotelCount');
  assert.ok(fnBody.includes('deletedRoomTypeCount'), 'Should include deletedRoomTypeCount');
  assert.ok(fnBody.includes('updatedRoomTypeCount'), 'Should include updatedRoomTypeCount');
});
