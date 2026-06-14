const assert = require('node:assert/strict');
const os = require('node:os');
const Module = require('node:module');
const test = require('node:test');

const originalLoad = Module._load;
Module._load = function loadWithElectronStub(request, parent, isMain) {
  if (request === 'electron') {
    return {
      app: {
        isPackaged: false,
        getPath() {
          return os.tmpdir();
        }
      },
      dialog: {
        async showOpenDialog() {
          return { canceled: true, filePaths: [] };
        }
      }
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};

const hotelHandlers = require('../src/main/ipc-handlers/hotel-handlers');
const templateHandlers = require('../src/main/ipc-handlers/template-handlers');
const registerSettingsHandlers = require('../src/main/ipc-handlers/settings-handlers');
const hotelStorage = require('../src/main/hotel-storage');
const { APP_CONFIG } = require('../src/main/config');

function createStore(initialData = {}) {
  const data = { ...initialData };
  const setCalls = [];

  return {
    get setCalls() {
      return setCalls;
    },
    get(key) {
      return data[key];
    },
    set(key, value) {
      data[key] = value;
      setCalls.push({ key, value });
    }
  };
}

function createIpcMain() {
  const handlers = {};
  return {
    handlers,
    handle(channel, handler) {
      handlers[channel] = handler;
    }
  };
}

function createCache() {
  return {
    invalidate() {}
  };
}

function createTrustedIpcEvent() {
  return {
    senderFrame: { url: 'file:///trusted/index.html' },
    sender: {}
  };
}

function registerHandler(register, store, extraServices = {}) {
  const ipcMain = createIpcMain();
  register({
    ipcMain,
    cache: createCache(),
    services: {
      dataService: { getStore: () => store },
      ...extraServices
    }
  });
  return ipcMain.handlers;
}

test('normalized hotels are read without redundant store writeback', () => {
  const normalizedHotel = hotelHandlers.normalizeHotelPayload({
    id: 1,
    name: '武汉测试酒店',
    room_type: '大床房',
    original_room_type: '豪华大床房',
    total_price: 688,
    room_count: 2
  });
  const store = createStore({
    hotels: hotelStorage.compactHotels([normalizedHotel], hotelHandlers.normalizeHotelPayload)
  });
  const handlers = registerHandler(hotelHandlers, store);

  const hotels = handlers['hotel:getAll'](createTrustedIpcEvent());

  assert.equal(hotels.length, 1);
  assert.equal(store.setCalls.length, 0);
});

test('hotel normalization still repairs missing and duplicate ids', () => {
  const store = createStore({
    hotels: [
      { name: ' 无 ID 酒店 ', room_type: '双床房' },
      { id: 7, name: '重复 ID 酒店 A', room_type: '大床房' },
      { id: 7, name: '重复 ID 酒店 B', room_type: '大床房' }
    ]
  });
  const handlers = registerHandler(hotelHandlers, store);

  const hotels = handlers['hotel:getAll'](createTrustedIpcEvent());
  const ids = hotels.map((hotel) => String(hotel.id));

  assert.equal(new Set(ids).size, hotels.length);
  assert.equal(hotels[0].name, '无 ID 酒店');
  assert.ok(store.setCalls.some((call) => call.key === 'hotels'));
});

test('normalized templates are read without redundant store writeback', () => {
  const normalizedTemplate = templateHandlers.normalizeTemplatePayload({
    id: 1,
    name: '武汉',
    destination: '江汉路步行街',
    check_in_date: '2026-06-01',
    check_out_date: '2026-06-02',
    room_count: 3,
    created_at: '2026-05-01T00:00:00.000Z'
  });
  const store = createStore({
    templates: [normalizedTemplate]
  });
  const handlers = registerHandler(templateHandlers, store, {
    windowService: { getMainWindow: () => null }
  });

  const templates = handlers['template:getAll'](createTrustedIpcEvent());

  assert.equal(templates.length, 1);
  assert.equal(store.setCalls.length, 0);
});

test('template normalization still fills defaults and repairs ids', () => {
  const store = createStore({
    templates: [
      { name: ' 武汉 ', destination: ' 江汉路 ', room_count: 5 },
      { id: 'same', name: '重复模板 A', room_count: '' },
      { id: 'same', name: '重复模板 B' }
    ]
  });
  const handlers = registerHandler(templateHandlers, store, {
    windowService: { getMainWindow: () => null }
  });

  const templates = handlers['template:getAll'](createTrustedIpcEvent());
  const ids = templates.map((template) => String(template.id));

  assert.equal(new Set(ids).size, templates.length);
  assert.equal(templates[0].name, '武汉');
  assert.equal(templates[0].destination, '江汉路');
  assert.equal(templates[0].room_count, 3);
  assert.equal(templates[1].room_count, 2);
  assert.ok(store.setCalls.some((call) => call.key === 'templates'));
});

test('normalized settings are read without redundant store writeback', () => {
  const store = createStore({
    settings: { ...APP_CONFIG.STORE_DEFAULTS.settings }
  });
  const handlers = registerHandler(registerSettingsHandlers, store, {
    windowService: {
      getIconState: () => ({})
    }
  });

  const settings = handlers['settings:getAll'](createTrustedIpcEvent());

  assert.equal(settings.theme, APP_CONFIG.STORE_DEFAULTS.settings.theme);
  assert.equal(store.setCalls.length, 0);
});

test('settings normalization still fills defaults and removes deprecated fields', () => {
  const store = createStore({
    settings: {
      theme: 'dark',
      amapApiKey: '  custom-amap-key  ',
      autoMatchTemplate: true,
      weight_price: 0.9,
      weight_score: 0.1,
      aiListMinScore: 4.1,
      aiListExcludeKeywords: '广告',
      aiListExcludeHotelTypes: '民宿,公寓',
      aiListMaxPages: 99
    }
  });
  const handlers = registerHandler(registerSettingsHandlers, store, {
    windowService: {
      getIconState: () => ({})
    }
  });

  const settings = handlers['settings:getAll'](createTrustedIpcEvent());

  assert.equal(settings.theme, APP_CONFIG.STORE_DEFAULTS.settings.theme);
  assert.equal(settings.collectBrowser, 'edge');
  assert.equal(settings.app_icon_file_name, '');
  assert.equal(settings.amapApiKey, 'custom-amap-key');
  assert.equal(Object.prototype.hasOwnProperty.call(settings, 'autoMatchTemplate'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(settings, 'weight_price'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(settings, 'weight_score'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(settings, 'aiListMinScore'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(settings, 'aiListExcludeKeywords'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(settings, 'aiListExcludeHotelTypes'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(settings, 'aiListMaxPages'), false);
  assert.ok(store.setCalls.some((call) => call.key === 'settings'));
});

test('settings normalization treats unsupported batch concurrency as default serial', () => {
  const store = createStore({
    settings: {
      ...APP_CONFIG.STORE_DEFAULTS.settings,
      collectBatchConcurrency: 6
    }
  });
  const handlers = registerHandler(registerSettingsHandlers, store, {
    windowService: {
      getIconState: () => ({})
    }
  });

  const settings = handlers['settings:getAll'](createTrustedIpcEvent());

  assert.equal(settings.collectBatchConcurrency, 1);
  assert.equal(store.setCalls.at(-1).key, 'settings');
  assert.equal(store.setCalls.at(-1).value.collectBatchConcurrency, 1);
});

test('settings:set rejects empty setting keys before mutating settings', () => {
  const store = createStore({
    settings: { ...APP_CONFIG.STORE_DEFAULTS.settings }
  });
  const handlers = registerHandler(registerSettingsHandlers, store, {
    windowService: {
      applyWindowIcon() {
        return { success: true };
      },
      applyThemeAppearance() {
        return { success: true };
      }
    }
  });

  const result = handlers['settings:set'](createTrustedIpcEvent(), '', 'value');

  assert.deepEqual(result, { success: false, error: '无效的设置项' });
  assert.equal(store.setCalls.length, 0);
});

test('settings:set rejects unknown setting keys before mutating settings', () => {
  const store = createStore({
    settings: { ...APP_CONFIG.STORE_DEFAULTS.settings }
  });
  const handlers = registerHandler(registerSettingsHandlers, store, {
    windowService: {
      applyWindowIcon() {
        return { success: true };
      },
      applyThemeAppearance() {
        return { success: true };
      }
    }
  });

  const result = handlers['settings:set'](
    createTrustedIpcEvent(),
    'unexpectedFilesystemPath',
    'C:/tmp'
  );

  assert.deepEqual(result, { success: false, error: '不支持的设置项' });
  assert.equal(store.setCalls.length, 0);
});
