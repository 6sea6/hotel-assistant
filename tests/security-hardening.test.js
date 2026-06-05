const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { isTrustedSender } = require('../src/main/ipc-safe-handler');
const {
  isAllowedExternalUrl,
  openAllowedExternalUrl
} = require('../src/main/ipc-handlers/other-handlers');

const rendererDir = path.join(__dirname, '..', 'src', 'renderer');
const inlineHandlerPattern =
  /\son(?:click|change|input|keydown|submit|blur|focus|mousedown|mouseup|mouseover|mouseout)\s*=/i;

function collectRendererFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectRendererFiles(fullPath);
    if (/\.(?:html|js)$/.test(entry.name)) return [fullPath];
    return [];
  });
}

test('renderer CSP removes inline scripts but keeps existing inline style compatibility', () => {
  const html = fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf8');
  const cspMatch = html.match(/Content-Security-Policy"\s+content="([^"]+)"/i);
  assert.ok(cspMatch, 'index.html should define a CSP meta tag');

  const csp = cspMatch[1];
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /style-src 'self' 'unsafe-inline'/);
  assert.match(csp, /img-src 'self' data: blob:/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
});

test('renderer markup and dynamic templates do not use inline event handlers', () => {
  for (const filePath of collectRendererFiles(rendererDir)) {
    const content = fs.readFileSync(filePath, 'utf8');
    assert.doesNotMatch(
      content,
      inlineHandlerPattern,
      `${filePath} should not contain inline event handlers`
    );
  }
});

test('external links are restricted to explicit HTTPS business domains', () => {
  assert.equal(isAllowedExternalUrl('https://www.ctrip.com/'), true);
  assert.equal(isAllowedExternalUrl('https://hotels.ctrip.com/hotels/detail/?hotelId=1'), true);
  assert.equal(isAllowedExternalUrl('https://www.fliggy.com/'), true);

  assert.equal(isAllowedExternalUrl('http://www.ctrip.com/'), false);
  assert.equal(isAllowedExternalUrl('javascript:alert(1)'), false);
  assert.equal(isAllowedExternalUrl('https://ctrip.com.evil.example/'), false);
  assert.equal(isAllowedExternalUrl('https://example.com/'), false);
});

test('open:external rejects file javascript http and non-whitelisted links', async () => {
  const opened = [];
  const shell = {
    openExternal(url) {
      opened.push(url);
    }
  };

  for (const url of [
    'file:///C:/Windows/notepad.exe',
    'javascript:alert(1)',
    'http://www.ctrip.com/',
    'https://example.com/'
  ]) {
    assert.deepEqual(await openAllowedExternalUrl(shell, url), {
      success: false,
      error: '不允许打开该外部链接'
    });
  }

  assert.deepEqual(opened, []);
});

test('BrowserWindow uses sandboxed isolated renderer preferences', () => {
  const windowManager = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'main', 'window-manager.js'),
    'utf8'
  );
  assert.match(windowManager, /nodeIntegration:\s*false/);
  assert.match(windowManager, /contextIsolation:\s*true/);
  assert.match(windowManager, /sandbox:\s*true/);
  assert.match(windowManager, /webSecurity:\s*true/);
});

test('preload stays compatible with sandbox by avoiding local module require', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'preload.js'), 'utf8');
  assert.doesNotMatch(preload, /require\(['"]\.\/config['"]\)/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\('electronAPI'/);
});

test('in-app manual content is extracted into a separate renderer resource', () => {
  const indexHtml = fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf8');
  const manualHtml = fs.readFileSync(path.join(rendererDir, 'manual.html'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'preload.js'), 'utf8');
  const otherHandlers = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'main', 'ipc-handlers', 'other-handlers.js'),
    'utf8'
  );

  assert.match(indexHtml, /id="manualContent"/);
  assert.doesNotMatch(indexHtml, /<h3>🏨 宾馆管理<\/h3>/);
  assert.match(manualHtml, /<h3>🏨 宾馆管理<\/h3>/);
  assert.match(
    preload,
    /getManualContent:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('manual:getContent'\)/
  );
  assert.match(otherHandlers, /safeHandle\([\s\S]*?ipcMain,[\s\S]*?'manual:getContent'/);
});

