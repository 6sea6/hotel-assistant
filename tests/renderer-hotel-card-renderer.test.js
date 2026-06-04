const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let rendererModuleUrl = '';
const projectRoot = path.resolve(__dirname, '..');

async function loadCardRendererModule() {
  if (!rendererModuleUrl) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-hotel-card-renderer-'));
    const sourceDir = path.join(__dirname, '..', 'src', 'renderer', 'modules');
    fs.writeFileSync(path.join(tempRoot, 'package.json'), '{"type":"module"}\n', 'utf-8');
    fs.copyFileSync(
      path.join(sourceDir, 'hotel-list-card-renderer.js'),
      path.join(tempRoot, 'hotel-list-card-renderer.js')
    );

    fs.writeFileSync(
      path.join(tempRoot, 'state.js'),
      `
export const state = globalThis.__hotelCardRendererState;
export const HOTEL_RENDER_BATCH_SIZE = 50;
export const LARGE_HOTEL_RENDER_THRESHOLD = 500;
`
    );
    fs.writeFileSync(
      path.join(tempRoot, 'dom-helpers.js'),
      `
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
export const escapeHtmlWithLineBreaks = escapeHtml;
export const hasDisplayValue = (value) => value !== null && value !== undefined && String(value).trim() !== '';
export const formatDateChinese = (value) => String(value || '');
export const getRoomCountText = (value) => String(value || '');
export const getSelectionKey = (id) => String(id);
`
    );
    fs.writeFileSync(
      path.join(tempRoot, 'render-scheduler.js'),
      `
export function isHotelInputPriorityActive() { return false; }
export function queueHotelRenderResume(callback) { callback(); }
`
    );
    fs.writeFileSync(
      path.join(tempRoot, 'hotel-filters.js'),
      'export function formatSubwayInfo() { return ""; }\n'
    );
    fs.writeFileSync(
      path.join(tempRoot, 'hotel-card-fields.js'),
      `
export function normalizeHotelCardVisibleFields() { return []; }
export function renderCardFields() {
  return globalThis.__hotelCardRendererFields || { headerFieldItems: [], compactItems: [], fullItems: [], footerItems: [], actionItems: [] };
}
`
    );

    rendererModuleUrl = pathToFileURL(path.join(tempRoot, 'hotel-list-card-renderer.js')).href;
    process.on('exit', () => fs.rmSync(tempRoot, { recursive: true, force: true }));
  }

  return import(rendererModuleUrl);
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.className = '';
    this.dataset = {};
    this.innerHTML = '';
  }
}

function installCardRendererDom() {
  const previousDocument = global.document;
  global.document = {
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    createDocumentFragment() {
      return {
        children: [],
        appendChild(child) {
          this.children.push(child);
        }
      };
    }
  };
  return () => {
    global.document = previousDocument;
  };
}

function makeHotel(overrides = {}) {
  return {
    id: 101,
    name: '星标酒店',
    is_favorite: 1,
    ...overrides
  };
}

