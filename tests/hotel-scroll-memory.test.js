const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let moduleUrl = '';

async function loadModule() {
  if (!moduleUrl) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-scroll-memory-'));
    const sourceDir = path.join(__dirname, '..', 'src', 'renderer', 'modules');
    fs.writeFileSync(path.join(tempRoot, 'package.json'), '{"type":"module"}\n', 'utf-8');
    fs.copyFileSync(
      path.join(sourceDir, 'state.js'),
      path.join(tempRoot, 'state.js')
    );
    moduleUrl = pathToFileURL(path.join(tempRoot, 'state.js')).href;
    process.on('exit', () => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
  }
  return import(moduleUrl);
}

/* ---- getScrollBehaviorForReason ---- */

test('getScrollBehaviorForReason: favorite returns keep', async () => {
  const { getScrollBehaviorForReason } = await loadModule();
  assert.equal(getScrollBehaviorForReason('favorite', '[]'), 'keep');
});

test('getScrollBehaviorForReason: hotel-update returns keep', async () => {
  const { getScrollBehaviorForReason } = await loadModule();
  assert.equal(getScrollBehaviorForReason('hotel-update', '[]'), 'keep');
});

test('getScrollBehaviorForReason: hotel-delete returns keep', async () => {
  const { getScrollBehaviorForReason } = await loadModule();
  assert.equal(getScrollBehaviorForReason('hotel-delete', '[]'), 'keep');
});

test('getScrollBehaviorForReason: view-mode-change returns top', async () => {
  const { getScrollBehaviorForReason } = await loadModule();
  assert.equal(getScrollBehaviorForReason('view-mode-change', '[]'), 'top');
});

test('getScrollBehaviorForReason: filter-change returns top', async () => {
  const { getScrollBehaviorForReason } = await loadModule();
  assert.equal(getScrollBehaviorForReason('filter-change', '[]'), 'top');
});

test('getScrollBehaviorForReason: sort-change returns top', async () => {
  const { getScrollBehaviorForReason } = await loadModule();
  assert.equal(getScrollBehaviorForReason('sort-change', '[]'), 'top');
});

test('getScrollBehaviorForReason: template-sync returns top', async () => {
  const { getScrollBehaviorForReason } = await loadModule();
  assert.equal(getScrollBehaviorForReason('template-sync', '[]'), 'top');
});

test('getScrollBehaviorForReason: settings-change returns top', async () => {
  const { getScrollBehaviorForReason } = await loadModule();
  assert.equal(getScrollBehaviorForReason('settings-change', '[]'), 'top');
});

test('getScrollBehaviorForReason: hotel-update returns keep even with different filtersKey', async () => {
  const { getScrollBehaviorForReason, saveScrollMemory } = await loadModule();
  saveScrollMemory({ scrollTop: 500, filtersKey: '["old-name","","","","",""]' });
  // hotel-update should keep scroll even if filtersKey changed
  assert.equal(getScrollBehaviorForReason('hotel-update', '["new-name","","","","",""]'), 'keep');
});

test('getScrollBehaviorForReason: hotel-delete returns keep even with different filtersKey', async () => {
  const { getScrollBehaviorForReason, saveScrollMemory } = await loadModule();
  saveScrollMemory({ scrollTop: 500, filtersKey: '["old","","","","",""]' });
  assert.equal(getScrollBehaviorForReason('hotel-delete', '["new","","","","",""]'), 'keep');
});

test('getScrollBehaviorForReason: favorite returns keep even with different filtersKey', async () => {
  const { getScrollBehaviorForReason, saveScrollMemory } = await loadModule();
  saveScrollMemory({ scrollTop: 500, filtersKey: '["","","0","","",""]' });
  assert.equal(getScrollBehaviorForReason('favorite', '["","","1","","",""]'), 'keep');
});

