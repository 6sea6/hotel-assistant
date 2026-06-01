const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function writeFile(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf-8');
}

async function loadHotelListModule() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-hotel-list-empty-'));
  const sourceDir = path.join(__dirname, '..', 'src', 'renderer', 'modules');

  [
    'hotel-list.js',
    'hotel-list-controller.js',
    'hotel-list-empty-state.js',
    'hotel-list-table-renderer.js',
    'hotel-list-card-renderer.js',
    'hotel-list-selection.js',
    'hotel-list-virtual-adapter.js'
  ].forEach((fileName) => {
    fs.copyFileSync(path.join(sourceDir, fileName), path.join(tempRoot, fileName));
  });
  writeFile(path.join(tempRoot, 'package.json'), '{"type":"module"}\n');

  writeFile(
    path.join(tempRoot, 'state.js'),
    `
    export const state = globalThis.__hotelListState;
    export const HOTEL_RENDER_BATCH_SIZE = 50;
    export const LARGE_HOTEL_RENDER_THRESHOLD = 500;
    export const INTERACTION_FIRST_RENDER_DELAY = 0;
    export const visibleHotelsCache = state.visibleHotelsCache;
    export const hotelListScrollMemory = {};
    export function setHotels(hotels) { state.hotels = hotels; }
    export function updateCurrentFilters(filters) { state.currentFilters = { ...state.currentFilters, ...filters }; }
    export function replaceCurrentFilters(filters) { state.currentFilters = { ...filters }; }
    export function clearSelectedHotels() { state.selectedHotels.clear(); }
    export function setViewMode(viewMode) { state.viewMode = viewMode; }
    export function markRankingCacheDirty() {}
    export function bumpHotelListRenderVersion() { state.hotelListRenderVersion += 1; }
    export function setRenderScheduled(value) { state.renderScheduled = value; }
    export function setPendingRenderInteractionFirst(value) { state.pendingRenderInteractionFirst = value; }
    export function setHotelNameFilterOptionSignature(value) { state.hotelNameFilterOptionSignature = value; }
    export function buildVisibleHotelsFiltersKey() { return JSON.stringify(state.currentFilters || {}); }
    export function saveScrollMemory() {}
    export function getScrollBehaviorForReason() { return 'top'; }
    export function calculateScrollTopForAnchor() { return 0; }
    export function calculateScrollTopAfterDelete() { return 0; }
    `
  );

  writeFile(
    path.join(tempRoot, 'dom-helpers.js'),
    `
    export const $ = (id) => globalThis.document.getElementById(id);
    export const getValue = (id) => $(id)?.value || '';
    export const escapeHtml = (value) => String(value ?? '');
    export const escapeHtmlWithLineBreaks = escapeHtml;
    export const idsEqual = (a, b) => String(a) === String(b);
    export const getSelectionKey = (id) => String(id);
    export const hasDisplayValue = (value) => value !== null && value !== undefined && String(value).trim() !== '';
    export const formatDateChinese = (value) => String(value || '');
    export const getRoomCountText = (value) => String(value || '');
    export const normalizeFilterOptionKey = (value) => String(value || '').trim();
    `
  );

  writeFile(path.join(tempRoot, 'notification.js'), 'export function showNotification() {}\n');
  writeFile(path.join(tempRoot, 'perf.js'), 'export function perfStart() {}\nexport function perfEnd() {}\n');
  writeFile(
    path.join(tempRoot, 'render-scheduler.js'),
    `
    export function isHotelInputPriorityActive() { return false; }
    export function clearPendingHotelRenderTimers() {}
    export function queueHotelRenderResume(callback) { callback(); }
    export function scheduleHotelRenderTask(callback) { callback(); }
    `
  );
  writeFile(
    path.join(tempRoot, 'ui-utils.js'),
    `
    export function setModalActive() {}
    export function resetDeleteConfirmation() {}
    export function startDeleteConfirmation() {}
    export function resetActionButtonConfirmation() {}
    export function startActionButtonConfirmation() {}
    export function resetBatchDeleteConfirmation() {}
    `
  );
  writeFile(
    path.join(tempRoot, 'hotel-filters.js'),
    `
    export const DEFAULT_SORT_MODE = 'review_high';
    export function applyFiltersToHotels(hotels) { return hotels || []; }
    export function sortHotels(hotels) { return hotels || []; }
    export function getVisibleHotelSummary(hotels) { return { hotelCount: hotels.length, roomTypeCount: hotels.length }; }
    export function formatSubwayInfo() { return '-'; }
    export function formatDistanceValue(value) { return value; }
    export function formatTransportValue(value) { return value; }
    export function extractDistanceNumber(value) { return Number(value) || null; }
    export function extractTimeNumber(value) { return Number(value) || null; }
    `
  );
  writeFile(
    path.join(tempRoot, 'hotel-render-decision.js'),
    `
    export function getHotelListRenderDecision(options = {}) { return { mode: 'full', changedIds: [], reason: options.reason || '' }; }
    export function shouldFullRerender() { return true; }
    `
  );
  writeFile(path.join(tempRoot, 'actions.js'), 'export const actions = {};\n');
  writeFile(path.join(tempRoot, 'custom-select.js'), 'export function refreshCustomSelects() {}\n');
  writeFile(
    path.join(tempRoot, 'hotel-card-fields.js'),
    `
    export function normalizeHotelCardVisibleFields() { return []; }
    export function renderCardFields() { return { headerFieldItems: [], compactItems: [], fullItems: [], footerItems: [], actionItems: [] }; }
    `
  );
  writeFile(
    path.join(tempRoot, 'hotel-virtual-list.js'),
    `
    export const VIRTUAL_OVERSCAN = 10;
    export const LIST_ROW_ESTIMATED_HEIGHT = 96;
    export const CARD_ESTIMATED_HEIGHT = 260;
    export const CARD_GAP = 16;
    export function shouldUseVirtualHotelList() { return false; }
    export function getVirtualScrollThreshold() { return 200; }
    export function calculateVirtualRange() { return { startIndex: 0, endIndex: 0, beforeHeight: 0, afterHeight: 0 }; }
    export function calculateCardVirtualRange() { return { startIndex: 0, endIndex: 0, beforeHeight: 0, afterHeight: 0 }; }
    export function createDefaultVirtualState(viewMode = 'card') { return { viewMode }; }
    export function measureAverageHeight(_elements, fallback) { return fallback; }
    export function calculateCardColumns() { return 3; }
    `
  );
  writeFile(
    path.join(tempRoot, 'virtual-scrollbar-math.js'),
    `
    export function calculateThumbMetrics() { return {}; }
    export function calculateScrollTopFromTrackClick() { return 0; }
    export function calculateScrollTopFromDrag() { return 0; }
    export function clampValue(value) { return value; }
    export function normalizeWheelDelta(value) { return value; }
    export function normalizeWheelToStep(value) { return value; }
    `
  );

  return {
    tempRoot,
    moduleUrl: pathToFileURL(path.join(tempRoot, 'hotel-list.js')).href
  };
}

