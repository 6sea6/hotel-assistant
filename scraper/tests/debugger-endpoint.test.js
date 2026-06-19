const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

function createJsonServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        close: () => new Promise((closeResolve) => server.close(closeResolve))
      });
    });
  });
}

test('waitForDebuggerEndpoint returns the websocket URL when the endpoint is ready', async () => {
  const { waitForDebuggerEndpoint } = require('../src/debugger-endpoint');
  const server = await createJsonServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/browser/test' }));
  });

  try {
    const wsUrl = await waitForDebuggerEndpoint(server.port, 500, {
      intervalMs: 10,
      requestTimeoutMs: 100
    });
    assert.equal(wsUrl, 'ws://127.0.0.1/devtools/browser/test');
  } finally {
    await server.close();
  }
});

test('waitForDebuggerEndpoint retries until webSocketDebuggerUrl is present', async () => {
  const { waitForDebuggerEndpoint } = require('../src/debugger-endpoint');
  let calls = 0;
  const server = await createJsonServer((_req, res) => {
    calls += 1;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(calls < 2 ? {} : { webSocketDebuggerUrl: 'ws://127.0.0.1/ready' }));
  });

  try {
    const wsUrl = await waitForDebuggerEndpoint(server.port, 500, {
      intervalMs: 10,
      requestTimeoutMs: 100
    });
    assert.equal(wsUrl, 'ws://127.0.0.1/ready');
    assert.equal(calls >= 2, true);
  } finally {
    await server.close();
  }
});

test('waitForDebuggerEndpoint times out stalled single requests', async () => {
  const { waitForDebuggerEndpoint } = require('../src/debugger-endpoint');
  const server = await createJsonServer((_req, _res) => {});

  try {
    await assert.rejects(
      waitForDebuggerEndpoint(server.port, 80, {
        intervalMs: 10,
        requestTimeoutMs: 20
      }),
      /未就绪/
    );
  } finally {
    await server.close();
  }
});
