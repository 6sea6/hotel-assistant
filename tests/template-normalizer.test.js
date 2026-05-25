const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeTemplatePayload } = require('../src/main/domain/template-normalizer');
const templateHandlers = require('../src/main/ipc-handlers/template-handlers');

test('template normalizer trims fields and normalizes ID and dates', () => {
  const normalized = normalizeTemplatePayload({
    id: '8',
    name: ' 武汉 ',
    destination: ' 江汉路 ',
    check_in_date: '',
    check_out_date: '2026-06-02',
    room_count: '1'
  });

  assert.equal(normalized.id, 8);
  assert.equal(normalized.name, '武汉');
  assert.equal(normalized.destination, '江汉路');
  assert.equal(normalized.check_in_date, null);
  assert.equal(normalized.check_out_date, '2026-06-02');
  assert.equal(normalized.room_count, 1);
});

test('template normalizer defaults and clamps room_count', () => {
  assert.equal(normalizeTemplatePayload({ name: '默认' }).room_count, 2);
  assert.equal(normalizeTemplatePayload({ name: '小于下限', room_count: 0 }).room_count, 1);
  assert.equal(normalizeTemplatePayload({ name: '大于上限', room_count: 9 }).room_count, 3);
});

test('template normalizer preserves existing created_at when payload omits it', () => {
  const normalized = normalizeTemplatePayload(
    { id: 1, name: '新名字' },
    { id: 1, name: '旧名字', created_at: '2026-05-01T00:00:00.000Z' }
  );

  assert.equal(normalized.created_at, '2026-05-01T00:00:00.000Z');
});

test('template handler keeps normalizeTemplatePayload compatibility export', () => {
  assert.equal(templateHandlers.normalizeTemplatePayload, normalizeTemplatePayload);
});
