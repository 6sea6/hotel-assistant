const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeHotelPayload } = require('../src/main/domain/hotel-normalizer');
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

function createSpiedHotelRepo(hotels) {
  const repo = createHotelRepo(hotels);
  const calls = {
    replaceAll: [],
    updateMany: []
  };

  return {
    repo: {
      ...repo,
      replaceAll(payload) {
        calls.replaceAll.push(payload);
        return repo.replaceAll(payload);
      },
      updateMany(payload) {
        calls.updateMany.push(payload);
        return repo.updateMany(payload);
      }
    },
    calls
  };
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

test('clearTemplateFromHotels updates only affected hotels instead of replacing all hotels', () => {
  const { repo: hotelRepo, calls } = createSpiedHotelRepo([
    { id: 1, name: '酒店 A', template_id: 9, template_info: { id: 9, name: '旧模板' } },
    { id: 2, name: '酒店 B', template_id: 10, template_info: { id: 10, name: '其他模板' } }
  ]);

  const result = clearTemplateFromHotels({ hotelRepo, templateId: 9 });

  assert.equal(result.affectedHotelCount, 1);
  assert.equal(calls.replaceAll.length, 0);
  assert.equal(calls.updateMany.length, 1);
  assert.equal(calls.updateMany[0].length, 1);
  assert.equal(calls.updateMany[0][0].id, 1);
  assert.deepEqual(
    result.affectedHotels.map((hotel) => hotel.id),
    [1]
  );
});

test('syncTemplateToHotels updates only matching hotels instead of replacing all hotels', () => {
  const { repo: hotelRepo, calls } = createSpiedHotelRepo([
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
  assert.equal(calls.replaceAll.length, 0);
  assert.equal(calls.updateMany.length, 1);
  assert.equal(calls.updateMany[0].length, 1);
  assert.equal(calls.updateMany[0][0].id, 1);
  assert.deepEqual(
    result.affectedHotels.map((hotel) => hotel.id),
    [1]
  );
});
