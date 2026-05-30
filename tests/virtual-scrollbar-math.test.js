const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let moduleUrl = '';

async function loadModule() {
  if (!moduleUrl) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'virtual-scrollbar-math-'));
    const sourceDir = path.join(__dirname, '..', 'src', 'renderer', 'modules');
    fs.writeFileSync(path.join(tempRoot, 'package.json'), '{"type":"module"}\n', 'utf-8');
    fs.copyFileSync(
      path.join(sourceDir, 'virtual-scrollbar-math.js'),
      path.join(tempRoot, 'virtual-scrollbar-math.js')
    );
    moduleUrl = pathToFileURL(path.join(tempRoot, 'virtual-scrollbar-math.js')).href;
    process.on('exit', () => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
  }
  return import(moduleUrl);
}

/* ---- calculateThumbMetrics ---- */

test('calculateThumbMetrics: content fits in viewport should hide', async () => {
  const { calculateThumbMetrics } = await loadModule();
  const result = calculateThumbMetrics({
    clientHeight: 600,
    scrollHeight: 600,
    scrollTop: 0,
    trackHeight: 500
  });
  assert.equal(result.shouldHide, true);
  assert.equal(result.thumbHeight, 0);
});

test('calculateThumbMetrics: content shorter than viewport should hide', async () => {
  const { calculateThumbMetrics } = await loadModule();
  const result = calculateThumbMetrics({
    clientHeight: 600,
    scrollHeight: 400,
    scrollTop: 0,
    trackHeight: 500
  });
  assert.equal(result.shouldHide, true);
});

test('calculateThumbMetrics: zero trackHeight should hide', async () => {
  const { calculateThumbMetrics } = await loadModule();
  const result = calculateThumbMetrics({
    clientHeight: 600,
    scrollHeight: 2000,
    scrollTop: 0,
    trackHeight: 0
  });
  assert.equal(result.shouldHide, true);
});

test('calculateThumbMetrics: zero clientHeight should hide', async () => {
  const { calculateThumbMetrics } = await loadModule();
  const result = calculateThumbMetrics({
    clientHeight: 0,
    scrollHeight: 2000,
    scrollTop: 0,
    trackHeight: 500
  });
  assert.equal(result.shouldHide, true);
});

test('calculateThumbMetrics: scrollTop=0 thumbTop=0', async () => {
  const { calculateThumbMetrics } = await loadModule();
  const result = calculateThumbMetrics({
    clientHeight: 600,
    scrollHeight: 3000,
    scrollTop: 0,
    trackHeight: 500
  });
  assert.equal(result.shouldHide, false);
  assert.equal(result.thumbTop, 0);
  assert.ok(result.thumbHeight >= 32);
});

test('calculateThumbMetrics: scrollTop=max thumbTop=maxThumbTop', async () => {
  const { calculateThumbMetrics } = await loadModule();
  const result = calculateThumbMetrics({
    clientHeight: 600,
    scrollHeight: 3000,
    scrollTop: 2400,
    trackHeight: 500
  });
  assert.equal(result.shouldHide, false);
  assert.equal(result.thumbTop, result.maxThumbTop);
});

test('calculateThumbMetrics: thumbHeight respects minThumbHeight', async () => {
  const { calculateThumbMetrics } = await loadModule();
  const result = calculateThumbMetrics({
    clientHeight: 600,
    scrollHeight: 100000,
    scrollTop: 0,
    trackHeight: 500,
    minThumbHeight: 50
  });
  assert.ok(result.thumbHeight >= 50);
});

test('calculateThumbMetrics: maxScrollTop = scrollHeight - clientHeight', async () => {
  const { calculateThumbMetrics } = await loadModule();
  const result = calculateThumbMetrics({
    clientHeight: 600,
    scrollHeight: 3000,
    scrollTop: 0,
    trackHeight: 500
  });
  assert.equal(result.maxScrollTop, 2400);
});

/* ---- calculateScrollTopFromTrackClick ---- */

test('calculateScrollTopFromTrackClick: click at top returns near 0', async () => {
  const { calculateScrollTopFromTrackClick } = await loadModule();
  const result = calculateScrollTopFromTrackClick({
    clickY: 0,
    trackHeight: 500,
    thumbHeight: 100,
    clientHeight: 600,
    scrollHeight: 3000
  });
  assert.ok(result >= 0);
  assert.ok(result < 100);
});

