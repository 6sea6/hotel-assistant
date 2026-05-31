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

/* ---- shouldUseVirtualHotelList ---- */

test('shouldUseVirtualHotelList: 199 returns false', async () => {
  const { shouldUseVirtualHotelList } = await loadModule();
  assert.equal(shouldUseVirtualHotelList(199), false);
});

test('shouldUseVirtualHotelList: 200 returns false', async () => {
  const { shouldUseVirtualHotelList } = await loadModule();
  assert.equal(shouldUseVirtualHotelList(200), false);
});

test('shouldUseVirtualHotelList: 201 returns true', async () => {
  const { shouldUseVirtualHotelList } = await loadModule();
  assert.equal(shouldUseVirtualHotelList(201), true);
});

test('shouldUseVirtualHotelList: 1000 returns true', async () => {
  const { shouldUseVirtualHotelList } = await loadModule();
  assert.equal(shouldUseVirtualHotelList(1000), true);
});

test('shouldUseVirtualHotelList: custom threshold', async () => {
  const { shouldUseVirtualHotelList } = await loadModule();
  assert.equal(shouldUseVirtualHotelList(50, { threshold: 100 }), false);
  assert.equal(shouldUseVirtualHotelList(150, { threshold: 100 }), true);
});

test('shouldUseVirtualHotelList: card mode uses threshold 80', async () => {
  const {
    shouldUseVirtualHotelList,
    getVirtualScrollThreshold,
    CARD_VIRTUAL_SCROLL_THRESHOLD
  } = await loadModule();

  assert.equal(CARD_VIRTUAL_SCROLL_THRESHOLD, 80);
  assert.equal(getVirtualScrollThreshold('card'), 80);
  assert.equal(shouldUseVirtualHotelList(80, { threshold: getVirtualScrollThreshold('card') }), false);
  assert.equal(shouldUseVirtualHotelList(81, { threshold: getVirtualScrollThreshold('card') }), true);
});

test('shouldUseVirtualHotelList: list mode keeps threshold 200', async () => {
  const { shouldUseVirtualHotelList, getVirtualScrollThreshold, VIRTUAL_SCROLL_THRESHOLD } = await loadModule();

  assert.equal(VIRTUAL_SCROLL_THRESHOLD, 200);
  assert.equal(getVirtualScrollThreshold('list'), 200);
  assert.equal(shouldUseVirtualHotelList(81, { threshold: getVirtualScrollThreshold('list') }), false);
  assert.equal(shouldUseVirtualHotelList(201, { threshold: getVirtualScrollThreshold('list') }), true);
});

test('shouldUseVirtualHotelList: 0 returns false', async () => {
  const { shouldUseVirtualHotelList } = await loadModule();
  assert.equal(shouldUseVirtualHotelList(0), false);
});

/* ---- clampScrollTop ---- */

test('clampScrollTop: negative clamps to 0', async () => {
  const { clampScrollTop } = await loadModule();
  assert.equal(clampScrollTop(-10, 500), 0);
});

test('clampScrollTop: within range returns value', async () => {
  const { clampScrollTop } = await loadModule();
  assert.equal(clampScrollTop(250, 500), 250);
});

test('clampScrollTop: exceeds max returns max', async () => {
  const { clampScrollTop } = await loadModule();
  assert.equal(clampScrollTop(600, 500), 500);
});

test('clampScrollTop: NaN returns 0', async () => {
  const { clampScrollTop } = await loadModule();
  assert.equal(clampScrollTop(NaN, 500), 0);
});

test('clampScrollTop: maxScrollTop 0 clamps to 0', async () => {
  const { clampScrollTop } = await loadModule();
  assert.equal(clampScrollTop(100, 0), 0);
});

/* ---- calculateVirtualRange ---- */

test('calculateVirtualRange: itemCount=0 returns empty range', async () => {
  const { calculateVirtualRange } = await loadModule();
  const result = calculateVirtualRange({
    itemCount: 0,
    scrollTop: 0,
    viewportHeight: 600,
    estimatedItemHeight: 96
  });
  assert.equal(result.startIndex, 0);
  assert.equal(result.endIndex, 0);
  assert.equal(result.beforeHeight, 0);
  assert.equal(result.afterHeight, 0);
});

