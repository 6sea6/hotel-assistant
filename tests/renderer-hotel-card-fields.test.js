const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let moduleUrls = null;

async function loadModules() {
  if (!moduleUrls) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-hotel-card-fields-'));
    const sourceDir = path.join(__dirname, '..', 'src', 'renderer', 'modules');
    fs.writeFileSync(path.join(tempRoot, 'package.json'), '{"type":"module"}\n', 'utf-8');

    // Copy hotel-card-fields.js
    fs.copyFileSync(path.join(sourceDir, 'hotel-card-fields.js'), path.join(tempRoot, 'hotel-card-fields.js'));

    // Create a stub dom-helpers.js that doesn't require document
    fs.writeFileSync(path.join(tempRoot, 'dom-helpers.js'), `
export function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escapeHtmlWithLineBreaks(text) {
  return escapeHtml(text).replace(/\\r?\\n/g, '<br>');
}

export function hasDisplayValue(v) {
  return v !== null && v !== undefined && String(v).trim() !== '';
}

export function idsEqual(left, right) {
  return String(left) === String(right);
}

export function normalizeFilterOptionKey(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase().replace(/\\s+/g, ' ');
}

export function normalizeIdValue(v) {
  if (v === null || v === undefined || v === '') return null;
  const t = String(v).trim();
  if (t === '') return null;
  return /^-?\\d+$/.test(t) ? Number(t) : t;
}

export function getSelectionKey(id) {
  return String(id);
}

export function formatDateChinese(dateStr) {
  return dateStr;
}

export function getRoomCountText(count) {
  return count + '人';
}

export function formatSubwayInfo(station, distance) {
  return (station || '') + ' ' + (distance || '');
}

export function normalizeHotelCardVisibleFields(value) {
  return Array.isArray(value) ? value : [];
}

export function $(id) { return null; }
export function getValue(id) { return ''; }
export function setValue(id, v) {}
`);

    moduleUrls = {
      cardFields: pathToFileURL(path.join(tempRoot, 'hotel-card-fields.js')).href
    };
    process.on('exit', () => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
  }

  const cardFields = await import(moduleUrls.cardFields);
  return { cardFields };
}

function makeHotel(overrides = {}) {
  return {
    id: 1,
    name: '测试酒店',
    address: '北京市朝阳区建国路100号',
    website: 'https://example.com',
    original_room_type: '豪华大床房',
    total_price: 300,
    daily_price: 150,
    ctrip_score: 4.5,
    distance: '1.2公里',
    subway_distance: '0.8',
    transport_time: '35分钟',
    is_favorite: 0,
    ...overrides
  };
}

