const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeHotelPayload } = require('../src/main/ipc-handlers/hotel-handlers');
const { createHotelRepository } = require('../src/main/repositories/hotel-repository');
const {
  clearTemplateFromHotels,
  syncTemplateToHotels
} = require('../src/main/services/template-sync-service');

function createStore(initialData = {}) {
  const data = { ...initialData };
  return {
    get(key) {
      return data[key];
    },
    set(key, value) {
      data[key] = value;
    }
  };
}

function createHotelRepo(hotels) {
  return createHotelRepository({
    store: createStore({ hotels }),
    normalizeHotelPayload
  });
}

test('clearTemplateFromHotels clears template references from matching hotels', () => {
  const hotelRepo = createHotelRepo([
    { id: 1, name: '酒店 A', template_id: 9, template_info: { id: 9, name: '旧模板' } },
    { id: 2, name: '酒店 B', template_id: 10, template_info: { id: 10, name: '其他模板' } }
  ]);

  const result = clearTemplateFromHotels({ hotelRepo, templateId: 9 });

  assert.equal(result.affectedHotelCount, 1);
  const hotels = hotelRepo.getAll();
  assert.equal(hotels[0].template_id, null);
  assert.equal(hotels[0].template_info, null);
  assert.equal(hotels[1].template_id, 10);
});

test('syncTemplateToHotels updates matching hotels with the new template fields', () => {
  const hotelRepo = createHotelRepo([
    { id: 1, name: '酒店 A', template_id: 9, destination: '旧目的地' },
    { id: 2, name: '酒店 B', template_id: 10, destination: '其他目的地' }
  ]);
  const template = {
    id: 9,
    name: '新模板',
    destination: '新目的地',
    check_in_date: '2026-06-01',
    check_out_date: '2026-06-03',
    room_count: 2
  };

  const result = syncTemplateToHotels({ hotelRepo, template });

  assert.equal(result.affectedCount, 1);
  const hotels = hotelRepo.getAll();
  assert.equal(hotels[0].destination, '新目的地');
  assert.deepEqual(hotels[0].template_info, template);
  assert.equal(hotels[1].destination, '其他目的地');
});
