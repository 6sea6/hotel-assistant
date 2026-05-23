const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let customSelectModuleUrl = '';

async function loadCustomSelectModule() {
  if (!customSelectModuleUrl) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-custom-select-'));
    const sourceDir = path.join(__dirname, '..', 'src', 'renderer', 'modules');
    fs.writeFileSync(path.join(tempRoot, 'package.json'), '{"type":"module"}\n', 'utf-8');
    fs.copyFileSync(
      path.join(sourceDir, 'custom-select.js'),
      path.join(tempRoot, 'custom-select.js')
    );
    customSelectModuleUrl = pathToFileURL(path.join(tempRoot, 'custom-select.js')).href;
    process.on('exit', () => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
  }

  return import(customSelectModuleUrl);
}

function createMockSelect(id, options = [], attrs = {}) {
  const listeners = {};
  const select = {
    id,
    value: options.length ? options[0].value : '',
    disabled: false,
    multiple: false,
    size: 0,
    dataset: { ...attrs },
    selectedIndex: 0,
    options: options.map((opt, i) => ({
      value: opt.value,
      textContent: opt.text,
      disabled: opt.disabled || false,
    })),
    selectedOptions: options.length ? [options[0]] : [],
    classList: {
      _classes: new Set(),
      add(cls) { this._classes.add(cls); },
      remove(cls) { this._classes.delete(cls); },
      contains(cls) { return this._classes.has(cls); },
    },
    parentNode: {
      insertBefore(child, ref) {
        child.parentNode = this;
        return child;
      },
    },
    addEventListener(event, fn) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    },
    removeEventListener(event, fn) {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((f) => f !== fn);
      }
    },
    dispatchEvent(event) {
      (listeners[event.type] || []).forEach((fn) => fn(event));
    },
    _listeners: listeners,
  };
  return select;
}

function createMockElement(tagName = 'div') {
  const children = [];
  const listeners = {};
  const classList = {
    _classes: new Set(),
    add(cls) { this._classes.add(cls); },
    remove(cls) { this._classes.delete(cls); },
    contains(cls) { return this._classes.has(cls); },
    toggle(cls, force) {
      if (force === undefined) {
        if (this._classes.has(cls)) this._classes.delete(cls);
        else this._classes.add(cls);
      } else {
        if (force) this._classes.add(cls);
        else this._classes.delete(cls);
      }
    },
  };
  let hiddenValue = false;
  let innerHTMLValue = '';

  const el = {
    tagName: tagName.toUpperCase(),
    id: '',
    className: '',
    type: '',
    disabled: false,
    dataset: {},
    classList,
    parentNode: null,
    children,
    style: {},
    _listeners: listeners,
    textContent: '',
    get hidden() { return hiddenValue; },
    set hidden(v) { hiddenValue = v; },
    get innerHTML() { return innerHTMLValue; },
    set innerHTML(v) {
      innerHTMLValue = v;
      children.length = 0;
    },
    setAttribute(key, val) {
      if (key === 'aria-haspopup') this._ariaHaspopup = val;
      if (key === 'aria-expanded') this._ariaExpanded = val;
      if (key === 'aria-selected') this._ariaSelected = val;
      if (key === 'aria-disabled') this._ariaDisabled = val;
      if (key === 'role') this._role = val;
    },
    getAttribute(key) {
      if (key === 'aria-haspopup') return this._ariaHaspopup || null;
      if (key === 'aria-expanded') return this._ariaExpanded || null;
      if (key === 'aria-selected') return this._ariaSelected || null;
      if (key === 'aria-disabled') return this._ariaDisabled || null;
      return null;
    },
    hasAttribute(key) {
      return key === 'aria-haspopup' ? !!this._ariaHaspopup
        : key === 'aria-expanded' ? !!this._ariaExpanded
        : false;
    },
    appendChild(child) {
      children.push(child);
      child.parentNode = this;
      return child;
    },
    insertBefore(child, ref) {
      const idx = children.indexOf(ref);
      if (idx >= 0) children.splice(idx, 0, child);
      else children.push(child);
      child.parentNode = this;
      return child;
    },
    removeChild(child) {
      const idx = children.indexOf(child);
      if (idx >= 0) children.splice(idx, 1);
      child.parentNode = null;
      return child;
    },
    addEventListener(event, fn) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    },
    removeEventListener(event, fn) {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((f) => f !== fn);
      }
    },
    querySelector(sel) {
      // Simple mock: find child with matching class or data attr
      for (const child of children) {
        if (sel.startsWith('[data-custom-select-option') && child.dataset?.customSelectOption === 'true') {
          return child;
        }
        if (sel.includes('is-active') && child.dataset?.customSelectOption === 'true' && child.classList?._classes?.has('is-active')) {
          return child;
        }
        if (child.classList && child.className && sel.startsWith('.') && child.classList.contains(sel.slice(1))) {
          return child;
        }
      }
      return null;
    },
    querySelectorAll(sel) {
      const results = [];
      if (sel.startsWith('[data-custom-select-option')) {
        for (const child of children) {
          if (child.dataset?.customSelectOption === 'true') results.push(child);
        }
      }
      return results;
    },
    closest(sel) {
      if (sel === '[data-custom-select-option="true"]') {
        return this.dataset?.customSelectOption === 'true' ? this : null;
      }
      return null;
    },
    focus() {},
    scrollIntoView() {},
    getBoundingClientRect() {
      return { top: 100, left: 100, bottom: 140, right: 300, width: 200, height: 40 };
    },
  };
  return el;
}

