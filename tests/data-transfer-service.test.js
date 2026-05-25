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
      app_icon_path: '/icons/app.ico'
    }
  });
  const appIconManager = {
    readCustomIconExportPayload(settings) {
      assert.equal(settings.app_icon_path, '/icons/app.ico');
      return { fileName: 'app.ico' };
    }
  };

  const payload = buildExportPayload(store, { appIconManager });

  assert.equal(payload.schemaVersion, 3);
  assert.equal(payload.meta.sourceApp, '宾馆比较助手');
  assert.equal(payload.meta.schemaVersion, 3);
  assert.equal(payload.meta.customAppIcon.fileName, 'app.ico');
  assert.equal(payload.settings.amapApiKey, '[REDACTED]');
  assert.equal(payload.settings.ai_provider_config.apiKey, '');
  assert.equal(payload.settings.ai_provider_config.hasApiKey, true);
  assert.equal(payload.hotels.length, 1);
  assert.equal(payload.hotels[0].rooms.length, 2);
  assert.equal(payload.templateCount, undefined);
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
    settings: { theme: 'totoro-blue' }
  });

  const payload = buildReplaceImportPayload(importedPayload);

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
