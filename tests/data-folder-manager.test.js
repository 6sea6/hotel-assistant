const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { readPointerData } = require('../shared/compare-app/data-folder');
const { DataFolderManager } = require('../src/main/utils');

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'data-folder-mgr-'));
}

function createMockDataFolderManager(options = {}) {
  const { isPackaged = false, appDataRoot = os.tmpdir() } = options;

  // Create manager instance - constructor calls require('electron')
  // which may fail in test env, so we handle it gracefully
  let manager;
  try {
    manager = new DataFolderManager();
  } catch (_e) {
    // If constructor fails (no electron), create a minimal mock
    manager = Object.create(DataFolderManager.prototype);
    manager.dataFolderName = '宾馆比较助手';
  }

  // Override pointer file path to use temp dir
  manager.pointerFilePath = path.join(appDataRoot, 'hotel-app-pointer.json');

  // Override isPackagedApp to return the desired value
  manager.isPackagedApp = () => isPackaged;

  return manager;
}

test('DataFolderManager development env trusts old bare pointer', (t) => {
  const tempRoot = makeTempRoot();
  const appDataRoot = path.join(tempRoot, 'appdata');
  const dataDir = path.join(tempRoot, 'my-data');
  fs.mkdirSync(appDataRoot, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });

  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const pointerFile = path.join(appDataRoot, 'hotel-app-pointer.json');
  fs.writeFileSync(pointerFile, JSON.stringify({ dataFolder: dataDir }, null, 2), 'utf-8');

  const manager = createMockDataFolderManager({
    isPackaged: false,
    appDataRoot
  });

  assert.equal(manager.readDataFolderPath(), dataDir);
});

test('DataFolderManager packaged env rejects old bare pointer', (t) => {
  const tempRoot = makeTempRoot();
  const appDataRoot = path.join(tempRoot, 'appdata');
  const dataDir = path.join(tempRoot, 'dev-data');
  fs.mkdirSync(appDataRoot, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });

  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const pointerFile = path.join(appDataRoot, 'hotel-app-pointer.json');
  fs.writeFileSync(pointerFile, JSON.stringify({ dataFolder: dataDir }, null, 2), 'utf-8');

  const manager = createMockDataFolderManager({
    isPackaged: true,
    appDataRoot
  });

  assert.equal(manager.isPackagedApp(), true);
  assert.equal(manager.readDataFolderPath(), null);
});

test('DataFolderManager packaged env rejects development source pointer', (t) => {
  const tempRoot = makeTempRoot();
  const appDataRoot = path.join(tempRoot, 'appdata');
  const dataDir = path.join(tempRoot, 'dev-data');
  fs.mkdirSync(appDataRoot, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });

  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const pointerFile = path.join(appDataRoot, 'hotel-app-pointer.json');
  fs.writeFileSync(
    pointerFile,
    JSON.stringify(
      {
        dataFolder: dataDir,
        source: 'development',
        appId: 'com.hotel.comparison.desktop'
      },
      null,
      2
    ),
    'utf-8'
  );

  const manager = createMockDataFolderManager({
    isPackaged: true,
    appDataRoot
  });

  assert.equal(manager.readDataFolderPath(), null);
});

test('DataFolderManager packaged env trusts packaged source pointer with correct appId', (t) => {
  const tempRoot = makeTempRoot();
  const appDataRoot = path.join(tempRoot, 'appdata');
  const dataDir = path.join(tempRoot, 'user-data');
  fs.mkdirSync(appDataRoot, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });

  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const pointerFile = path.join(appDataRoot, 'hotel-app-pointer.json');
  fs.writeFileSync(
    pointerFile,
    JSON.stringify(
      {
        dataFolder: dataDir,
        source: 'packaged',
        appId: 'com.hotel.comparison.desktop',
        appVersion: '8.8.0'
      },
      null,
      2
    ),
    'utf-8'
  );

  const manager = createMockDataFolderManager({
    isPackaged: true,
    appDataRoot
  });

  assert.equal(manager.readDataFolderPath(), dataDir);
});

test('DataFolderManager packaged env rejects packaged pointer with wrong appId', (t) => {
  const tempRoot = makeTempRoot();
  const appDataRoot = path.join(tempRoot, 'appdata');
  const dataDir = path.join(tempRoot, 'wrong-app');
  fs.mkdirSync(appDataRoot, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });

  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const pointerFile = path.join(appDataRoot, 'hotel-app-pointer.json');
  fs.writeFileSync(
    pointerFile,
    JSON.stringify(
      {
        dataFolder: dataDir,
        source: 'packaged',
        appId: 'com.other.app'
      },
      null,
      2
    ),
    'utf-8'
  );

  const manager = createMockDataFolderManager({
    isPackaged: true,
    appDataRoot
  });

  assert.equal(manager.readDataFolderPath(), null);
});