function makeHelpers() {
  return {
    escapeHtml: (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    escapeHtmlWithLineBreaks: (t) => String(t || ''),
    hasDisplayValue: (v) => v !== null && v !== undefined && String(v).trim() !== '',
    formatDateChinese: (d) => d,
    getRoomCountText: (n) => `${n}人`,
    formatSubwayInfo: (s, d) => `${s} ${d}`,
    isFromTemplate: () => false
  };
}

const ALL_KEYS = [
  'original_room_type', 'address', 'website',
  'total_price', 'daily_price', 'ctrip_score',
  'distance', 'subway', 'transport_time',
  'bus_route', 'room_type', 'notes', 'template'
];

test('renderCardFields returns headerFieldItems', async () => {
  const { cardFields } = await loadModules();
  const hotel = makeHotel();
  const helpers = makeHelpers();
  const result = cardFields.renderCardFields(hotel, ALL_KEYS, helpers);

  assert.ok(Array.isArray(result.headerFieldItems), 'headerFieldItems should be an array');
  assert.ok(result.headerFieldItems.length > 0, 'headerFieldItems should not be empty');
});

test('headerFieldItems contains original_room_type with card class', async () => {
  const { cardFields } = await loadModules();
  const hotel = makeHotel();
  const helpers = makeHelpers();
  const result = cardFields.renderCardFields(hotel, ALL_KEYS, helpers);

  const originalRoom = result.headerFieldItems.find(item => item.key === 'original_room_type');
  assert.ok(originalRoom, 'should have original_room_type in headerFieldItems');
  assert.ok(originalRoom.html.includes('hotel-card-original-room'), 'html should include hotel-card-original-room class');
  assert.ok(originalRoom.html.includes('hotel-original-room'), 'html should include original hotel-original-room class');
  assert.ok(originalRoom.html.includes('豪华大床房'), 'html should include the room type value');
});

test('headerFieldItems contains website with card class', async () => {
  const { cardFields } = await loadModules();
  const hotel = makeHotel();
  const helpers = makeHelpers();
  const result = cardFields.renderCardFields(hotel, ALL_KEYS, helpers);

  const website = result.headerFieldItems.find(item => item.key === 'website');
  assert.ok(website, 'should have website in headerFieldItems');
  assert.ok(website.html.includes('hotel-card-website'), 'html should include hotel-card-website class');
  assert.ok(website.html.includes('hotel-website'), 'html should include original hotel-website class');
  assert.ok(website.html.includes('https://example.com'), 'html should include the website value');
});

test('headerFieldItems contains address with card class', async () => {
  const { cardFields } = await loadModules();
  const hotel = makeHotel();
  const helpers = makeHelpers();
  const result = cardFields.renderCardFields(hotel, ALL_KEYS, helpers);

  const address = result.headerFieldItems.find(item => item.key === 'address');
  assert.ok(address, 'should have address in headerFieldItems');
  assert.ok(address.html.includes('hotel-card-address'), 'html should include hotel-card-address class');
  assert.ok(address.html.includes('hotel-address'), 'html should include original hotel-address class');
  assert.ok(address.html.includes('hotel-card-address-text'), 'address text should have its own truncation target');
  assert.ok(address.html.includes('北京市朝阳区建国路100号'), 'html should include the address value');
});

test('headerItems still preserved for backward compatibility', async () => {
  const { cardFields } = await loadModules();
  const hotel = makeHotel();
  const helpers = makeHelpers();
  const result = cardFields.renderCardFields(hotel, ALL_KEYS, helpers);

  assert.ok(Array.isArray(result.headerItems), 'headerItems should be an array');
  assert.ok(result.headerItems.length > 0, 'headerItems should not be empty');
  assert.equal(result.headerItems.length, result.headerFieldItems.length, 'headerItems and headerFieldItems should have same length');
});

test('headerFieldItems is empty when no header fields visible', async () => {
  const { cardFields } = await loadModules();
  const hotel = makeHotel();
  const helpers = makeHelpers();
  const result = cardFields.renderCardFields(hotel, ['total_price', 'daily_price'], helpers);

  assert.equal(result.headerFieldItems.length, 0, 'headerFieldItems should be empty when no header fields visible');
  assert.equal(result.headerItems.length, 0, 'headerItems should be empty when no header fields visible');
});

test('headerFieldItems excludes fields with null values', async () => {
  const { cardFields } = await loadModules();
  const hotel = makeHotel({ original_room_type: '', address: '', website: '' });
  const helpers = makeHelpers();
  const result = cardFields.renderCardFields(hotel, ALL_KEYS, helpers);

  const originalRoom = result.headerFieldItems.find(item => item.key === 'original_room_type');
  const website = result.headerFieldItems.find(item => item.key === 'website');
  const address = result.headerFieldItems.find(item => item.key === 'address');

  assert.equal(originalRoom, undefined, 'original_room_type should be excluded when empty');
  assert.equal(website, undefined, 'website should be excluded when empty');
  assert.equal(address, undefined, 'address should be excluded when empty');
});

test('card-specific classes do not break line view classes', async () => {
  const { cardFields } = await loadModules();
  const hotel = makeHotel();
  const helpers = makeHelpers();
  const result = cardFields.renderCardFields(hotel, ALL_KEYS, helpers);

  const originalRoom = result.headerFieldItems.find(item => item.key === 'original_room_type');
  assert.ok(originalRoom.html.includes('hotel-original-room'), 'should keep original hotel-original-room class for line view compatibility');
});
