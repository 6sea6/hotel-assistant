const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { isAllowedExternalUrl } = require('../src/main/ipc-handlers/other-handlers');

const rendererDir = path.join(__dirname, '..', 'src', 'renderer');
const inlineHandlerPattern = /\son(?:click|change|input|keydown|submit|blur|focus|mousedown|mouseup|mouseover|mouseout)\s*=/i;

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
    assert.doesNotMatch(content, inlineHandlerPattern, `${filePath} should not contain inline event handlers`);
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
