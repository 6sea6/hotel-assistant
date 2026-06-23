const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let moduleUrl = '';

async function loadModule() {
  if (!moduleUrl) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-virtual-list-'));
    const sourceDir = path.join(__dirname, '..', 'src', 'renderer', 'modules');
    fs.writeFileSync(path.join(tempRoot, 'package.json'), '{"type":"module"}\n', 'utf-8');
    fs.copyFileSync(
      path.join(sourceDir, 'hotel-virtual-list.js'),
      path.join(tempRoot, 'hotel-virtual-list.js')
    );
    moduleUrl = pathToFileURL(path.join(tempRoot, 'hotel-virtual-list.js')).href;
    process.on('exit', () => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
  }
  return import(moduleUrl);
}

test('shouldUseVirtualHotelList: default threshold is exclusive', async () => {
  const { shouldUseVirtualHotelList } = await loadModule();
  assert.equal(shouldUseVirtualHotelList(199), false);
  assert.equal(shouldUseVirtualHotelList(200), false);
  assert.equal(shouldUseVirtualHotelList(201), true);
});

test('shouldUseVirtualHotelList: custom threshold is supported', async () => {
  const { shouldUseVirtualHotelList } = await loadModule();
  assert.equal(shouldUseVirtualHotelList(50, { threshold: 100 }), false);
  assert.equal(shouldUseVirtualHotelList(150, { threshold: 100 }), true);
});

test('getVirtualScrollThreshold: card mode uses lower threshold', async () => {
  const { getVirtualScrollThreshold, CARD_VIRTUAL_SCROLL_THRESHOLD, VIRTUAL_SCROLL_THRESHOLD } =
    await loadModule();

  assert.equal(CARD_VIRTUAL_SCROLL_THRESHOLD, 80);
  assert.equal(VIRTUAL_SCROLL_THRESHOLD, 200);
  assert.equal(getVirtualScrollThreshold('card'), 80);
  assert.equal(getVirtualScrollThreshold('list'), 200);
});

test('createDefaultVirtualState: list mode defaults', async () => {
  const { createDefaultVirtualState, LIST_ROW_ESTIMATED_HEIGHT, VIRTUAL_OVERSCAN } =
    await loadModule();
  const state = createDefaultVirtualState('list');

  assert.equal(state.enabled, false);
  assert.equal(state.viewMode, 'list');
  assert.equal(state.itemCount, 0);
  assert.equal(state.estimatedItemHeight, LIST_ROW_ESTIMATED_HEIGHT);
  assert.equal(state.overscan, VIRTUAL_OVERSCAN);
  assert.equal(state.columns, 1);
  assert.equal(state.hasMeasuredItemHeight, false);
});

test('createDefaultVirtualState: card mode defaults', async () => {
  const { createDefaultVirtualState, CARD_ESTIMATED_HEIGHT, VIRTUAL_OVERSCAN } = await loadModule();
  const state = createDefaultVirtualState('card');

  assert.equal(state.enabled, false);
  assert.equal(state.viewMode, 'card');
  assert.equal(state.estimatedItemHeight, CARD_ESTIMATED_HEIGHT);
  assert.equal(state.overscan, VIRTUAL_OVERSCAN);
  assert.equal(state.columns, 3);
  assert.equal(state.hasMeasuredItemHeight, false);
});

test('calculateCardColumns: breakpoints match the card grid rules', async () => {
  const { calculateCardColumns } = await loadModule();

  assert.equal(calculateCardColumns(0), 1);
  assert.equal(calculateCardColumns(500), 1);
  assert.equal(calculateCardColumns(900), 2);
  assert.equal(calculateCardColumns(1032), 3);
  assert.equal(calculateCardColumns(1400), 3);
  assert.equal(calculateCardColumns(1600), 4);
});