test('calculateVirtualRange: scrollTop=0 starts from 0 with overscan', async () => {
  const { calculateVirtualRange } = await loadModule();
  const result = calculateVirtualRange({
    itemCount: 1000,
    scrollTop: 0,
    viewportHeight: 600,
    estimatedItemHeight: 96,
    overscan: 10
  });
  assert.equal(result.startIndex, 0);
  assert.ok(result.endIndex > 0);
  assert.equal(result.beforeHeight, 0);
  assert.ok(result.afterHeight > 0);
  assert.equal(result.endIndex, Math.ceil(600 / 96) + 10);
});

test('calculateVirtualRange: middle scroll has correct before/after height', async () => {
  const { calculateVirtualRange } = await loadModule();
  const result = calculateVirtualRange({
    itemCount: 1000,
    scrollTop: 48000,
    viewportHeight: 600,
    estimatedItemHeight: 96,
    overscan: 10
  });
  const expectedStart = Math.max(0, Math.floor(48000 / 96) - 10);
  assert.equal(result.startIndex, expectedStart);
  assert.equal(result.beforeHeight, expectedStart * 96);
  assert.ok(result.endIndex <= 1000);
  assert.equal(result.afterHeight, Math.max(0, (1000 - result.endIndex) * 96));
});

test('calculateVirtualRange: near bottom endIndex equals itemCount', async () => {
  const { calculateVirtualRange } = await loadModule();
  const result = calculateVirtualRange({
    itemCount: 1000,
    scrollTop: 96000,
    viewportHeight: 600,
    estimatedItemHeight: 96,
    overscan: 10
  });
  assert.equal(result.endIndex, 1000);
  assert.equal(result.afterHeight, 0);
});

test('calculateVirtualRange: overscan applies on both sides', async () => {
  const { calculateVirtualRange } = await loadModule();
  const result = calculateVirtualRange({
    itemCount: 1000,
    scrollTop: 9600,
    viewportHeight: 600,
    estimatedItemHeight: 96,
    overscan: 5
  });
  const rawStart = Math.floor(9600 / 96);
  assert.equal(result.startIndex, Math.max(0, rawStart - 5));
  const rawEnd = rawStart + Math.ceil(600 / 96);
  assert.equal(result.endIndex, Math.min(1000, rawEnd + 5));
});

test('calculateVirtualRange: viewportHeight less than itemHeight', async () => {
  const { calculateVirtualRange } = await loadModule();
  const result = calculateVirtualRange({
    itemCount: 100,
    scrollTop: 500,
    viewportHeight: 50,
    estimatedItemHeight: 96,
    overscan: 5
  });
  assert.ok(result.startIndex >= 0);
  assert.ok(result.endIndex <= 100);
  assert.ok(result.endIndex > result.startIndex);
});

test('calculateVirtualRange: estimatedItemHeight=0 returns empty', async () => {
  const { calculateVirtualRange } = await loadModule();
  const result = calculateVirtualRange({
    itemCount: 100,
    scrollTop: 0,
    viewportHeight: 600,
    estimatedItemHeight: 0
  });
  assert.equal(result.startIndex, 0);
  assert.equal(result.endIndex, 0);
});

/* ---- calculateCardVirtualRange ---- */

test('calculateCardVirtualRange: itemCount=0 returns empty', async () => {
  const { calculateCardVirtualRange } = await loadModule();
  const result = calculateCardVirtualRange({
    itemCount: 0,
    scrollTop: 0,
    viewportHeight: 600,
    estimatedItemHeight: 260,
    columns: 3
  });
  assert.equal(result.startIndex, 0);
  assert.equal(result.endIndex, 0);
});