function installMockDom() {
  const elements = new Map();

  // Mock MutationObserver
  class MockMutationObserver {
    constructor(callback) {
      this._callback = callback;
      this._target = null;
    }
    observe(target) { this._target = target; }
    disconnect() {}
    takeRecords() { return []; }
  }

  const mockDocument = {
    elements,
    getElementById(id) { return elements.get(id) || null; },
    querySelectorAll() { return []; },
    createElement(tag) { return createMockElement(tag); },
    addEventListener() {},
    removeEventListener() {},
  };
  const mockWindow = {
    innerHeight: 800,
    innerWidth: 1200,
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame(cb) { return setTimeout(cb, 0); },
    cancelAnimationFrame(id) { clearTimeout(id); },
    queueMicrotask(cb) { queueMicrotask(cb); },
  };

  global.document = mockDocument;
  global.window = mockWindow;
  global.requestAnimationFrame = mockWindow.requestAnimationFrame;
  global.cancelAnimationFrame = mockWindow.cancelAnimationFrame;
  global.queueMicrotask = queueMicrotask;
  global.MutationObserver = MockMutationObserver;

  return { elements, mockDocument, mockWindow };
}

/* ============================================================
 * 测试
 * ============================================================ */

test('custom-select: data-custom-select-option attribute is added to each option button', async () => {
  installMockDom();
  const { enhanceCustomSelect } = await loadCustomSelectModule();

  const select = createMockSelect('testSelect', [
    { value: 'a', text: 'Option A' },
    { value: 'b', text: 'Option B' },
  ]);
  document.elements.set('testSelect', select);

  const wrapper = createMockElement('div');
  const button = createMockElement('button');
  const textSpan = createMockElement('span');
  const menu = createMockElement('div');
  wrapper.appendChild(button);
  button.appendChild(textSpan);
  wrapper.appendChild(menu);

  const ctx = enhanceCustomSelect(select, {
    existingElements: { wrapper, button, textSpan, menu },
  });

  assert.ok(ctx, 'ctx should be returned');
  // The menu should have option children with data-custom-select-option
  const options = menu.querySelectorAll('[data-custom-select-option="true"]');
  assert.equal(options.length, 2, 'should have 2 option buttons with data attribute');
  assert.equal(options[0].dataset.value, 'a');
  assert.equal(options[1].dataset.value, 'b');
  assert.equal(options[0].textContent, 'Option A');
});

