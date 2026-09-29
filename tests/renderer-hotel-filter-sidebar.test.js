const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

test('hotel name suggestions preserve a free-form partial query', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-filter-sidebar-'));
  const sourceDir = path.join(__dirname, '..', 'src', 'renderer', 'modules');
  fs.writeFileSync(path.join(tempRoot, 'package.json'), '{"type":"module"}\n', 'utf-8');
  fs.copyFileSync(
    path.join(sourceDir, 'hotel-list-filter-options.js'),
    path.join(tempRoot, 'hotel-list-filter-options.js')
  );
  fs.writeFileSync(
    path.join(tempRoot, 'state.js'),
    `
      export const state = globalThis.__filterSidebarState;
      export function setHotelNameFilterOptionSignature(value) {
        state.hotelNameFilterOptionSignature = value;
      }
    `,
    'utf-8'
  );
  fs.writeFileSync(
    path.join(tempRoot, 'dom-helpers.js'),
    `
      export const $ = (id) => globalThis.__filterSidebarElements[id] || null;
      export function normalizeFilterOptionKey(value) {
        return String(value || '').trim().toLocaleLowerCase('zh-CN');
      }
    `,
    'utf-8'
  );

  const createElement = (tagName) => ({
    tagName: String(tagName).toUpperCase(),
    id: '',
    className: '',
    dataset: {},
    textContent: '',
    tabIndex: 0,
    attributes: new Map(),
    classList: { toggle() {} },
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    },
    removeAttribute(name) {
      this.attributes.delete(name);
    },
    scrollIntoView() {}
  });
  const input = createElement('input');
  input.value = '';
  const dataList = {
    options: [],
    querySelectorAll() {
      return this.options;
    },
    appendChild(fragment) {
      this.options.push(...fragment.children);
    }
  };
  Object.defineProperty(dataList, 'innerHTML', {
    set() {
      this.options = [];
    }
  });
  const previousDocument = globalThis.document;
  globalThis.__filterSidebarState = {
    hotels: [
      { id: 1, name: '上海和平饭店' },
      { id: 2, name: '北京饭店' },
      { id: 3, name: '上海和平饭店' }
    ],
    hotelNameFilterOptionSignature: null
  };
  globalThis.__filterSidebarElements = {
    filterName: input,
    hotelNameSuggestions: dataList
  };
  globalThis.document = {
    createDocumentFragment: () => ({
      children: [],
      appendChild(option) {
        this.children.push(option);
      }
    }),
    createElement
  };

  try {
    const moduleUrl = pathToFileURL(path.join(tempRoot, 'hotel-list-filter-options.js')).href;
    const { syncHotelNameFilterOptions, getFilteredHotelNameSuggestions } = await import(moduleUrl);
    const result = syncHotelNameFilterOptions({ selectedValue: '和平' });

    assert.equal(result, '和平');
    assert.equal(input.value, '和平');
    assert.deepEqual(
      dataList.options.map((option) => option.dataset.value),
      ['上海和平饭店']
    );
    assert.deepEqual(getFilteredHotelNameSuggestions('饭店'), ['北京饭店', '上海和平饭店']);
  } finally {
    globalThis.document = previousDocument;
    delete globalThis.__filterSidebarState;
    delete globalThis.__filterSidebarElements;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('hotel name filter uses the app-drawn listbox instead of native datalist UI', () => {
  const projectRoot = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(projectRoot, 'src', 'renderer', 'index.html'), 'utf-8');
  const css = fs.readFileSync(
    path.join(projectRoot, 'src', 'renderer', 'styles', 'components', 'custom-select.css'),
    'utf-8'
  );

  assert.doesNotMatch(html, /<datalist\b/i);
  assert.doesNotMatch(html, /id="filterName"[^>]*\blist=/i);
  assert.match(html, /class="custom-select-menu hotel-name-suggestion-menu"/);
  assert.match(html, /role="listbox"/);
  assert.match(css, /\.hotel-name-suggestion-menu\s*{/);
  assert.match(css, /border-radius:\s*999px/);
});