test('getScrollBehaviorForReason: view-mode-change returns top when filtersKey changed', async () => {
  const { getScrollBehaviorForReason, saveScrollMemory } = await loadModule();
  saveScrollMemory({ scrollTop: 500, filtersKey: '["old","","","","",""]' });
  assert.equal(getScrollBehaviorForReason('view-mode-change', '["new","","","","",""]'), 'top');
});

test('getScrollBehaviorForReason: view-mode-change returns top when filtersKey unchanged', async () => {
  const { getScrollBehaviorForReason, saveScrollMemory } = await loadModule();
  const fk = '["test","","","","",""]';
  saveScrollMemory({ scrollTop: 500, filtersKey: fk });
  assert.equal(getScrollBehaviorForReason('view-mode-change', fk), 'top');
});

test('getScrollBehaviorForReason: unknown reason returns top when filtersKey changed', async () => {
  const { getScrollBehaviorForReason, saveScrollMemory } = await loadModule();
  saveScrollMemory({ scrollTop: 500, filtersKey: '["old","","","","",""]' });
  assert.equal(getScrollBehaviorForReason('batch-delete', '["new","","","","",""]'), 'top');
});

test('getScrollBehaviorForReason: empty reason returns top', async () => {
  const { getScrollBehaviorForReason } = await loadModule();
  assert.equal(getScrollBehaviorForReason('', '[]'), 'top');
});

test('getScrollBehaviorForReason: null reason returns top', async () => {
  const { getScrollBehaviorForReason } = await loadModule();
  assert.equal(getScrollBehaviorForReason(null, '[]'), 'top');
});

test('getScrollBehaviorForReason: unknown reason returns top', async () => {
  const { getScrollBehaviorForReason } = await loadModule();
  assert.equal(getScrollBehaviorForReason('batch-delete', '[]'), 'top');
});

test('getScrollBehaviorForReason: data-reload returns top', async () => {
  const { getScrollBehaviorForReason } = await loadModule();
  assert.equal(getScrollBehaviorForReason('data-reload', '[]'), 'top');
});

test('getScrollBehaviorForReason: rule-delete returns top', async () => {
  const { getScrollBehaviorForReason } = await loadModule();
  assert.equal(getScrollBehaviorForReason('rule-delete', '[]'), 'top');
});

test('getScrollBehaviorForReason: fallback returns top', async () => {
  const { getScrollBehaviorForReason } = await loadModule();
  assert.equal(getScrollBehaviorForReason('fallback', '[]'), 'top');
});

test('getScrollBehaviorForReason: hotel-add returns top', async () => {
  const { getScrollBehaviorForReason } = await loadModule();
  assert.equal(getScrollBehaviorForReason('hotel-add', '[]'), 'top');
});

/* ---- saveScrollMemory / hotelListScrollMemory ---- */

test('saveScrollMemory: stores values correctly', async () => {
  const { saveScrollMemory, hotelListScrollMemory } = await loadModule();
  saveScrollMemory({
    scrollTop: 1234,
    anchorHotelId: 42,
    anchorRank: 10,
    viewMode: 'list',
    filtersKey: 'test-key'
  });
  assert.equal(hotelListScrollMemory.lastScrollTop, 1234);
  assert.equal(hotelListScrollMemory.lastAnchorHotelId, 42);
  assert.equal(hotelListScrollMemory.lastAnchorRank, 10);
  assert.equal(hotelListScrollMemory.viewMode, 'list');
  assert.equal(hotelListScrollMemory.filtersKey, 'test-key');
});

test('saveScrollMemory: defaults missing fields', async () => {
  const { saveScrollMemory, hotelListScrollMemory } = await loadModule();
  saveScrollMemory({ scrollTop: 500 });
  assert.equal(hotelListScrollMemory.lastScrollTop, 500);
  assert.equal(hotelListScrollMemory.lastAnchorHotelId, null);
  assert.equal(hotelListScrollMemory.lastAnchorRank, 0);
});
