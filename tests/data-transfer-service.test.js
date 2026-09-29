const test = require('node:test');
const assert = require('node:assert/strict');

const hotelStorage = require('../src/main/hotel-storage');
const {
  buildAppendImportPayload,
  buildExportPayload,
  buildReplaceImportPayload,
  normalizeImportedPayload,
  restoreSnapshot
} = require('../src/main/services/data-transfer-service');

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

test('buildExportPayload keeps export schema and redacts sensitive settings', () => {
  const store = createStore({
    hotels: [
      {
        name: '测试酒店',
        address: '测试地址',
        website: 'https://example.com/hotel',
        room_type: '大床房',
        total_price: 688
      },
      {
        name: '测试酒店',
        address: '测试地址',
        website: 'https://example.com/hotel',
        room_type: '双床房',
        total_price: 788
      }
    ],
    templates: [{ id: 1, name: '会展模板', destination: '上海', room_count: 2 }],
    settings: {
      amapApiKey: 'secret-map-key',
      ai_provider_config: {
        provider: 'openai',
        apiKey: 'secret-ai-key',
        enabled: true
      },
      theme: 'colorful-mode',
      activeTheme: 'colorful-mode',
      hotelCardVisibleFields: ['name', 'daily_price'],
      app_icon_path: '/icons/app.ico',
      app_icon_file_name: 'app.ico'
    }
  });

  const payload = buildExportPayload(store);

  assert.equal(payload.schemaVersion, 3);
  assert.equal(payload.meta.sourceApp, '宾馆比较助手');
  assert.equal(payload.meta.schemaVersion, 3);
  assert.equal(Object.hasOwn(payload.meta, 'customAppIcon'), false);
  assert.equal(payload.settings.amapApiKey, '[REDACTED]');
  assert.equal(payload.settings.ai_provider_config.apiKey, '');
  assert.equal(payload.settings.ai_provider_config.hasApiKey, true);
  for (const key of [
    'theme',
    'activeTheme',
    'hotelCardVisibleFields',
    'app_icon_path',
    'app_icon_file_name'
  ]) {
    assert.equal(Object.hasOwn(payload.settings, key), false, key);
  }
  assert.equal(payload.hotels.length, 1);
  assert.equal(payload.hotels[0].rooms.length, 2);
  assert.equal(payload.templateCount, undefined);
});

test('buildExportPayload can export hotel rooms from several selected templates', () => {
  const store = createStore({
    hotels: [
      { id: 11, name: '甲酒店', room_type: '大床房', template_id: 1 },
      { id: 12, name: '甲酒店', room_type: '双床房', template_id: 1 },
      { id: 21, name: '乙酒店', room_type: '套房', template_id: 2 },
      { id: 31, name: '丙酒店', room_type: '家庭房', template_id: 3 }
    ],
    templates: [
      { id: 1, name: '模板一', destination: '上海', room_count: 2 },
      { id: 2, name: '模板二', destination: '北京', room_count: 2 },
      { id: 3, name: '模板三', destination: '广州', room_count: 3 }
    ]
  });

  const payload = buildExportPayload(store, {
    selection: { mode: 'templates', templateIds: ['1', 3] }
  });

  assert.deepEqual(
    payload.templates.map((template) => template.id),
    [1, 3]
  );
  assert.equal(payload.hotels.length, 2);
  assert.equal(payload.hotels[0].rooms.length, 2);
  assert.equal(payload.hotels[1].rooms.length, 1);
  assert.deepEqual(payload.meta.exportScope, {
    mode: 'templates',
    hotelCount: 2,
    roomCount: 3,
    templateCount: 2
  });
});

test('buildExportPayload exports only specifically selected room records and referenced templates', () => {
  const store = createStore({
    hotels: [
      { id: 11, name: '甲酒店', room_type: '大床房', template_id: 1 },
      { id: 12, name: '甲酒店', room_type: '双床房', template_id: 1 },
      { id: 21, name: '乙酒店', room_type: '套房', template_id: 2 }
    ],
    templates: [
      { id: 1, name: '模板一', destination: '上海', room_count: 2 },
      { id: 2, name: '模板二', destination: '北京', room_count: 2 }
    ]
  });

  const payload = buildExportPayload(store, {
    selection: { mode: 'rooms', roomIds: ['12'] }
  });

  assert.equal(payload.hotels.length, 1);
  assert.equal(payload.hotels[0].rooms.length, 1);
  assert.equal(payload.hotels[0].rooms[0].id, 12);
  assert.deepEqual(
    payload.templates.map((template) => template.id),
    [1]
  );
  assert.equal(payload.meta.exportScope.roomCount, 1);
});

test('normalizeImportedPayload validates recognizable payload and item shapes', () => {
  assert.throws(() => normalizeImportedPayload(null), /导入文件格式不正确/);
  assert.throws(() => normalizeImportedPayload({ templates: [] }), /无法识别导入文件/);
  assert.throws(() => normalizeImportedPayload({ hotels: ['bad'] }), /hotels\[0\] 不是有效的对象/);
  assert.throws(
    () => normalizeImportedPayload({ hotels: [{ rooms: [] }] }),
    /hotels\[0\]\.shared 不是有效的对象/
  );
  assert.throws(
    () => normalizeImportedPayload({ hotels: [{ shared: {}, rooms: ['bad'] }] }),
    /hotels\[0\]\.rooms\[0\] 不是有效的对象/
  );
  assert.throws(
    () => normalizeImportedPayload({ hotels: [{ room_type: '大床房' }] }),
    /hotels\[0\] 缺少必填字段 name/
  );
  assert.throws(
    () => normalizeImportedPayload({ hotels: [], templates: [{ destination: '上海' }] }),
    /templates\[0\] 缺少必填字段 name/
  );
});

