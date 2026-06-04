const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let moduleUrl = '';
let tempRoot = '';

async function loadActionsModule() {
  if (!moduleUrl) {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-actions-registry-'));
    fs.writeFileSync(path.join(tempRoot, 'package.json'), '{"type":"module"}\n', 'utf-8');
    fs.copyFileSync(
      path.join(__dirname, '..', 'src', 'renderer', 'modules', 'actions.js'),
      path.join(tempRoot, 'actions.js')
    );
    moduleUrl = pathToFileURL(path.join(tempRoot, 'actions.js')).href;
    process.on('exit', () => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
  }

  return import(moduleUrl);
}

test('actions registry accepts known function assignments', async () => {
  const { actions, ACTION_REGISTRY_KEYS } = await loadActionsModule();

  actions.renderHotelList = () => 'rendered';

  assert.ok(ACTION_REGISTRY_KEYS.includes('renderHotelList'));
  assert.equal(actions.renderHotelList(), 'rendered');
});

test('actions registry rejects unknown action names', async () => {
  const { actions } = await loadActionsModule();

  assert.throws(() => {
    actions.renderHotleList = () => {};
  }, /Unknown renderer action: renderHotleList/);
});

test('actions registry rejects non-function action values', async () => {
  const { actions } = await loadActionsModule();

  assert.throws(() => {
    actions.renderHotelList = null;
  }, /Renderer action must be a function: renderHotelList/);
});
