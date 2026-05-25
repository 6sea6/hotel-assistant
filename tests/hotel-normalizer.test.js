const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeHotelPayload } = require('../src/main/domain/hotel-normalizer');
const hotelHandlers = require('../src/main/ipc-handlers/hotel-handlers');

test('hotel normalizer trims text fields and normalizes numeric fields', () => {
  const normalized = normalizeHotelPayload({
    id: '42',
    name: ' 测试酒店 ',
    address: ' 测试地址 ',
    website: ' https://hotel.example ',
    destination: ' 会展中心 ',
    subway_station: ' 徐泾东 ',
    room_type: ' 大床房 ',
    original_room_type: ' 豪华大床房 ',
    notes: ' 备注 ',
    total_price: '688.5',
    daily_price: '344.25',
    days: '2',
    ctrip_score: '4.8',
    distance: ' 1.2 ',
    subway_distance: 0.8,
    transport_time: ' 18 ',
    bus_route: ' 乘地铁 ',
    room_area: 35
  });

  assert.equal(normalized.id, 42);
  assert.equal(normalized.name, '测试酒店');
  assert.equal(normalized.address, '测试地址');
  assert.equal(normalized.website, 'https://hotel.example');
  assert.equal(normalized.destination, '会展中心');
  assert.equal(normalized.subway_station, '徐泾东');
  assert.equal(normalized.room_type, '大床房');
  assert.equal(normalized.original_room_type, '豪华大床房');
  assert.equal(normalized.notes, '备注');
  assert.equal(normalized.total_price, 688.5);
  assert.equal(normalized.daily_price, 344.25);
  assert.equal(normalized.days, 2);
  assert.equal(normalized.ctrip_score, 4.8);
  assert.equal(normalized.distance, '1.2');
  assert.equal(normalized.subway_distance, '0.8');
  assert.equal(normalized.transport_time, '18');
  assert.equal(normalized.bus_route, '乘地铁');
  assert.equal(normalized.room_area, '35');
});

test('hotel normalizer applies defaults and template info normalization', () => {
  const normalized = normalizeHotelPayload({
    name: '酒店',
    room_count: '',
    is_favorite: '1',
    template_info: {
      id: '9',
      name: ' 模板 ',
      destination: ' 目的地 ',
      check_in_date: '',
      check_out_date: '2026-06-02',
      room_count: '3'
    }
  });

  assert.equal(normalized.room_count, 1);
  assert.equal(normalized.is_favorite, 1);
  assert.equal(normalized.template_id, 9);
  assert.deepEqual(normalized.template_info, {
    id: 9,
    name: '模板',
    destination: '目的地',
    check_in_date: null,
    check_out_date: '2026-06-02',
    room_count: 3
  });
});

test('hotel normalizer removes unknown fields and preserves allowed policy fields', () => {
  const normalized = normalizeHotelPayload({
    name: '酒店',
    room_type: '房型',
    unknown_field: 'remove me',
    cancel_policy: '免费取消',
    window_status: '有窗'
  });

  assert.equal(Object.prototype.hasOwnProperty.call(normalized, 'unknown_field'), false);
  assert.equal(normalized.cancel_policy, '免费取消');
  assert.equal(normalized.window_status, '有窗');
});

test('hotel handler keeps normalizeHotelPayload compatibility export', () => {
  assert.equal(hotelHandlers.normalizeHotelPayload, normalizeHotelPayload);
});
