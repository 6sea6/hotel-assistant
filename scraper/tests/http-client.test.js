const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { HttpClientError, get, mergeCookieHeader, mergeHeaders } = require('../src/http-client');

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test('mergeHeaders keeps one value per header name case-insensitively', () => {
  assert.deepEqual(
    mergeHeaders(
      { Accept: 'text/html', 'X-Test': 'old' },
      { accept: 'application/json', 'x-new': 'yes' }
    ),
    {
      Accept: 'application/json',
      'X-Test': 'old',
      'x-new': 'yes'
    }
  );
});

test('get applies params, timeout and retry/backoff wrapper through axios', async () => {
  let requestCount = 0;
  const server = http.createServer((req, res) => {
    requestCount += 1;
    if (requestCount === 1) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'temporary' }));
      return;
    }

    const url = new URL(req.url, 'http://127.0.0.1');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        keyword: url.searchParams.get('keyword')
      })
    );
  });

  const port = await listen(server);
  try {
    const response = await get(`http://127.0.0.1:${port}/search`, {
      params: { keyword: '武汉' },
      timeoutMs: 1000,
      retries: 1,
      retryDelayMs: 1
    });

    assert.equal(requestCount, 2);
    assert.deepEqual(response.data, { ok: true, keyword: '武汉' });
  } finally {
    await close(server);
  }
});

test('get preserves axios response headers for cookie-sensitive Ctrip callers', async () => {
  const server = http.createServer((_req, res) => {
    res.setHeader('Set-Cookie', ['a=1; Path=/', 'b=2; Path=/']);
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html></html>');
  });

  const port = await listen(server);
  try {
    const response = await get(`http://127.0.0.1:${port}/hotel`, {
      responseType: 'text',
      timeoutMs: 1000,
      retries: 0
    });

    assert.equal(response.data, '<html></html>');
    assert.deepEqual(response.headers['set-cookie'], ['a=1; Path=/', 'b=2; Path=/']);
  } finally {
    await close(server);
  }
});

test('get reuses keep-alive sockets for sequential calls to the same host', async () => {
  const remotePorts = [];
  const server = http.createServer((req, res) => {
    remotePorts.push(req.socket.remotePort);
    res.setHeader('Connection', 'keep-alive');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });

  const port = await listen(server);
  try {
    await get(`http://127.0.0.1:${port}/one`, {
      timeoutMs: 1000,
      retries: 0
    });
    await get(`http://127.0.0.1:${port}/two`, {
      timeoutMs: 1000,
      retries: 0
    });

    assert.equal(new Set(remotePorts).size, 1);
  } finally {
    await close(server);
  }
});

test('get reports timeout failures with a unified error object', async () => {
  const server = http.createServer((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    }, 100);
  });

  const port = await listen(server);
  try {
    await assert.rejects(
      () => get(`http://127.0.0.1:${port}/slow`, { timeoutMs: 5, retries: 0 }),
      (error) =>
        error instanceof HttpClientError && error.method === 'GET' && error.url.includes('/slow')
    );
  } finally {
    await close(server);
  }
});

test('cookieHeader and userAgent merge into request headers without dropping existing Cookie', async () => {
  assert.equal(mergeCookieHeader('a=1; b=2', 'b=2; c=3'), 'a=1; b=2; c=3');

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        cookie: req.headers.cookie,
        userAgent: req.headers['user-agent']
      })
    );
  });

  const port = await listen(server);
  try {
    const response = await get(`http://127.0.0.1:${port}/headers`, {
      headers: {
        Cookie: 'a=1',
        Accept: 'application/json'
      },
      cookieHeader: 'b=2',
      userAgent: 'hotel-scraper-test',
      timeoutMs: 1000,
      retries: 0
    });

    assert.equal(response.data.cookie, 'a=1; b=2');
    assert.equal(response.data.userAgent, 'hotel-scraper-test');
  } finally {
    await close(server);
  }
});