test('custom-select: optionClass with multiple classes still works via data selector', async () => {
  installMockDom();
  const { enhanceCustomSelect } = await loadCustomSelectModule();

  const select = createMockSelect('testSelect', [
    { value: 'x', text: 'X' },
    { value: 'y', text: 'Y' },
  ]);
  document.elements.set('testSelect', select);

  const wrapper = createMockElement('div');
  const button = createMockElement('button');
  const textSpan = createMockElement('span');
  const menu = createMockElement('div');
  wrapper.appendChild(button);
  button.appendChild(textSpan);
  wrapper.appendChild(menu);

  // Use multi-class optionClass
  const ctx = enhanceCustomSelect(select, {
    optionClass: 'my-custom-option fancy-style',
    existingElements: { wrapper, button, textSpan, menu },
  });

  assert.ok(ctx);
  const options = menu.querySelectorAll('[data-custom-select-option="true"]');
  assert.equal(options.length, 2);
  // Each button should have the full className
  assert.equal(options[0].className, 'my-custom-option fancy-style');
});

test('custom-select: selected option has is-selected class', async () => {
  installMockDom();
  const { enhanceCustomSelect } = await loadCustomSelectModule();

  const select = createMockSelect('testSelect', [
    { value: 'a', text: 'A' },
    { value: 'b', text: 'B' },
  ]);
  select.value = 'b';
  select.selectedIndex = 1;
  select.selectedOptions = [select.options[1]];
  document.elements.set('testSelect', select);

  const wrapper = createMockElement('div');
  const button = createMockElement('button');
  const textSpan = createMockElement('span');
  const menu = createMockElement('div');
  wrapper.appendChild(button);
  button.appendChild(textSpan);
  wrapper.appendChild(menu);

  const ctx = enhanceCustomSelect(select, {
    existingElements: { wrapper, button, textSpan, menu },
  });

  assert.ok(ctx);
  const options = menu.querySelectorAll('[data-custom-select-option="true"]');
  assert.equal(options[0].classList.contains('is-selected'), false, 'first option should not be selected');
  assert.equal(options[1].classList.contains('is-selected'), true, 'second option should be selected');
  assert.equal(options[1].getAttribute('aria-selected'), 'true');
});

test('custom-select: aiTemplateSelect excluded from auto but works with manual enhance', async () => {
  installMockDom();
  const { enhanceCustomSelect, getCustomSelectInstance, destroyCustomSelect } = await loadCustomSelectModule();

  const select = createMockSelect('aiTemplateSelect', [
    { value: 't1', text: 'Template 1' },
  ], { customSelect: 'false', customSelectAuto: 'false' });
  document.elements.set('aiTemplateSelect', select);

  const wrapper = createMockElement('div');
  wrapper.id = 'aiTemplatePicker';
  const button = createMockElement('button');
  const textSpan = createMockElement('span');
  const menu = createMockElement('div');
  wrapper.appendChild(button);
  button.appendChild(textSpan);
  wrapper.appendChild(menu);

  // Manual enhance should still work despite data-custom-select="false"
  const ctx = enhanceCustomSelect(select, {
    existingElements: { wrapper, button, textSpan, menu },
  });

  assert.ok(ctx, 'manual enhance should work for aiTemplateSelect');
  assert.equal(getCustomSelectInstance(select), ctx);
});

