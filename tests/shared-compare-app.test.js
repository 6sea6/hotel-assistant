const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveSharedCompareAppPath } = require('../src/main/shared-compare-app');
const {
  readPointerData,
  readPointerDataFolder,
  writePointerDataFolder
} = require('../shared/compare-app/data-folder');

test('resolveSharedCompareAppPath prefers workspace shared modules during development', () => {
  const resolved = resolveSharedCompareAppPath('constants.js');

  assert.equal(fs.existsSync(resolved), true);
  assert.equal(resolved, path.resolve(__dirname, '..', 'shared', 'compare-app', 'constants.js'));
});

test('resolveSharedCompareAppPath falls back to packaged resources adjacent to app.asar', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-compare-app-'));
  const currentDir = path.join(tempRoot, 'resources', 'app.asar', 'src', 'main');
  const resourcesPath = path.join(tempRoot, 'resources');
  const packagedModulePath = path.join(resourcesPath, 'shared', 'compare-app', 'constants.js');

  fs.mkdirSync(currentDir, { recursive: true });
  fs.mkdirSync(path.dirname(packagedModulePath), { recursive: true });
  fs.writeFileSync(packagedModulePath, 'module.exports = {};', 'utf-8');

  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const resolved = resolveSharedCompareAppPath('constants.js', {
    currentDir
  });

  assert.equal(resolved, packagedModulePath);
});

test('readPointerData returns full metadata from new format pointer', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pointer-data-test-'));
  const pointerFile = path.join(tempRoot, 'hotel-app-pointer.json');

  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  fs.writeFileSync(
    pointerFile,
    JSON.stringify(
      {
        dataFolder: path.join(tempRoot, 'my-data'),
        source: 'packaged',
        appId: 'com.hotel.comparison.desktop',
        appVersion: '8.8.0',
        updatedAt: '2026-05-23T10:00:00.000Z'
      },
      null,
      2
    ),
    'utf-8'
  );

  const pointer = readPointerData(pointerFile);
  assert.ok(pointer);
  assert.equal(pointer.dataFolder, path.join(tempRoot, 'my-data'));
  assert.equal(pointer.source, 'packaged');
  assert.equal(pointer.appId, 'com.hotel.comparison.desktop');
  assert.equal(pointer.appVersion, '8.8.0');
  assert.equal(pointer.updatedAt, '2026-05-23T10:00:00.000Z');
});

test('readPointerData returns metadata with empty strings for old bare pointer', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pointer-old-test-'));
  const pointerFile = path.join(tempRoot, 'hotel-app-pointer.json');

  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  fs.writeFileSync(
    pointerFile,
    JSON.stringify({ dataFolder: path.join(tempRoot, 'old-data') }, null, 2),
    'utf-8'
  );

  const pointer = readPointerData(pointerFile);
  assert.ok(pointer);
  assert.equal(pointer.dataFolder, path.join(tempRoot, 'old-data'));
  assert.equal(pointer.source, '');
  assert.equal(pointer.appId, '');
  assert.equal(pointer.appVersion, '');
  assert.equal(pointer.updatedAt, '');
});

test('readPointerData returns null for missing or invalid pointer file', () => {
  assert.equal(readPointerData(''), null);
  assert.equal(readPointerData('/nonexistent/path/pointer.json'), null);
  assert.equal(readPointerData(null), null);
});

test('readPointerDataFolder still returns dataFolder string for backward compatibility', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pointer-compat-test-'));
  const pointerFile = path.join(tempRoot, 'hotel-app-pointer.json');

  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  fs.writeFileSync(
    pointerFile,
    JSON.stringify(
      {
        dataFolder: path.join(tempRoot, 'compat-data'),
        source: 'development'
      },
      null,
      2
    ),
    'utf-8'
  );

  assert.equal(readPointerDataFolder(pointerFile), path.join(tempRoot, 'compat-data'));
  assert.equal(readPointerDataFolder(''), '');
  assert.equal(readPointerDataFolder(null), '');
});

test('writePointerDataFolder writes metadata fields when provided', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pointer-write-test-'));
  const pointerFile = path.join(tempRoot, 'sub', 'hotel-app-pointer.json');

  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  writePointerDataFolder(pointerFile, path.join(tempRoot, 'data'), {
    source: 'packaged',
    appId: 'com.hotel.comparison.desktop',
    appVersion: '9.0.0'
  });

  const raw = JSON.parse(fs.readFileSync(pointerFile, 'utf-8'));
  assert.equal(raw.dataFolder, path.join(tempRoot, 'data'));
  assert.equal(raw.source, 'packaged');
  assert.equal(raw.appId, 'com.hotel.comparison.desktop');
  assert.equal(raw.appVersion, '9.0.0');
  assert.ok(typeof raw.updatedAt === 'string' && raw.updatedAt.length > 0);
});

test('writePointerDataFolder defaults metadata to empty strings when omitted', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pointer-write-default-'));
  const pointerFile = path.join(tempRoot, 'hotel-app-pointer.json');

  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  writePointerDataFolder(pointerFile, path.join(tempRoot, 'data'));

  const raw = JSON.parse(fs.readFileSync(pointerFile, 'utf-8'));
  assert.equal(raw.dataFolder, path.join(tempRoot, 'data'));
  assert.equal(raw.source, '');
  assert.equal(raw.appId, '');
  assert.equal(raw.appVersion, '');
  assert.ok(typeof raw.updatedAt === 'string' && raw.updatedAt.length > 0);
});