test('manual content is sanitized and excluded from global data-action delegation', () => {
  const appModule = fs.readFileSync(path.join(rendererDir, 'app.module.js'), 'utf8');
  const aboutManual = fs.readFileSync(
    path.join(rendererDir, 'modules', 'about-manual.js'),
    'utf8'
  );

  assert.match(appModule, /closest\('#manualContent'\)/);
  assert.match(aboutManual, /function sanitizeManualContent/);
  assert.match(aboutManual, /name\.startsWith\('on'\)/);
  assert.match(aboutManual, /name === 'data-action'/);
});

test('core IPC handlers use the safe handler wrapper', () => {
  const mainDir = path.join(__dirname, '..', 'src', 'main');
  const safeHandler = fs.readFileSync(path.join(mainDir, 'ipc-safe-handler.js'), 'utf8');
  const hotelHandlers = fs.readFileSync(
    path.join(mainDir, 'ipc-handlers', 'hotel-handlers.js'),
    'utf8'
  );
  const templateHandlers = fs.readFileSync(
    path.join(mainDir, 'ipc-handlers', 'template-handlers.js'),
    'utf8'
  );
  const dataHandlers = fs.readFileSync(
    path.join(mainDir, 'ipc-handlers', 'data-handlers.js'),
    'utf8'
  );
  const settingsHandlers = fs.readFileSync(
    path.join(mainDir, 'ipc-handlers', 'settings-handlers.js'),
    'utf8'
  );
  const aiHandlers = fs.readFileSync(path.join(mainDir, 'ipc-handlers', 'ai-handlers.js'), 'utf8');
  const otherHandlers = fs.readFileSync(
    path.join(mainDir, 'ipc-handlers', 'other-handlers.js'),
    'utf8'
  );

  assert.match(safeHandler, /function isTrustedSender/);
  assert.match(safeHandler, /senderFrame/);
  assert.match(hotelHandlers, /safeHandle\(ipcMain,\s*'hotel:add'/);
  assert.match(templateHandlers, /safeHandle\(ipcMain,\s*'template:updateAndSync'/);
  assert.match(dataHandlers, /safeHandle\(ipcMain,\s*'data:import'/);
  assert.match(dataHandlers, /safeHandle\(ipcMain,\s*'ranking:exportImage'/);
  assert.match(settingsHandlers, /safeHandle\([\s\S]*?ipcMain,[\s\S]*?'settings:set'/);
  assert.match(aiHandlers, /safeHandle\(ipcMain,\s*'ai:task:start'/);
  assert.match(otherHandlers, /safeHandle\(ipcMain,\s*'open:external'/);
  assert.match(otherHandlers, /safeHandle\(ipcMain,\s*'window:getState'/);

  for (const [name, source] of [
    ['hotel', hotelHandlers],
    ['template', templateHandlers],
    ['data', dataHandlers],
    ['settings', settingsHandlers],
    ['ai', aiHandlers],
    ['other', otherHandlers]
  ]) {
    assert.doesNotMatch(source, /ipcMain\.handle\(/, `${name} handlers should use safeHandle`);
  }
});

test('IPC sender validation rejects missing and remote origins', () => {
  assert.equal(isTrustedSender({ senderFrame: { url: 'file:///app/index.html' } }), true);
  assert.equal(isTrustedSender({ senderFrame: { url: 'app://renderer/index.html' } }), true);
  assert.equal(isTrustedSender({ senderFrame: { url: 'http://evil.example/index.html' } }), false);
  assert.equal(isTrustedSender({ senderFrame: { url: 'https://evil.example/index.html' } }), false);
  assert.equal(isTrustedSender({ senderFrame: { url: 'javascript:alert(1)' } }), false);
  assert.equal(isTrustedSender({ sender: {} }), false);
});
