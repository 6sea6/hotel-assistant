const test = require('node:test');
const assert = require('node:assert/strict');

const { HANDLER_REGISTRATIONS, getHandlerRegistrations } = require('../src/main/ipc-handler-registry');

test('IPC handler registry keeps a stable registration order', () => {
  assert.deepEqual(
    HANDLER_REGISTRATIONS.map((registration) => registration.id),
    ['hotel', 'template', 'settings', 'data', 'prompt', 'other']
  );
});

test('IPC handler registry declares dependency shapes centrally', () => {
  const context = {
    ipcMain: { name: 'ipc' },
    cache: { name: 'cache' },
    services: { name: 'services' }
  };

  const contextMap = Object.fromEntries(
    HANDLER_REGISTRATIONS.map((registration) => [
      registration.id,
      getHandlerRegistrations(context).find((item) => item.id === registration.id).context
    ])
  );

  assert.deepEqual(contextMap.hotel, context);
  assert.deepEqual(contextMap.template, context);
  assert.deepEqual(contextMap.settings, context);
  assert.deepEqual(contextMap.data, context);
  assert.deepEqual(contextMap.prompt, context);
  assert.deepEqual(contextMap.other, context);
});
