const test = require('node:test');
const assert = require('node:assert/strict');

test('shared browser launch args keep visible windows on screen', () => {
  const { buildVisibleBrowserWindowArgs } = require('../src/browser-launch-args');
  const args = buildVisibleBrowserWindowArgs();

  assert.deepEqual(args, ['--new-window', '--window-size=1280,900', '--window-position=80,80']);
});

test('shared background launch args add 360 fallback flags only for 360 runtimes', () => {
  const {
    buildBackgroundBrowserWindowArgs,
    is360BrowserRuntime
  } = require('../src/browser-launch-args');
  const edgeArgs = buildBackgroundBrowserWindowArgs({
    browserName: 'Edge',
    browserPreference: 'edge',
    browserExecutable: 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
  });
  const browser360Args = buildBackgroundBrowserWindowArgs({
    browserName: '360 Browser',
    browserPreference: 'edge',
    browserExecutable: 'C:/Program Files/360/360se6/Application/360se.exe'
  });

  assert.equal(is360BrowserRuntime({ browserPreference: '360' }), true);
  assert.equal(is360BrowserRuntime({ browserExecutable: 'C:/Program Files/360/360se.exe' }), true);
  assert.equal(edgeArgs.includes('--headless=new'), true);
  assert.equal(edgeArgs.includes('--start-minimized'), false);
  assert.equal(edgeArgs.includes('--window-position=-32000,-32000'), false);
  assert.equal(browser360Args.includes('--disable-extensions'), true);
  assert.equal(browser360Args.includes('--start-minimized'), true);
  assert.equal(browser360Args.includes('--window-position=-32000,-32000'), true);
});
