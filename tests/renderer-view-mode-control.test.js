const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const projectRoot = path.resolve(__dirname, '..');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf-8');
}

function writeFile(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf-8');
}

test('main toolbar exposes an explicit whole-frame card/table view toggle', () => {
  const html = readProjectFile('src/renderer/index.html');

  assert.match(html, /<button[\s\S]*id="viewModeToggle"[\s\S]*class="view-mode-segmented"/);
  assert.match(html, /aria-label="视图模式，当前卡片，点击切换为表格"/);
  assert.match(html, /data-action="toggle-view-mode"/);
  assert.match(html, /id="viewModeCardOption"[\s\S]*data-view-mode="card"/);
  assert.match(html, /id="viewModeListOption"[\s\S]*data-view-mode="list"/);
  assert.match(html, /🗂️/);
  assert.match(html, /📝/);
  assert.doesNotMatch(html, /data-action="set-view-mode"/);
});

async function loadControllerModule() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-view-mode-control-'));
  const sourceDir = path.join(projectRoot, 'src', 'renderer', 'modules');
  fs.copyFileSync(
    path.join(sourceDir, 'hotel-list-controller.js'),
    path.join(tempRoot, 'hotel-list-controller.js')
  );
  writeFile(path.join(tempRoot, 'package.json'), '{"type":"module"}\n');
  writeFile(
    path.join(tempRoot, 'state.js'),
    `
    export const state = globalThis.__viewModeState;
    export function replaceCurrentFilters(filters) { state.currentFilters = { ...filters }; }
    export function clearSelectedHotels() {
      globalThis.__viewModeClearSelectionCalls += 1;
      state.selectedHotels.clear();
    }
    export function setViewMode(viewMode) {
      state.viewMode = viewMode;
      globalThis.__viewModeSetCalls.push(viewMode);
    }
    export function markRankingCacheDirty() {}
    `
  );
  writeFile(
    path.join(tempRoot, 'dom-helpers.js'),
    `
    export const $ = (id) => globalThis.__viewModeElements.get(id) || null;
    export const getValue = (id) => $(id)?.value || '';
    export const escapeHtml = (value) => String(value ?? '');
    export const escapeHtmlWithLineBreaks = escapeHtml;
    export const idsEqual = (a, b) => String(a) === String(b);
    export const getRoomCountText = (value) => String(value || '');
    `
  );
  writeFile(
    path.join(tempRoot, 'ui-utils.js'),
    `
    export function setModalActive() {}
    export function resetDeleteConfirmation() {}
    export function startDeleteConfirmation() {}
    export function resetBatchDeleteConfirmation(options = {}) {
      globalThis.__viewModeBatchResetCalls.push(options);
    }
    `
  );
  writeFile(
    path.join(tempRoot, 'hotel-filters.js'),
    `
    export const DEFAULT_SORT_MODE = 'review_high';
    export function formatSubwayInfo() { return '-'; }
    export function formatDistanceValue(value) { return value; }
    export function formatTransportValue(value) { return value; }
    `
  );
  writeFile(
    path.join(tempRoot, 'hotel-list-filter-options.js'),
    `
    export function buildHotelNameFilterOptions() { return []; }
    export function syncHotelNameFilterOptions() { return ''; }
    `
  );
  writeFile(
    path.join(tempRoot, 'hotel-list-render-orchestrator.js'),
    `
    export function renderHotelList() {}
    export function requestHotelListRender(options = {}) {
      globalThis.__viewModeRenderRequests.push(options);
    }
    `
  );
  writeFile(
    path.join(tempRoot, 'hotel-render-decision.js'),
    `
    export function shouldFullRerender() { return true; }
    `
  );
  writeFile(
    path.join(tempRoot, 'rule-delete-controller.js'),
    `
    export function closeRuleDeleteModal() {}
    export function confirmRuleDelete() {}
    export function openRuleDeleteModal() {}
    export function updateRuleDeletePreview() {}
    `
  );
  writeFile(path.join(tempRoot, 'actions.js'), 'export const actions = {};\n');
  writeFile(path.join(tempRoot, 'custom-select.js'), 'export function refreshCustomSelects() {}\n');
  writeFile(
    path.join(tempRoot, 'hotel-list-selection.js'),
    'export function toggleHotelRowSelection() {}\nexport function toggleSelectAll() {}\n'
  );

  return {
    tempRoot,
    moduleUrl: pathToFileURL(path.join(tempRoot, 'hotel-list-controller.js')).href
  };
}

