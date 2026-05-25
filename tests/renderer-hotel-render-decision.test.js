const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let decisionModuleUrl = '';

async function loadDecisionModule() {
  if (!decisionModuleUrl) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-hotel-render-decision-'));
    const sourceDir = path.join(__dirname, '..', 'src', 'renderer', 'modules');
    fs.writeFileSync(path.join(tempRoot, 'package.json'), '{"type":"module"}\n', 'utf-8');
    fs.copyFileSync(
      path.join(sourceDir, 'hotel-render-decision.js'),
      path.join(tempRoot, 'hotel-render-decision.js')
    );
    decisionModuleUrl = pathToFileURL(path.join(tempRoot, 'hotel-render-decision.js')).href;
    process.on('exit', () => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
  }

  return import(decisionModuleUrl);
}

test('hotel render decision marks structural changes as full rerender reasons', async () => {
  const { shouldFullRerender } = await loadDecisionModule();

  for (const reason of [
    'filter-change',
    'sort-change',
    'hotel-add',
    'batch-delete',
    'template-sync',
    'ranking-change',
    'view-mode-change'
  ]) {
    assert.equal(shouldFullRerender(reason), true, `${reason} should force full rerender`);
  }
});

test('hotel render decision allows narrow hotel mutations to try patching', async () => {
  const { getHotelListRenderDecision, shouldFullRerender } = await loadDecisionModule();

  assert.equal(shouldFullRerender('favorite'), false);
  assert.equal(shouldFullRerender('hotel-update'), false);
  assert.equal(shouldFullRerender('hotel-delete'), false);

  assert.deepEqual(
    getHotelListRenderDecision({
      reason: 'favorite',
      changedIds: [101],
      forceFull: false,
      renderScheduled: false,
      hasPendingRenderResume: false
    }),
    { mode: 'patch', changedIds: ['101'], reason: 'favorite' }
  );
});

test('hotel render decision falls back to full render when patching is unsafe', async () => {
  const { getHotelListRenderDecision } = await loadDecisionModule();

  assert.equal(
    getHotelListRenderDecision({
      reason: 'favorite',
      changedIds: [],
      forceFull: false,
      renderScheduled: false,
      hasPendingRenderResume: false
    }).mode,
    'full'
  );
  assert.equal(
    getHotelListRenderDecision({
      reason: 'favorite',
      changedIds: [1],
      forceFull: false,
      renderScheduled: true,
      hasPendingRenderResume: false
    }).mode,
    'full'
  );
  assert.equal(
    getHotelListRenderDecision({
      reason: 'hotel-update',
      changedIds: [1],
      forceFull: true,
      renderScheduled: false,
      hasPendingRenderResume: false
    }).mode,
    'full'
  );
});
