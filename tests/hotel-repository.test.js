const test = require('node:test');
const assert = require('node:assert/strict');

const hotelStorage = require('../src/main/hotel-storage');
const { normalizeHotelPayload } = require('../src/main/domain/hotel-normalizer');
const {
  createHotelRepository,
  flushAllHotelRepositoryCaches,
  resetHotelRepositoryCache
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
