const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const originalLoad = Module._load;
const dialogState = {
  open: { canceled: true, filePaths: [] },
  save: { canceled: true, filePath: '' },
  messageBoxCalls: [],
  messageBoxResponses: []
};
const shellCalls = [];

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
          return dialogState.open;
        },
        async showSaveDialog() {
          return dialogState.save;
        },
        showMessageBoxSync(...args) {
          const options = args[1] || args[0] || {};
          dialogState.messageBoxCalls.push(options);
          return dialogState.messageBoxResponses.length
            ? dialogState.messageBoxResponses.shift()
            : 1;
        }
      },
      shell: {
        showItemInFolder(filePath) {
          shellCalls.push(filePath);
        }
      }
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};

test.after(() => {
  Module._load = originalLoad;
});

const registerHotelHandlers = require('../src/main/ipc-handlers/hotel-handlers');
const registerTemplateHandlers = require('../src/main/ipc-handlers/template-handlers');
const registerDataHandlers = require('../src/main/ipc-handlers/data-handlers');

function createEvent() {
  return {
    senderFrame: { url: 'file:///trusted/index.html' },
    sender: {}
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
  const invalidated = [];
  return {
    invalidated,
    invalidate(key) {
      invalidated.push(key);
    }
  };
}

function createStore(initialData = {}) {
  const data = { ...initialData };
  const setCalls = [];

  return {
    path: initialData.path || path.join(os.tmpdir(), 'hotel-data.json'),
    setCalls,
    get(key) {
      return data[key];
    },
    set(key, value) {
      data[key] = value;
      setCalls.push({ key, value });
    }
  };
}

function registerHandlers(register, store, extraServices = {}) {
  const ipcMain = createIpcMain();
  const cache = createCache();
  register({
    ipcMain,
    cache,
    services: {
      dataService: {
        getStore: () => store,
        getDataFolderManager: () => ({
          getDataFolderPath: () => os.tmpdir(),
          ensureDataFolder() {},
          saveDataFolderPath() {}
        }),
        reinitializeStore() {}
      },
      windowService: {
        getMainWindow: () => ({ isDestroyed: () => false, webContents: { send() {} } }),
        applyThemeAppearance() {
          return { success: true };
        },
        applyWindowIcon() {
          return { success: true };
        }
      },
      ...extraServices
    }
  });
  return { handlers: ipcMain.handlers, cache };
}

function createChangePathDataService(currentDataFolder, options = {}) {
  const calls = [];
  const store = createStore({
    path: path.join(currentDataFolder, 'hotel-data.json')
  });
  const dataFolderManager = {
    getDataFolderPath() {
      return currentDataFolder;
    },
    ensureDataFolder(folder) {
      calls.push(['ensureDataFolder', folder]);
    },
    saveDataFolderPath(folder) {
      calls.push(['saveDataFolderPath', folder]);
    }
  };
  const dataService = {
    getStore() {
      return store;
    },
    getDataFolderManager() {
      return dataFolderManager;
    },
    reinitializeStore(folder) {
      calls.push(['reinitializeStore', folder]);
      if (options.throwOnReinitialize) {
        throw new Error('reload failed');
      }
      store.path = path.join(folder, 'hotel-data.json');
    }
  };

  return { calls, dataService, store };
}

test('hotel handlers reject invalid renderer payloads before normalization', () => {
  const store = createStore({ hotels: [] });
  const { handlers } = registerHandlers(registerHotelHandlers, store);

  assert.deepEqual(handlers['hotel:add'](createEvent(), 'bad'), {
    success: false,
    error: '无效的宾馆数据'
  });
  assert.deepEqual(handlers['hotel:update'](createEvent(), { name: '无 ID' }), {
    success: false,
    error: '无效的宾馆 ID'
  });
  assert.deepEqual(handlers['hotel:updateMultiple'](createEvent(), 'bad'), {
    success: false,
    error: '无效的批量宾馆数据'
  });
});

test('hotel:updateMultiple rejects non-object items instead of silently skipping them', () => {
  const store = createStore({
    hotels: [{ id: 1, name: '测试酒店', room_type: '大床房' }]
  });
  const { handlers } = registerHandlers(registerHotelHandlers, store);

  assert.deepEqual(handlers['hotel:updateMultiple'](createEvent(), [{ id: 1 }, 'bad']), {
    success: false,
    error: '无效的批量宾馆数据'
  });
});

test('template handlers reject invalid renderer payloads before normalization', async () => {
  const store = createStore({ templates: [] });
  const { handlers } = registerHandlers(registerTemplateHandlers, store);

  assert.deepEqual(handlers['template:add'](createEvent(), 'bad'), {
    success: false,
    error: '无效的模板数据'
  });
  assert.deepEqual(handlers['template:update'](createEvent(), { name: '无 ID' }), {
    success: false,
    error: '无效的模板 ID'
  });
  assert.deepEqual(await handlers['template:updateAndSync'](createEvent(), null), {
    success: false,
    error: '无效的模板数据'
  });
  assert.deepEqual(await handlers['template:updateAndSync'](createEvent(), { name: '无 ID' }), {
    success: false,
    error: '无效的模板 ID'
  });
});

test('ranking image export rejects invalid image data before opening save dialog', async () => {
  const store = createStore();
  const { handlers } = registerHandlers(registerDataHandlers, store);
  dialogState.save = { canceled: false, filePath: path.join(os.tmpdir(), 'ranking.png') };

  const result = await handlers['ranking:exportImage'](createEvent(), '');

  assert.deepEqual(result, { success: false, error: '无效的图片数据' });
});

test('data import restores snapshot when JSON parsing fails', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-data-import-'));
  const invalidJsonPath = path.join(tempRoot, 'invalid.json');
  fs.writeFileSync(invalidJsonPath, '{broken-json', 'utf8');
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const previousSettings = { theme: 'totoro-blue', app_icon_path: '' };
  const store = createStore({
    hotels: [{ id: 1, name: '原酒店', room_type: '大床房' }],
    templates: [{ id: 1, name: '原模板', destination: '武汉' }],
    settings: previousSettings
  });
  const { handlers } = registerHandlers(registerDataHandlers, store);
  dialogState.open = { canceled: false, filePaths: [invalidJsonPath] };

  const result = await handlers['data:import'](createEvent(), 'replace');

  assert.equal(result.success, false);
  assert.match(result.error, /JSON|Expected|Unexpected|position/i);
  assert.deepEqual(store.get('hotels'), [{ id: 1, name: '原酒店', room_type: '大床房' }]);
  assert.deepEqual(store.get('templates'), [{ id: 1, name: '原模板', destination: '武汉' }]);
  assert.deepEqual(store.get('settings'), previousSettings);
});