test('custom-select: destroyCustomSelect cleans up events and removes instance', async () => {
  installMockDom();
  const { enhanceCustomSelect, destroyCustomSelect, getCustomSelectInstance } = await loadCustomSelectModule();

  const select = createMockSelect('testSelect', [
    { value: 'a', text: 'A' },
  ]);
  document.elements.set('testSelect', select);

  const wrapper = createMockElement('div');
  const button = createMockElement('button');
  const textSpan = createMockElement('span');
  const menu = createMockElement('div');
  wrapper.appendChild(button);
  button.appendChild(textSpan);
  wrapper.appendChild(menu);

  enhanceCustomSelect(select, {
    existingElements: { wrapper, button, textSpan, menu },
  });

  assert.ok(getCustomSelectInstance(select), 'instance should exist before destroy');

  destroyCustomSelect(select);

  assert.equal(getCustomSelectInstance(select), null, 'instance should be removed after destroy');
  assert.equal(select.dataset.customSelectReady, undefined, 'ready attr should be removed');
  assert.equal(select.classList.contains('custom-select-native'), false, 'native class should be removed');
  // Menu should be cleared for existingElements path
  assert.equal(menu.innerHTML, '', 'menu innerHTML should be cleared');
  assert.equal(menu.hidden, true, 'menu should be hidden');
});

test('custom-select: destroyCustomSelect with ownsWrapper removes wrapper from DOM', async () => {
  installMockDom();
  const { enhanceCustomSelect, destroyCustomSelect, getCustomSelectInstance } = await loadCustomSelectModule();

  const select = createMockSelect('testSelect', [
    { value: 'a', text: 'A' },
  ]);
  const parent = createMockElement('div');
  parent.appendChild(select);
  document.elements.set('testSelect', select);

  // No existingElements => ownsWrapper = true
  enhanceCustomSelect(select);

  const ctx = getCustomSelectInstance(select);
  assert.ok(ctx);
  assert.ok(ctx.ownsWrapper, 'should own wrapper');
  assert.ok(ctx.wrapper.parentNode, 'wrapper should be in DOM');

  destroyCustomSelect(select);

  assert.equal(getCustomSelectInstance(select), null);
});

test('custom-select: destroy during scheduled rebuild does not throw', async () => {
  installMockDom();
  const { enhanceCustomSelect, destroyCustomSelect, getCustomSelectInstance } = await loadCustomSelectModule();

  const select = createMockSelect('testSelect', [
    { value: 'a', text: 'A' },
  ]);
  document.elements.set('testSelect', select);

  const wrapper = createMockElement('div');
  const button = createMockElement('button');
  const textSpan = createMockElement('span');
  const menu = createMockElement('div');
  wrapper.appendChild(button);
  button.appendChild(textSpan);
  wrapper.appendChild(menu);

  const ctx = enhanceCustomSelect(select, {
    existingElements: { wrapper, button, textSpan, menu },
  });
  assert.ok(ctx);

  // Simulate a scheduled rebuild
  ctx._rebuildScheduled = true;

  // Destroy should not throw
  assert.doesNotThrow(() => {
    destroyCustomSelect(select);
  });
  assert.equal(getCustomSelectInstance(select), null);
});

test('custom-select: clearStaleReadyState allows re-enhancement', async () => {
  installMockDom();
  const { enhanceCustomSelect, getCustomSelectInstance } = await loadCustomSelectModule();

  const select = createMockSelect('testSelect', [
    { value: 'a', text: 'A' },
  ]);
  select.dataset.customSelectReady = 'true'; // stale ready
  document.elements.set('testSelect', select);

  // Should not return existing instance (since there is none in WeakMap)
  const ctx = enhanceCustomSelect(select);
  assert.ok(ctx, 'should re-enhance stale select');
  assert.ok(select.dataset.customSelectReady === 'true', 'ready attr should be set again');
});

