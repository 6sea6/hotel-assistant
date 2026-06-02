const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let stateModuleUrl = '';
let filtersModuleUrl = '';
let modelModuleUrl = '';
let tempRoot = '';

function writeStub(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf-8');
}

async function loadModules() {
  if (!stateModuleUrl) {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'visible-hotels-cache-'));
    const sourceDir = path.join(__dirname, '..', 'src', 'renderer', 'modules');

    writeStub(path.join(tempRoot, 'package.json'), '{"type":"module"}\n');

    fs.copyFileSync(path.join(sourceDir, 'state.js'), path.join(tempRoot, 'state.js'));
    fs.copyFileSync(
      path.join(sourceDir, 'hotel-filters.js'),
      path.join(tempRoot, 'hotel-filters.js')
    );
    fs.copyFileSync(
      path.join(sourceDir, 'hotel-list-model.js'),
      path.join(tempRoot, 'hotel-list-model.js')
    );

    writeStub(
      path.join(tempRoot, 'dom-helpers.js'),
      `
      export function $(id) { return null; }
      export function getValue(id, fallback) { return fallback || ''; }
      export function idsEqual(a, b) { return String(a) === String(b); }
      export function hasDisplayValue(v) { return v !== null && v !== undefined && String(v).trim() !== ''; }
      export function normalizeFilterOptionKey(value) {
        if (value === null || value === undefined) return '';
        return String(value).trim().toLowerCase().replace(/\\s+/g, ' ');
      }
      export function escapeHtml(t) { return String(t); }
      `
    );

    stateModuleUrl = pathToFileURL(path.join(tempRoot, 'state.js')).href;
    filtersModuleUrl = pathToFileURL(path.join(tempRoot, 'hotel-filters.js')).href;
    modelModuleUrl = pathToFileURL(path.join(tempRoot, 'hotel-list-model.js')).href;
    process.on('exit', () => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
  }

  const stateMod = await import(stateModuleUrl);
  const filtersMod = await import(filtersModuleUrl);
  const modelMod = await import(modelModuleUrl);
  return { stateMod, filtersMod, modelMod };
}

function makeHotels(count) {
  const hotels = [];
  for (let i = 1; i <= count; i++) {
    hotels.push({
      id: i,
      name: `宾馆${i}`,
      total_price: 200 + (i % 10) * 50,
      daily_price: 100 + (i % 10) * 25,
      ctrip_score: 3.0 + (i % 5) * 0.4,
      distance: `${1 + (i % 20)}km`,
      transport_time: `${5 + (i % 15)}min`,
      subway_distance: `${0.1 + (i % 10) * 0.2}km`,
      is_favorite: i % 3 === 0 ? 1 : 0,
      template_id: null,
      template_info: null,
      _derived: {
        nameKey: `宾馆${i}`.toLowerCase(),
        totalPriceNumber: 200 + (i % 10) * 50,
        dailyPriceNumber: 100 + (i % 10) * 25,
        scoreNumber: 3.0 + (i % 5) * 0.4,
        distanceNumber: 1 + (i % 20),
        subwayDistanceNumber: 0.1 + (i % 10) * 0.2,
        transportTimeNumber: 5 + (i % 15),
        roomTypeKey: '',
        originalRoomTypeKey: '',
        hotelIdentityKey: `宾馆${i}`
      }
    });
  }
  return hotels;
}

function resetCache(visibleHotelsCache) {
  visibleHotelsCache.invalidate();
  visibleHotelsCache.hitCount = 0;
  visibleHotelsCache.missCount = 0;
}

/* ---- 测试 ---- */

test('visibleHotelsCache: 同一条件第二次调用命中缓存', async () => {
  const { stateMod, modelMod } = await loadModules();
  const { state, visibleHotelsCache, setHotels } = stateMod;

  resetCache(visibleHotelsCache);
  const hotels = makeHotels(10);
  setHotels(hotels);
  state.currentFilters = {};

  const result1 = modelMod.getSortedVisibleHotels();
  assert.equal(visibleHotelsCache.missCount, 1);
  assert.equal(visibleHotelsCache.hitCount, 0);
  assert.ok(result1.length > 0);

  const result2 = modelMod.getSortedVisibleHotels();
  assert.equal(visibleHotelsCache.missCount, 1);
  assert.equal(visibleHotelsCache.hitCount, 1);
  assert.strictEqual(result1, result2, '缓存命中应返回同一数组引用');
});

