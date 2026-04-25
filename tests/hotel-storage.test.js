const test = require('node:test');
const assert = require('node:assert/strict');

const hotelStorage = require('../src/main/hotel-storage');

function normalizeHotelPayload(hotel = {}) {
  return {
    ...hotel,
    name: String(hotel.name || '').trim(),
    address: String(hotel.address || '').trim(),
    website: String(hotel.website || '').trim(),
    destination: String(hotel.destination || '').trim(),
    room_type: String(hotel.room_type || '').trim(),
    original_room_type: String(hotel.original_room_type || '').trim(),
    template_info: hotel.template_info || null
  };
}

test('expandStoredHotels supports grouped and flat entries together', () => {
  const rawHotels = [
    {
      shared: {
        name: '测试酒店',
        address: '测试地址',
        website: 'https://example.com/hotel',
        check_in_date: '2026-05-01',
        check_out_date: '2026-05-03',
        days: 2,
        ctrip_score: 4.8,
        destination: '上海国家会展中心',
        distance: '1.2',
        subway_station: '徐泾东站',
        subway_distance: '0.8',
        transport_time: '18',
        bus_route: '步行至地铁后换乘',
        template_id: 1001,
        template_info: {
          id: 1001,
          name: 'bw'
        }
      },
      rooms: [
        {
          room_type: '大床房',
          original_room_type: '商务大床房',
          total_price: 699
        },
        {
          room_type: '双床房',
          original_room_type: '商务双床房',
          total_price: 799
        }
      ]
    },
    {
      name: '独立酒店',
      address: '独立地址',
      room_type: '家庭房'
    }
  ];

  const expandedHotels = hotelStorage.expandStoredHotels(rawHotels, normalizeHotelPayload);

  assert.equal(expandedHotels.length, 3);
  assert.equal(expandedHotels[0].name, '测试酒店');
  assert.equal(expandedHotels[1].room_type, '双床房');
  assert.equal(expandedHotels[2].name, '独立酒店');
  assert.deepEqual(expandedHotels[0].template_info, { id: 1001, name: 'bw' });
});

test('compactHotels keeps shared fields together and splits room fields out', () => {
  const hotels = [
    {
      name: '测试酒店',
      address: '测试地址',
      website: 'https://example.com/hotel',
      check_in_date: '2026-05-01',
      check_out_date: '2026-05-03',
      days: 2,
      ctrip_score: 4.8,
      destination: '上海国家会展中心',
      distance: '1.2',
      subway_station: '徐泾东站',
      subway_distance: '0.8',
      transport_time: '18',
      bus_route: '步行至地铁后换乘',
      template_id: 1001,
      template_info: {
        id: 1001,
        name: 'bw'
      },
      room_type: '大床房',
      original_room_type: '商务大床房',
      total_price: 699
    },
    {
      name: '测试酒店',
      address: '测试地址',
      website: 'https://example.com/hotel',
      check_in_date: '2026-05-01',
      check_out_date: '2026-05-03',
      days: 2,
      ctrip_score: 4.8,
      destination: '上海国家会展中心',
      distance: '1.2',
      subway_station: '徐泾东站',
      subway_distance: '0.8',
      transport_time: '18',
      bus_route: '步行至地铁后换乘',
      template_id: 1001,
      template_info: {
        id: 1001,
        name: 'bw'
      },
      room_type: '双床房',
      original_room_type: '商务双床房',
      total_price: 799
    },
    {
      name: '第二家酒店',
      address: '第二地址',
      room_type: '家庭房',
      total_price: 999
    }
  ];

  const compactedHotels = hotelStorage.compactHotels(hotels, normalizeHotelPayload);

  assert.equal(compactedHotels.length, 2);
  assert.equal(compactedHotels[0].rooms.length, 2);
  assert.equal(compactedHotels[1].shared.name, '第二家酒店');
  assert.ok(!('room_type' in compactedHotels[0].shared));
  assert.equal(compactedHotels[0].rooms[0].room_type, '大床房');
  assert.equal(compactedHotels[0].rooms[1].room_type, '双床房');
});