test('custom-select: openMenu positions menu then sets active index', async () => {
  installMockDom();
  const { enhanceCustomSelect, getCustomSelectInstance } = await loadCustomSelectModule();

  const select = createMockSelect('testSelect', [
    { value: 'a', text: 'A' },
    { value: 'b', text: 'B' },
    { value: 'c', text: 'C' },
  ]);
  select.value = 'b';
  select.selectedIndex = 1;
  select.selectedOptions = [select.options[1]];
  document.elements.set('testSelect', select);

  const wrapper = createMockElement('div');
  const button = createMockElement('button');
  const textSpan = createMockElement('span');
  const menu = createMockElement('div');
  wrapper.appendChild(button);
  button.appendChild(textSpan);
  wrapper.appendChild(menu);
  // Mock scrollHeight to be large enough to require scrolling
  Object.defineProperty(menu, 'scrollHeight', { value: 2000, configurable: true });

  enhanceCustomSelect(select, {
    existingElements: { wrapper, button, textSpan, menu },
  });

  const ctx = getCustomSelectInstance(select);
  assert.ok(ctx);

  // Simulate openMenu by calling the button click handler
  button._listeners['click'][0]({ preventDefault() {} });

  // After open, menuScrollable should be set based on positionMenu result
  // Since scrollHeight (2000) > space below (~660), it should be scrollable
  assert.equal(ctx.menuScrollable, true, 'menu should be scrollable for tall menu');
  assert.equal(menu.hidden, false, 'menu should be visible');
});

test('custom-select: refreshCustomSelect on data-custom-select="false" select still works', async () => {
  installMockDom();
  const { enhanceCustomSelect, refreshCustomSelect, getCustomSelectInstance } = await loadCustomSelectModule();

  const select = createMockSelect('testSelect', [
    { value: 'a', text: 'A' },
  ], { customSelect: 'false' });
  document.elements.set('testSelect', select);

  const wrapper = createMockElement('div');
  const button = createMockElement('button');
  const textSpan = createMockElement('span');
  const menu = createMockElement('div');
  wrapper.appendChild(button);
  button.appendChild(textSpan);
  wrapper.appendChild(menu);

  // Manually enhance
  enhanceCustomSelect(select, {
    existingElements: { wrapper, button, textSpan, menu },
  });

  assert.ok(getCustomSelectInstance(select));

  // Add a new option to the select
  select.options.push({ value: 'new', text: 'New Option', disabled: false });
  select.value = 'new';
  select.selectedOptions = [select.options[1]];

  // refreshCustomSelect should rebuild the menu
  refreshCustomSelect(select);

  const ctx = getCustomSelectInstance(select);
  assert.ok(ctx);
  const options = menu.querySelectorAll('[data-custom-select-option="true"]');
  assert.equal(options.length, 2, 'should have rebuilt with 2 options');
});

test('custom-select: is-selected class preserved after syncSelectedOption', async () => {
  installMockDom();
  const { enhanceCustomSelect, getCustomSelectInstance } = await loadCustomSelectModule();

  const select = createMockSelect('testSelect', [
    { value: 'a', text: 'A' },
    { value: 'b', text: 'B' },
  ]);
  document.elements.set('testSelect', select);

  const wrapper = createMockElement('div');
  const button = createMockElement('button');
  const textSpan = createMockElement('span');
  const menu = createMockElement('div');
  wrapper.appendChild(button);
  button.appendChild(textSpan);
  wrapper.appendChild(menu);

  enhanceCustomSelect(select, {
    existingElements: { wrapper, button, textSpan, menu },
  });

  const ctx = getCustomSelectInstance(select);
  assert.ok(ctx);

  let options = menu.querySelectorAll('[data-custom-select-option="true"]');
  assert.equal(options[0].classList.contains('is-selected'), true, 'first option should be selected initially');
  assert.equal(options[1].classList.contains('is-selected'), false, 'second should not be selected');

  // Change select value and trigger change event
  select.value = 'b';
  select.selectedOptions = [select.options[1]];
  select.dispatchEvent(new Event('change'));

  options = menu.querySelectorAll('[data-custom-select-option="true"]');
  assert.equal(options[0].classList.contains('is-selected'), false, 'first should no longer be selected');
  assert.equal(options[1].classList.contains('is-selected'), true, 'second should now be selected');
});