test('setHotels 后 hotelsVersion 递增，缓存失效', async () => {
  const { stateMod, modelMod } = await loadModules();
  const { state, visibleHotelsCache, setHotels } = stateMod;

  resetCache(visibleHotelsCache);
  const hotels = makeHotels(5);
  setHotels(hotels);
  state.currentFilters = {};

  const v1 = state.hotelsVersion;
  modelMod.getSortedVisibleHotels();
  assert.equal(visibleHotelsCache.missCount, 1);

  setHotels(makeHotels(5));
  const v2 = state.hotelsVersion;
  assert.ok(v2 > v1, 'hotelsVersion 应递增');
  assert.equal(visibleHotelsCache.data, null, '缓存应失效');

  const missBefore = visibleHotelsCache.missCount;
  modelMod.getSortedVisibleHotels();
  assert.equal(visibleHotelsCache.missCount, missBefore + 1, '新数据应导致 miss');
});

test('sortMode 变化后缓存失效', async () => {
  const { stateMod, modelMod } = await loadModules();
  const { state, visibleHotelsCache, setHotels } = stateMod;

  resetCache(visibleHotelsCache);
  setHotels(makeHotels(10));
  state.currentFilters = { sortMode: 'review_high' };

  modelMod.getSortedVisibleHotels();
  assert.equal(visibleHotelsCache.sortMode, 'review_high');

  const missBefore = visibleHotelsCache.missCount;
  state.currentFilters = { sortMode: 'price_low' };
  modelMod.getSortedVisibleHotels();
  assert.equal(visibleHotelsCache.sortMode, 'price_low');
  assert.equal(visibleHotelsCache.missCount, missBefore + 1, 'sortMode 变化应导致新的 miss');
});

test('name 筛选变化后缓存失效', async () => {
  const { stateMod, modelMod } = await loadModules();
  const { state, visibleHotelsCache, setHotels } = stateMod;

  resetCache(visibleHotelsCache);
  setHotels(makeHotels(10));
  state.currentFilters = { name: '宾馆1' };

  modelMod.getSortedVisibleHotels();
  assert.equal(visibleHotelsCache.missCount, 1);

  const missBefore = visibleHotelsCache.missCount;
  state.currentFilters = { name: '宾馆2' };
  modelMod.getSortedVisibleHotels();
  assert.equal(visibleHotelsCache.missCount, missBefore + 1, 'name 变化应导致 miss');
});

test('favorite 筛选变化后缓存失效', async () => {
  const { stateMod, modelMod } = await loadModules();
  const { state, visibleHotelsCache, setHotels } = stateMod;

  resetCache(visibleHotelsCache);
  setHotels(makeHotels(10));
  state.currentFilters = { favorite: '1' };

  modelMod.getSortedVisibleHotels();
  const fk1 = visibleHotelsCache.filtersKey;

  const missBefore = visibleHotelsCache.missCount;
  state.currentFilters = { favorite: '0' };
  modelMod.getSortedVisibleHotels();
  const fk2 = visibleHotelsCache.filtersKey;

  assert.notEqual(fk1, fk2, 'filtersKey 应不同');
  assert.equal(visibleHotelsCache.missCount, missBefore + 1, 'favorite 变化应导致 miss');
});

test('缓存命中时返回结果与 applyFiltersToHotels + sortHotels 一致', async () => {
  const { stateMod, filtersMod, modelMod } = await loadModules();
  const { state, visibleHotelsCache, setHotels } = stateMod;

  resetCache(visibleHotelsCache);
  setHotels(makeHotels(20));
  state.currentFilters = { score: '3.5', sortMode: 'price_low' };

  const directResult = filtersMod.sortHotels(
    filtersMod.applyFiltersToHotels(state.hotels, state.currentFilters),
    'price_low'
  );
  const cachedResult = modelMod.getSortedVisibleHotels();

  assert.equal(cachedResult.length, directResult.length);
  for (let i = 0; i < cachedResult.length; i++) {
    assert.equal(cachedResult[i].id, directResult[i].id, `index ${i} id 应一致`);
  }

  const cachedResult2 = modelMod.getSortedVisibleHotels();
  assert.strictEqual(cachedResult, cachedResult2, '第二次应命中缓存');
});

