const test = require('node:test');
const assert = require('node:assert/strict');

const hotelStorage = require('../src/main/hotel-storage');
const { normalizeHotelPayload } = require('../src/main/domain/hotel-normalizer');
const {
  createHotelRepository,
  flushAllHotelRepositoryCaches,
  resetHotelRepositoryCache,
  buildHotelBusinessKey,
  createHotelBusinessKeyIndex
} = require('../src/main/repositories/hotel-repository');

function createStore(initialData = {}) {
  const data = { ...initialData };
  const getCalls = [];
  const setCalls = [];

  return {
    getCalls,
    setCalls,
    get(key) {
      getCalls.push(key);
      return data[key];
    },
    set(key, value) {
      data[key] = value;
      setCalls.push({ key, value });
    }
  };
}

function createRepo(store) {
  return createHotelRepository({ store, normalizeHotelPayload });
}

test('hotel repository getAll repairs missing and duplicate IDs and writes back', () => {
  const store = createStore({
    hotels: [
      { name: ' 无 ID 酒店 ', room_type: '双床房' },
      { id: 7, name: '重复 ID 酒店 A', room_type: '大床房' },
      { id: 7, name: '重复 ID 酒店 B', room_type: '家庭房' }
    ]
  });
  const repo = createRepo(store);

  const hotels = repo.getAll();
  const ids = hotels.map((hotel) => String(hotel.id));

  assert.equal(new Set(ids).size, hotels.length);
  assert.equal(hotels[0].name, '无 ID 酒店');
  assert.ok(store.setCalls.some((call) => call.key === 'hotels'));
});

test('hotel repository add allocates a unique ID and persists compacted hotels', () => {
  const existing = normalizeHotelPayload({ id: 1, name: '已有酒店', room_type: '大床房' });
  const store = createStore({
    hotels: hotelStorage.compactHotels([existing], normalizeHotelPayload)
  });
  const repo = createRepo(store);

  const added = repo.add({ id: 1, name: ' 新酒店 ', room_type: '双床房' });
  const hotels = repo.getAll();
  repo.flush();

  assert.notEqual(String(added.id), '1');
  assert.equal(added.name, '新酒店');
  assert.equal(hotels.length, 2);
  assert.ok(Array.isArray(store.get('hotels')));
  assert.ok(store.setCalls.some((call) => call.key === 'hotels'));
});

test('hotel repository update returns the updated hotel or null when missing', () => {
  const store = createStore({
    hotels: [{ id: 1, name: '旧酒店', room_type: '大床房' }]
  });
  const repo = createRepo(store);

  const updated = repo.update({ id: 1, name: '新酒店' });
  const missing = repo.update({ id: 404, name: '不存在' });

  assert.equal(updated.name, '新酒店');
  assert.equal(missing, null);
});

test('hotel repository updateMany returns only successfully updated hotels', () => {
  const store = createStore({
    hotels: [
      { id: 1, name: '酒店 A', room_type: '大床房' },
      { id: 2, name: '酒店 B', room_type: '双床房' }
    ]
  });
  const repo = createRepo(store);

  const updated = repo.updateMany([
    { id: 1, name: '酒店 A+' },
    { id: 404, name: '不存在' }
  ]);

  assert.equal(updated.length, 1);
  assert.equal(updated[0].name, '酒店 A+');
});

test('hotel repository deleteById and deleteMany remove matching hotels', () => {
  const store = createStore({
    hotels: [
      { id: 1, name: '酒店 A', room_type: '大床房' },
      { id: 2, name: '酒店 B', room_type: '双床房' },
      { id: 3, name: '酒店 C', room_type: '家庭房' }
    ]
  });
  const repo = createRepo(store);

  const singleResult = repo.deleteById(1);
  const manyResult = repo.deleteMany([2, 404]);

  assert.equal(singleResult.deletedCount, 1);
  assert.equal(manyResult.deletedCount, 1);
  assert.deepEqual(
    repo.getAll().map((hotel) => hotel.id),
    [3]
  );
});

test('hotel repository replaceAll stores compact hotel groups', () => {
  const store = createStore({ hotels: [] });
  const repo = createRepo(store);

  repo.replaceAll([
    { id: 1, name: '同一家', address: '地址', room_type: '大床房', total_price: 600 },
    { id: 2, name: '同一家', address: '地址', room_type: '双床房', total_price: 700 }
  ]);

  const storedHotels = store.get('hotels');
  assert.equal(storedHotels.length, 1);
  assert.equal(storedHotels[0].rooms.length, 2);
});

