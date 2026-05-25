const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

const {
  buildTargetDataFolder,
  deleteOldDataFolder,
  isSameResolvedPath,
  migrateDataFolder,
  prepareTargetFolder
} = require('../src/main/services/data-folder-migration-service');

function createFsStub(options = {}) {
  const { exists = false, throwOnCopy = false } = options;
  const calls = [];

  return {
    calls,
    existsSync(target) {
      calls.push(['existsSync', target]);
      return exists;
    },
    rmSync(target, rmOptions) {
      calls.push(['rmSync', target, rmOptions]);
    },
    cpSync(source, target, cpOptions) {
      calls.push(['cpSync', source, target, cpOptions]);
      if (throwOnCopy) {
        throw new Error('copy failed');
      }
    }
  };
}

test('buildTargetDataFolder joins the selected directory with DATA_FOLDER_NAME', () => {
  const selectedDir = path.join(os.tmpdir(), 'selected-root');

  assert.equal(
    buildTargetDataFolder(selectedDir, { DATA_FOLDER_NAME: '宾馆比较助手' }),
    path.join(selectedDir, '宾馆比较助手')
  );
});

test('isSameResolvedPath compares resolved paths', () => {
  const base = path.join(os.tmpdir(), 'hotel-app-data');

  assert.equal(isSameResolvedPath(path.join(base, '..', 'hotel-app-data'), base), true);
  assert.equal(isSameResolvedPath(path.join(base, 'other'), base), false);
});

test('prepareTargetFolder leaves missing target folders untouched', () => {
  const fsStub = createFsStub({ exists: false });

  const result = prepareTargetFolder({
    fs: fsStub,
    targetFolder: path.join(os.tmpdir(), 'missing-target'),
    overwrite: false
  });

  assert.deepEqual(result, { exists: false, removed: false });
  assert.deepEqual(
    fsStub.calls.map((call) => call[0]),
    ['existsSync']
  );
});

test('prepareTargetFolder reports existing targets unless overwrite is enabled', () => {
  const fsStub = createFsStub({ exists: true });
  const targetFolder = path.join(os.tmpdir(), 'existing-target');

  const result = prepareTargetFolder({
    fs: fsStub,
    targetFolder,
    overwrite: false
  });

  assert.deepEqual(result, { exists: true, removed: false });
  assert.deepEqual(fsStub.calls, [['existsSync', targetFolder]]);
});

test('prepareTargetFolder removes existing target folders when overwrite is enabled', () => {
  const fsStub = createFsStub({ exists: true });
  const targetFolder = path.join(os.tmpdir(), 'existing-target');

  const result = prepareTargetFolder({
    fs: fsStub,
    targetFolder,
    overwrite: true
  });

  assert.deepEqual(result, { exists: true, removed: true });
  assert.deepEqual(fsStub.calls, [
    ['existsSync', targetFolder],
    ['rmSync', targetFolder, { recursive: true, force: true }]
  ]);
});

test('migrateDataFolder copies data, saves pointer, and reinitializes store in order', () => {
  const currentDataFolder = path.join(os.tmpdir(), 'current-data');
  const targetDataFolder = path.join(os.tmpdir(), 'target-data');
  const calls = [];
  const fsStub = {
    cpSync(source, target, options) {
      calls.push(['cpSync', source, target, options]);
    }
  };
  const dataFolderManager = {
    ensureDataFolder(folder) {
      calls.push(['ensureDataFolder', folder]);
    },
    saveDataFolderPath(folder) {
      calls.push(['saveDataFolderPath', folder]);
    }
  };
  const dataService = {
    reinitializeStore(folder) {
      calls.push(['reinitializeStore', folder]);
    },
    getStore() {
      calls.push(['getStore']);
      return { path: path.join(targetDataFolder, 'hotel-data.json') };
    }
  };

  const result = migrateDataFolder({
    fs: fsStub,
    dataFolderManager,
    dataService,
    currentDataFolder,
    targetDataFolder
  });

  assert.deepEqual(calls, [
    ['ensureDataFolder', currentDataFolder],
    ['cpSync', currentDataFolder, targetDataFolder, { recursive: true, force: true }],
    ['saveDataFolderPath', targetDataFolder],
    ['reinitializeStore', targetDataFolder],
    ['getStore']
  ]);
  assert.deepEqual(result, { path: path.join(targetDataFolder, 'hotel-data.json') });
});

test('migrateDataFolder lets copy errors bubble up without saving the pointer', () => {
  const currentDataFolder = path.join(os.tmpdir(), 'current-data');
  const targetDataFolder = path.join(os.tmpdir(), 'target-data');
  const calls = [];
  const fsStub = {
    cpSync() {
      calls.push(['cpSync']);
      throw new Error('copy failed');
    }
  };
  const dataFolderManager = {
    ensureDataFolder(folder) {
      calls.push(['ensureDataFolder', folder]);
    },
    saveDataFolderPath(folder) {
      calls.push(['saveDataFolderPath', folder]);
    }
  };
  const dataService = {
    reinitializeStore(folder) {
      calls.push(['reinitializeStore', folder]);
    },
    getStore() {
      calls.push(['getStore']);
      return { path: '' };
    }
  };

  assert.throws(
    () =>
      migrateDataFolder({
        fs: fsStub,
        dataFolderManager,
        dataService,
        currentDataFolder,
        targetDataFolder
      }),
    /copy failed/
  );
  assert.deepEqual(calls, [['ensureDataFolder', currentDataFolder], ['cpSync']]);
});

test('deleteOldDataFolder removes the old folder recursively', () => {
  const fsStub = createFsStub();
  const oldPath = path.join(os.tmpdir(), 'old-data');

  deleteOldDataFolder({ fs: fsStub, oldPath });

  assert.deepEqual(fsStub.calls, [['rmSync', oldPath, { recursive: true, force: true }]]);
});