function createElement(id) {
  const classSet = new Set();
  const attrs = new Map();
  return {
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    style: {},
    dataset: {},
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
    setAttribute(name, value) {
      attrs.set(name, String(value));
    },
    getAttribute(name) {
      return attrs.get(name) || null;
    }
  };
}

function installViewModeDom() {
  const elements = new Map(
    [
      'viewModeToggle',
      'viewModeCardOption',
      'viewModeListOption',
      'batchDeleteBtn',
      'ruleDeleteBtn'
    ].map((id) => [id, createElement(id)])
  );
  globalThis.__viewModeElements = elements;
  globalThis.document = {
    getElementById(id) {
      return elements.get(id) || null;
    },
    querySelector() {
      return null;
    }
  };
  return elements;
}

test('setViewModeChoice applies the requested mode and synchronizes segmented state', async () => {
  const { tempRoot, moduleUrl } = await loadControllerModule();
  const previousDocument = globalThis.document;
  globalThis.__viewModeState = {
    viewMode: 'card',
    currentFilters: {},
    selectedHotels: new Set(['hotel-1'])
  };
  globalThis.__viewModeSetCalls = [];
  globalThis.__viewModeRenderRequests = [];
  globalThis.__viewModeBatchResetCalls = [];
  globalThis.__viewModeClearSelectionCalls = 0;
  const elements = installViewModeDom();

  try {
    const { setViewModeChoice } = await import(moduleUrl);

    setViewModeChoice('list');

    assert.equal(globalThis.__viewModeState.viewMode, 'list');
    assert.deepEqual(globalThis.__viewModeSetCalls, ['list']);
    assert.deepEqual(globalThis.__viewModeRenderRequests, [
      { reason: 'view-mode-change', forceFull: true }
    ]);
    assert.equal(
      elements.get('viewModeToggle').getAttribute('aria-label'),
      '视图模式，当前表格，点击切换为卡片'
    );
    assert.equal(elements.get('viewModeListOption').getAttribute('aria-current'), 'true');
    assert.equal(elements.get('viewModeCardOption').getAttribute('aria-current'), 'false');
    assert.equal(elements.get('viewModeListOption').classList.contains('is-active'), true);
    assert.equal(elements.get('batchDeleteBtn').hidden, false);
    assert.equal(elements.get('batchDeleteBtn').style.display, 'inline-flex');
    assert.equal(elements.get('ruleDeleteBtn').hidden, true);
    assert.equal(globalThis.__viewModeClearSelectionCalls, 0);

    setViewModeChoice('list');
    assert.equal(globalThis.__viewModeRenderRequests.length, 1);

    setViewModeChoice('card');
    assert.equal(globalThis.__viewModeState.viewMode, 'card');
    assert.equal(globalThis.__viewModeState.selectedHotels.size, 0);
    assert.equal(
      elements.get('viewModeToggle').getAttribute('aria-label'),
      '视图模式，当前卡片，点击切换为表格'
    );
    assert.equal(elements.get('viewModeCardOption').getAttribute('aria-current'), 'true');
    assert.equal(elements.get('batchDeleteBtn').hidden, true);
    assert.equal(elements.get('ruleDeleteBtn').hidden, false);
  } finally {
    globalThis.document = previousDocument;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