test('hotel repository reuses the loaded cache and ID index for repeated reads', () => {
  const store = createStore({
    hotels: hotelStorage.compactHotels(
      [
        normalizeHotelPayload({ id: 1, name: '酒店 A', room_type: '大床房' }),
        normalizeHotelPayload({ id: 2, name: '酒店 B', room_type: '双床房' })
      ],
      normalizeHotelPayload
    )
  });
  const repo = createRepo(store);

  assert.equal(repo.getById(1).name, '酒店 A');
  assert.equal(repo.getById('2').name, '酒店 B');
  assert.equal(repo.getAll().length, 2);
  assert.equal(store.getCalls.filter((key) => key === 'hotels').length, 1);

  const returnedHotels = repo.getAll();
  returnedHotels[0].name = '外部误改';

  assert.equal(repo.getById(1).name, '酒店 A');
});

test('hotel repository shares pending cache changes across instances for the same store', () => {
  const store = createStore({ hotels: [] });
  const firstRepo = createRepo(store);
  const added = firstRepo.add({ name: '新酒店', room_type: '双床房' });
  const secondRepo = createRepo(store);

  assert.equal(secondRepo.getById(added.id).name, '新酒店');
  assert.equal(store.getCalls.filter((key) => key === 'hotels').length, 1);

  secondRepo.flush();
  assert.ok(store.setCalls.some((call) => call.key === 'hotels'));
});

test('hotel repository mutates cached data and flushes compacted data on demand', () => {
  const store = createStore({
    hotels: [
      { id: 1, name: '酒店 A', room_type: '大床房' },
      { id: 2, name: '酒店 B', room_type: '双床房' },
      { id: 3, name: '酒店 C', room_type: '家庭房' }
    ]
  });
  const repo = createRepo(store);

  assert.equal(repo.getAll().length, 3);
  repo.updateMany([
    { id: 1, name: '酒店 A+' },
    { id: 2, name: '酒店 B+' }
  ]);
  repo.deleteById(3);

  assert.equal(store.getCalls.filter((key) => key === 'hotels').length, 1);
  assert.deepEqual(
    repo.getAll().map((hotel) => hotel.name),
    ['酒店 A+', '酒店 B+']
  );

  repo.flush();
  assert.ok(store.setCalls.some((call) => call.key === 'hotels'));
});

test('hotel repository flushes pending changes before compact export', () => {
  const store = createStore({ hotels: [] });
  const repo = createRepo(store);

  repo.add({ name: '导出酒店', room_type: '大床房' });
  const compacted = repo.getCompactedForExport();

  assert.equal(compacted.length, 1);
  assert.ok(store.setCalls.some((call) => call.key === 'hotels'));
});

test('hotel repository can flush all pending store caches before app exit', () => {
  const store = createStore({ hotels: [] });
  const repo = createRepo(store);

  repo.add({ name: '退出前保存酒店', room_type: '双床房' });
  flushAllHotelRepositoryCaches();

  assert.ok(store.setCalls.some((call) => call.key === 'hotels'));
});

test('hotel repository cache can be reset after external store writes', () => {
  const store = createStore({
    hotels: [{ id: 1, name: '旧酒店', room_type: '大床房' }]
  });
  const repo = createRepo(store);

  assert.equal(repo.getById(1).name, '旧酒店');
  store.set('hotels', [{ id: 1, name: '外部新酒店', room_type: '双床房' }]);
  resetHotelRepositoryCache(store);

  assert.equal(repo.getById(1).name, '外部新酒店');
});

// --- addMany tests ---

test('hotel repository addMany with empty array returns empty and does not write', () => {
  const store = createStore({ hotels: [] });
  const repo = createRepo(store);

  const result = repo.addMany([]);

  assert.deepEqual(result, []);
  assert.equal(store.setCalls.length, 0);
});

test('hotel repository addMany assigns unique IDs and only schedules one flush', () => {
  const store = createStore({ hotels: [] });
  const repo = createRepo(store);

  const payloads = [];
  for (let i = 0; i < 1000; i++) {
    payloads.push({ name: `批量酒店 ${i}`, room_type: '大床房' });
  }

  const result = repo.addMany(payloads);

  assert.equal(result.length, 1000);
  const ids = result.map((h) => String(h.id));
  assert.equal(new Set(ids).size, 1000, 'all IDs should be unique');
  assert.equal(result[0].name, '批量酒店 0');
  assert.ok(result[0].created_at);
  assert.ok(result[0].updated_at);

  repo.flush();
  assert.equal(store.setCalls.filter((c) => c.key === 'hotels').length, 1);
});

