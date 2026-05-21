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
