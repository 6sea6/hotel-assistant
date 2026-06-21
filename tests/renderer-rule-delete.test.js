const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let moduleUrl = null;

async function loadRuleDeleteModule() {
  if (!moduleUrl) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-rule-delete-'));
    const sourceDir = path.join(__dirname, '..', 'src', 'renderer', 'modules');

    fs.writeFileSync(path.join(tempRoot, 'package.json'), '{"type":"module"}\n', 'utf-8');
    fs.copyFileSync(
      path.join(sourceDir, 'rule-delete-controller.js'),
      path.join(tempRoot, 'rule-delete-controller.js')
    );
    fs.writeFileSync(
      path.join(tempRoot, 'state.js'),
      `
      export const state = { hotels: [], currentFilters: {}, viewMode: 'card' };
      export function setHotels(hotels) { state.hotels = hotels; }
      export function markVisibleHotelsCacheDirty() {}
      `,
      'utf-8'
    );
    fs.writeFileSync(
      path.join(tempRoot, 'dom-helpers.js'),
      `
      export const $ = () => null;
      export const getValue = () => '';
      export const getSelectionKey = (id) => String(id);
      export const iconHtml = () => '';
      `,
      'utf-8'
    );
    fs.writeFileSync(
      path.join(tempRoot, 'notification.js'),
      'export function showNotification() {}\n',
      'utf-8'
    );
    fs.writeFileSync(
      path.join(tempRoot, 'ui-utils.js'),
      `
      export function setModalActive() {}
      export function resetActionButtonConfirmation() {}
      export function startActionButtonConfirmation() {}
      `,
      'utf-8'
    );
    fs.writeFileSync(
      path.join(tempRoot, 'hotel-filters.js'),
      `
      export function applyFiltersToHotels(hotels) { return hotels; }
      export function extractDistanceNumber(distanceStr) {
        if (!distanceStr) return null;
        const match = String(distanceStr).match(/(\\d+\\.?\\d*)/);
        return match ? parseFloat(match[1]) : null;
      }
      export function extractTimeNumber(timeStr) {
        if (!timeStr) return null;
        const match = String(timeStr).match(/(\\d+)/);
        return match ? parseInt(match[1], 10) : null;
      }
      `,
      'utf-8'
    );
    fs.writeFileSync(
      path.join(tempRoot, 'hotel-list-render-orchestrator.js'),
      'export function requestHotelListRender() {}\n',
      'utf-8'
    );

    moduleUrl = pathToFileURL(path.join(tempRoot, 'rule-delete-controller.js')).href;
    process.on('exit', () => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
  }

  return import(moduleUrl);
}

test('rule delete treats subway distance zero as no nearby subway and over threshold', async () => {
  const { isSubwayDistanceRuleMatched } = await loadRuleDeleteModule();

  assert.equal(isSubwayDistanceRuleMatched(0, 0.8), true);
  assert.equal(isSubwayDistanceRuleMatched(0, 0), true);
  assert.equal(isSubwayDistanceRuleMatched(0.6, 0.8), false);
  assert.equal(isSubwayDistanceRuleMatched(1.2, 0.8), true);
  assert.equal(isSubwayDistanceRuleMatched(null, 0.8), false);
  assert.equal(isSubwayDistanceRuleMatched(1.2, null), false);
});

test('rule delete matches ctrip score below threshold only for known positive scores', async () => {
  const { isCtripScoreRuleMatched } = await loadRuleDeleteModule();

  assert.equal(isCtripScoreRuleMatched(4.6, 4.7), true);
  assert.equal(isCtripScoreRuleMatched(4.7, 4.7), false);
  assert.equal(isCtripScoreRuleMatched(4.8, 4.7), false);
  assert.equal(isCtripScoreRuleMatched(0, 4.7), false);
  assert.equal(isCtripScoreRuleMatched(Number.NaN, 4.7), false);
  assert.equal(isCtripScoreRuleMatched(4.6, null), false);
});

test('rule delete subway threshold includes hotels with no nearby subway station', async () => {
  const { getRuleDeleteCandidates } = await loadRuleDeleteModule();

  const candidates = getRuleDeleteCandidates(
    {
      price: null,
      ctripScore: null,
      subwayDistance: 0.8,
      transportTime: null
    },
    [
      { id: 1, subway_distance: '0' },
      { id: 2, subway_distance: '0.6' },
      { id: 3, subway_distance: '1.2' },
      { id: 4, subway_distance: '' },
      { id: 5, subway_distance: null }
    ]
  );

  assert.deepEqual(
    candidates.map((hotel) => hotel.id),
    [1, 3]
  );
});

test('rule delete ctrip score threshold includes only hotels below threshold', async () => {
  const { getRuleDeleteCandidates } = await loadRuleDeleteModule();

  const candidates = getRuleDeleteCandidates(
    {
      price: null,
      ctripScore: 4.7,
      subwayDistance: null,
      transportTime: null
    },
    [
      { id: 1, ctrip_score: 4.8 },
      { id: 2, ctrip_score: 4.7 },
      { id: 3, ctrip_score: 4.6 },
      { id: 4, ctrip_score: null },
      { id: 5, ctrip_score: 0 }
    ]
  );

  assert.deepEqual(
    candidates.map((hotel) => hotel.id),
    [3]
  );
});