test('calculateCardVirtualRange: scrollTop=0 with 3 columns', async () => {
  const { calculateCardVirtualRange } = await loadModule();
  const result = calculateCardVirtualRange({
    itemCount: 1000,
    scrollTop: 0,
    viewportHeight: 600,
    estimatedItemHeight: 260,
    columns: 3,
    gap: 16,
    overscan: 2
  });
  assert.equal(result.startIndex, 0);
  assert.ok(result.endIndex > 0);
  assert.equal(result.rowStartIndex, 0);
  assert.equal(result.beforeHeight, 0);
});

test('calculateCardVirtualRange: startIndex/endIndex are multiples of columns', async () => {
  const { calculateCardVirtualRange } = await loadModule();
  const result = calculateCardVirtualRange({
    itemCount: 100,
    scrollTop: 2000,
    viewportHeight: 600,
    estimatedItemHeight: 260,
    columns: 3,
    gap: 16,
    overscan: 2
  });
  assert.equal(result.startIndex % 3, 0, 'startIndex should be column-aligned');
  assert.ok(result.endIndex <= 100);
});

test('calculateCardVirtualRange: near bottom', async () => {
  const { calculateCardVirtualRange } = await loadModule();
  const result = calculateCardVirtualRange({
    itemCount: 100,
    scrollTop: 10000,
    viewportHeight: 600,
    estimatedItemHeight: 260,
    columns: 3,
    gap: 16,
    overscan: 2
  });
  assert.equal(result.endIndex, 100);
  assert.equal(result.afterHeight, 0);
});

/* ---- createDefaultVirtualState ---- */

test('createDefaultVirtualState: list mode defaults', async () => {
  const { createDefaultVirtualState, LIST_ROW_ESTIMATED_HEIGHT } = await loadModule();
  const state = createDefaultVirtualState('list');
  assert.equal(state.enabled, false);
  assert.equal(state.viewMode, 'list');
  assert.equal(state.itemCount, 0);
  assert.equal(state.estimatedItemHeight, LIST_ROW_ESTIMATED_HEIGHT);
  assert.equal(state.columns, 1);
  assert.equal(state.hasMeasuredItemHeight, false);
});

test('createDefaultVirtualState: card mode defaults', async () => {
  const { createDefaultVirtualState, CARD_ESTIMATED_HEIGHT } = await loadModule();
  const state = createDefaultVirtualState('card');
  assert.equal(state.enabled, false);
  assert.equal(state.viewMode, 'card');
  assert.equal(state.estimatedItemHeight, CARD_ESTIMATED_HEIGHT);
  assert.equal(state.columns, 3);
  assert.equal(state.hasMeasuredItemHeight, false);
});

/* ---- measureAverageHeight ---- */

test('measureAverageHeight: empty returns fallback', async () => {
  const { measureAverageHeight } = await loadModule();
  assert.equal(measureAverageHeight([], 96), 96);
});

test('measureAverageHeight: null returns fallback', async () => {
  const { measureAverageHeight } = await loadModule();
  assert.equal(measureAverageHeight(null, 96), 96);
});

/* ---- calculateCardColumns ---- */

test('calculateCardColumns: small width returns 1', async () => {
  const { calculateCardColumns } = await loadModule();
  assert.equal(calculateCardColumns(500), 1);
});

test('calculateCardColumns: medium width returns 2', async () => {
  const { calculateCardColumns } = await loadModule();
  assert.equal(calculateCardColumns(900), 2);
});

test('calculateCardColumns: large width returns 3', async () => {
  const { calculateCardColumns } = await loadModule();
  assert.equal(calculateCardColumns(1400), 3);
});

test('calculateCardColumns: 0 returns 1', async () => {
  const { calculateCardColumns } = await loadModule();
  assert.equal(calculateCardColumns(0), 1);
});

/* ---- 虚拟区间一致性 ---- */

test('calculateVirtualRange: total rendered items + spacers cover full height', async () => {
  const { calculateVirtualRange } = await loadModule();
  const itemCount = 1000;
  const estimatedItemHeight = 96;
  const result = calculateVirtualRange({
    itemCount,
    scrollTop: 30000,
    viewportHeight: 600,
    estimatedItemHeight,
    overscan: 10
  });
  const renderedCount = result.endIndex - result.startIndex;
  const totalCoverage = result.beforeHeight + renderedCount * estimatedItemHeight + result.afterHeight;
  assert.equal(totalCoverage, itemCount * estimatedItemHeight);
});