test('DataFolderManager saveDataFolderPath writes packaged metadata in packaged env', (t) => {
  const tempRoot = makeTempRoot();
  const appDataRoot = path.join(tempRoot, 'appdata');
  fs.mkdirSync(appDataRoot, { recursive: true });

  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const manager = createMockDataFolderManager({
    isPackaged: true,
    appDataRoot
  });

  const dataDir = path.join(tempRoot, 'saved-data');
  manager.saveDataFolderPath(dataDir);

  const pointerFile = path.join(appDataRoot, 'hotel-app-pointer.json');
  const raw = JSON.parse(fs.readFileSync(pointerFile, 'utf-8'));

  assert.equal(raw.dataFolder, dataDir);
  assert.equal(raw.source, 'packaged');
  assert.equal(raw.appId, 'com.hotel.comparison.desktop');
  assert.ok(typeof raw.appVersion === 'string' && raw.appVersion.length > 0);
  assert.ok(typeof raw.updatedAt === 'string' && raw.updatedAt.length > 0);
});

test('DataFolderManager saveDataFolderPath writes development metadata in dev env', (t) => {
  const tempRoot = makeTempRoot();
  const appDataRoot = path.join(tempRoot, 'appdata');
  fs.mkdirSync(appDataRoot, { recursive: true });

  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const manager = createMockDataFolderManager({
    isPackaged: false,
    appDataRoot
  });

  const dataDir = path.join(tempRoot, 'dev-saved');
  manager.saveDataFolderPath(dataDir);

  const pointerFile = path.join(appDataRoot, 'hotel-app-pointer.json');
  const raw = JSON.parse(fs.readFileSync(pointerFile, 'utf-8'));

  assert.equal(raw.dataFolder, dataDir);
  assert.equal(raw.source, 'development');
  assert.equal(raw.appId, 'com.hotel.comparison.desktop');
  assert.ok(typeof raw.appVersion === 'string' && raw.appVersion.length > 0);
});

test('DataFolderManager isTrustedPointer correctly distinguishes trust levels', (t) => {
  const tempRoot = makeTempRoot();
  const appDataRoot = path.join(tempRoot, 'appdata');
  fs.mkdirSync(appDataRoot, { recursive: true });

  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const devManager = createMockDataFolderManager({
    isPackaged: false,
    appDataRoot
  });

  // 开发环境信任所有有 dataFolder 的指针
  assert.equal(devManager.isTrustedPointer(null), false);
  assert.equal(devManager.isTrustedPointer({ dataFolder: '' }), false);
  assert.equal(devManager.isTrustedPointer({ dataFolder: '/some/path' }), true);
  assert.equal(
    devManager.isTrustedPointer({ dataFolder: '/some/path', source: '', appId: '' }),
    true
  );
  assert.equal(
    devManager.isTrustedPointer({ dataFolder: '/some/path', source: 'development' }),
    true
  );

  const packagedManager = createMockDataFolderManager({
    isPackaged: true,
    appDataRoot
  });

  // 正式版不信任 null、空 dataFolder、旧裸指针、development 指针
  assert.equal(packagedManager.isTrustedPointer(null), false);
  assert.equal(packagedManager.isTrustedPointer({ dataFolder: '' }), false);
  assert.equal(packagedManager.isTrustedPointer({ dataFolder: '/some/path' }), false);
  assert.equal(
    packagedManager.isTrustedPointer({ dataFolder: '/some/path', source: '', appId: '' }),
    false
  );
  assert.equal(
    packagedManager.isTrustedPointer({ dataFolder: '/some/path', source: 'development' }),
    false
  );
  assert.equal(
    packagedManager.isTrustedPointer({
      dataFolder: '/some/path',
      source: 'development',
      appId: 'com.hotel.comparison.desktop'
    }),
    false
  );
  // 正式版不信任 wrong appId
  assert.equal(
    packagedManager.isTrustedPointer({
      dataFolder: '/some/path',
      source: 'packaged',
      appId: 'com.other.app'
    }),
    false
  );
  // 正式版只信任 source=packaged + 正确 appId
  assert.equal(
    packagedManager.isTrustedPointer({
      dataFolder: '/some/path',
      source: 'packaged',
      appId: 'com.hotel.comparison.desktop'
    }),
    true
  );
});

test('DataFolderManager packaged env returns null when no pointer file exists', (t) => {
  const tempRoot = makeTempRoot();
  const appDataRoot = path.join(tempRoot, 'appdata');
  fs.mkdirSync(appDataRoot, { recursive: true });

  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const manager = createMockDataFolderManager({
    isPackaged: true,
    appDataRoot
  });

  // No pointer file written — should return null
  assert.equal(manager.readDataFolderPath(), null);
});