test('custom-select: aiTemplateSelect not found by findTargetSelects in auto mode', async () => {
  installMockDom();
  const { setupCustomSelects, getCustomSelectInstance } = await loadCustomSelectModule();

  // Simulate aiTemplateSelect with data-custom-select-auto="false"
  const aiSelect = createMockSelect('aiTemplateSelect', [
    { value: 't1', text: 'T1' },
  ], { customSelect: 'false', customSelectAuto: 'false' });

  // Simulate a normal select with class "input"
  const normalSelect = createMockSelect('normalSelect', [
    { value: 'n1', text: 'N1' },
  ]);
  normalSelect.className = 'input';

  document.elements = new Map();
  document.elements.set('aiTemplateSelect', aiSelect);
  document.elements.set('normalSelect', normalSelect);

  // Override querySelectorAll for this test
  const origQsa = document.querySelectorAll;
  document.querySelectorAll = function (selector) {
    if (selector.includes('select.input')) {
      return [aiSelect, normalSelect];
    }
    return [];
  };

  setupCustomSelects(document, { auto: true });

  // aiTemplateSelect should NOT be enhanced
  assert.equal(getCustomSelectInstance(aiSelect), null, 'aiTemplateSelect should not be auto-enhanced');

  document.querySelectorAll = origQsa;
});

test('custom-select: data-custom-select-option used in keyboard navigation', async () => {
  installMockDom();
  const { enhanceCustomSelect, getCustomSelectInstance } = await loadCustomSelectModule();

  const select = createMockSelect('testSelect', [
    { value: 'a', text: 'A' },
    { value: 'b', text: 'B' },
    { value: 'c', text: 'C' },
  ]);
  document.elements.set('testSelect', select);

  const wrapper = createMockElement('div');
  const button = createMockElement('button');
  const textSpan = createMockElement('span');
  const menu = createMockElement('div');
  wrapper.appendChild(button);
  button.appendChild(textSpan);
  wrapper.appendChild(menu);

  enhanceCustomSelect(select, {
    existingElements: { wrapper, button, textSpan, menu },
  });

  const ctx = getCustomSelectInstance(select);
  assert.ok(ctx);

  // Open menu
  button._listeners['click'][0]({ preventDefault() {} });

  // Simulate ArrowDown key
  menu._listeners['keydown'][0]({
    key: 'ArrowDown',
    preventDefault() {},
  });

  assert.equal(ctx.activeIndex, 1, 'activeIndex should move to 1 after ArrowDown');

  // The active option should have is-active class via data selector
  const options = menu.querySelectorAll('[data-custom-select-option="true"]');
  assert.equal(options[1].classList.contains('is-active'), true, 'second option should have is-active');
});

test('custom-select: setupCustomSelects can recover stale ready state', async () => {
  installMockDom();
  const { setupCustomSelects, getCustomSelectInstance } = await loadCustomSelectModule();

  const select = createMockSelect('staleSelect', [
    { value: 'a', text: 'A' },
  ]);
  // Simulate stale ready: dataset says ready, class says native, but no WeakMap instance
  select.dataset.customSelectReady = 'true';
  select.classList.add('custom-select-native');
  document.elements.set('staleSelect', select);

  // Override querySelectorAll to return this select for data-custom-select selector
  const origQsa = document.querySelectorAll;
  document.querySelectorAll = function (selector) {
    if (selector.includes('data-custom-select')) {
      return [select];
    }
    return [];
  };

  setupCustomSelects(document, { auto: true });

  assert.ok(getCustomSelectInstance(select), 'stale select should be re-enhanced');
  assert.equal(select.dataset.customSelectReady, 'true', 'ready attr should be set again');

  document.querySelectorAll = origQsa;
});

