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

function readStyleFile(relativePath) {
  return readProjectFile(path.posix.join('src/renderer/styles', relativePath));
}

function readCssRuleBlock(css, selector) {
  const selectorIndex = css.indexOf(selector);
  assert.notEqual(selectorIndex, -1, `missing selector: ${selector}`);
  const blockStart = css.indexOf('{', selectorIndex);
  const blockEnd = css.indexOf('}', blockStart);
  assert.notEqual(blockStart, -1, `missing block start for selector: ${selector}`);
  assert.notEqual(blockEnd, -1, `missing block end for selector: ${selector}`);
  return css.slice(blockStart + 1, blockEnd);
}

test('theme aliases no longer expose a dark theme that maps to oak brown', () => {
  const themeFiles = [
    'src/main/window-manager.js',
    'src/main/ipc-handlers/settings-handlers.js',
    'src/renderer/modules/personalization-ui.js',
    'src/renderer/styles/themes.css'
  ];

  for (const relativePath of themeFiles) {
    const source = readProjectFile(relativePath);
    assert.doesNotMatch(source, /dark\s*:\s*['"]oak-brown['"]/, relativePath);
    assert.doesNotMatch(source, /\[data-theme=['"]dark['"]\]/, relativePath);
  }
});

test('renderer tokens include semantic color typography spacing focus and motion contracts', () => {
  const tokens = readStyleFile('tokens.css');
  [
    '--font-family-primary',
    '--font-size-base',
    '--font-weight-semibold',
    '--line-height-normal',
    '--space-4',
    '--color-success',
    '--color-warning',
    '--color-info',
    '--color-favorite',
    '--color-template-badge',
    '--focus-ring',
    '--duration-fast',
    '--ease-standard',
    '--transition-lift',
    '--duration-motion-reduced',
    '--z-notification'
  ].forEach((tokenName) => {
    assert.match(tokens, new RegExp(`${tokenName}\\s*:`), tokenName);
  });
});

test('shared status colors in component and page CSS use semantic tokens', () => {
  const styleFiles = [
    'components/app-shell.css',
    'components/notifications.css',
    'components/virtual-scroll.css',
    'pages/app-modals.css',
    'pages/hotel-cards.css',
    'pages/hotel-table.css',
    'pages/ai-assistant.css'
  ];
  const forbiddenStatusColors =
    /#(?:22c55e|00b42a|ffb800|ff9500|ff7d00|165dff|2f80ed|7b8794|94a3b8|64748b|d93636|f53f3f)\b/i;

  for (const relativePath of styleFiles) {
    assert.doesNotMatch(readStyleFile(relativePath), forbiddenStatusColors, relativePath);
  }
});

test('renderer CSS defines keyboard focus and reduced motion safeguards', () => {
  const css = [
    readStyleFile('tokens.css'),
    readStyleFile('motion.css'),
    readStyleFile('components/app-shell.css'),
    readStyleFile('components/custom-select.css'),
    readStyleFile('components/modal-form.css'),
    readStyleFile('components/notifications.css'),
    readStyleFile('components/view-controls.css'),
    readStyleFile('pages/ai-assistant.css')
  ].join('\n');

  assert.match(css, /:focus-visible/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /@keyframes\s+spin/);
  assert.match(
    css,
    /\.loading-icon,[\s\S]*?animation-duration:\s*1s\s*!important;[\s\S]*?animation-iteration-count:\s*infinite\s*!important;/
  );
});

test('renderer CSS avoids broad transitions and blue-tinted theme leaks', () => {
  const css = [
    readStyleFile('components/app-shell.css'),
    readStyleFile('components/custom-select.css'),
    readStyleFile('components/modal-form.css'),
    readStyleFile('components/notifications.css'),
    readStyleFile('components/view-controls.css'),
    readStyleFile('pages/app-modals.css'),
    readStyleFile('pages/hotel-cards.css'),
    readStyleFile('pages/hotel-table.css'),
    readStyleFile('pages/settings-prefilter.css'),
    readStyleFile('pages/ai-assistant.css')
  ].join('\n');

  assert.doesNotMatch(css, /transition\s*:\s*all\b/);
  assert.doesNotMatch(
    readStyleFile('pages/ai-assistant.css'),
    /#eaf3ff|#68a7ff|#0e4cd9|rgba\(28,\s*54,\s*84/i
  );
  assert.doesNotMatch(
    readStyleFile('components/custom-select.css'),
    /#0e4cd9|rgba\(28,\s*54,\s*84/i
  );
});

test('form controls use the soft selected field focus treatment', () => {
  const tokens = readStyleFile('tokens.css');
  const appShell = readStyleFile('components/app-shell.css');
  const customSelect = readStyleFile('components/custom-select.css');
  const prefilter = readStyleFile('pages/settings-prefilter.css');

  assert.match(tokens, /--field-focus-border\s*:/);
  assert.match(tokens, /--field-focus-bg\s*:/);
  assert.match(tokens, /--field-focus-shadow\s*:/);

  const inputFocus = readCssRuleBlock(appShell, '.input:focus,\n.input:focus-visible');
  assert.match(inputFocus, /outline:\s*none/);
  assert.match(inputFocus, /border-color:\s*var\(--field-focus-border\)/);
  assert.match(inputFocus, /background:\s*var\(--field-focus-bg\)/);
  assert.match(inputFocus, /box-shadow:\s*var\(--field-focus-shadow\)/);

  const keyboardFocusSelector = appShell.match(/\.btn:focus-visible,[\s\S]*?{/);
  assert.ok(keyboardFocusSelector);
  assert.doesNotMatch(keyboardFocusSelector[0], /\.input:focus-visible/);

  const customSelectFocus = readCssRuleBlock(
    customSelect,
    '.custom-select.is-open .custom-select-button,\n.ai-template-picker.is-open .ai-template-picker-button,\n.custom-select-button:focus-visible,\n.ai-template-picker-button:focus-visible'
  );
  assert.match(customSelectFocus, /outline:\s*none/);
  assert.match(customSelectFocus, /border-color:\s*var\(--field-focus-border\)/);
  assert.match(customSelectFocus, /background:\s*var\(--field-focus-bg\)/);
  assert.match(customSelectFocus, /box-shadow:\s*var\(--field-focus-shadow\)/);

  const prefilterFocus = readCssRuleBlock(
    prefilter,
    '.prefilter-input:focus,\n.prefilter-input:focus-visible'
  );
  assert.match(prefilterFocus, /outline:\s*none/);
  assert.match(prefilterFocus, /border-color:\s*var\(--field-focus-border\)/);
  assert.match(prefilterFocus, /background:\s*var\(--field-focus-bg\)/);
  assert.match(prefilterFocus, /box-shadow:\s*var\(--field-focus-shadow\)/);
});

test('sort mode radio controls are custom painted for consistent theme colors', () => {
  const appShell = readStyleFile('components/app-shell.css');
  const radioRule = readCssRuleBlock(appShell, ".sort-mode-option input[type='radio']");
  const checkedRadioRule = readCssRuleBlock(
    appShell,
    ".sort-mode-option input[type='radio']:checked"
  );

  assert.match(radioRule, /appearance:\s*none/);
  assert.match(radioRule, /-webkit-appearance:\s*none/);
  assert.match(radioRule, /border:\s*2px solid var\(--primary-color\)/);
  assert.match(radioRule, /background:\s*var\(--bg-primary\)/);
  assert.doesNotMatch(radioRule, /accent-color/);
  assert.match(checkedRadioRule, /radial-gradient\(circle at center,\s*var\(--primary-color\)/);
  assert.match(checkedRadioRule, /var\(--bg-primary\)/);
});

test('sort mode defaults to low price and lists price options first', () => {
  const html = readProjectFile('src/renderer/index.html');
  const sortListMatch = html.match(
    /<div class="sort-mode-list" role="radiogroup" aria-label="排序方式">([\s\S]*?)<\/div>/
  );
  assert.ok(sortListMatch, 'sort mode list should exist');

  const values = [...sortListMatch[1].matchAll(/name="sortMode" value="([^"]+)"/g)].map(
    (match) => match[1]
  );

  assert.deepEqual(values, ['price_low', 'price_high', 'review_high', 'distance_near']);
  assert.match(sortListMatch[1], /value="price_low" checked/);
});

test('Esc returns from the AI assistant page to the hotel list', () => {
  const appModule = readProjectFile('src/renderer/app.module.js');

  assert.match(appModule, /function\s+isAiAssistantPageVisible\(\)/);
  assert.match(appModule, /\$\('aiAssistantPage'\)/);
  assert.match(
    appModule,
    /if\s*\(\s*isAiAssistantPageVisible\(\)\s*\)\s*{[\s\S]*?callAiAssistant\('closeAiAssistant'\)/
  );
});

test('AI assistant return button uses the dark primary action treatment', () => {
  const html = readProjectFile('src/renderer/index.html');
  const aiAssistantCss = readStyleFile('pages/ai-assistant.css');

  assert.match(
    html,
    /class="ai-ghost-button ai-return-button"[\s\S]*?data-action="close-ai-assistant"/
  );
  const returnButtonRule = readCssRuleBlock(aiAssistantCss, '.ai-return-button');
  assert.match(returnButtonRule, /color:\s*#fff/);
  assert.match(
    returnButtonRule,
    /background:\s*linear-gradient\(135deg,\s*var\(--primary-color\),\s*var\(--primary-hover\)\)/
  );
  assert.match(returnButtonRule, /border-color:\s*transparent/);
});

test('custom select menus use an opaque theme-safe background', () => {
  const customSelect = readStyleFile('components/custom-select.css');
  const menuRule = readCssRuleBlock(customSelect, '.custom-select-menu,\n.ai-template-picker-menu');

  assert.match(menuRule, /background:\s*var\(--bg-primary\)/);
  assert.doesNotMatch(menuRule, /background:\s*color-mix\([^;]*--bg-secondary/);
});

test('hotel edit form keeps dates after prices and ctrip star after score', () => {
  const html = readProjectFile('src/renderer/index.html');
  const totalIndex = html.indexOf('for="totalPrice"');
  const dailyIndex = html.indexOf('for="dailyPrice"');
  const checkInIndex = html.indexOf('for="checkInDate"');
  const checkOutIndex = html.indexOf('for="checkOutDate"');
  const scoreIndex = html.indexOf('for="ctripScore"');
  const starIndex = html.indexOf('for="ctripDiamondLevel"');

  assert.ok(totalIndex >= 0, 'total price field should exist');
  assert.ok(dailyIndex > totalIndex, 'daily price should follow total price');
  assert.ok(checkInIndex > dailyIndex, 'check-in date should follow daily price');
  assert.ok(checkOutIndex > checkInIndex, 'check-out date should follow check-in date');
  assert.ok(starIndex > scoreIndex, 'ctrip star level should follow ctrip score');
});

test('hotel and template room count selects support four people', () => {
  const html = readProjectFile('src/renderer/index.html');
  const hotelRoomCount = html.match(/<select id="roomCount"[\s\S]*?<\/select>/);
  const templateRoomCount = html.match(/<select id="templateRoomCount"[\s\S]*?<\/select>/);

  assert.ok(hotelRoomCount, 'hotel room count select should exist');
  assert.ok(templateRoomCount, 'template room count select should exist');
  assert.match(hotelRoomCount[0], /<option value="4">四人<\/option>/);
  assert.match(templateRoomCount[0], /<option value="4">四人<\/option>/);
});

test('rule delete protects favorite hotels by default in the modal UI', () => {
  const html = readProjectFile('src/renderer/index.html');
  const footerMatch = html.match(
    /<div class="modal-footer rule-delete-footer">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>\s*<\/template>/
  );

  assert.ok(footerMatch, 'rule delete footer should exist');
  assert.match(footerMatch[1], /<input type="checkbox" id="ruleDeleteProtectFavorite" checked \/>/);
  assert.ok(
    footerMatch[1].indexOf('ruleDeleteProtectFavorite') < footerMatch[1].indexOf('取消'),
    'favorite protection should be on the left before the cancel button'
  );
});

test('rule delete modal includes template deletion selector', () => {
  const html = readProjectFile('src/renderer/index.html');
  const modalMatch = html.match(
    /<template data-modal-template="ruleDeleteModal">([\s\S]*?)<\/template>/
  );

  assert.ok(modalMatch, 'rule delete modal should exist');
  assert.match(modalMatch[1], /<label for="ruleDeleteTemplate">选择模板删除<\/label>/);
  assert.match(
    modalMatch[1],
    /<select id="ruleDeleteTemplate" class="input" data-custom-select="true">/
  );
  assert.match(modalMatch[1], /<option value="">不按模板删除<\/option>/);
  assert.ok(
    modalMatch[1].indexOf('ruleDeleteTransportTime') <
      modalMatch[1].indexOf('ruleDeleteTemplate'),
    'template deletion selector should appear below threshold inputs'
  );
});

test('modal layering uses z-index tokens without inline overrides', () => {
  const modalCss = readStyleFile('components/modal-form.css');
  const uiUtils = readProjectFile('src/renderer/modules/ui-utils.js');

  assert.match(modalCss, /\.modal\s*{[\s\S]*z-index:\s*var\(--z-modal\)/);
  assert.doesNotMatch(uiUtils, /style\.zIndex\s*=/);
  assert.doesNotMatch(uiUtils, /['"]1000['"]/);
  assert.doesNotMatch(uiUtils, /['"]3001['"]/);
});

test('modal overlay does not draw a divider between header and main content', () => {
  const tokens = readStyleFile('tokens.css');
  const modalCss = readStyleFile('components/modal-form.css');
  const modalOverlay = readCssRuleBlock(modalCss, '.modal::before');

  assert.doesNotMatch(tokens, /--modal-divider-color\s*:/);
  assert.doesNotMatch(modalOverlay, /linear-gradient/);
  assert.doesNotMatch(modalOverlay, /--modal-divider-color/);
  assert.match(modalOverlay, /background:\s*rgba\(0,\s*0,\s*0,\s*0\.5\)/);
});

test('default app window width keeps hotel card grid at three columns', () => {
  const modalCss = readStyleFile('components/modal-form.css');
  const defaultWindowBreakpoint =
    /@media\s*\(max-width:\s*1400px\)\s*{\s*\.hotel-list\s*{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*1fr\)/;

  assert.doesNotMatch(modalCss, defaultWindowBreakpoint);
  assert.match(
    modalCss,
    /@media\s*\(max-width:\s*1180px\)\s*{[\s\S]*?\.hotel-list\s*{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*1fr\)/
  );
});

test('virtual hotel lists use native scrollbar gutters', () => {
  const appShell = readStyleFile('components/app-shell.css');
  const virtualScroll = readStyleFile('components/virtual-scroll.css');

  const contentArea = readCssRuleBlock(appShell, '.content-area');
  assert.match(contentArea, /--content-area-padding-x:\s*24px/);
  assert.match(contentArea, /--content-area-scrollbar-width:\s*8px/);
  assert.match(
    contentArea,
    /padding:\s*var\(--content-area-padding-y\)\s+var\(--content-area-padding-x\)/
  );

  const virtualCardScroll = readCssRuleBlock(virtualScroll, '.virtual-card-scroll {');
  assert.match(virtualCardScroll, /overflow-y:\s*auto/);
  assert.match(virtualCardScroll, /scrollbar-gutter:\s*stable/);

  const virtualListScroll = readCssRuleBlock(virtualScroll, '.virtual-list-scroll {');
  assert.match(virtualListScroll, /overflow-y:\s*auto/);
  assert.match(virtualListScroll, /scrollbar-gutter:\s*stable/);
});

test('virtual hotel lists do not define custom scrollbar DOM styles', () => {
  const virtualScroll = readStyleFile('components/virtual-scroll.css');

  const virtualCardItems = readCssRuleBlock(virtualScroll, '.virtual-card-items');
  assert.doesNotMatch(virtualCardItems, /padding-right/);
  assert.doesNotMatch(virtualScroll, /\.virtual-list-scroll\s+\.virtual-items\s*{/);
  assert.doesNotMatch(virtualScroll, /\.virtual-scroll-native-hidden/);
  assert.doesNotMatch(virtualScroll, /\.virtual-scrollbar/);
  assert.doesNotMatch(virtualScroll, /is-dragging-virtual-scrollbar/);
});

test('non-virtual hotel table body lets the content area own the page scrollbar', () => {
  const tableCss = readStyleFile('pages/hotel-table.css');
  const appShell = readStyleFile('components/app-shell.css');

  const tableBody = readCssRuleBlock(tableCss, '.hotel-table-body');
  assert.doesNotMatch(tableBody, /max-height/);
  assert.doesNotMatch(tableBody, /overflow-y:\s*auto/);

  const contentArea = readCssRuleBlock(appShell, '.content-area');
  assert.match(contentArea, /overflow-y:\s*auto/);
  assert.match(contentArea, /scrollbar-gutter:\s*stable/);
});

test('native scrollbar width stays on the content area contract', () => {
  const modalCss = readStyleFile('components/modal-form.css');
  const appShell = readStyleFile('components/app-shell.css');
  const nativeScrollbar = readCssRuleBlock(modalCss, '::-webkit-scrollbar');
  const contentArea = readCssRuleBlock(appShell, '.content-area');

  assert.match(nativeScrollbar, /width:\s*8px/);
  assert.match(contentArea, /--content-area-scrollbar-width:\s*8px/);
});

test('native scrollbar uses subdued default colors', () => {
  const modalCss = readStyleFile('components/modal-form.css');

  const nativeTrack = readCssRuleBlock(modalCss, '::-webkit-scrollbar-track');
  const nativeThumb = readCssRuleBlock(modalCss, '::-webkit-scrollbar-thumb');
  const nativeThumbHover = readCssRuleBlock(modalCss, '::-webkit-scrollbar-thumb:hover');

  assert.match(nativeTrack, /background:\s*var\(--bg-tertiary\)/);
  assert.match(nativeThumb, /background:\s*var\(--border-color\)/);
  assert.match(nativeThumbHover, /background:\s*var\(--text-tertiary\)/);
});

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
    this.values = new Set();
  }

  syncFromOwner() {
    this.values = new Set(
      String(this.owner.className || '')
        .split(/\s+/)
        .filter(Boolean)
    );
  }

  add(...names) {
    this.syncFromOwner();
    names.forEach((name) => this.values.add(name));
    this.owner.className = [...this.values].join(' ');
  }

  remove(...names) {
    this.syncFromOwner();
    names.forEach((name) => this.values.delete(name));
    this.owner.className = [...this.values].join(' ');
  }

  contains(name) {
    this.syncFromOwner();
    return this.values.has(name);
  }

  toggle(name, force) {
    this.syncFromOwner();
    const shouldAdd = force === undefined ? !this.values.has(name) : Boolean(force);
    if (shouldAdd) {
      this.values.add(name);
    } else {
      this.values.delete(name);
    }
    this.owner.className = [...this.values].join(' ');
    return shouldAdd;
  }
}

class FakeElement {
  constructor(tagName, ownerDocument = null) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.id = '';
    this.className = '';
    this.classList = new FakeClassList(this);
    this.textContent = '';
    this.eventListeners = new Map();
    this.removed = false;
    this.disabled = false;
    this.hidden = false;
    this.tabIndex = 0;
    this.style = {
      removeProperty(name) {
        delete this[name.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())];
      }
    };
  }

  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'id') {
      this.id = String(value);
    }
    if (name === 'tabindex') {
      this.tabIndex = Number(value);
    }
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(name, callback) {
    this.eventListeners.set(name, callback);
  }

  removeEventListener(name, callback) {
    if (!callback || this.eventListeners.get(name) === callback) {
      this.eventListeners.delete(name);
    }
  }

  dispatchEvent(event) {
    const callback = this.eventListeners.get(event.type);
    if (callback) callback(event);
  }

  focus() {
    if (this.ownerDocument) {
      this.ownerDocument.activeElement = this;
    }
  }

  select() {
    this.selected = true;
  }

  contains(node) {
    if (node === this) return true;
    return this.children.some((child) => child.contains?.(node));
  }

  remove() {
    this.removed = true;
  }

  querySelectorAll(selector) {
    const descendants = [];
    const walk = (node) => {
      node.children.forEach((child) => {
        descendants.push(child);
        walk(child);
      });
    };
    walk(this);

    if (selector.includes(',')) {
      return descendants.filter((child) => child.isFocusableCandidate?.());
    }
    if (selector === '.modal-header h2') {
      return descendants.filter(
        (child) =>
          child.tagName === 'H2' &&
          child.parentNode?.className.split(/\s+/).includes('modal-header')
      );
    }
    if (selector === '*') {
      return descendants;
    }
    if (selector.startsWith('.')) {
      const classes = selector.slice(1).split('.').filter(Boolean);
      return descendants.filter((child) =>
        classes.every((className) => child.className.split(/\s+/).includes(className))
      );
    }
    return descendants.filter((child) => child.tagName.toLowerCase() === selector);
  }

  querySelector(selector) {
    if (selector.startsWith('#')) {
      return this.querySelectorAll('*').find((child) => child.id === selector.slice(1)) || null;
    }
    return this.querySelectorAll(selector)[0] || null;
  }

  isFocusableCandidate() {
    if (this.disabled || this.hidden || this.getAttribute('aria-hidden') === 'true') return false;
    const focusableTags = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A']);
    if (focusableTags.has(this.tagName)) return true;
    return this.getAttribute('tabindex') !== null && this.tabIndex >= 0;
  }
}

class FakeDocument {
  constructor() {
    this.body = new FakeElement('body', this);
    this.activeElement = this.body;
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }

  getElementById(id) {
    return this.body.querySelectorAll('*').find((child) => child.id === id) || null;
  }

  querySelector(selector) {
    if (selector === '.modal.active') {
      return (
        this.body
          .querySelectorAll('.modal')
          .find((modal) => modal.className.split(/\s+/).includes('active')) || null
      );
    }
    return this.body.querySelector(selector);
  }
}

async function loadUiUtilsModule() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-ui-utils-'));
  const sourceDir = path.join(projectRoot, 'src', 'renderer', 'modules');
  fs.writeFileSync(path.join(tempRoot, 'package.json'), '{"type":"module"}\n', 'utf-8');
  [
    'dom-helpers.js',
    'modal-templates.js',
    'render-scheduler.js',
    'state.js',
    'ui-utils.js'
  ].forEach((fileName) => {
    fs.copyFileSync(path.join(sourceDir, fileName), path.join(tempRoot, fileName));
  });

  const moduleUrl = pathToFileURL(path.join(tempRoot, 'ui-utils.js')).href;
  const module = await import(moduleUrl);
  fs.rmSync(tempRoot, { recursive: true, force: true });
  return module;
}

function createModalFixture(document) {
  const trigger = document.createElement('button');
  trigger.id = 'openSettings';

  const modal = document.createElement('div');
  modal.id = 'settingsModal';
  modal.className = 'modal';

  const content = document.createElement('div');
  content.className = 'modal-content';

  const header = document.createElement('div');
  header.className = 'modal-header';

  const title = document.createElement('h2');
  title.textContent = '设置';

  const closeButton = document.createElement('button');
  closeButton.className = 'modal-close';

  const input = document.createElement('input');
  input.id = 'settingsInput';

  header.appendChild(title);
  header.appendChild(closeButton);
  content.appendChild(header);
  content.appendChild(input);
  modal.appendChild(content);
  document.body.appendChild(trigger);
  document.body.appendChild(modal);
  trigger.focus();

  return { trigger, modal, content, title, closeButton, input };
}

async function loadNotificationModule() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-notification-'));
  fs.writeFileSync(path.join(tempRoot, 'package.json'), '{"type":"module"}\n', 'utf-8');
  fs.copyFileSync(
    path.join(projectRoot, 'src', 'renderer', 'modules', 'notification.js'),
    path.join(tempRoot, 'notification.js')
  );

  const moduleUrl = pathToFileURL(path.join(tempRoot, 'notification.js')).href;
  const module = await import(moduleUrl);
  fs.rmSync(tempRoot, { recursive: true, force: true });
  return module;
}

async function loadDomHelpersModule() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-dom-helpers-'));
  fs.writeFileSync(path.join(tempRoot, 'package.json'), '{"type":"module"}\n', 'utf-8');
  fs.copyFileSync(
    path.join(projectRoot, 'src', 'renderer', 'modules', 'dom-helpers.js'),
    path.join(tempRoot, 'dom-helpers.js')
  );

  const moduleUrl = pathToFileURL(path.join(tempRoot, 'dom-helpers.js')).href;
  const module = await import(moduleUrl);
  fs.rmSync(tempRoot, { recursive: true, force: true });
  return module;
}

test('modal activation applies dialog semantics traps focus and restores the trigger', async (t) => {
  const originalDocument = global.document;
  const originalWindow = global.window;
  const originalRequestAnimationFrame = global.requestAnimationFrame;
  const originalSetTimeout = global.setTimeout;
  const fakeDocument = new FakeDocument();
  const { trigger, modal, content, title, closeButton, input } = createModalFixture(fakeDocument);

  global.document = fakeDocument;
  global.window = { setTimeout: global.setTimeout, clearTimeout: global.clearTimeout };
  global.requestAnimationFrame = (callback) => callback();
  global.setTimeout = (callback) => {
    callback();
    return 1;
  };
  t.after(() => {
    global.document = originalDocument;
    global.window = originalWindow;
    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.setTimeout = originalSetTimeout;
  });

  const { setModalActive } = await loadUiUtilsModule();
  setModalActive('settingsModal', true);

  assert.equal(modal.getAttribute('role'), 'dialog');
  assert.equal(modal.getAttribute('aria-modal'), 'true');
  assert.equal(modal.getAttribute('aria-labelledby'), title.id);
  assert.equal(content.getAttribute('tabindex'), '-1');
  assert.equal(modal.style.display, 'flex');
  assert.equal(modal.style.zIndex, undefined);
  assert.equal(fakeDocument.activeElement, closeButton);

  input.focus();
  let prevented = false;
  modal.dispatchEvent({
    type: 'keydown',
    key: 'Tab',
    shiftKey: false,
    preventDefault() {
      prevented = true;
    }
  });
  assert.equal(prevented, true);
  assert.equal(fakeDocument.activeElement, closeButton);

  prevented = false;
  modal.dispatchEvent({
    type: 'keydown',
    key: 'Tab',
    shiftKey: true,
    preventDefault() {
      prevented = true;
    }
  });
  assert.equal(prevented, true);
  assert.equal(fakeDocument.activeElement, input);

  setModalActive('settingsModal', false);
  assert.equal(fakeDocument.activeElement, trigger);
  assert.equal(modal.eventListeners.has('keydown'), false);
});

test('notifications expose status semantics and a close control', async (t) => {
  const originalDocument = global.document;
  const originalWindow = global.window;
  const appended = [];
  const timeouts = [];

  global.document = {
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    body: {
      appendChild(element) {
        appended.push(element);
        return element;
      }
    }
  };
  global.window = {
    setTimeout(callback, delay) {
      timeouts.push({ callback, delay });
      return timeouts.length;
    },
    clearTimeout() {}
  };
  t.after(() => {
    global.document = originalDocument;
    global.window = originalWindow;
  });

  const { showNotification } = await loadNotificationModule();
  showNotification('保存失败', 'error');

  assert.equal(appended.length, 1);
  const notification = appended[0];
  assert.equal(notification.getAttribute('role'), 'alert');
  assert.equal(notification.getAttribute('aria-live'), 'assertive');
  assert.equal(notification.querySelector('.notification-message').textContent, '保存失败');

  const closeButton = notification.querySelector('button');
  assert.ok(closeButton, 'notification should include a close button');
  assert.equal(closeButton.getAttribute('aria-label'), '关闭通知');
});

test('escapeHtml preserves numeric zero while escaping markup', async (t) => {
  const originalDocument = global.document;
  global.document = {
    createElement() {
      return {
        innerHTML: '',
        set textContent(value) {
          this.innerHTML = String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        }
      };
    }
  };
  t.after(() => {
    global.document = originalDocument;
  });

  const { escapeHtml } = await loadDomHelpersModule();

  assert.equal(escapeHtml(0), '0');
  assert.equal(escapeHtml('<b>&</b>'), '&lt;b&gt;&amp;&lt;/b&gt;');
  assert.equal(escapeHtml(null), '');
});
