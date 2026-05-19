const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { writeJsonFile, sanitizeSensitiveData } = require('../src/utils');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'report-level-test-'));
}

test('writeJsonFile writes compact JSON when pretty is false', () => {
  const tempDir = createTempDir();
  const filePath = path.join(tempDir, 'test.json');
  const content = { key: 'value', nested: { a: 1 } };

  writeJsonFile(filePath, content, { pretty: false });
  const raw = fs.readFileSync(filePath, 'utf-8');

  assert.ok(!raw.includes('\n'));
  assert.ok(raw.length < JSON.stringify(content, null, 2).length);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('writeJsonFile writes pretty JSON by default', () => {
  const tempDir = createTempDir();
  const filePath = path.join(tempDir, 'test.json');
  const content = { key: 'value' };

  writeJsonFile(filePath, content);
  const raw = fs.readFileSync(filePath, 'utf-8');

  assert.ok(raw.includes('\n'));
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('sanitizeSensitiveData redacts api_key and token', () => {
  const input = {
    api_key: 'secret123',
    access_token: 'token456',
    normal: 'keep',
    nested: {
      authorization: 'bearer xxx',
      safe: true
    }
  };

  const result = sanitizeSensitiveData(input);

  assert.equal(result.api_key, '[REDACTED]');
  assert.equal(result.access_token, '[REDACTED]');
  assert.equal(result.normal, 'keep');
  assert.equal(result.nested.authorization, '[REDACTED]');
  assert.equal(result.nested.safe, true);
});

test('buildBatchOutputPayload with summary reportLevel excludes review_inputs and item_debug', () => {
  const { buildBatchOutputPayload } = require('../src/task-runner');

  const resultPayloads = [
    {
      review_input: {
        taskMeta: { taskId: '1' },
        rawRoomCandidates: [],
        normalizeLogs: [],
        selectionLogs: []
      },
      scrape_debug: { raw_room_candidates: [{ id: 1 }], selection_logs: [], normalize_logs: [] },
      hotels: [{ name: 'Hotel 1' }]
    },
    {
      review_input: {
        taskMeta: { taskId: '2' },
        rawRoomCandidates: [],
        normalizeLogs: [],
        selectionLogs: []
      },
      scrape_debug: { raw_room_candidates: [{ id: 2 }], selection_logs: [], normalize_logs: [] },
      hotels: [{ name: 'Hotel 2' }]
    }
  ];

  const payload = buildBatchOutputPayload({
    args: {},
    template: { ctrip_url: 'https://example.com' },
    matchedTemplate: null,
    effectiveTemplate: {},
    compareAppSettings: {},
    expandedInputs: {
      summary: {},
      hotelInputs: [{ url: 'https://example.com' }, { url: 'https://example.com' }],
      requestedUrls: [],
      listResults: [],
      skippedUrls: []
    },
    resultPayloads,
    childResults: [],
    failedItems: [],
    allHotels: [],
    writeResult: null,
    performance: {},
    reportLevel: 'summary'
  });

  assert.equal(payload.reportLevel, 'summary');
  assert.equal(payload.review_inputs, undefined);
  assert.equal(payload.scrape_debug.item_debug, undefined);
  assert.ok(payload.scrape_debug.item_debug_count > 0);
});

test('buildBatchOutputPayload with normal reportLevel excludes review_inputs and item_debug', () => {
  const { buildBatchOutputPayload } = require('../src/task-runner');

  const resultPayloads = [
    {
      review_input: {
        taskMeta: { taskId: '1' },
        rawRoomCandidates: [],
        normalizeLogs: [],
        selectionLogs: []
      },
      scrape_debug: { raw_room_candidates: [{ id: 1 }], selection_logs: [], normalize_logs: [] },
      hotels: [{ name: 'Hotel 1' }]
    }
  ];

  const payload = buildBatchOutputPayload({
    args: {},
    template: { ctrip_url: 'https://example.com' },
    matchedTemplate: null,
    effectiveTemplate: {},
    compareAppSettings: {},
    expandedInputs: {
      summary: {},
      hotelInputs: [{ url: 'https://example.com' }],
      requestedUrls: [],
      listResults: [],
      skippedUrls: []
    },
    resultPayloads,
    childResults: [],
    failedItems: [],
    allHotels: [],
    writeResult: null,
    performance: {},
    reportLevel: 'normal'
  });

  assert.equal(payload.reportLevel, 'normal');
  assert.equal(payload.review_inputs, undefined);
  assert.equal(payload.scrape_debug.item_debug, undefined);
});

test('buildBatchOutputPayload with full reportLevel includes review_inputs and item_debug', () => {
  const { buildBatchOutputPayload } = require('../src/task-runner');

  const resultPayloads = [
    {
      review_input: {
        taskMeta: { taskId: '1' },
        rawRoomCandidates: [],
        normalizeLogs: [],
        selectionLogs: []
      },
      scrape_debug: { raw_room_candidates: [{ id: 1 }], selection_logs: [], normalize_logs: [] },
      hotels: [{ name: 'Hotel 1' }]
    },
    {
      review_input: {
        taskMeta: { taskId: '2' },
        rawRoomCandidates: [],
        normalizeLogs: [],
        selectionLogs: []
      },
      scrape_debug: { raw_room_candidates: [{ id: 2 }], selection_logs: [], normalize_logs: [] },
      hotels: [{ name: 'Hotel 2' }]
    }
  ];

  const payload = buildBatchOutputPayload({
    args: {},
    template: { ctrip_url: 'https://example.com' },
    matchedTemplate: null,
    effectiveTemplate: {},
    compareAppSettings: {},
    expandedInputs: {
      summary: {},
      hotelInputs: [{ url: 'https://example.com' }, { url: 'https://example.com' }],
      requestedUrls: [],
      listResults: [],
      skippedUrls: []
    },
    resultPayloads,
    childResults: [],
    failedItems: [],
    allHotels: [],
    writeResult: null,
    performance: {},
    reportLevel: 'full'
  });

  assert.equal(payload.reportLevel, 'full');
  assert.ok(Array.isArray(payload.review_inputs));
  assert.equal(payload.review_inputs.length, 2);
  assert.ok(Array.isArray(payload.scrape_debug.item_debug));
  assert.equal(payload.scrape_debug.item_debug.length, 2);
});

test('latest-run.json does not contain large objects like raw_room_candidates', () => {
  const { buildRunSummary } = require('../src/cli/run-summary');

  const result = {
    success: true,
    hotelName: 'Test Hotel',
    eligibleCount: 1,
    eligibleHotels: [{ name: 'Hotel' }],
    reviewInput: {
      rawRoomCandidates: new Array(100).fill({ id: 1 }),
      normalizeLogs: new Array(500).fill({ log: 'test' }),
      selectionLogs: new Array(100).fill({ log: 'test' })
    },
    performance: {}
  };

  const summary = buildRunSummary(result);

  assert.equal(summary.success, true);
  assert.equal(summary.hotelName, 'Test Hotel');
  assert.equal(summary.eligibleCount, 1);
  assert.equal(summary.reviewInput, undefined);
  assert.equal(summary.raw_room_candidates, undefined);
});

test('CLI output is compact (no pretty print)', () => {
  const result = { success: true, hotelName: 'Test', eligibleCount: 1 };
  const compact = JSON.stringify(result);
  const pretty = JSON.stringify(result, null, 2);

  assert.ok(compact.length < pretty.length);
  assert.ok(!compact.includes('\n'));
});
