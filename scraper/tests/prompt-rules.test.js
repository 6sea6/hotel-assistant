const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scraperRoot = path.resolve(__dirname, '..');

function readScraperDoc(relativePath) {
  return fs.readFileSync(path.join(scraperRoot, relativePath), 'utf8');
}

function assertOnePersonTemplateOccupancyRule(documentText, label) {
  assert.match(
    documentText,
    /room_count\s*=\s*1[\s\S]{0,120}occupancy\s*=\s*1/,
    `${label} should mention 1-person templates keep occupancy=1 rooms`
  );
  assert.match(
    documentText,
    /room_count\s*=\s*1[\s\S]{0,160}occupancy\s*=\s*2[\s\S]{0,120}大床房/,
    `${label} should mention 1-person templates can keep 2-person big-bed rooms`
  );
  assert.match(
    documentText,
    /occupancy\s*=\s*2[\s\S]{0,160}(双床房|家庭房|非大床)/,
    `${label} should mention non-big-bed 2-person rooms remain excluded`
  );
}

test('business rule docs describe 1-person template occupancy relaxation', () => {
  assertOnePersonTemplateOccupancyRule(
    readScraperDoc('00-后续AI统一提示词.md'),
    'unified prompt'
  );
  assertOnePersonTemplateOccupancyRule(readScraperDoc('README.md'), 'README');
});