test('normalizeImportedPayload restores redacted settings placeholders', () => {
  const payload = normalizeImportedPayload({
    hotels: [{ name: '导入酒店', room_type: '大床房' }],
    settings: {
      amapApiKey: '[REDACTED]',
      ai_provider_config: {
        provider: 'openai',
        apiKey: '',
        enabled: true
      }
    },
    meta: { sourceApp: '宾馆比较助手', customAppIcon: { fileName: 'app.ico' } }
  });

  assert.equal(payload.settings.amapApiKey, '');
  assert.equal(payload.settings.ai_provider_config.provider, 'openai');
  assert.equal(payload.customAppIcon.fileName, 'app.ico');
});

test('buildReplaceImportPayload remaps imported hotel template snapshots', () => {
  const importedPayload = normalizeImportedPayload({
    hotels: [
      {
        id: 11,
        name: '导入酒店',
        room_type: '大床房',
        template_id: 7,
        template_info: { id: 7, name: '导入模板', destination: '上海', room_count: 2 }
      }
    ],
    templates: [{ id: 7, name: '导入模板', destination: '上海', room_count: 2 }],
    settings: { theme: 'totoro-blue', amapApiKey: 'imported-map-key' }
  });

  const payload = buildReplaceImportPayload(importedPayload, {
    theme: 'colorful-mode',
    activeTheme: 'colorful-mode',
    hotelCardVisibleFields: ['name', 'daily_price'],
    app_icon_path: 'managed:assets/app-icon.png',
    app_icon_file_name: 'my-icon.png'
  });

  assert.equal(payload.templates.length, 1);
  assert.equal(payload.hotels.length, 1);
  assert.equal(payload.hotels[0].template_id, payload.templates[0].id);
  assert.deepEqual(payload.hotels[0].template_info, {
    id: payload.templates[0].id,
    name: payload.templates[0].name,
    destination: payload.templates[0].destination,
    check_in_date: payload.templates[0].check_in_date,
    check_out_date: payload.templates[0].check_out_date,
    room_count: payload.templates[0].room_count
  });
  assert.deepEqual(payload.importStats, {
    addedHotelCount: 1,
    skippedHotelCount: 0,
    addedTemplateCount: 1,
    skippedTemplateCount: 0
  });
  assert.equal(payload.settings.theme, 'colorful-mode');
  assert.equal(payload.settings.activeTheme, 'colorful-mode');
  assert.deepEqual(payload.settings.hotelCardVisibleFields, ['name', 'daily_price']);
  assert.equal(payload.settings.app_icon_path, 'managed:assets/app-icon.png');
  assert.equal(payload.settings.app_icon_file_name, 'my-icon.png');
  assert.equal(payload.settings.amapApiKey, 'imported-map-key');
});

test('buildAppendImportPayload skips duplicate hotels and templates while preserving existing data', () => {
  const snapshot = {
    hotels: hotelStorage.compactHotels([
      {
        id: 1,
        name: '已有酒店',
        address: '已有地址',
        room_type: '大床房',
        total_price: 600
      }
    ]),
    templates: [{ id: 1, name: '已有模板', destination: '上海', room_count: 2 }],
    settings: { theme: 'totoro-blue' }
  };
  const importedPayload = normalizeImportedPayload({
    hotels: [
      {
        id: 1,
        name: '已有酒店',
        address: '已有地址',
        room_type: '大床房',
        total_price: 600
      },
      {
        id: 2,
        name: '新增酒店',
        address: '新增地址',
        room_type: '双床房',
        total_price: 700
      }
    ],
    templates: [
      { id: 1, name: '已有模板', destination: '上海', room_count: 2 },
      { id: 2, name: '新增模板', destination: '北京', room_count: 1 }
    ],
    settings: { theme: 'ignored-in-append' }
  });

  const payload = buildAppendImportPayload(snapshot, importedPayload);

  assert.equal(payload.hotels.length, 2);
  assert.equal(payload.templates.length, 2);
  assert.equal(payload.hotels[0].name, '已有酒店');
  assert.equal(payload.hotels[1].name, '新增酒店');
  assert.equal(payload.settings.theme, 'totoro-blue');
  assert.deepEqual(payload.importStats, {
    addedHotelCount: 1,
    skippedHotelCount: 1,
    addedTemplateCount: 1,
    skippedTemplateCount: 1
  });
});

test('restoreSnapshot restores all persisted data slices', () => {
  const store = createStore({
    hotels: [{ name: '新酒店' }],
    templates: [{ name: '新模板' }],
    settings: { theme: 'new' }
  });
  const snapshot = {
    hotels: [{ name: '旧酒店' }],
    templates: [{ name: '旧模板' }],
    settings: { theme: 'old' }
  };

  restoreSnapshot(store, snapshot);

  assert.deepEqual(store.get('hotels'), snapshot.hotels);
  assert.deepEqual(store.get('templates'), snapshot.templates);
  assert.deepEqual(store.get('settings'), snapshot.settings);
});
