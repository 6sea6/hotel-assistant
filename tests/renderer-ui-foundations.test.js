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
    readStyleFile('components/app-shell.css'),
    readStyleFile('components/custom-select.css'),
    readStyleFile('components/modal-form.css'),
    readStyleFile('components/notifications.css'),
    readStyleFile('components/view-controls.css')
  ].join('\n');

  assert.match(css, /:focus-visible/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
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

test('modal layering uses z-index tokens without inline overrides', () => {
  const modalCss = readStyleFile('components/modal-form.css');
  const uiUtils = readProjectFile('src/renderer/modules/ui-utils.js');

  assert.match(modalCss, /\.modal\s*{[\s\S]*z-index:\s*var\(--z-modal\)/);
  assert.doesNotMatch(uiUtils, /style\.zIndex\s*=/);
  assert.doesNotMatch(uiUtils, /['"]1000['"]/);
  assert.doesNotMatch(uiUtils, /['"]3001['"]/);
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