function createElementMock(id) {
  return {
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    className: '',
    style: {},
    classList: { contains: () => false, toggle() {}, add() {}, remove() {} },
    querySelector: () => null,
    querySelectorAll: () => [],
    appendChild() {},
    addEventListener() {},
    removeEventListener() {}
  };
}

function setupDom() {
  const elements = new Map(
    ['hotelList', 'hotelCount', 'roomTypeCount'].map((id) => [id, createElementMock(id)])
  );
  const documentMock = {
    getElementById(id) {
      return elements.get(id) || null;
    },
    createElement: (tagName) => createElementMock(tagName),
    createDocumentFragment: () => createElementMock('fragment'),
    querySelector: () => null,
    querySelectorAll: () => []
  };
  return { elements, documentMock };
}

test('renderHotelList: empty hotel state opens AI assistant instead of manual add modal', async () => {
  const { tempRoot, moduleUrl } = await loadHotelListModule();
  const { elements, documentMock } = setupDom();
  const previousDocument = globalThis.document;
  const previousHtmlInputElement = globalThis.HTMLInputElement;

  globalThis.document = documentMock;
  globalThis.HTMLInputElement = class HTMLInputElement {};
  globalThis.__hotelListState = {
    hotels: [],
    templates: [],
    currentFilters: {},
    selectedHotels: new Set(),
    viewMode: 'card',
    hotelsVersion: 0,
    hotelListRenderVersion: 0,
    renderScheduled: false,
    pendingRenderInteractionFirst: false,
    pendingHotelRenderResume: null,
    hotelNameFilterOptionSignature: '',
    visibleHotelsCache: { data: null, hotelsVersion: -1, filtersKey: '', sortMode: '', hitCount: 0, missCount: 0 }
  };

  try {
    const { renderHotelList } = await import(moduleUrl);
    renderHotelList();

    const html = elements.get('hotelList').innerHTML;
    assert.match(html, /data-action="open-ai-assistant"/);
    assert.doesNotMatch(html, /data-action="open-add-hotel"/);
    assert.match(html, /打开采集助手/);
  } finally {
    globalThis.document = previousDocument;
    globalThis.HTMLInputElement = previousHtmlInputElement;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
