const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

globalThis.window = globalThis;
globalThis.performance = { now: () => Date.now() };
globalThis.document = {
  getElementById: (id) => globalThis.__formFields[id] || null,
  activeElement: null
};
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);

let moduleUrl = '';

function writeStub(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf-8');
}

async function loadCrudModule() {
  if (!moduleUrl) {
    // Ensure __testState exists before state.js stub is evaluated
    if (!globalThis.__testState) initTestState([]);

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-crud-incremental-'));
    const sourceDir = path.join(__dirname, '..', 'src', 'renderer', 'modules');

    writeStub(path.join(tempRoot, 'package.json'), '{"type":"module"}\n');

    // Copy the files under test
    fs.copyFileSync(path.join(sourceDir, 'hotel-crud.js'), path.join(tempRoot, 'hotel-crud.js'));
    fs.copyFileSync(
      path.join(sourceDir, 'hotel-state-helpers.js'),
      path.join(tempRoot, 'hotel-state-helpers.js')
    );

    // Stub: state.js
    writeStub(
      path.join(tempRoot, 'state.js'),
      `
      export const state = globalThis.__testState;
      export const TEMPLATE_SELECT_BATCH_SIZE = 180;
      export function setHotels(h) { state.hotels = h; }
      export function setTemplates(t) { state.templates = t; }
      export function setSettings(s) { state.settings = s; }
      export function clearSelectedHotels() { state.selectedHotels.clear(); }
      export function markRankingCacheDirty() { state._rankingDirty = true; }
      `
    );

    // Stub: dom-helpers.js
    writeStub(
      path.join(tempRoot, 'dom-helpers.js'),
      `
      export const $ = (id) => globalThis.__formFields[id] || null;
      export function getValue(id) {
        const el = $(id);
        return el ? el.value : '';
      }
      export function setValue(id, v) {
        const el = $(id);
        if (el) el.value = v;
      }
      export function idsEqual(a, b) { return String(a) === String(b); }
      export function normalizeIdValue(v) {
        if (v === null || v === undefined || v === '') return null;
        const t = String(v).trim();
        if (t === '') return null;
        return /^-?\\d+$/.test(t) ? Number(t) : t;
      }
      export function getSelectionKey(id) { return String(id); }
      export function hasDisplayValue(v) { return v !== null && v !== undefined && String(v).trim() !== ''; }
      export function escapeHtml(t) { return String(t); }
      `
    );

    // Stub: notification.js
    writeStub(
      path.join(tempRoot, 'notification.js'),
      `export function showNotification(msg, type) {
        globalThis.__notifications.push({ msg, type });
      }`
    );

    // Stub: perf.js
    writeStub(
      path.join(tempRoot, 'perf.js'),
      `export function perfStart() {}
       export function perfEnd() {}`
    );

    // Stub: ui-utils.js
    writeStub(
      path.join(tempRoot, 'ui-utils.js'),
      `export function setModalActive() {}
       export function resetBatchDeleteConfirmation() {}
       export function startBatchDeleteConfirmation() {}
       export function syncBatchDeleteButton() {}
       export function scheduleHotelModalFocus() {}`
    );

    // Stub: actions.js
    writeStub(
      path.join(tempRoot, 'actions.js'),
      `export const actions = {
        requestHotelListRender() {},
        renderHotelList() {}
      };`
    );

    // Stub: custom-select.js
    writeStub(
      path.join(tempRoot, 'custom-select.js'),
      `export function refreshCustomSelects() {}`
    );

    moduleUrl = pathToFileURL(path.join(tempRoot, 'hotel-crud.js')).href;
    process.on('exit', () => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
  }

  return import(moduleUrl);
}

// Must be called once before any test to set the initial reference.
// Subsequent calls mutate the same object so ES module bindings stay valid.
function initTestState(hotels = []) {
  if (!globalThis.__testState) {
    globalThis.__testState = {
      hotels: [],
      templates: [],
      settings: {},
      selectedHotels: new Set(),
      currentFilters: {},
      lastEditedPriceField: null,
      hotelTemplateSelectRenderVersion: 0,
      _rankingDirty: false
    };
  }
  const s = globalThis.__testState;
  s.hotels = hotels.map((h) => ({ ...h }));
  s.templates = [];
  s.settings = {};
  s.selectedHotels = new Set();
  s.currentFilters = {};
  s.lastEditedPriceField = null;
  s.hotelTemplateSelectRenderVersion = 0;
  s._rankingDirty = false;
  globalThis.__formFields = {};
  globalThis.__notifications = [];
}

function setFormField(id, value) {
  globalThis.__formFields[id] = { value };
}

function setFormCheckbox(id, checked) {
  globalThis.__formFields[id] = { value: checked ? 'on' : '', checked };
}

function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

/* ---- saveHotel ---- */

test('saveHotel add success does not call getAllHotels', async () => {
  const { saveHotel } = await loadCrudModule();
  initTestState([]);
  globalThis.__testState.templates = [];

  setFormField('hotelId', '');
  setFormField('hotelName', '新宾馆');
  setFormField('hotelTemplateSelect', '');
  setFormField('hotelAddress', '');
  setFormField('hotelWebsite', '');
  setFormField('totalPrice', '');
  setFormField('dailyPrice', '');
  setFormField('checkInDate', '');
  setFormField('checkOutDate', '');
  setFormField('days', '');
  setFormField('ctripScore', '');
  setFormField('destination', '');
  setFormField('distance', '');
  setFormField('subwayStation', '');
  setFormField('subwayDistance', '');
  setFormField('transportTime', '');
  setFormField('busRoute', '');
  setFormField('roomType', '');
  setFormField('originalRoomType', '');
  setFormField('roomCount', '1');
  setFormField('roomArea', '');
  setFormField('notes', '');
  setFormCheckbox('isFavorite', false);

  const addedHotel = { id: 100, name: '新宾馆', is_favorite: 0 };
  let addCallCount = 0;
  let getAllCallCount = 0;

  window.electronAPI = {
    addHotel: async () => { addCallCount++; return addedHotel; },
    updateHotel: async () => null,
    deleteHotel: async () => ({ success: true }),
    getAllHotels: async () => { getAllCallCount++; return []; }
  };

  await saveHotel();
  await flushMicrotasks();

  assert.equal(addCallCount, 1);
  assert.equal(getAllCallCount, 0, 'getAllHotels should not be called on success');
  assert.equal(globalThis.__testState.hotels.length, 1);
  assert.equal(globalThis.__testState.hotels[0].name, '新宾馆');
});

test('saveHotel update success does not call getAllHotels', async () => {
  const { saveHotel } = await loadCrudModule();
  initTestState([{ id: 1, name: '旧名', is_favorite: 0 }]);

  setFormField('hotelId', '1');
  setFormField('hotelName', '新名');
  setFormField('hotelTemplateSelect', '');
  setFormField('hotelAddress', '');
  setFormField('hotelWebsite', '');
  setFormField('totalPrice', '');
  setFormField('dailyPrice', '');
  setFormField('checkInDate', '');
  setFormField('checkOutDate', '');
  setFormField('days', '');
  setFormField('ctripScore', '');
  setFormField('destination', '');
  setFormField('distance', '');
  setFormField('subwayStation', '');
  setFormField('subwayDistance', '');
  setFormField('transportTime', '');
  setFormField('busRoute', '');
  setFormField('roomType', '');
  setFormField('originalRoomType', '');
  setFormField('roomCount', '1');
  setFormField('roomArea', '');
  setFormField('notes', '');
  setFormCheckbox('isFavorite', false);

  const updatedHotel = { id: 1, name: '新名', is_favorite: 0 };
  let updateCallCount = 0;
  let getAllCallCount = 0;

  window.electronAPI = {
    addHotel: async () => null,
    updateHotel: async () => { updateCallCount++; return updatedHotel; },
    deleteHotel: async () => ({ success: true }),
    getAllHotels: async () => { getAllCallCount++; return []; }
  };

  await saveHotel();
  await flushMicrotasks();

  assert.equal(updateCallCount, 1);
  assert.equal(getAllCallCount, 0, 'getAllHotels should not be called on success');
  assert.equal(globalThis.__testState.hotels.length, 1);
  assert.equal(globalThis.__testState.hotels[0].name, '新名');
});

test('saveHotel { success:false } does not pollute state.hotels', async () => {
  const { saveHotel } = await loadCrudModule();
  const original = { id: 1, name: '原始', is_favorite: 0 };
  initTestState([original]);

  setFormField('hotelId', '1');
  setFormField('hotelName', '尝试修改');
  setFormField('hotelTemplateSelect', '');
  setFormField('hotelAddress', '');
  setFormField('hotelWebsite', '');
  setFormField('totalPrice', '');
  setFormField('dailyPrice', '');
  setFormField('checkInDate', '');
  setFormField('checkOutDate', '');
  setFormField('days', '');
  setFormField('ctripScore', '');
  setFormField('destination', '');
  setFormField('distance', '');
  setFormField('subwayStation', '');
  setFormField('subwayDistance', '');
  setFormField('transportTime', '');
  setFormField('busRoute', '');
  setFormField('roomType', '');
  setFormField('originalRoomType', '');
  setFormField('roomCount', '1');
  setFormField('roomArea', '');
  setFormField('notes', '');
  setFormCheckbox('isFavorite', false);

  window.electronAPI = {
    addHotel: async () => null,
    updateHotel: async () => ({ success: false, error: '无效的宾馆 ID' }),
    deleteHotel: async () => ({ success: true }),
    getAllHotels: async () => []
  };

  await saveHotel();
  await flushMicrotasks();

  assert.equal(globalThis.__testState.hotels.length, 1);
  assert.equal(globalThis.__testState.hotels[0].name, '原始');
  const hasSuccessFalse = globalThis.__testState.hotels.some((h) => h.success === false);
  assert.equal(hasSuccessFalse, false, 'state.hotels must not contain { success:false } objects');
  const errNotification = globalThis.__notifications.find((n) => n.type === 'error');
  assert.ok(errNotification, 'should show error notification');
});

/* ---- toggleFavorite ---- */

test('toggleFavorite success does not call getAllHotels', async () => {
  const { toggleFavorite } = await loadCrudModule();
  initTestState([{ id: 1, name: 'A', is_favorite: 0 }]);

  const savedHotel = { id: 1, name: 'A', is_favorite: 1 };
  let updateCallCount = 0;
  let getAllCallCount = 0;

  window.electronAPI = {
    addHotel: async () => null,
    updateHotel: async () => { updateCallCount++; return savedHotel; },
    deleteHotel: async () => ({ success: true }),
    getAllHotels: async () => { getAllCallCount++; return []; }
  };

  await toggleFavorite(1, 0);
  await flushMicrotasks();

  assert.equal(updateCallCount, 1);
  assert.equal(getAllCallCount, 0, 'getAllHotels should not be called on success');
  assert.equal(globalThis.__testState.hotels[0].is_favorite, 1);
});

test('toggleFavorite { success:false } rolls back to previousHotels', async () => {
  const { toggleFavorite } = await loadCrudModule();
  initTestState([{ id: 1, name: 'A', is_favorite: 0 }]);

  window.electronAPI = {
    addHotel: async () => null,
    updateHotel: async () => ({ success: false, error: '失败' }),
    deleteHotel: async () => ({ success: true }),
    getAllHotels: async () => []
  };

  await toggleFavorite(1, 0);
  await flushMicrotasks();

  assert.equal(globalThis.__testState.hotels[0].is_favorite, 0, 'should roll back to original');
  const hasSuccessFalse = globalThis.__testState.hotels.some((h) => h.success === false);
  assert.equal(hasSuccessFalse, false, 'state.hotels must not contain { success:false } objects');
  const errNotification = globalThis.__notifications.find((n) => n.type === 'error');
  assert.ok(errNotification, 'should show error notification');
});

/* ---- deleteHotel ---- */

test('deleteHotel success does not call getAllHotels', async () => {
  const { deleteHotel } = await loadCrudModule();
  initTestState([
    { id: 1, name: 'A', is_favorite: 0 },
    { id: 2, name: 'B', is_favorite: 0 }
  ]);

  let deleteCallCount = 0;
  let getAllCallCount = 0;

  window.electronAPI = {
    addHotel: async () => null,
    updateHotel: async () => null,
    deleteHotel: async () => { deleteCallCount++; return { success: true, deletedCount: 1 }; },
    getAllHotels: async () => { getAllCallCount++; return []; }
  };

  await deleteHotel(1);
  await flushMicrotasks();

  assert.equal(deleteCallCount, 1);
  assert.equal(getAllCallCount, 0, 'getAllHotels should not be called on success');
  assert.equal(globalThis.__testState.hotels.length, 1);
  assert.equal(globalThis.__testState.hotels[0].id, 2);
});
