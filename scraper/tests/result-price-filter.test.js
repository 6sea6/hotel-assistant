const test = require('node:test');
const assert = require('node:assert/strict');

const {
  filterHotelsByPerPersonDailyPrice,
  getPerPersonDailyPrice,
  summarizePriceFilter
} = require('../src/result-price-filter');

test('result price filter removes rooms above the per-person daily maximum', () => {
  const hotels = [
    { name: 'A', room_type: '双床房', daily_price: 300, room_count: 2 },
    { name: 'B', room_type: '家庭房', daily_price: 451, room_count: 3 },
    { name: 'C', room_type: '套房', daily_price: 600, room_count: 4 }
  ];

  const result = filterHotelsByPerPersonDailyPrice(hotels, 150);

  assert.equal(result.active, true);
  assert.deepEqual(result.hotels, [hotels[0], hotels[2]]);
  assert.deepEqual(result.keptIndexes, [0, 2]);
  assert.equal(result.removed.length, 1);
  assert.equal(result.removed[0].perPersonDailyPrice, 150.33);
  assert.deepEqual(summarizePriceFilter(result), {
    active: true,
    perPersonDailyPriceMax: 150,
    removedCount: 1,
    keptCount: 2
  });
});

test('result price filter keeps exact-boundary and unknown prices', () => {
  const hotels = [
    { daily_price: 300, room_count: 2 },
    { daily_price: null, room_count: 2 },
    { daily_price: 300, room_count: null }
  ];

  const result = filterHotelsByPerPersonDailyPrice(hotels, 150);

  assert.deepEqual(result.hotels, hotels);
  assert.equal(result.removed.length, 0);
  assert.equal(getPerPersonDailyPrice(hotels[0]), 150);
  assert.equal(getPerPersonDailyPrice(hotels[1]), null);
});

test('result price filter stays inactive without a positive numeric maximum', () => {
  const hotels = [{ daily_price: 900, room_count: 2 }];

  for (const maximum of [null, undefined, 'max', 0, -1]) {
    const result = filterHotelsByPerPersonDailyPrice(hotels, maximum);
    assert.equal(result.active, false);
    assert.deepEqual(result.hotels, hotels);
  }
});

test('result price filter compares unrounded values at the exact ceiling', () => {
  const result = filterHotelsByPerPersonDailyPrice([{ daily_price: 300.008, room_count: 2 }], 150);

  assert.equal(result.removed.length, 1);
  assert.equal(result.removed[0].perPersonDailyPrice, 150);
});
