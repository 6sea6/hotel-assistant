const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveSharedCompareAppPath } = require('../src/main/shared-compare-app');

test('resolveSharedCompareAppPath prefers workspace shared modules during development', () => {
  const resolved = resolveSharedCompareAppPath('constants.js');

  assert.equal(fs.existsSync(resolved), true);
  assert.equal(
    resolved,
    path.resolve(__dirname, '..', 'shared', 'compare-app', 'constants.js')
  );
});

test('resolveSharedCompareAppPath falls back to packaged resources adjacent to app.asar', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-compare-app-'));
  const currentDir = path.join(tempRoot, 'resources', 'app.asar', 'src', 'main');
  const resourcesPath = path.join(tempRoot, 'resources');
  const packagedModulePath = path.join(resourcesPath, 'shared', 'compare-app', 'constants.js');

  fs.mkdirSync(currentDir, { recursive: true });
  fs.mkdirSync(path.dirname(packagedModulePath), { recursive: true });
  fs.writeFileSync(packagedModulePath, 'module.exports = {};', 'utf-8');

  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const resolved = resolveSharedCompareAppPath('constants.js', {
    currentDir
  });

  assert.equal(resolved, packagedModulePath);
});
