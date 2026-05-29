const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let moduleUrls = null;

async function loadModules() {
  if (!moduleUrls) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-hotel-derived-'));
    const sourceDir = path.join(__dirname, '..', 'src', 'renderer', 'modules');
    fs.writeFileSync(path.join(tempRoot, 'package.json'), '{"type":"module"}\n', 'utf-8');
    [
      'hotel-derived.js',
      'hotel-filters.js',
      'dom-helpers.js',
      'state.js'
    ].forEach((fileName) => {
      fs.copyFileSync(path.join(sourceDir, fileName), path.join(tempRoot, fileName));
    });
    moduleUrls = {
      derived: pathToFileURL(path.join(tempRoot, 'hotel-derived.js')).href,
      filters: pathToFileURL(path.join(tempRoot, 'hotel-filters.js')).href
    };
    process.on('exit', () => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
  }

  const [derived, filters] = await Promise.all([
    import(moduleUrls.derived),
    import(moduleUrls.filters)
  ]);
  return { derived, filters };
}

function makeHotel(overrides = {}) {
  return {
    id: 1,
    name: '测试酒店',
    address: '测试地址',
    website: '',
    total_price: 300,
    daily_price: 150,
    ctrip_score: 4.5,
    distance: '1.2公里',
    subway_distance: '0.8',
    transport_time: '35分钟',
    room_type: '大床房',
    original_room_type: '豪华大床房',
    is_favorite: 0,
    template_id: null,
    template_info: null,
    ...overrides
  };
}

test('buildHotelDerivedFields correctly parses numeric fields', async () => {
  const { derived } = await loadModules();
  const hotel = makeHotel();
  const d = derived.buildHotelDerivedFields(hotel);

  assert.equal(d.totalPriceNumber, 300);
  assert.equal(d.dailyPriceNumber, 150);
  assert.equal(d.scoreNumber, 4.5);
  assert.equal(d.distanceNumber, 1.2);
  assert.equal(d.subwayDistanceNumber, 0.8);
  assert.equal(d.transportTimeNumber, 35);
});

test('buildHotelDerivedFields returns null for missing or invalid numbers', async () => {
  const { derived } = await loadModules();
  const hotel = makeHotel({
    total_price: null,
    daily_price: 0,
    ctrip_score: -1,
    distance: '',
    subway_distance: null,
    transport_time: '无'
  });
  const d = derived.buildHotelDerivedFields(hotel);

  assert.equal(d.totalPriceNumber, null);
  assert.equal(d.dailyPriceNumber, null);
  assert.equal(d.scoreNumber, null);
  assert.equal(d.distanceNumber, null);
  assert.equal(d.subwayDistanceNumber, null);
  assert.equal(d.transportTimeNumber, null);
});

test('buildHotelDerivedFields computes nameKey and roomTypeKey', async () => {
  const { derived } = await loadModules();
  const hotel = makeHotel();
  const d = derived.buildHotelDerivedFields(hotel);

  assert.equal(d.nameKey, '测试酒店');
  assert.equal(d.roomTypeKey, '大床房');
  assert.equal(d.originalRoomTypeKey, '豪华大床房');
  assert.equal(d.hotelIdentityKey, '测试酒店');
});

test('buildHotelDerivedFields falls back hotelIdentityKey to id when name is empty', async () => {
  const { derived } = await loadModules();
  const hotel = makeHotel({ id: 42, name: '' });
  const d = derived.buildHotelDerivedFields(hotel);

  assert.equal(d.hotelIdentityKey, 'hotel:42');
});

test('attachDerivedFieldsToHotel does not modify the original hotel', async () => {
  const { derived } = await loadModules();
  const hotel = makeHotel();
  const originalKeys = Object.keys(hotel);
  const attached = derived.attachDerivedFieldsToHotel(hotel);

  assert.deepEqual(Object.keys(hotel), originalKeys);
  assert.equal(hotel._derived, undefined);
  assert.ok(attached._derived);
  assert.equal(attached.name, hotel.name);
  assert.equal(attached.id, hotel.id);
});

test('attachDerivedFields maps over array', async () => {
  const { derived } = await loadModules();
  const hotels = [makeHotel({ id: 1 }), makeHotel({ id: 2, name: '另一个酒店' })];
  const result = derived.attachDerivedFields(hotels);

  assert.equal(result.length, 2);
  assert.ok(result[0]._derived);
  assert.ok(result[1]._derived);
  assert.equal(result[0]._derived.nameKey, '测试酒店');
  assert.equal(result[1]._derived.nameKey, '另一个酒店');
  assert.equal(hotels[0]._derived, undefined);
});