test('custom-select: refreshCustomSelects auto enhances newly inserted select.input', async () => {
  installMockDom();
  const { refreshCustomSelects, getCustomSelectInstance } = await loadCustomSelectModule();

  const select = createMockSelect('newSelect', [
    { value: 'x', text: 'X' },
    { value: 'y', text: 'Y' },
  ]);
  select.classList.add('input');
  // No data-custom-select, no ready, no native class — just a plain select.input
  document.elements.set('newSelect', select);

  const origQsa = document.querySelectorAll;
  document.querySelectorAll = function (selector) {
    // Handle comma-separated selectors
    const parts = selector.split(',').map(s => s.trim());
    const results = [];
    for (const part of parts) {
      if (part.includes('select.input')) {
        results.push(select);
      }
    }
    return results;
  };

  refreshCustomSelects(document, { auto: true });

  assert.ok(getCustomSelectInstance(select), 'new select.input should be enhanced by refreshCustomSelects auto');
  assert.equal(select.dataset.customSelectReady, 'true', 'ready attr should be set');

  document.querySelectorAll = origQsa;
});

test('custom-select: refreshCustomSelect with auto option enhances single select.input', async () => {
  installMockDom();
  const { refreshCustomSelect, getCustomSelectInstance } = await loadCustomSelectModule();

  const select = createMockSelect('singleNew', [
    { value: 'p', text: 'P' },
  ]);
  select.classList.add('input');
  document.elements.set('singleNew', select);

  refreshCustomSelect(select, { auto: true });

  assert.ok(getCustomSelectInstance(select), 'select.input should be enhanced by refreshCustomSelect with auto');
});

test('custom-select: refreshCustomSelects auto still excludes aiTemplateSelect', async () => {
  installMockDom();
  const { refreshCustomSelects, getCustomSelectInstance } = await loadCustomSelectModule();

  const aiSelect = createMockSelect('aiTemplateSelect', [
    { value: 't1', text: 'T1' },
  ], { customSelect: 'false', customSelectAuto: 'false' });
  aiSelect.className = 'input ai-template-select';

  const normalSelect = createMockSelect('normalSel', [
    { value: 'n', text: 'N' },
  ], { customSelect: 'true' });

  const origQsa = document.querySelectorAll;
  document.querySelectorAll = function (selector) {
    if (selector.includes('select.input') || selector.includes('data-custom-select')) {
      return [aiSelect, normalSelect];
    }
    return [];
  };

  refreshCustomSelects(document, { auto: true });

  assert.equal(getCustomSelectInstance(aiSelect), null, 'aiTemplateSelect should still be excluded');

  document.querySelectorAll = origQsa;
});

test('custom-select: openMenu uses getAnimationFrame fallback when requestAnimationFrame missing', async () => {
  installMockDom();
  const { enhanceCustomSelect, getCustomSelectInstance } = await loadCustomSelectModule();

  // Remove global requestAnimationFrame to simulate test/env edge
  const origRaf = global.requestAnimationFrame;
  delete global.requestAnimationFrame;

  const select = createMockSelect('rafTest', [
    { value: 'a', text: 'A' },
  ]);
  document.elements.set('rafTest', select);

  const wrapper = createMockElement('div');
  const button = createMockElement('button');
  const textSpan = createMockElement('span');
  const menu = createMockElement('div');
  wrapper.appendChild(button);
  button.appendChild(textSpan);
  wrapper.appendChild(menu);

  enhanceCustomSelect(select, {
    existingElements: { wrapper, button, textSpan, menu },
  });

  const ctx = getCustomSelectInstance(select);
  assert.ok(ctx);

  // openMenu should not throw even without requestAnimationFrame
  assert.doesNotThrow(() => {
    button._listeners['click'][0]({ preventDefault() {} });
  }, 'openMenu should work with getAnimationFrame fallback');

  assert.equal(menu.hidden, false, 'menu should be visible');

  // Restore
  global.requestAnimationFrame = origRaf;
});
