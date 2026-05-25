const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeTemplatePayload } = require('../src/main/domain/template-normalizer');
const { createTemplateRepository } = require('../src/main/repositories/template-repository');

function createStore(initialData = {}) {
  const data = { ...initialData };
  const setCalls = [];

  return {
    setCalls,
    get(key) {
      return data[key];
    },
    set(key, value) {
      data[key] = value;
      setCalls.push({ key, value });
    }
  };
}

function createRepo(store) {
  return createTemplateRepository({ store, normalizeTemplatePayload });
}

test('template repository getAll repairs missing and duplicate IDs and writes back', () => {
  const store = createStore({
    templates: [
      { name: ' 武汉 ', destination: ' 江汉路 ', room_count: 5 },
      { id: 'same', name: '重复模板 A', room_count: '' },
      { id: 'same', name: '重复模板 B' }
    ]
  });
  const repo = createRepo(store);

  const templates = repo.getAll();
  const ids = templates.map((template) => String(template.id));

  assert.equal(new Set(ids).size, templates.length);
  assert.equal(templates[0].name, '武汉');
  assert.equal(templates[0].destination, '江汉路');
  assert.equal(templates[0].room_count, 3);
  assert.equal(templates[1].room_count, 2);
  assert.ok(store.setCalls.some((call) => call.key === 'templates'));
});

test('template repository add allocates a unique ID', () => {
  const store = createStore({
    templates: [{ id: 1, name: '已有模板', destination: '武汉' }]
  });
  const repo = createRepo(store);

  const added = repo.add({ id: 1, name: ' 新模板 ', destination: ' 上海 ', room_count: 1 });

  assert.notEqual(String(added.id), '1');
  assert.equal(added.name, '新模板');
  assert.equal(added.destination, '上海');
  assert.equal(repo.getAll().length, 2);
});

test('template repository update returns updated template or null when missing', () => {
  const store = createStore({
    templates: [{ id: 1, name: '旧模板', destination: '武汉' }]
  });
  const repo = createRepo(store);

  const updated = repo.update({ id: 1, name: '新模板', room_count: 9 });
  const missing = repo.update({ id: 404, name: '不存在' });

  assert.equal(updated.name, '新模板');
  assert.equal(updated.room_count, 3);
  assert.equal(missing, null);
});

test('template repository deleteById removes matching template', () => {
  const store = createStore({
    templates: [
      { id: 1, name: '模板 A', destination: '武汉' },
      { id: 2, name: '模板 B', destination: '上海' }
    ]
  });
  const repo = createRepo(store);

  const result = repo.deleteById(1);

  assert.equal(result.deletedCount, 1);
  assert.deepEqual(
    repo.getAll().map((template) => template.id),
    [2]
  );
});

test('template repository replaceAll normalizes and persists templates', () => {
  const store = createStore({ templates: [] });
  const repo = createRepo(store);

  repo.replaceAll([{ id: 1, name: ' 模板 ', destination: ' 目的地 ', room_count: 10 }]);

  assert.deepEqual(store.get('templates')[0].name, '模板');
  assert.equal(store.get('templates')[0].room_count, 3);
});