test('data:changePath returns samePath when selected folder resolves to current data folder', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-change-path-same-'));
  const selectedDir = path.join(tempRoot, 'selected');
  const currentDataFolder = path.join(selectedDir, '宾馆比较助手');
  fs.mkdirSync(currentDataFolder, { recursive: true });
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const { dataService } = createChangePathDataService(currentDataFolder);
  const { handlers } = registerHandlers(registerDataHandlers, createStore(), { dataService });
  dialogState.open = { canceled: false, filePaths: [selectedDir] };
  dialogState.messageBoxCalls = [];
  dialogState.messageBoxResponses = [];

  const result = await handlers['data:changePath'](createEvent());

  assert.deepEqual(result, { success: false, samePath: true });
  assert.equal(dialogState.messageBoxCalls.length, 0);
});

test('data:changePath keeps existing target when user cancels overwrite', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-change-path-cancel-'));
  const currentDataFolder = path.join(tempRoot, 'current');
  const selectedDir = path.join(tempRoot, 'selected');
  const targetDataFolder = path.join(selectedDir, '宾馆比较助手');
  fs.mkdirSync(currentDataFolder, { recursive: true });
  fs.mkdirSync(targetDataFolder, { recursive: true });
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const { calls, dataService } = createChangePathDataService(currentDataFolder);
  const { handlers } = registerHandlers(registerDataHandlers, createStore(), { dataService });
  dialogState.open = { canceled: false, filePaths: [selectedDir] };
  dialogState.messageBoxCalls = [];
  dialogState.messageBoxResponses = [1];

  const result = await handlers['data:changePath'](createEvent());

  assert.deepEqual(result, { success: false, canceled: true });
  assert.equal(fs.existsSync(targetDataFolder), true);
  assert.deepEqual(calls, []);
  assert.equal(dialogState.messageBoxCalls[0].title, '文件夹已存在');
});

