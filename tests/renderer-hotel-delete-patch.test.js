const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function writeFile(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf-8');
}

test('non-virtual hotel deletion removes one node and updates remaining ranks', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-delete-patch-'));
  const sourceDir = path.join(__dirname, '..', 'src', 'renderer', 'modules');
  writeFile(path.join(tempRoot, 'package.json'), '{"type":"module"}\n');
  fs.copyFileSync(
    path.join(sourceDir, 'hotel-list-patch.js'),
    path.join(tempRoot, 'hotel-list-patch.js')
  );
  writeFile(
    path.join(tempRoot, 'state.js'),
    `
      export const state = globalThis.__deletePatchState;
      export function updateCurrentFilters(patch) { state.currentFilters = { ...state.currentFilters, ...patch }; }
      export function bumpHotelListRenderVersion() { state.hotelListRenderVersion += 1; }
    `
  );
  writeFile(
    path.join(tempRoot, 'dom-helpers.js'),
    `
      export const $ = (id) => globalThis.__deletePatchElements[id] || null;
      export const idsEqual = (a, b) => String(a) === String(b);
      export const getSelectionKey = (id) => String(id);
    `
  );
  writeFile(
    path.join(tempRoot, 'ui-utils.js'),
    'export function resetBatchDeleteConfirmation() {}\n'
  );
  writeFile(
    path.join(tempRoot, 'hotel-list-model.js'),
    `
      export function getSortedVisibleHotels() { return globalThis.__deletePatchState.hotels; }
      export function getVisibleHotelListSummary(hotels) {
        return { hotelCount: hotels.length, roomTypeCount: hotels.length };
      }
    `
  );
  writeFile(
    path.join(tempRoot, 'hotel-list-filter-options.js'),
    'export function syncHotelNameFilterOptions(options = {}) { return options.selectedValue || ""; }\n'
  );
  writeFile(
    path.join(tempRoot, 'hotel-list-table-renderer.js'),
    'export function createHotelListRow() { return null; }\n'
  );
  writeFile(
    path.join(tempRoot, 'hotel-list-card-renderer.js'),
    `
      export function alignHotelCardTitleRows() {}
      export function createHotelCard() { return null; }
      export function getCurrentHotelCardVisibleKeys() { return []; }
    `
  );
  writeFile(
    path.join(tempRoot, 'hotel-list-selection.js'),
    'export function syncSelectAllCheckboxState() {}\n'
  );
  writeFile(
    path.join(tempRoot, 'hotel-filters.js'),
    'export function getActiveHotelFilterCount() { return 0; }\n'
  );

  const makeRank = (text) => ({
    textContent: text,
    classList: {
      top3: true,
      toggle(_name, value) {
        this.top3 = value;
      }
    }
  });
  const makeNode = (id, rankText) => {
    const rank = makeRank(rankText);
    return {
      dataset: { id: String(id) },
      rank,
      removed: false,
      querySelector() {
        return rank;
      },
      remove() {
        this.removed = true;
      }
    };
  };
  const first = makeNode(1, '#1');
  const second = makeNode(2, '#2');
  const third = makeNode(3, '#3');
  const container = {
    querySelector() {
      return null;
    },
    contains() {
      return true;
    }
  };
  const count = { textContent: '' };
  const roomCount = { textContent: '' };
  globalThis.__deletePatchState = {
    hotels: [{ id: 2 }, { id: 3 }],
    currentFilters: {},
    selectedHotels: new Set(['1']),
    renderedHotelNodeMap: new Map([
      ['1', first],
      ['2', second],
      ['3', third]
    ]),
    viewMode: 'list',
    hotelListRenderVersion: 0
  };
  globalThis.__deletePatchElements = {
    hotelList: container,
    hotelCount: count,
    roomTypeCount: roomCount
  };
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById(id) {
      return globalThis.__deletePatchElements[id] || null;
    }
  };

  try {
    const moduleUrl = pathToFileURL(path.join(tempRoot, 'hotel-list-patch.js')).href;
    const { patchHotelCards } = await import(moduleUrl);
    assert.equal(patchHotelCards(['1'], { reason: 'hotel-delete' }), true);
    assert.equal(first.removed, true);
    assert.equal(second.rank.textContent, '#1');
    assert.equal(third.rank.textContent, '#2');
    assert.deepEqual([...globalThis.__deletePatchState.renderedHotelNodeMap.keys()], ['2', '3']);
    assert.equal(globalThis.__deletePatchState.selectedHotels.has('1'), false);
    assert.equal(count.textContent, '2');
  } finally {
    globalThis.document = previousDocument;
    delete globalThis.__deletePatchState;
    delete globalThis.__deletePatchElements;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
