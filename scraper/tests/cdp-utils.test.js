const test = require('node:test');
const assert = require('node:assert/strict');

test('CDP send times out and clears pending requests', async () => {
  const { createCdpConnection } = require('../src/scraper/cdp-utils');
  const sent = [];
  const socket = {
    readyState: 1,
    addEventListener() {},
    send(payload) {
      sent.push(JSON.parse(payload));
    }
  };
  const connection = createCdpConnection(socket, { defaultTimeoutMs: 5 });

  await assert.rejects(
    connection.send('Runtime.evaluate', { expression: '1' }),
    /CDP Runtime\.evaluate timed out after 5ms/
  );

  assert.equal(sent.length, 1);
  assert.equal(connection.getPendingCount(), 0);
});

test('CDP send rejects immediately when cancellation signal aborts', async () => {
  const { createCdpConnection } = require('../src/scraper/cdp-utils');
  const controller = new AbortController();
  const socket = {
    readyState: 1,
    addEventListener() {},
    send() {}
  };
  const connection = createCdpConnection(socket, { defaultTimeoutMs: 1000 });
  const pending = connection.send('Network.getResponseBody', {}, '', {
    signal: controller.signal
  });

  controller.abort();

  await assert.rejects(pending, /CDP Network\.getResponseBody aborted/);
  assert.equal(connection.getPendingCount(), 0);
});

test('visible managed Edge windows are positioned on screen', () => {
  const { buildVisibleManagedBrowserWindowArgs } = require('../src/scraper/cdp-utils');
  const args = buildVisibleManagedBrowserWindowArgs();

  assert.ok(args.includes('--new-window'));
  assert.ok(args.includes('--window-size=1280,900'));
  assert.ok(args.includes('--window-position=80,80'));
  assert.equal(args.includes('--window-position=-32000,-32000'), false);
  assert.equal(args.includes('--start-minimized'), false);
});

test('managed 360 browser headless sessions start minimized and offscreen as a fallback', () => {
  const { buildBackgroundManagedBrowserWindowArgs } = require('../src/scraper/cdp-utils');
  const edgeArgs = buildBackgroundManagedBrowserWindowArgs(
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    { browserPreference: 'edge' }
  );
  const browser360Args = buildBackgroundManagedBrowserWindowArgs(
    'C:/Program Files/360/360se6/Application/360se.exe',
    { browserPreference: '360' }
  );

  assert.ok(edgeArgs.includes('--headless=new'));
  assert.equal(edgeArgs.includes('--start-minimized'), false);
  assert.equal(edgeArgs.includes('--window-position=-32000,-32000'), false);
  assert.ok(browser360Args.includes('--headless=new'));
  assert.ok(browser360Args.includes('--no-startup-window'));
  assert.ok(browser360Args.includes('--disable-extensions'));
  assert.ok(browser360Args.includes('--disable-component-extensions-with-background-pages'));
  assert.ok(browser360Args.includes('--disable-component-update'));
  assert.ok(browser360Args.includes('--disable-sync'));
  assert.ok(browser360Args.includes('--start-minimized'));
  assert.ok(browser360Args.includes('--window-size=1280,900'));
  assert.ok(browser360Args.includes('--window-position=-32000,-32000'));
});