test('data:changePath migrates data and keeps old folder when user declines deletion', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-change-path-success-'));
  const currentDataFolder = path.join(tempRoot, 'current');
  const selectedDir = path.join(tempRoot, 'selected');
  const targetDataFolder = path.join(selectedDir, '宾馆比较助手');
  fs.mkdirSync(currentDataFolder, { recursive: true });
  fs.mkdirSync(selectedDir, { recursive: true });
  fs.writeFileSync(path.join(currentDataFolder, 'hotel-data.json'), '{"hotels":[]}', 'utf8');
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const { calls, dataService } = createChangePathDataService(currentDataFolder);
  const { handlers, cache } = registerHandlers(registerDataHandlers, createStore(), {
    dataService
  });
  dialogState.open = { canceled: false, filePaths: [selectedDir] };
  dialogState.messageBoxCalls = [];
  dialogState.messageBoxResponses = [1];

  const result = await handlers['data:changePath'](createEvent());

  assert.deepEqual(result, {
    success: true,
    path: path.join(targetDataFolder, 'hotel-data.json'),
    oldPath: currentDataFolder,
    deleted: false
  });
  assert.deepEqual(calls, [
    ['ensureDataFolder', currentDataFolder],
    ['saveDataFolderPath', targetDataFolder],
    ['reinitializeStore', targetDataFolder]
  ]);
  const migratedFolderName = fs.readdirSync(selectedDir)[0];
  assert.equal(fs.existsSync(path.join(selectedDir, migratedFolderName, 'hotel-data.json')), true);
  assert.equal(fs.existsSync(currentDataFolder), true);
  assert.deepEqual(cache.invalidated, ['']);
  assert.equal(dialogState.messageBoxCalls.at(-1).title, '迁移完成');
});

test('data:changePath deletes old folder after successful migration when requested', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-change-path-delete-'));
  const currentDataFolder = path.join(tempRoot, 'current');
  const selectedDir = path.join(tempRoot, 'selected');
  fs.mkdirSync(currentDataFolder, { recursive: true });
  fs.mkdirSync(selectedDir, { recursive: true });
  fs.writeFileSync(path.join(currentDataFolder, 'hotel-data.json'), '{"hotels":[]}', 'utf8');
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const { dataService } = createChangePathDataService(currentDataFolder);
  const { handlers } = registerHandlers(registerDataHandlers, createStore(), { dataService });
  dialogState.open = { canceled: false, filePaths: [selectedDir] };
  dialogState.messageBoxCalls = [];
  dialogState.messageBoxResponses = [0];

  const result = await handlers['data:changePath'](createEvent());

  assert.equal(result.success, true);
  assert.equal(result.deleted, true);
  const migratedFolderName = fs.readdirSync(selectedDir)[0];
  assert.equal(fs.existsSync(path.join(selectedDir, migratedFolderName, 'hotel-data.json')), true);
  assert.equal(fs.existsSync(currentDataFolder), false);
});

test('data:changePath returns a safe error result when migration fails', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-change-path-fail-'));
  const currentDataFolder = path.join(tempRoot, 'current');
  const selectedDir = path.join(tempRoot, 'selected');
  fs.mkdirSync(currentDataFolder, { recursive: true });
  fs.mkdirSync(selectedDir, { recursive: true });
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const { dataService } = createChangePathDataService(currentDataFolder, {
    throwOnReinitialize: true
  });
  const { handlers, cache } = registerHandlers(registerDataHandlers, createStore(), {
    dataService
  });
  dialogState.open = { canceled: false, filePaths: [selectedDir] };
  dialogState.messageBoxCalls = [];
  dialogState.messageBoxResponses = [];

  const result = await handlers['data:changePath'](createEvent());

  assert.deepEqual(result, { success: false, error: 'reload failed' });
  assert.deepEqual(cache.invalidated, []);
  assert.equal(dialogState.messageBoxCalls.length, 0);
});
