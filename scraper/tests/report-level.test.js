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

test('buildBatchOutputPayload with full reportLevel includes item_debug but not review_inputs', () => {
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
  assert.equal(payload.review_inputs, undefined);
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

test('compactCliResult strips large objects from result', () => {
  const { compactCliResult } = require('../src/utils');

  const result = {
    success: true,
    batchMode: true,
    inputMode: 'list',
    hotelName: 'Test Hotel',
    eligibleCount: 5,
    totalPrice: 1000,
    outputPath: '/output/test.json',
    reviewInput: { rawRoomCandidates: new Array(100).fill({ id: 1 }) },
    eligibleHotels: new Array(50).fill({ name: 'Hotel' }),
    performance: { scrapeMs: 1000, transitMs: 500 },
    batchSummary: {
      inputMode: 'list',
      requestedUrlCount: 1,
      expandedHotelCount: 5,
      succeededCount: 5,
      failedCount: 0,
      eligibleHotelRecordCount: 5,
      extraField: 'should be stripped'
    },
    items: Array.from({ length: 30 }, (_, i) => ({
      index: i + 1,
      hotelName: `Hotel ${i + 1}`,
      eligibleCount: 1,
      totalPrice: 100,
      outputPath: `/output/hotel-${i + 1}.json`,
      error: '',
      extraField: 'should be stripped'
    })),
    writeResult: {
      batchMode: true,
      appliedCount: 5,
      skippedCount: 0,
      extraField: 'should be stripped'
    }
  };

  const compact = compactCliResult(result);

  assert.equal(compact.success, true);
  assert.equal(compact.batchMode, true);
  assert.equal(compact.eligibleCount, 5);
  assert.equal(compact.reviewInput, undefined);
  assert.equal(compact.eligibleHotels, undefined);
  assert.equal(compact.performance, undefined);
  assert.ok(compact.items.length <= 20);
  assert.equal(compact.items[0].extraField, undefined);
  assert.equal(compact.batchSummary.extraField, undefined);
  assert.equal(compact.writeResult.extraField, undefined);
});

test('compactCliResult handles single hotel result', () => {
  const { compactCliResult } = require('../src/utils');

  const result = {
    success: true,
    batchMode: false,
    hotelName: 'Single Hotel',
    eligibleCount: 1,
    totalPrice: 500,
    outputPath: '/output/single.json',
    reviewInput: { taskMeta: {} },
    eligibleHotels: [{ name: 'Hotel' }]
  };

  const compact = compactCliResult(result);

  assert.equal(compact.success, true);
  assert.equal(compact.batchMode, false);
  assert.equal(compact.hotelName, 'Single Hotel');
  assert.equal(compact.items, undefined);
});

test('normalizeReportLevel returns only off/summary/normal/full', () => {
  const { normalizeReportLevel } = require('../src/utils');

  assert.equal(normalizeReportLevel('off'), 'off');
  assert.equal(normalizeReportLevel('summary'), 'summary');
  assert.equal(normalizeReportLevel('normal'), 'normal');
  assert.equal(normalizeReportLevel('full'), 'full');
  assert.equal(normalizeReportLevel('OFF'), 'off');
  assert.equal(normalizeReportLevel('SUMMARY'), 'summary');
  assert.equal(normalizeReportLevel('FULL'), 'full');
  assert.equal(normalizeReportLevel('invalid'), 'normal');
  assert.equal(normalizeReportLevel(''), 'normal');
  assert.equal(normalizeReportLevel(null), 'normal');
  assert.equal(normalizeReportLevel(undefined), 'normal');
});

test('writeJsonFile with measure returns bytes/stringifyMs/writeMs', () => {
  const { writeJsonFile } = require('../src/utils');
  const tempDir = createTempDir();
  const filePath = path.join(tempDir, 'measure-test.json');
  const content = { key: 'value', data: new Array(100).fill('test') };

  const result = writeJsonFile(filePath, content, { measure: true });

  assert.ok(result.bytes > 0);
  assert.ok(result.stringifyMs >= 0);
  assert.ok(result.writeMs >= 0);
  assert.ok(result.totalMs >= 0);
  assert.equal(result.totalMs, result.stringifyMs + result.writeMs);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('buildListResultsSummary extracts only summary fields', () => {
  const { buildListResultsSummary } = require('../src/ctrip-list');

  const listResults = [
    {
      inputUrl: 'https://example.com/list',
      selected: [{ id: 1 }, { id: 2 }],
      totalCandidates: 10,
      rejected: [{ id: 3 }],
      edgeFallbackUsed: true,
      performance: { htmlFetchMs: 100, edgeFallbackMs: 200, totalMs: 300 },
      errors: [{ error: 'test error' }]
    }
  ];

  const summary = buildListResultsSummary(listResults);

  assert.equal(summary.length, 1);
  assert.equal(summary[0].inputUrl, 'https://example.com/list');
  assert.equal(summary[0].selectedCount, 2);
  assert.equal(summary[0].totalCandidates, 10);
  assert.equal(summary[0].rejectedCount, 1);
  assert.equal(summary[0].edgeFallbackUsed, true);
  assert.equal(summary[0].htmlFetchMs, 100);
  assert.equal(summary[0].edgeFallbackMs, 200);
  assert.equal(summary[0].totalMs, 300);
  assert.deepEqual(summary[0].errors, ['test error']);
  assert.equal(summary[0].selected, undefined);
  assert.equal(summary[0].rejected, undefined);
});

test('buildRunSummary limits eligibleHotels and items count', () => {
  const { buildRunSummary } = require('../src/cli/run-summary');

  const result = {
    success: true,
    hotelName: 'Test',
    eligibleCount: 10,
    eligibleHotels: Array.from({ length: 50 }, (_, i) => ({ name: `Hotel ${i}` })),
    eligibleRoomTypes: Array.from({ length: 50 }, (_, i) => ({ roomType: `Room ${i}` })),
    items: Array.from({ length: 50 }, (_, i) => ({ index: i, hotelName: `Item ${i}` }))
  };

  const summary = buildRunSummary(result);

  assert.ok(summary.eligibleHotels.length <= 3);
  assert.ok(summary.eligibleRoomTypes.length <= 5);
  assert.ok(summary.items.length <= 20);
});

test('buildRunSummary does not include reviewInput or scrape_debug', () => {
  const { buildRunSummary } = require('../src/cli/run-summary');

  const result = {
    success: true,
    hotelName: 'Test',
    eligibleCount: 1,
    reviewInput: { rawRoomCandidates: [1, 2, 3] },
    review_input: { normalizeLogs: [1, 2, 3] },
    review_inputs: [{}, {}],
    scrape_debug: { item_debug: [{}, {}] },
    performance: { scrapeMs: 1000 }
  };

  const summary = buildRunSummary(result);

  assert.equal(summary.reviewInput, undefined);
  assert.equal(summary.review_input, undefined);
  assert.equal(summary.review_inputs, undefined);
  assert.equal(summary.scrape_debug, undefined);
  assert.equal(summary.performance, undefined);
});

test('normalizeReportLevel explicitly supports normal', () => {
  const { normalizeReportLevel } = require('../src/utils');

  assert.equal(normalizeReportLevel('normal'), 'normal');
  assert.equal(normalizeReportLevel('NORMAL'), 'normal');
  assert.equal(normalizeReportLevel('Normal'), 'normal');
  assert.equal(normalizeReportLevel('bad'), 'normal');
  assert.equal(normalizeReportLevel('off'), 'off');
  assert.equal(normalizeReportLevel('summary'), 'summary');
  assert.equal(normalizeReportLevel('full'), 'full');
});

test('parseArgs supports reportLevel off aliases', () => {
  const { parseArgs } = require('../src/utils');

  assert.equal(parseArgs(['node', 'cli.js', '--reportLevel', 'off']).reportLevel, 'off');
  assert.equal(parseArgs(['node', 'cli.js', '--report-level', 'off'])['report-level'], 'off');
  assert.equal(parseArgs(['node', 'cli.js', '--skip-report'])['skip-report'], true);
  assert.equal(parseArgs(['node', 'cli.js', '--no-output-report'])['no-output-report'], true);
});

test('single hotel normal report does not include review_input', () => {
  const { buildBatchOutputPayload } = require('../src/task-runner');

  const resultPayloads = [
    {
      review_input: {
        taskMeta: { taskId: '1' },
        rawRoomCandidates: [{ id: 1 }],
        normalizeLogs: [{ log: 1 }],
        selectionLogs: [{ log: 1 }]
      },
      scrape_debug: {},
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
  assert.equal(payload.review_input, undefined);
  assert.equal(payload.review_input_mode, undefined);
});

test('batch normal report does not include full review_inputs', () => {
  const { buildBatchOutputPayload } = require('../src/task-runner');

  const resultPayloads = [
    {
      review_input: {
        taskMeta: { taskId: '1' },
        rawRoomCandidates: [{ id: 1 }],
        normalizeLogs: [{ log: 1 }],
        selectionLogs: [{ log: 1 }]
      },
      scrape_debug: {},
      hotels: [{ name: 'Hotel 1' }]
    },
    {
      review_input: {
        taskMeta: { taskId: '2' },
        rawRoomCandidates: [{ id: 2 }],
        normalizeLogs: [{ log: 2 }],
        selectionLogs: [{ log: 2 }]
      },
      scrape_debug: {},
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
    reportLevel: 'normal'
  });

  assert.equal(payload.reportLevel, 'normal');
  assert.equal(payload.review_inputs, undefined);
  assert.equal(payload.scrape_debug.item_debug, undefined);
  assert.ok(payload.scrape_debug.item_debug_count > 0);
});

test('summary report does not include review_input or review_input_summary', () => {
  const { buildBatchOutputPayload } = require('../src/task-runner');

  const resultPayloads = [
    {
      review_input: null,
      review_input_summary: { finalHotelCount: 1, rawCandidateCount: 3 },
      scrape_debug: {},
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
    reportLevel: 'summary'
  });

  assert.equal(payload.reportLevel, 'summary');
  assert.equal(payload.review_inputs, undefined);
  assert.equal(payload.review_input, undefined);
  assert.equal(payload.review_input_summary, undefined);
});

test('full report includes item_debug but not review_inputs', () => {
  const { buildBatchOutputPayload } = require('../src/task-runner');

  const resultPayloads = [
    {
      review_input: { taskMeta: { taskId: '1' } },
      scrape_debug: { raw_room_candidates: [{ id: 1 }] },
      hotels: [{ name: 'Hotel 1' }]
    },
    {
      review_input: { taskMeta: { taskId: '2' } },
      scrape_debug: { raw_room_candidates: [{ id: 2 }] },
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
  assert.equal(payload.review_inputs, undefined);
  assert.ok(Array.isArray(payload.scrape_debug.item_debug));
  assert.equal(payload.scrape_debug.item_debug.length, 2);
});