test('stripDerivedFieldsFromHotel removes _derived', async () => {
  const { derived } = await loadModules();
  const hotel = makeHotel();
  const attached = derived.attachDerivedFieldsToHotel(hotel);
  const stripped = derived.stripDerivedFieldsFromHotel(attached);

  assert.equal(stripped._derived, undefined);
  assert.equal(stripped.name, hotel.name);
  assert.equal(stripped.total_price, hotel.total_price);
});

test('stripDerivedFields removes _derived from array', async () => {
  const { derived } = await loadModules();
  const hotels = [makeHotel({ id: 1 }), makeHotel({ id: 2 })];
  const attached = derived.attachDerivedFields(hotels);
  const stripped = derived.stripDerivedFields(attached);

  assert.equal(stripped.length, 2);
  assert.equal(stripped[0]._derived, undefined);
  assert.equal(stripped[1]._derived, undefined);
});

test('stripDerivedFieldsFromHotel returns hotel as-is when no _derived', async () => {
  const { derived } = await loadModules();
  const hotel = makeHotel();
  const stripped = derived.stripDerivedFieldsFromHotel(hotel);

  assert.equal(stripped, hotel);
});

test('applyFiltersToHotels produces same result with and without _derived', async () => {
  const { derived, filters } = await loadModules();
  const hotels = [
    makeHotel({ id: 1, name: '酒店A', ctrip_score: 4.8, transport_time: '20分钟', subway_distance: '0.5' }),
    makeHotel({ id: 2, name: '酒店B', ctrip_score: 3.5, transport_time: '45分钟', subway_distance: '2.0' }),
    makeHotel({ id: 3, name: '酒店C', ctrip_score: 4.2, transport_time: '15分钟', subway_distance: '0.3' })
  ];
  const hotelsWithDerived = derived.attachDerivedFields(hotels);

  const filterCases = [
    {},
    { name: '酒店A' },
    { score: '4.0' },
    { transportTime: '30' },
    { subwayDistance: '1.0' },
    { name: '酒店A', score: '4.0', transportTime: '30' }
  ];

  for (const f of filterCases) {
    const withoutDerived = filters.applyFiltersToHotels(hotels, f).map((h) => h.id);
    const withDerived = filters.applyFiltersToHotels(hotelsWithDerived, f).map((h) => h.id);
    assert.deepEqual(withDerived, withoutDerived, `Filter ${JSON.stringify(f)} should match`);
  }
});

test('sortHotels produces same order with and without _derived', async () => {
  const { derived, filters } = await loadModules();
  const hotels = [
    makeHotel({ id: 1, total_price: 300, ctrip_score: 4.8, distance: '1.2公里' }),
    makeHotel({ id: 2, total_price: 200, ctrip_score: 3.5, distance: '0.5公里' }),
    makeHotel({ id: 3, total_price: 500, ctrip_score: 4.2, distance: '2.0公里' })
  ];
  const hotelsWithDerived = derived.attachDerivedFields(hotels);

  const sortModes = ['review_high', 'price_low', 'price_high', 'distance_near'];

  for (const mode of sortModes) {
    const withoutDerived = filters.sortHotels(hotels, mode).map((h) => h.id);
    const withDerived = filters.sortHotels(hotelsWithDerived, mode).map((h) => h.id);
    assert.deepEqual(withDerived, withoutDerived, `Sort mode ${mode} should match`);
  }
});

test('getVisibleHotelSummary produces same result with and without _derived', async () => {
  const { derived, filters } = await loadModules();
  const hotels = [
    makeHotel({ id: 1, name: '酒店A', original_room_type: '豪华大床房', room_type: '大床房' }),
    makeHotel({ id: 2, name: '酒店A', original_room_type: '商务双床房', room_type: '双床房' }),
    makeHotel({ id: 3, name: '酒店B', original_room_type: '', room_type: '家庭房' })
  ];
  const hotelsWithDerived = derived.attachDerivedFields(hotels);

  const withoutDerived = filters.getVisibleHotelSummary(hotels);
  const withDerived = filters.getVisibleHotelSummary(hotelsWithDerived);

  assert.deepEqual(withDerived, withoutDerived);
});

test('stripDerivedFieldsFromHotel removes _derived before IPC send', async () => {
  const { derived } = await loadModules();
  const hotel = makeHotel();
  const attached = derived.attachDerivedFieldsToHotel(hotel);

  assert.ok(attached._derived, 'attached hotel should have _derived');

  const stripped = derived.stripDerivedFieldsFromHotel(attached);
  const json = JSON.parse(JSON.stringify(stripped));

  assert.equal(json._derived, undefined, 'stripped JSON should not have _derived');
  assert.equal(json.name, hotel.name);
});
