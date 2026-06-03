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

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
    this.values = new Set();
  }

  add(...names) {
    names.forEach((name) => this.values.add(name));
    this.owner.className = [...this.values].join(' ');
  }

  remove(...names) {
    names.forEach((name) => this.values.delete(name));
    this.owner.className = [...this.values].join(' ');
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.className = '';
    this.classList = new FakeClassList(this);
    this.textContent = '';
    this.eventListeners = new Map();
    this.removed = false;
  }

  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  addEventListener(name, callback) {
    this.eventListeners.set(name, callback);
  }

  remove() {
    this.removed = true;
  }

  querySelector(selector) {
    if (selector.startsWith('.')) {
      const className = selector.slice(1);
      return (
        this.children.find((child) => child.className.split(/\s+/).includes(className)) || null
      );
    }
    return this.children.find((child) => child.tagName.toLowerCase() === selector) || null;
  }
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
