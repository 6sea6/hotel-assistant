const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const bridgeModulePath = path.resolve(__dirname, '../src/compare-app-bridge.js');

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-compare-bridge-'));
}

function withBridge(testFn) {
  return async (t) => {
    const originalAppData = process.env.APPDATA;
    const originalDataDir = process.env.HOTEL_COMPARE_APP_DATA_DIR;
    const originalWorkspaceDir = process.env.HOTEL_COMPARE_APP_WORKSPACE_DIR;
    const originalUseWorkspace = process.env.HOTEL_COMPARE_APP_USE_WORKSPACE;
    const tempRoot = createTempRoot();
    const appDataRoot = path.join(tempRoot, 'appdata');
    fs.mkdirSync(appDataRoot, { recursive: true });

    process.env.APPDATA = appDataRoot;
    process.env.HOTEL_COMPARE_APP_USE_WORKSPACE = 'false';
    delete process.env.HOTEL_COMPARE_APP_DATA_DIR;
    delete process.env.HOTEL_COMPARE_APP_WORKSPACE_DIR;
    delete require.cache[bridgeModulePath];
    const bridge = require(bridgeModulePath);

    t.after(() => {
      delete require.cache[bridgeModulePath];
      if (originalAppData === undefined) {
        delete process.env.APPDATA;
      } else {
        process.env.APPDATA = originalAppData;
      }
      if (originalDataDir === undefined) {
        delete process.env.HOTEL_COMPARE_APP_DATA_DIR;
      } else {
        process.env.HOTEL_COMPARE_APP_DATA_DIR = originalDataDir;
      }
      if (originalWorkspaceDir === undefined) {
        delete process.env.HOTEL_COMPARE_APP_WORKSPACE_DIR;
      } else {
        process.env.HOTEL_COMPARE_APP_WORKSPACE_DIR = originalWorkspaceDir;
      }
      if (originalUseWorkspace === undefined) {
        delete process.env.HOTEL_COMPARE_APP_USE_WORKSPACE;
      } else {
        process.env.HOTEL_COMPARE_APP_USE_WORKSPACE = originalUseWorkspace;
      }
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    await testFn({
      appDataRoot,
      tempRoot,
      bridge
    });
  };
}

test(
  'findTemplateInStore only matches explicit template id or exact normalized name',
  withBridge(async ({ bridge }) => {
    const store = {
      templates: [
        {
          id: 1,
          name: 'other',
          destination: '上海国家会展中心',
          check_in_date: '2026-05-01',
          check_out_date: '2026-05-03',
          room_count: 2
        },
        {
          id: 2,
          name: 'bw',
          destination: '上海 国家会展中心',
          check_in_date: '2026-05-01',
          check_out_date: '2026-05-03',
          room_count: 2
        },
        {
          id: 3,
          name: 'bw',
          destination: '深圳国际会展中心',
          check_in_date: '2026-05-01',
          check_out_date: '2026-05-03',
          room_count: 2
        }
      ]
    };

    assert.equal(bridge.findTemplateInStore(store, null, ' bw ').id, 2);
    assert.equal(bridge.findTemplateInStore(store, 3, '').id, 3);
    assert.equal(bridge.findTemplateInStore(store, null, ''), null);
  })
);

test(
  'appendHotelsToStore replaceExistingGroup writes grouped hotels without flattening schema',
  withBridge(async ({ bridge }) => {
    const templateInfo = {
      id: 2001,
      name: 'bw',
      destination: '上海国家会展中心',
      check_in_date: '2026-05-01',
      check_out_date: '2026-05-03',
      room_count: 2
    };

    const incomingHotels = [
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
        template_id: 2001,
        template_info: templateInfo,
        room_type: '大床房',
        original_room_type: '商务大床房',
        total_price: 699,
        daily_price: 349.5
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
        template_id: 2001,
        template_info: templateInfo,
        room_type: '双床房',
        original_room_type: '商务双床房',
        total_price: 799,
        daily_price: 399.5
      }
    ];

    const results = bridge.appendHotelsToStore(incomingHotels, { replaceExistingGroup: true });
    const store = bridge.loadCompareAppStore();

    assert.equal(results.length, 2);
    assert.equal(store.hotels.length, 1);
    assert.equal(store.hotels[0].rooms.length, 2);
    assert.equal(store.hotels[0].shared.name, '测试酒店');
    assert.equal(store.hotels[0].rooms[0].room_type, '大床房');
    assert.equal(store.hotels[0].rooms[1].room_type, '双床房');
  })
);

test(
  'appendHotelsToStore replaceExistingGroup preserves untouched rooms and only updates duplicates from current write',
  withBridge(async ({ bridge }) => {
    const templateInfo = {
      id: 2001,
      name: 'bw',
      destination: '上海国家会展中心',
      check_in_date: '2026-05-01',
      check_out_date: '2026-05-03',
      room_count: 2
    };

    bridge.appendHotelsToStore(
      [
        {
          name: '测试酒店',
          address: '旧地址',
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
          bus_route: '旧路线',
          template_id: 2001,
          template_info: templateInfo,
          room_type: '大床房',
          original_room_type: '商务大床房',
          total_price: 699,
          daily_price: 349.5
        },
        {
          name: '测试酒店',
          address: '旧地址',
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
          bus_route: '旧路线',
          template_id: 2001,
          template_info: templateInfo,
          room_type: '双床房',
          original_room_type: '商务双床房',
          total_price: 799,
          daily_price: 399.5
        }
      ],
      { replaceExistingGroup: true }
    );

    const results = bridge.appendHotelsToStore(
      [
        {
          name: '测试酒店',
          address: '新地址',
          website: 'https://example.com/hotel',
          check_in_date: '2026-05-01',
          check_out_date: '2026-05-03',
          days: 2,
          ctrip_score: 4.9,
          destination: '上海国家会展中心',
          distance: '1.5',
          subway_station: '徐泾东站',
          subway_distance: '0.6',
          transport_time: '16',
          bus_route: '新路线',
          template_id: 2001,
          template_info: templateInfo,
          room_type: '大床房',
          original_room_type: '商务大床房',
          total_price: 888,
          daily_price: 444
        }
      ],
      { replaceExistingGroup: true }
    );

    const store = bridge.loadCompareAppStore();
    const groupedHotel = store.hotels[0];
    const bigBedRoom = groupedHotel.rooms.find((room) => room.original_room_type === '商务大床房');
    const twinRoom = groupedHotel.rooms.find((room) => room.original_room_type === '商务双床房');

    assert.equal(results.length, 1);
    assert.equal(results[0].operation, 'updated');
    assert.equal(store.hotels.length, 1);
    assert.equal(groupedHotel.rooms.length, 2);
    assert.equal(groupedHotel.shared.address, '新地址');
    assert.equal(groupedHotel.shared.distance, '1.5');
    assert.equal(groupedHotel.shared.bus_route, '新路线');
    assert.equal(bigBedRoom.total_price, 888);
    assert.equal(bigBedRoom.daily_price, 444);
    assert.equal(twinRoom.total_price, 799);
    assert.equal(twinRoom.daily_price, 399.5);
  })
);

test(
  'appendHotelsToStore overwriteExistingGroup replaces all rooms in the matched hotel group',
  withBridge(async ({ bridge }) => {
    const templateInfo = {
      id: 2001,
      name: 'bw',
      destination: '上海国家会展中心',
      check_in_date: '2026-05-01',
      check_out_date: '2026-05-03',
      room_count: 2
    };

    bridge.appendHotelsToStore(
      [
        {
          name: '测试酒店',
          website: 'https://example.com/hotel',
          check_in_date: '2026-05-01',
          check_out_date: '2026-05-03',
          template_id: 2001,
          template_info: templateInfo,
          room_type: '大床房',
          original_room_type: '商务大床房',
          total_price: 699
        },
        {
          name: '测试酒店',
          website: 'https://example.com/hotel',
          check_in_date: '2026-05-01',
          check_out_date: '2026-05-03',
          template_id: 2001,
          template_info: templateInfo,
          room_type: '双床房',
          original_room_type: '商务双床房',
          total_price: 799
        }
      ],
      { replaceExistingGroup: true }
    );

    const results = bridge.appendHotelsToStore(
      [
        {
          name: '测试酒店',
          website: 'https://example.com/hotel',
          check_in_date: '2026-05-01',
          check_out_date: '2026-05-03',
          template_id: 2001,
          template_info: templateInfo,
          room_type: '家庭房',
          original_room_type: '亲子家庭房',
          total_price: 888
        }
      ],
      { overwriteExistingGroup: true }
    );

    const store = bridge.loadCompareAppStore();

    assert.equal(results.length, 1);
    assert.equal(results[0].operation, 'replaced');
    assert.equal(store.hotels.length, 1);
    assert.equal(store.hotels[0].rooms.length, 1);
    assert.equal(store.hotels[0].rooms[0].room_type, '家庭房');
  })
);

test(
  'pointer file overrides default compare app data folder',
  withBridge(async ({ appDataRoot, tempRoot, bridge }) => {
    const customDataFolder = path.join(tempRoot, 'custom-data-folder');
    fs.mkdirSync(customDataFolder, { recursive: true });
    fs.writeFileSync(
      path.join(appDataRoot, 'hotel-app-pointer.json'),
      JSON.stringify({ dataFolder: customDataFolder }, null, 2),
      'utf-8'
    );

    assert.equal(bridge.getCompareAppDataFolder(), customDataFolder);
    assert.equal(bridge.getCompareAppStorePath(), path.join(customDataFolder, 'hotel-data.json'));
  })
);

test(
  'explicit compare app data dir override wins over pointer',
  withBridge(async ({ appDataRoot, tempRoot }) => {
    const customDataFolder = path.join(tempRoot, 'custom-data-folder');
    const explicitDataFolder = path.join(tempRoot, 'explicit-data-folder');
    fs.mkdirSync(customDataFolder, { recursive: true });
    fs.mkdirSync(explicitDataFolder, { recursive: true });
    fs.writeFileSync(
      path.join(explicitDataFolder, 'hotel-data.json'),
      JSON.stringify({ hotels: [], templates: [] }),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(appDataRoot, 'hotel-app-pointer.json'),
      JSON.stringify({ dataFolder: customDataFolder }, null, 2),
      'utf-8'
    );

    process.env.HOTEL_COMPARE_APP_DATA_DIR = explicitDataFolder;
    delete require.cache[bridgeModulePath];
    const bridge = require(bridgeModulePath);

    assert.equal(bridge.getExplicitDataFolderOverride(), explicitDataFolder);
    assert.equal(bridge.getCompareAppDataFolder(), explicitDataFolder);
  })
);

test(
  'workspace compare app folder wins over pointer in local development mode',
  withBridge(async ({ appDataRoot, tempRoot }) => {
    const pointerFolder = path.join(tempRoot, 'pointer-data-folder');
    const workspaceFolder = path.join(tempRoot, 'workspace-data-folder');
    fs.mkdirSync(pointerFolder, { recursive: true });
    fs.mkdirSync(workspaceFolder, { recursive: true });
    fs.writeFileSync(
      path.join(workspaceFolder, 'hotel-data.json'),
      JSON.stringify({ hotels: [], templates: [] }),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(appDataRoot, 'hotel-app-pointer.json'),
      JSON.stringify({ dataFolder: pointerFolder }, null, 2),
      'utf-8'
    );

    process.env.HOTEL_COMPARE_APP_USE_WORKSPACE = 'true';
    process.env.HOTEL_COMPARE_APP_WORKSPACE_DIR = workspaceFolder;
    delete require.cache[bridgeModulePath];
    const bridge = require(bridgeModulePath);

    assert.equal(bridge.getCompareAppDataFolder(), workspaceFolder);
  })
);

test(
  'loadCompareAppStore normalizes settings and removes deprecated autoMatchTemplate flag',
  withBridge(async ({ bridge }) => {
    const storePath = bridge.getCompareAppStorePath();
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(
      storePath,
      JSON.stringify(
        {
          hotels: [],
          templates: [],
          settings: {
            autoMatchTemplate: true,
            weight_price: 0.9,
            weight_score: 0.1,
            includeFourPersonRoomsForThreePersonTemplate: true
          }
        },
        null,
        2
      ),
      'utf-8'
    );

    const store = bridge.loadCompareAppStore();

    assert.equal(store.settings.includeFourPersonRoomsForThreePersonTemplate, true);
    assert.equal(Object.prototype.hasOwnProperty.call(store.settings, 'autoMatchTemplate'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(store.settings, 'weight_price'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(store.settings, 'weight_score'), false);
  })
);

test(
  'appendHotelsToStore drops legacy unknown fields during duplicate merges',
  withBridge(async ({ bridge }) => {
    const storePath = bridge.getCompareAppStorePath();
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(
      storePath,
      JSON.stringify(
        {
          hotels: [
            {
              shared: {
                name: '测试酒店',
                address: '旧地址',
                website: 'https://example.com/hotel',
                check_in_date: '2026-05-01',
                check_out_date: '2026-05-03',
                template_id: 2001,
                legacy_extra: 'shared legacy'
              },
              rooms: [
                {
                  room_type: '大床房',
                  original_room_type: '商务大床房',
                  total_price: 699,
                  daily_price: 349.5,
                  legacy_extra: 'room legacy'
                }
              ]
            }
          ],
          templates: [],
          settings: {}
        },
        null,
        2
      ),
      'utf-8'
    );

    bridge.appendHotelsToStore(
      [
        {
          name: '测试酒店',
          address: '新地址',
          website: 'https://example.com/hotel',
          check_in_date: '2026-05-01',
          check_out_date: '2026-05-03',
          template_id: 2001,
          room_type: '大床房',
          original_room_type: '商务大床房',
          total_price: 888,
          daily_price: 444
        }
      ],
      { replaceExistingGroup: true }
    );

    const store = bridge.loadCompareAppStore();
    const groupedHotel = store.hotels[0];
    const room = groupedHotel.rooms[0];

    assert.equal(groupedHotel.shared.address, '新地址');
    assert.equal(room.total_price, 888);
    assert.equal(Object.prototype.hasOwnProperty.call(groupedHotel.shared, 'legacy_extra'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(room, 'legacy_extra'), false);
  })
);