/* ---- 超大 scrollTop clamp 测试 ---- */

test('calculateVirtualRange: huge scrollTop clamps to max and endIndex === itemCount', async () => {
  const { calculateVirtualRange } = await loadModule();
  const result = calculateVirtualRange({
    itemCount: 1000,
    scrollTop: 999999,
    viewportHeight: 600,
    estimatedItemHeight: 96,
    overscan: 10
  });
  assert.equal(result.endIndex, 1000);
  assert.equal(result.afterHeight, 0);
  assert.ok(result.startIndex >= 0);
  assert.ok(result.startIndex <= result.endIndex);
});

test('calculateVirtualRange: scrollTop=NaN clamps to 0', async () => {
  const { calculateVirtualRange } = await loadModule();
  const result = calculateVirtualRange({
    itemCount: 500,
    scrollTop: NaN,
    viewportHeight: 600,
    estimatedItemHeight: 96,
    overscan: 10
  });
  assert.equal(result.startIndex, 0);
  assert.ok(result.endIndex > 0);
});

test('calculateVirtualRange: negative scrollTop clamps to 0', async () => {
  const { calculateVirtualRange } = await loadModule();
  const result = calculateVirtualRange({
    itemCount: 500,
    scrollTop: -500,
    viewportHeight: 600,
    estimatedItemHeight: 96,
    overscan: 10
  });
  assert.equal(result.startIndex, 0);
  assert.equal(result.beforeHeight, 0);
});

test('calculateVirtualRange: startIndex never exceeds endIndex for any scrollTop', async () => {
  const { calculateVirtualRange } = await loadModule();
  const testScrollTops = [0, 100, 1000, 10000, 50000, 99999, -1, NaN, Infinity];
  for (const scrollTop of testScrollTops) {
    const result = calculateVirtualRange({
      itemCount: 100,
      scrollTop,
      viewportHeight: 600,
      estimatedItemHeight: 96,
      overscan: 10
    });
    assert.ok(
      result.startIndex <= result.endIndex,
      `startIndex (${result.startIndex}) should <= endIndex (${result.endIndex}) for scrollTop=${scrollTop}`
    );
  }
});

test('calculateCardVirtualRange: huge scrollTop clamps and endIndex === itemCount', async () => {
  const { calculateCardVirtualRange } = await loadModule();
  const result = calculateCardVirtualRange({
    itemCount: 100,
    scrollTop: 999999,
    viewportHeight: 600,
    estimatedItemHeight: 260,
    columns: 3,
    gap: 16,
    overscan: 2
  });
  assert.equal(result.endIndex, 100);
  assert.equal(result.afterHeight, 0);
  assert.ok(result.startIndex >= 0);
  assert.ok(result.startIndex <= result.endIndex);
});

test('calculateCardVirtualRange: negative scrollTop clamps to 0', async () => {
  const { calculateCardVirtualRange } = await loadModule();
  const result = calculateCardVirtualRange({
    itemCount: 100,
    scrollTop: -100,
    viewportHeight: 600,
    estimatedItemHeight: 260,
    columns: 3,
    gap: 16,
    overscan: 2
  });
  assert.equal(result.startIndex, 0);
  assert.equal(result.beforeHeight, 0);
});

test('calculateCardVirtualRange: startIndex never exceeds endIndex for any scrollTop', async () => {
  const { calculateCardVirtualRange } = await loadModule();
  const testScrollTops = [0, 100, 1000, 5000, 50000, 99999, -1, NaN, Infinity];
  for (const scrollTop of testScrollTops) {
    const result = calculateCardVirtualRange({
      itemCount: 50,
      scrollTop,
      viewportHeight: 600,
      estimatedItemHeight: 260,
      columns: 3,
      gap: 16,
      overscan: 2
    });
    assert.ok(
      result.startIndex <= result.endIndex,
      `startIndex (${result.startIndex}) should <= endIndex (${result.endIndex}) for scrollTop=${scrollTop}`
    );
  }
});
