const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const writebackPath = require.resolve('../src/task-writeback');
const bridgePath = require.resolve('../src/compare-app-bridge');
const writePolicyPath = require.resolve('../src/cli/write-policy');
const storeRepoPath = require.resolve('../src/compare-app/store-repository');

function clearModules() {
  for (const mod of [writebackPath, bridgePath, writePolicyPath, storeRepoPath]) {
    delete require.cache[mod];
  }
}

function installMock(modulePath, exports) {
  const resolvedPath = require.resolve(modulePath);
  require.cache[resolvedPath] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports
  };
  return resolvedPath;
}

function createTempStoreDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'task-writeback-test-'));
}

test('writeBatchHotelRecords calls appendHotelsToStore only once when reportDisabled=false', () => {
  const tempDir = createTempStoreDir();
  try {
    let appendCallCount = 0;
    let appendedHotels = [];

    clearModules();
    installMock('../src/compare-app-bridge', {
      appendHotelsToStore: (hotels, options) => {
        appendCallCount += 1;
        appendedHotels = hotels;
        return { operation: 'bulk-upserted', count: hotels.length };
      },
      getCompareAppStorePath: () => path.join(tempDir, 'hotel-data.json')
    });
    installMock('../src/cli/write-policy', {
      shouldSkipHotelWrite: () => false
    });

    const { writeBatchHotelRecords } = require(writebackPath);
    const result = writeBatchHotelRecords({
      allHotels: [{ name: 'A' }, { name: 'B' }],
      resultPayloads: [
        { hotels: [{ name: 'A' }] },
        { hotels: [{ name: 'B' }] }
      ],
      reportDisabled: false
    });

    assert.equal(appendCallCount, 1, 'should call appendHotelsToStore exactly once');
    assert.equal(appendedHotels.length, 2, 'should pass all writable hotels at once');
    assert.equal(result.length, 2);
    assert.equal(result[0].itemIndex, 1);
    assert.equal(result[0].result.operation, 'bulk-upserted');
    assert.equal(result[1].itemIndex, 2);
  } finally {
    clearModules();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('writeBatchHotelRecords does not call appendHotelsToStore when all items skipped', () => {
  const tempDir = createTempStoreDir();
  try {
    let appendCallCount = 0;

    clearModules();
    installMock('../src/compare-app-bridge', {
      appendHotelsToStore: (hotels) => {
        appendCallCount += 1;
        return { operation: 'append', count: hotels.length };
      },
      getCompareAppStorePath: () => path.join(tempDir, 'hotel-data.json')
    });
    installMock('../src/cli/write-policy', {
      shouldSkipHotelWrite: () => true
    });

    const { writeBatchHotelRecords } = require(writebackPath);
    const result = writeBatchHotelRecords({
      allHotels: [{ name: 'skip1' }, { name: 'skip2' }],
      resultPayloads: [
        { hotels: [{ name: 'skip1' }] },
        { hotels: [{ name: 'skip2' }] }
      ],
      reportDisabled: false
    });

    assert.equal(appendCallCount, 0, 'should not call appendHotelsToStore');
    assert.equal(result.operation, 'skipped');
    assert.equal(result.skippedCount, 2);
  } finally {
    clearModules();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('writeBatchHotelRecords mixed skipped and writable items', () => {
  const tempDir = createTempStoreDir();
  try {
    let appendCallCount = 0;
    let appendedHotels = [];

    clearModules();
    installMock('../src/compare-app-bridge', {
      appendHotelsToStore: (hotels) => {
        appendCallCount += 1;
        appendedHotels = hotels;
        return { operation: 'bulk-upserted', count: hotels.length };
      },
      getCompareAppStorePath: () => path.join(tempDir, 'hotel-data.json')
    });

    // shouldSkipHotelWrite for allHotels (aggregate) returns false,
    // but returns true for individual payloads containing 'skip-me'
    let skipCallIndex = 0;
    installMock('../src/cli/write-policy', {
      shouldSkipHotelWrite: (hotels) => {
        skipCallIndex += 1;
        // First call is the aggregate allHotels check — not skipped
        if (skipCallIndex === 1) return false;
        // Subsequent calls are per-payload checks
        return Array.isArray(hotels) && hotels.some((h) => h.name && h.name.includes('skip'));
      }
    });

    const { writeBatchHotelRecords } = require(writebackPath);
    const result = writeBatchHotelRecords({
      allHotels: [{ name: 'write1' }, { name: 'skip-me' }, { name: 'write2' }],
      resultPayloads: [
        { hotels: [{ name: 'write1' }] },
        { hotels: [{ name: 'skip-me' }] },
        { hotels: [{ name: 'write2' }] }
      ],
      reportDisabled: false
    });

    assert.equal(appendCallCount, 1, 'should call appendHotelsToStore exactly once');
    assert.equal(appendedHotels.length, 2, 'should only pass writable hotels');
    assert.equal(appendedHotels[0].name, 'write1');
    assert.equal(appendedHotels[1].name, 'write2');

    // Result should be sorted by itemIndex
    assert.equal(result.length, 3);
    assert.equal(result[0].itemIndex, 1);
    assert.equal(result[0].result.operation, 'bulk-upserted');
    assert.equal(result[1].itemIndex, 2);
    assert.equal(result[1].operation, 'skipped');
    assert.equal(result[2].itemIndex, 3);
    assert.equal(result[2].result.operation, 'bulk-upserted');
  } finally {
    clearModules();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('writeBatchHotelRecords reportDisabled=true uses allHotels in single call', () => {
  const tempDir = createTempStoreDir();
  try {
    let appendCallCount = 0;
    let appendedHotels = [];

    clearModules();
    installMock('../src/compare-app-bridge', {
      appendHotelsToStore: (hotels) => {
        appendCallCount += 1;
        appendedHotels = hotels;
        return { operation: 'append', count: hotels.length };
      },
      getCompareAppStorePath: () => path.join(tempDir, 'hotel-data.json')
    });
    installMock('../src/cli/write-policy', {
      shouldSkipHotelWrite: () => false
    });

    const { writeBatchHotelRecords } = require(writebackPath);
    const result = writeBatchHotelRecords({
      allHotels: [{ name: 'A' }, { name: 'B' }],
      resultPayloads: [],
      reportDisabled: true
    });

    assert.equal(appendCallCount, 1);
    assert.equal(appendedHotels.length, 2);
    assert.equal(result.operation, 'append');
  } finally {
    clearModules();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
