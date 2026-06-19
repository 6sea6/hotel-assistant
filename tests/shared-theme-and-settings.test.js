const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

test('shared theme config normalizes aliases and exposes window colors', () => {
  const {
    getThemeTitleBarColor,
    getThemeTitleBarSymbolColor,
    getThemeWindowBackground,
    normalizeThemeKey
  } = require('../src/shared/theme-config');

  assert.equal(normalizeThemeKey('light'), 'cloud-white');
  assert.equal(normalizeThemeKey('changing-mode'), 'colorful-mode');
  assert.equal(normalizeThemeKey('unknown-theme', 'totoro-blue'), 'totoro-blue');
  assert.equal(getThemeWindowBackground('oak-brown'), '#F8F0E9');
  assert.equal(getThemeTitleBarColor('grape-purple'), '#8A73D1');
  assert.equal(getThemeTitleBarSymbolColor('cloud-white'), '#5A5F66');
});

test('theme alias maps are defined only in the shared theme module', () => {
  const files = [
    'src/main/window-manager.js',
    'src/main/ipc-handlers/settings-handlers.js',
    'src/renderer/modules/personalization-ui.js'
  ];

  for (const relativePath of files) {
    const source = fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
    assert.doesNotMatch(source, /THEME_ALIAS_MAP|SUPPORTED_THEMES/, relativePath);
    assert.match(source, /theme-config/, relativePath);
  }
});

test('shared settings normalizers keep collection options consistent', () => {
  const {
    normalizeCollectBatchConcurrency,
    normalizeCollectBrowser
  } = require('../src/shared/settings-normalizers');

  assert.equal(normalizeCollectBatchConcurrency(1), 1);
  assert.equal(normalizeCollectBatchConcurrency('2'), 2);
  assert.equal(normalizeCollectBatchConcurrency(3), 3);
  assert.equal(normalizeCollectBatchConcurrency(6), 1);
  assert.equal(normalizeCollectBrowser('360'), '360');
  assert.equal(normalizeCollectBrowser('edge'), 'edge');
  assert.equal(normalizeCollectBrowser('unknown'), 'edge');
});