test('hotel repository addMany merges with existing hotels', () => {
  const existing = normalizeHotelPayload({ id: 1, name: '已有酒店', room_type: '大床房' });
  const store = createStore({
    hotels: hotelStorage.compactHotels([existing], normalizeHotelPayload)
  });
  const repo = createRepo(store);

  const result = repo.addMany([
    { name: '新酒店 A', room_type: '双床房' },
    { name: '新酒店 B', room_type: '家庭房' }
  ]);

  assert.equal(result.length, 2);
  assert.equal(repo.getAll().length, 3);
});

// --- upsertMany tests ---

test('hotel repository upsertMany with empty array returns empty', () => {
  const store = createStore({ hotels: [] });
  const repo = createRepo(store);

  const result = repo.upsertMany([]);

  assert.deepEqual(result, { added: [], updated: [], hotels: [] });
  assert.equal(store.setCalls.length, 0);
});

test('hotel repository upsertMany updates by ID when present', () => {
  const store = createStore({
    hotels: [
      { id: 1, name: '旧酒店', room_type: '大床房' },
      { id: 2, name: '酒店 B', room_type: '双床房' }
    ]
  });
  const repo = createRepo(store);

  const result = repo.upsertMany([
    { id: 1, name: '新酒店', room_type: '大床房' }
  ]);

  assert.equal(result.updated.length, 1);
  assert.equal(result.added.length, 0);
  assert.equal(result.updated[0].name, '新酒店');
  assert.equal(repo.getById(1).name, '新酒店');
});

test('hotel repository upsertMany updates by website + room_type when no ID match', () => {
  const store = createStore({
    hotels: [
      { id: 1, name: '携程酒店', website: 'https://hotel.ctrip.com/123', room_type: '大床房' }
    ]
  });
  const repo = createRepo(store);

  const result = repo.upsertMany([
    { name: '携程酒店更新', website: 'https://hotel.ctrip.com/123', room_type: '大床房', total_price: 500 }
  ]);

  assert.equal(result.updated.length, 1);
  assert.equal(result.added.length, 0);
  assert.equal(result.updated[0].total_price, 500);
  assert.equal(result.updated[0].id, 1, 'should preserve existing ID');
});

test('hotel repository upsertMany updates by name + address + room_type when no website', () => {
  const store = createStore({
    hotels: [
      { id: 1, name: '花园酒店', address: '北京市朝阳区', room_type: '大床房' }
    ]
  });
  const repo = createRepo(store);

  const result = repo.upsertMany([
    { name: '花园酒店', address: '北京市朝阳区', room_type: '大床房', total_price: 300 }
  ]);

  assert.equal(result.updated.length, 1);
  assert.equal(result.added.length, 0);
  assert.equal(result.updated[0].total_price, 300);
});

test('hotel repository upsertMany does not match different room_type', () => {
  const store = createStore({
    hotels: [
      { id: 1, name: '花园酒店', address: '北京市朝阳区', room_type: '大床房' }
    ]
  });
  const repo = createRepo(store);

  const result = repo.upsertMany([
    { name: '花园酒店', address: '北京市朝阳区', room_type: '双床房', total_price: 400 }
  ]);

  assert.equal(result.updated.length, 0);
  assert.equal(result.added.length, 1);
  assert.equal(repo.getAll().length, 2);
});

test('hotel repository upsertMany adds when no match found', () => {
  const store = createStore({ hotels: [] });
  const repo = createRepo(store);

  const result = repo.upsertMany([
    { name: '全新酒店', room_type: '大床房' }
  ]);

  assert.equal(result.added.length, 1);
  assert.equal(result.updated.length, 0);
  assert.equal(result.hotels.length, 1);
  assert.equal(result.added[0].name, '全新酒店');
});

test('hotel repository upsertMany mixed adds and updates', () => {
  const store = createStore({
    hotels: [
      { id: 1, name: '已有酒店', room_type: '大床房' }
    ]
  });
  const repo = createRepo(store);

  const result = repo.upsertMany([
    { id: 1, name: '更新酒店', room_type: '大床房' },
    { name: '新增酒店', room_type: '双床房' }
  ]);

  assert.equal(result.updated.length, 1);
  assert.equal(result.added.length, 1);
  assert.equal(result.hotels.length, 2);
  assert.equal(result.updated[0].name, '更新酒店');
  assert.equal(result.added[0].name, '新增酒店');
});