test('1000 条数据多次调用不重复排序（缓存命中）', async () => {
  const { stateMod, modelMod } = await loadModules();
  const { state, visibleHotelsCache, setHotels } = stateMod;

  resetCache(visibleHotelsCache);
  setHotels(makeHotels(1000));
  state.currentFilters = { sortMode: 'review_high' };

  const result1 = modelMod.getSortedVisibleHotels();
  assert.equal(result1.length, 1000);
  assert.equal(visibleHotelsCache.missCount, 1);

  for (let i = 0; i < 100; i++) {
    const result = modelMod.getSortedVisibleHotels();
    assert.strictEqual(result, result1, `第${i + 2}次调用应命中缓存`);
  }
  assert.equal(visibleHotelsCache.hitCount, 100);
  assert.equal(visibleHotelsCache.missCount, 1, '只有首次调用是 miss');
});

test('buildVisibleHotelsFiltersKey 输出稳定', async () => {
  const { modelMod } = await loadModules();
  const { getVisibleHotelsCacheKey } = modelMod;

  const filters1 = {
    name: '宾馆A',
    score: '4.0',
    favorite: '1',
    template: '',
    transportTime: '30',
    subwayDistance: '1.5'
  };
  const filters2 = {
    name: '宾馆A',
    score: '4.0',
    favorite: '1',
    template: '',
    transportTime: '30',
    subwayDistance: '1.5'
  };
  const filters3 = {
    name: '宾馆B',
    score: '4.0',
    favorite: '1',
    template: '',
    transportTime: '30',
    subwayDistance: '1.5'
  };

  assert.equal(getVisibleHotelsCacheKey(filters1), getVisibleHotelsCacheKey(filters2));
  assert.notEqual(getVisibleHotelsCacheKey(filters1), getVisibleHotelsCacheKey(filters3));
});

test('buildVisibleHotelsFiltersKey 不含 sortMode', async () => {
  const { modelMod } = await loadModules();
  const { getVisibleHotelsCacheKey } = modelMod;

  const filters = { name: '宾馆A', score: '4.0', favorite: '1', sortMode: 'review_high' };
  const key = getVisibleHotelsCacheKey(filters);
  assert.ok(!key.includes('review_high'), 'filtersKey 不应包含 sortMode');
  assert.ok(!key.includes('sortMode'), 'filtersKey 不应包含 sortMode 字段名');
});

test('markVisibleHotelsCacheDirty 独立失效', async () => {
  const { stateMod, modelMod } = await loadModules();
  const { state, visibleHotelsCache, setHotels, markVisibleHotelsCacheDirty } = stateMod;

  resetCache(visibleHotelsCache);
  setHotels(makeHotels(5));
  state.currentFilters = {};

  modelMod.getSortedVisibleHotels();
  assert.equal(visibleHotelsCache.missCount, 1);
  assert.ok(visibleHotelsCache.data !== null);

  markVisibleHotelsCacheDirty();
  assert.equal(visibleHotelsCache.data, null, '缓存应被清空');
  assert.equal(visibleHotelsCache.hotelsVersion, -1);

  const missBefore = visibleHotelsCache.missCount;
  modelMod.getSortedVisibleHotels();
  assert.equal(visibleHotelsCache.missCount, missBefore + 1, '手动失效后应重新计算');
});

test('空筛选条件和默认 sortMode', async () => {
  const { stateMod, filtersMod, modelMod } = await loadModules();
  const { state, visibleHotelsCache, setHotels } = stateMod;

  resetCache(visibleHotelsCache);
  setHotels(makeHotels(10));
  state.currentFilters = {};

  const result = modelMod.getSortedVisibleHotels();
  assert.equal(result.length, 10);
  assert.equal(
    visibleHotelsCache.sortMode,
    filtersMod.DEFAULT_SORT_MODE,
    '空 sortMode 应使用默认值'
  );
});

test('多个筛选条件同时变化', async () => {
  const { stateMod, modelMod } = await loadModules();
  const { state, visibleHotelsCache, setHotels } = stateMod;

  resetCache(visibleHotelsCache);
  setHotels(makeHotels(20));
  state.currentFilters = { name: '宾馆1', score: '3.0' };

  modelMod.getSortedVisibleHotels();
  assert.equal(visibleHotelsCache.missCount, 1);

  const missBefore = visibleHotelsCache.missCount;
  state.currentFilters = { name: '宾馆1', score: '4.0' };
  modelMod.getSortedVisibleHotels();
  assert.equal(visibleHotelsCache.missCount, missBefore + 1, 'score 变化应导致 miss');
});