test('calculateScrollTopFromTrackClick: click at bottom returns near max', async () => {
  const { calculateScrollTopFromTrackClick } = await loadModule();
  const result = calculateScrollTopFromTrackClick({
    clickY: 500,
    trackHeight: 500,
    thumbHeight: 100,
    clientHeight: 600,
    scrollHeight: 3000
  });
  const maxScrollTop = 2400;
  assert.ok(result > maxScrollTop - 200);
  assert.ok(result <= maxScrollTop);
});

test('calculateScrollTopFromTrackClick: click at middle returns near middle', async () => {
  const { calculateScrollTopFromTrackClick } = await loadModule();
  const result = calculateScrollTopFromTrackClick({
    clickY: 250,
    trackHeight: 500,
    thumbHeight: 100,
    clientHeight: 600,
    scrollHeight: 3000
  });
  const maxScrollTop = 2400;
  assert.ok(result > maxScrollTop * 0.3);
  assert.ok(result < maxScrollTop * 0.7);
});

test('calculateScrollTopFromTrackClick: content fits returns 0', async () => {
  const { calculateScrollTopFromTrackClick } = await loadModule();
  const result = calculateScrollTopFromTrackClick({
    clickY: 250,
    trackHeight: 500,
    thumbHeight: 100,
    clientHeight: 600,
    scrollHeight: 400
  });
  assert.equal(result, 0);
});

/* ---- calculateScrollTopFromDrag ---- */

test('calculateScrollTopFromDrag: no movement returns startScrollTop', async () => {
  const { calculateScrollTopFromDrag } = await loadModule();
  const result = calculateScrollTopFromDrag({
    deltaY: 0,
    maxThumbTop: 400,
    maxScrollTop: 2400,
    startScrollTop: 500
  });
  assert.equal(result, 500);
});

test('calculateScrollTopFromDrag: positive deltaY increases scrollTop', async () => {
  const { calculateScrollTopFromDrag } = await loadModule();
  const result = calculateScrollTopFromDrag({
    deltaY: 100,
    maxThumbTop: 400,
    maxScrollTop: 2400,
    startScrollTop: 0
  });
  assert.ok(result > 0);
});

test('calculateScrollTopFromDrag: negative deltaY decreases scrollTop', async () => {
  const { calculateScrollTopFromDrag } = await loadModule();
  const result = calculateScrollTopFromDrag({
    deltaY: -100,
    maxThumbTop: 400,
    maxScrollTop: 2400,
    startScrollTop: 500
  });
  assert.ok(result < 500);
});

test('calculateScrollTopFromDrag: clamps to 0', async () => {
  const { calculateScrollTopFromDrag } = await loadModule();
  const result = calculateScrollTopFromDrag({
    deltaY: -1000,
    maxThumbTop: 400,
    maxScrollTop: 2400,
    startScrollTop: 100
  });
  assert.equal(result, 0);
});

test('calculateScrollTopFromDrag: clamps to maxScrollTop', async () => {
  const { calculateScrollTopFromDrag } = await loadModule();
  const result = calculateScrollTopFromDrag({
    deltaY: 1000,
    maxThumbTop: 400,
    maxScrollTop: 2400,
    startScrollTop: 2000
  });
  assert.equal(result, 2400);
});

/* ---- clampValue ---- */

test('clampValue: within range returns value', async () => {
  const { clampValue } = await loadModule();
  assert.equal(clampValue(5, 0, 10), 5);
});

test('clampValue: below min returns min', async () => {
  const { clampValue } = await loadModule();
  assert.equal(clampValue(-5, 0, 10), 0);
});

test('clampValue: above max returns max', async () => {
  const { clampValue } = await loadModule();
  assert.equal(clampValue(15, 0, 10), 10);
});

test('clampValue: NaN returns min', async () => {
  const { clampValue } = await loadModule();
  assert.equal(clampValue(NaN, 0, 10), 0);
});

test('clampValue: Infinity returns max', async () => {
  const { clampValue } = await loadModule();
  assert.equal(clampValue(Infinity, 0, 10), 10);
});
