const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

const {
  buildTargetDataFolder,
  copyDataFolderRecursive,
  deleteOldDataFolder,
  isSameResolvedPath,
  migrateDataFolder,
  prepareTargetFolder
} = require('../src/main/services/data-folder-migration-service');

function createFsStub(options = {}) {
  const { exists = false, throwOnCopy = false } = options;
  const calls = [];
  const dirent = (name, directory = false) => ({
    name,
    isDirectory() {
      return directory;
    }
  });
  const entriesByPath = options.entriesByPath || {};

  return {
    calls,
    existsSync(target) {
      calls.push(['existsSync', target]);
      return exists;
    },
    rmSync(target, rmOptions) {
      calls.push(['rmSync', target, rmOptions]);
    },
    mkdirSync(target, mkdirOptions) {
      calls.push(['mkdirSync', target, mkdirOptions]);
    },
    readdirSync(target, readdirOptions) {
      calls.push(['readdirSync', target, readdirOptions]);
      return (entriesByPath[target] || []).map((entry) =>
        typeof entry === 'string' ? dirent(entry) : dirent(entry.name, entry.directory)
      );
    },
    copyFileSync(source, target) {
      calls.push(['copyFileSync', source, target]);
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

test('copyDataFolderRecursive copies nested folders without fs.cpSync', () => {
  const sourceFolder = path.join(os.tmpdir(), 'copy-source');
  const targetFolder = path.join(os.tmpdir(), 'copy-target');
  const nestedSource = path.join(sourceFolder, 'nested');
  const nestedTarget = path.join(targetFolder, 'nested');
  const fsStub = createFsStub({
    entriesByPath: {
      [sourceFolder]: [{ name: 'nested', directory: true }, 'hotel-data.json'],
      [nestedSource]: ['中文文件.txt']
    }
  });

  copyDataFolderRecursive({ fs: fsStub, sourceFolder, targetFolder });

  assert.deepEqual(fsStub.calls, [
    ['mkdirSync', targetFolder, { recursive: true }],
    ['readdirSync', sourceFolder, { withFileTypes: true }],
    ['mkdirSync', nestedTarget, { recursive: true }],
    ['readdirSync', nestedSource, { withFileTypes: true }],
    [
      'copyFileSync',
      path.join(nestedSource, '中文文件.txt'),
      path.join(nestedTarget, '中文文件.txt')
    ],
    [
      'copyFileSync',
      path.join(sourceFolder, 'hotel-data.json'),
      path.join(targetFolder, 'hotel-data.json')
    ]
  ]);
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
  const fsStub = createFsStub({
    entriesByPath: {
      [currentDataFolder]: ['hotel-data.json']
    }
  });
  const { calls } = fsStub;
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
    ['mkdirSync', targetDataFolder, { recursive: true }],
    ['readdirSync', currentDataFolder, { withFileTypes: true }],
    [
      'copyFileSync',
      path.join(currentDataFolder, 'hotel-data.json'),
      path.join(targetDataFolder, 'hotel-data.json')
    ],
    ['saveDataFolderPath', targetDataFolder],
    ['reinitializeStore', targetDataFolder],
    ['getStore']
  ]);
  assert.deepEqual(result, { path: path.join(targetDataFolder, 'hotel-data.json') });
});

test('migrateDataFolder lets copy errors bubble up without saving the pointer', () => {
  const currentDataFolder = path.join(os.tmpdir(), 'current-data');
  const targetDataFolder = path.join(os.tmpdir(), 'target-data');
  const fsStub = createFsStub({
    throwOnCopy: true,
    entriesByPath: {
      [currentDataFolder]: ['hotel-data.json']
    }
  });
  const { calls } = fsStub;
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
  assert.deepEqual(calls, [
    ['ensureDataFolder', currentDataFolder],
    ['mkdirSync', targetDataFolder, { recursive: true }],
    ['readdirSync', currentDataFolder, { withFileTypes: true }],
    [
      'copyFileSync',
      path.join(currentDataFolder, 'hotel-data.json'),
      path.join(targetDataFolder, 'hotel-data.json')
    ]
  ]);
});

test('deleteOldDataFolder removes the old folder recursively', () => {
  const fsStub = createFsStub();
  const oldPath = path.join(os.tmpdir(), 'old-data');

  deleteOldDataFolder({ fs: fsStub, oldPath });

  assert.deepEqual(fsStub.calls, [['rmSync', oldPath, { recursive: true, force: true }]]);
});