test('hotel card renders the favorite star below the top-right rank without a frame', async () => {
  const restoreDom = installCardRendererDom();
  globalThis.__hotelCardRendererState = {
    settings: { hotelCardVisibleFields: [] },
    renderedHotelNodeMap: new Map()
  };
  globalThis.__hotelCardRendererFields = null;

  try {
    const { createHotelCard } = await loadCardRendererModule();
    const card = createHotelCard(makeHotel(), 0);
    const html = card.innerHTML;
    const cornerIndex = html.indexOf('class="hotel-card-corner"');
    const headerIndex = html.indexOf('class="hotel-card-header"');

    assert.match(
      html,
      /<div class="hotel-card-corner">[\s\S]*<div class="hotel-rank top3">#1<\/div>[\s\S]*<button[\s\S]*class="hotel-favorite-star is-active"/
    );
    assert.match(
      html,
      /<button[^>]+class="hotel-favorite-star is-active"[^>]+data-action="favorite"[^>]+data-id="101"[^>]+data-favorite="1"/
    );
    assert.match(html, /aria-label="取消收藏 星标酒店"/);
    assert.match(html, /<span aria-hidden="true">★<\/span>/);
    assert.ok(cornerIndex >= 0, 'corner group should render');
    assert.ok(cornerIndex < headerIndex, 'corner group should sit before the card header');

    const actionsHtml = html.match(/<div class="hotel-actions">([\s\S]*?)<\/div>/)?.[1] || '';
    assert.doesNotMatch(actionsHtml, /data-action="favorite"/);

    const css = fs.readFileSync(
      path.join(projectRoot, 'src', 'renderer', 'styles', 'pages', 'hotel-cards.css'),
      'utf-8'
    );
    const cornerRule = css.match(/\.hotel-card-corner\s*{([\s\S]*?)}/)?.[1] || '';
    const starRule = css.match(/\.hotel-favorite-star\s*{([\s\S]*?)}/)?.[1] || '';
    assert.match(cornerRule, /position:\s*absolute/);
    assert.match(cornerRule, /justify-items:\s*center/);
    assert.match(starRule, /border:\s*(?:0|none)/);
    assert.match(starRule, /background:\s*transparent/);
  } finally {
    restoreDom();
  }
});

test('hotel card meta row lets a single address use the full row', async () => {
  const restoreDom = installCardRendererDom();
  globalThis.__hotelCardRendererState = {
    settings: { hotelCardVisibleFields: [] },
    renderedHotelNodeMap: new Map()
  };
  globalThis.__hotelCardRendererFields = {
    headerFieldItems: [
      {
        key: 'address',
        html: '<div class="hotel-address hotel-card-address"><span class="hotel-card-address-text">湖北武汉武昌区沿江大道159号</span></div>'
      }
    ],
    compactItems: [],
    fullItems: [],
    footerItems: [],
    actionItems: []
  };

  try {
    const { createHotelCard } = await loadCardRendererModule();
    const card = createHotelCard(makeHotel(), 0);
    const html = card.innerHTML;
    const metaRow = html.match(/<div class="hotel-card-meta-pair[^"]*">[\s\S]*?<\/div>\s*<\/div>/)?.[0] || '';

    assert.match(metaRow, /hotel-card-meta-pair[^"]*\bis-single-meta\b/);
    assert.match(metaRow, /hotel-card-meta-pair[^"]*\bhas-address\b/);
    assert.match(metaRow, /hotel-card-meta-cell-address/);
    assert.doesNotMatch(metaRow, /hotel-card-meta-cell-website/);
  } finally {
    globalThis.__hotelCardRendererFields = null;
    restoreDom();
  }
});

test('hotel card metadata css lets address consume available row space before truncating', () => {
  const css = fs.readFileSync(
    path.join(projectRoot, 'src', 'renderer', 'styles', 'pages', 'hotel-cards.css'),
    'utf-8'
  );
  const metaPairRule = css.match(/\.hotel-card-meta-pair\s*{([\s\S]*?)}/)?.[1] || '';
  const singleMetaRule = css.match(/\.hotel-card-meta-pair\.is-single-meta\s*{([\s\S]*?)}/)?.[1] || '';
  const addressRuleStart = css.lastIndexOf('\n.hotel-card-address {');
  assert.notEqual(addressRuleStart, -1, 'missing standalone hotel-card-address rule');
  const addressRuleBlockStart = css.indexOf('{', addressRuleStart);
  const addressRuleBlockEnd = css.indexOf('}', addressRuleBlockStart);
  const addressRule = css.slice(addressRuleBlockStart + 1, addressRuleBlockEnd);
  const addressTextRule = css.match(/\.hotel-card-address-text\s*{([\s\S]*?)}/)?.[1] || '';

  assert.match(metaPairRule, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/);
  assert.match(singleMetaRule, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(addressRule, /display:\s*grid/);
  assert.match(addressRule, /grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)/);
  assert.match(addressTextRule, /min-width:\s*0/);
  assert.match(addressTextRule, /text-overflow:\s*ellipsis/);
});
