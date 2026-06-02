const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let moduleUrl = '';

function writeStub(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf-8');
}

async function loadSelectionModule() {
  if (!moduleUrl) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-list-selection-'));
    const sourceDir = path.join(__dirname, '..', 'src', 'renderer', 'modules');

    writeStub(path.join(tempRoot, 'package.json'), '{"type":"module"}\n');
    fs.copyFileSync(
      path.join(sourceDir, 'hotel-list-selection.js'),
      path.join(tempRoot, 'hotel-list-selection.js')
    );

    writeStub(
      path.join(tempRoot, 'state.js'),
      `
      export const state = globalThis.__selectionState;
      export function clearSelectedHotels() { state.selectedHotels.clear(); }
      `
    );
    writeStub(
      path.join(tempRoot, 'dom-helpers.js'),
      `
      export const $ = (id) => globalThis.__selectionFields[id] || null;
      export function getSelectionKey(id) { return String(id); }
      `
    );
    writeStub(
      path.join(tempRoot, 'ui-utils.js'),
      `
      export function resetBatchDeleteConfirmation(options = {}) {
        globalThis.__batchDeleteResetCalls.push(options);
      }
      `
    );
    writeStub(
      path.join(tempRoot, 'hotel-list-virtual-adapter.js'),
      `
      export function getVirtualHotelListState() { return globalThis.__virtualHotelListState || null; }
      export function syncVirtualSelectAllCheckboxState(sortedHotels) {
        globalThis.__virtualSelectAllSyncs.push(sortedHotels);
      }
      `
    );

    moduleUrl = pathToFileURL(path.join(tempRoot, 'hotel-list-selection.js')).href;
    process.on('exit', () => fs.rmSync(tempRoot, { recursive: true, force: true }));
  }

  return import(moduleUrl);
}

function initSelectionState() {
  if (!globalThis.__selectionState) {
    globalThis.__selectionState = {
      selectedHotels: new Set(),
      renderedHotelNodeMap: new Map()
    };
  }
  globalThis.__selectionState.selectedHotels = new Set();
  globalThis.__selectionState.renderedHotelNodeMap = new Map();
  globalThis.__selectionFields = {
    selectAll: { checked: false, indeterminate: false }
  };
  globalThis.__batchDeleteResetCalls = [];
  globalThis.__virtualSelectAllSyncs = [];
  globalThis.__virtualHotelListState = null;
  globalThis.document = {
    getElementById: (id) => globalThis.__selectionFields[id] || null,
    querySelectorAll() {
      throw new Error('selection should not scan global DOM');
    },
    querySelector() {
      throw new Error('selection should use mounted node map');
    }
  };
}

function createRow(id) {
  const classSet = new Set();
  const checkbox = { checked: false };
  return {
    dataset: { id: String(id) },
    checkbox,
    classList: {
      add(name) {
        classSet.add(name);
      },
      remove(name) {
        classSet.delete(name);
      },
      toggle(name, enabled) {
        if (enabled) classSet.add(name);
        else classSet.delete(name);
      },
      contains(name) {
        return classSet.has(name);
      }
    },
    querySelector(selector) {
      return selector.includes('checkbox') ? checkbox : null;
    }
  };
}

test('toggleSelectAll updates mounted nodes from renderedHotelNodeMap without scanning DOM', async () => {
  initSelectionState();
  const { toggleSelectAll } = await loadSelectionModule();
  const rowOne = createRow(1);
  const rowTwo = createRow(2);
  globalThis.__selectionState.renderedHotelNodeMap.set('1', rowOne);
  globalThis.__selectionState.renderedHotelNodeMap.set('2', rowTwo);

  toggleSelectAll({ checked: true });

  assert.deepEqual([...globalThis.__selectionState.selectedHotels].sort(), ['1', '2']);
  assert.equal(rowOne.classList.contains('selected'), true);
  assert.equal(rowTwo.classList.contains('selected'), true);
  assert.equal(rowOne.checkbox.checked, true);
  assert.equal(rowTwo.checkbox.checked, true);
  assert.equal(globalThis.__selectionFields.selectAll.checked, true);
  assert.equal(globalThis.__selectionFields.selectAll.indeterminate, false);
});

test('syncSelectAllCheckboxState derives state from renderedHotelNodeMap', async () => {
  initSelectionState();
  const { syncSelectAllCheckboxState } = await loadSelectionModule();
  globalThis.__selectionState.renderedHotelNodeMap.set('1', createRow(1));
  globalThis.__selectionState.renderedHotelNodeMap.set('2', createRow(2));
  globalThis.__selectionState.selectedHotels.add('1');

  syncSelectAllCheckboxState();

  assert.equal(globalThis.__selectionFields.selectAll.checked, false);
  assert.equal(globalThis.__selectionFields.selectAll.indeterminate, true);
});
