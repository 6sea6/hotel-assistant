const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isTrustedSender,
  normalizeIpcError,
  safeHandle,
  toErrorMessage
} = require('../src/main/ipc-safe-handler');

function createIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  };
}

function createEvent(url) {
  return {
    senderFrame: url ? { url } : null,
    sender: {}
  };
}

test('safeHandle returns successful handler result without wrapping it', async () => {
  const ipcMain = createIpcMain();
  safeHandle(ipcMain, 'demo:ok', async (_event, value) => ({ value }));

  const result = await ipcMain.handlers.get('demo:ok')(createEvent('file:///app/index.html'), 42);

  assert.deepEqual(result, { value: 42 });
});

test('safeHandle converts thrown errors to a stable IPC error result', async () => {
  const ipcMain = createIpcMain();
  safeHandle(ipcMain, 'demo:fail', () => {
    throw new Error('boom');
  });

  const result = await ipcMain.handlers.get('demo:fail')(createEvent('app://renderer/index.html'));

  assert.deepEqual(result, { success: false, error: 'boom' });
});

test('safeHandle rejects untrusted sender frames before running handler', async () => {
  const ipcMain = createIpcMain();
  let called = false;
  safeHandle(ipcMain, 'demo:secure', () => {
    called = true;
    return { success: true };
  });

  const result = await ipcMain.handlers.get('demo:secure')(
    createEvent('https://evil.example/index.html')
  );

  assert.equal(called, false);
  assert.deepEqual(result, { success: false, error: '非法 IPC 来源' });
});

test('safeHandle can skip sender validation for compatibility handlers', async () => {
  const ipcMain = createIpcMain();
  safeHandle(ipcMain, 'demo:compat', () => 'ok', { requireTrustedSender: false });

  const result = await ipcMain.handlers.get('demo:compat')(
    createEvent('https://evil.example/index.html')
  );

  assert.equal(result, 'ok');
});

test('isTrustedSender allows app and file senders and keeps missing frame compatible', () => {
  assert.equal(isTrustedSender(createEvent('file:///C:/app/index.html')), true);
  assert.equal(isTrustedSender(createEvent('app://renderer/index.html')), true);
  assert.equal(isTrustedSender(createEvent('https://evil.example/index.html')), false);
  assert.equal(isTrustedSender({ sender: {} }), true);
});

test('toErrorMessage normalizes Error, string, and unknown values', () => {
  assert.equal(toErrorMessage(new Error('error message')), 'error message');
  assert.equal(toErrorMessage('plain string'), 'plain string');
  assert.equal(toErrorMessage({ nope: true }), '未知错误');
});

test('normalizeIpcError supports fallback messages', () => {
  assert.deepEqual(normalizeIpcError(new Error('boom')), { success: false, error: 'boom' });
  assert.deepEqual(normalizeIpcError(null, '兜底错误'), { success: false, error: '兜底错误' });
});