// --- buildHotelBusinessKey tests ---

test('buildHotelBusinessKey prefers original_room_type over room_type', () => {
  const key = buildHotelBusinessKey({
    website: 'https://hotel.test/1',
    room_type: '标准房',
    original_room_type: '豪华大床房'
  });
  assert.ok(key.includes('豪华大床房'));
  assert.ok(!key.includes('标准房'));
});

test('buildHotelBusinessKey uses name + address + original_room_type when no website', () => {
  const key = buildHotelBusinessKey({
    name: '花园酒店',
    address: '北京市朝阳区',
    room_type: '标准房',
    original_room_type: '豪华大床房'
  });
  assert.ok(key.includes('花园酒店'));
  assert.ok(key.includes('北京市朝阳区'));
  assert.ok(key.includes('豪华大床房'));
  assert.ok(!key.includes('标准房'));
});

test('buildHotelBusinessKey returns empty string when all fields missing', () => {
  assert.equal(buildHotelBusinessKey({}), '');
  assert.equal(buildHotelBusinessKey({ room_type: '' }), '');
  assert.equal(buildHotelBusinessKey({ name: '', address: '' }), '');
});

test('createHotelBusinessKeyIndex ignores empty keys', () => {
  const hotels = [
    { id: 1, name: '有效酒店', room_type: '大床房' },
    { id: 2 },
    { id: 3, name: '', room_type: '' }
  ];
  const index = createHotelBusinessKeyIndex(hotels);
  assert.equal(index.size, 1);
  assert.ok(index.has(buildHotelBusinessKey(hotels[0])));
});

// --- upsertMany ID preservation tests ---

test('hotel repository upsertMany preserves existing ID on business key match', () => {
  const store = createStore({
    hotels: [
      { id: 1, name: '已有酒店', website: 'https://x', original_room_type: '豪华大床房' }
    ]
  });
  const repo = createRepo(store);

  const result = repo.upsertMany([
    { id: 999, name: '更新酒店', website: 'https://x', original_room_type: '豪华大床房', total_price: 500 }
  ]);

  assert.equal(result.updated.length, 1);
  assert.equal(result.added.length, 0);
  assert.equal(result.updated[0].id, 1, 'should preserve existing ID');
  assert.equal(result.updated[0].total_price, 500);
  assert.ok(repo.getById(1), 'id 1 should exist');
  assert.equal(repo.getById(999), undefined, 'id 999 should not exist');
});

// --- upsertMany same-batch dedup tests ---

test('hotel repository upsertMany deduplicates same-batch payloads with same business key', () => {
  const store = createStore({ hotels: [] });
  const repo = createRepo(store);

  const result = repo.upsertMany([
    { name: 'A', address: 'X', original_room_type: '豪华大床房', total_price: 300 },
    { name: 'A', address: 'X', original_room_type: '豪华大床房', total_price: 320 }
  ]);

  assert.equal(result.added.length, 1);
  assert.equal(result.updated.length, 1);
  assert.equal(repo.getAll().length, 1, 'should have exactly 1 hotel');
  assert.equal(result.updated[0].total_price, 320, 'second payload should overwrite first');
});

test('hotel repository upsertMany same-batch different original_room_type produces two records', () => {
  const store = createStore({ hotels: [] });
  const repo = createRepo(store);

  const result = repo.upsertMany([
    { name: 'A', address: 'X', original_room_type: '豪华大床房', total_price: 300 },
    { name: 'A', address: 'X', original_room_type: '商务双床房', total_price: 400 }
  ]);

  assert.equal(result.added.length, 2);
  assert.equal(result.updated.length, 0);
  assert.equal(repo.getAll().length, 2);
});

// --- upsertMany matchByBusinessKey option ---

test('hotel repository upsertMany matchByBusinessKey:false only matches by ID', () => {
  const store = createStore({
    hotels: [
      { id: 1, name: '已有酒店', website: 'https://x', room_type: '大床房' }
    ]
  });
  const repo = createRepo(store);

  const result = repo.upsertMany(
    [
      { name: '更新酒店', website: 'https://x', room_type: '大床房', total_price: 500 }
    ],
    { matchByBusinessKey: false }
  );

  assert.equal(result.updated.length, 0, 'should not match by business key');
  assert.equal(result.added.length, 1, 'should add as new');
  assert.equal(repo.getAll().length, 2);
});
