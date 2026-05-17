const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildPageSnapshotSummary, buildRunSummary } = require('../src/cli/run-summary');
const { classifyWriteCancelPolicy, shouldSkipHotelWrite } = require('../src/cli/write-policy');
const {
  hasReusableEdgeProfile,
  resolveEdgeProfileDirectory,
  resolveEdgeUserDataDir,
  toBoolean
} = require('../src/edge-runtime');
const {
  buildFailureResult,
  buildTemplateSnapshot,
  runHotelImportTask
} = require('../src/task-runner');
const { buildReviewInput } = require('../src/review-input');
const { resolveSharedCompareAppModule } = require('../src/compare-app/shared-module');
const { cleanupOutputArtifacts, parseArgs, sanitizeSensitiveData } = require('../src/utils');
const {
  applyMatchedTemplate,
  mergeTemplateWithArgs,
  validateTemplate
} = require('../src/template-loader');

test('buildPageSnapshotSummary keeps only compact fields needed for latest-run', () => {
  const summary = buildPageSnapshotSummary({
    source_url: 'https://example.com/hotel',
    html_source: 'remote',
    room_candidates_count: 5,
    room_price_visible: true,
    selected_room_source: 'edge-cdp',
    selected_room_price_locked: false,
    saved_html_files: ['a.html', 'b.html'],
    sources: [
      {
        source: 'desktop',
        room_candidates_count: 3,
        room_price_visible: false,
        locked_price_detected: true,
        tracked_urls: ['u1', 'u2'],
        attempts: ['a1'],
        spider_error_codes: [203]
      }
    ]
  });

  assert.equal(summary.saved_html_file_count, 2);
  assert.equal(summary.sources.length, 1);
  assert.equal(summary.sources[0].tracked_url_count, 2);
  assert.equal(summary.sources[0].attempt_count, 1);
  assert.deepEqual(summary.sources[0].spider_error_codes, [203]);
});

test('buildRunSummary preserves runtime result fields and nests page summary', () => {
  const summary = buildRunSummary({
    success: true,
    startedAt: '2026-04-14T10:00:00.000Z',
    finishedAt: '2026-04-14T10:00:30.000Z',
    templateSnapshot: {
      matchedTemplate: {
        source: 'store.templates',
        id: 2001,
        name: '实验',
        destination: '江汉路步行街',
        check_in_date: '2026-04-18',
        check_out_date: '2026-04-23',
        room_count: 3,
        created_at: '2026-04-16T02:49:32.756Z'
      },
      effectiveTemplate: {
        source: 'effective-template',
        id: 2001,
        name: '实验',
        destination: '江汉路步行街',
        check_in_date: '2026-04-18',
        check_out_date: '2026-04-23',
        room_count: 3,
        created_at: null
      }
    },
    hotelName: '测试酒店',
    inputMode: 'list',
    batchMode: true,
    requestedUrls: ['https://hotels.ctrip.com/hotels/list?city=1'],
    resolvedUrls: ['https://hotels.ctrip.com/hotels/detail/?hotelId=1'],
    items: [
      {
        index: 1,
        success: true,
        hotelName: '测试酒店',
        outputPath: 'output/batch-items/item.json',
        eligibleCount: 2
      }
    ],
    batchStats: {
      expandedHotelCount: 1,
      succeededCount: 1
    },
    batchSummary: {
      expandedHotelCount: 1
    },
    eligibleCount: 2,
    eligibleHotels: [{ name: '测试酒店', total_price: 880, ctrip_score: 4.8 }],
    pageSnapshot: {
      source_url: 'https://example.com/hotel',
      room_candidates_count: 1,
      sources: []
    }
  });

  assert.equal(summary.success, true);
  assert.equal(summary.hotelName, '测试酒店');
  assert.equal(summary.inputMode, 'list');
  assert.equal(summary.batchMode, true);
  assert.equal(summary.requestedUrls.length, 1);
  assert.equal(summary.resolvedUrls.length, 1);
  assert.equal(summary.items.length, 1);
  assert.equal(summary.batchStats.succeededCount, 1);
  assert.equal(summary.batchSummary.expandedHotelCount, 1);
  assert.equal(summary.eligibleCount, 2);
  assert.equal(summary.eligibleHotels.length, 1);
  assert.equal(summary.totalPrice, 880);
  assert.equal(summary.ctripScore, 4.8);
  assert.equal(summary.templateSnapshot.matchedTemplate.name, '实验');
  assert.equal(summary.templateSnapshot.effectiveTemplate.room_count, 3);
  assert.equal(summary.pageSnapshot.source_url, 'https://example.com/hotel');
});

test('buildRunSummary keeps single detail result shape batch-compatible', () => {
  const summary = buildRunSummary({
    success: true,
    hotelName: '单酒店',
    eligibleCount: 1,
    eligibleRoomTypes: [{ roomType: '家庭房', totalPrice: 900 }],
    eligibleHotels: [{ name: '单酒店', total_price: 900 }],
    totalPrice: 900
  });

  assert.equal(summary.success, true);
  assert.equal(summary.batchMode, false);
  assert.deepEqual(summary.items, []);
  assert.equal(summary.batchStats, null);
  assert.equal(summary.hotelName, '单酒店');
  assert.equal(summary.eligibleCount, 1);
  assert.equal(summary.eligibleRoomTypes.length, 1);
  assert.equal(summary.eligibleHotels.length, 1);
  assert.equal(summary.totalPrice, 900);
});

test('sanitizeSensitiveData redacts API keys and token-shaped fields recursively', () => {
  const sanitized = sanitizeSensitiveData({
    settings: {
      ai_provider_config: {
        provider: 'mimo',
        apiKey: 'secret'
      }
    },
    scrape_debug: {
      layerInfo: {
        token: 'ctrip-token'
      },
      roomToken: 'room-token',
      normal: 'kept'
    }
  });

  assert.equal(sanitized.settings.ai_provider_config.apiKey, '[REDACTED]');
  assert.equal(sanitized.scrape_debug.layerInfo.token, '[REDACTED]');
  assert.equal(sanitized.scrape_debug.roomToken, '[REDACTED]');
  assert.equal(sanitized.scrape_debug.normal, 'kept');
});

test('buildReviewInput keeps final, eligible, rejected, raw and diagnostic evidence', () => {
  const reviewInput = buildReviewInput({
    taskMeta: {
      taskId: 'task-1',
      url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=1',
      templateId: 100,
      templateName: '武汉',
      checkInDate: '2026-06-01',
      checkOutDate: '2026-06-02',
      roomCount: 3,
      guestCount: 3,
      destination: '江汉路'
    },
    finalHotels: [
      {
        name: '测试酒店',
        website: 'https://hotels.ctrip.com/hotels/detail/?hotelId=1',
        room_type: '家庭房',
        total_price: 600,
        room_area: '40',
        notes: '早餐：无早餐'
      }
    ],
    template: {
      room_count: 3,
      room_type: '家庭房'
    },
    roomCandidates: [
      {
        title: '家庭房',
        original_title: '家庭房',
        standard_title: '家庭房',
        price: 600,
        occupancy: 3,
        cancelPolicy: '免费取消',
        source: 'edge-cdp',
        raw: {
          physicalRoom: {
            area: 40
          },
          saleRoom: {
            mealInfo: {
              title: '无早餐'
            }
          }
        }
      },
      {
        title: '双床房',
        original_title: '双床房',
        standard_title: '双床房',
        price: null,
        occupancy: 3,
        cancelPolicy: '免费取消',
        source: 'desktop',
        raw: '双床房 登录看低价 token:"secret-token"'
      }
    ],
    evaluations: [
      {
        action: 'selected',
        score: 30,
        reason: '符合规则',
        reasonCode: 'selected',
        evidenceFields: ['price']
      },
      {
        action: 'rejected',
        score: 20,
        reason: '价格缺失',
        reasonCode: 'price_missing_or_locked',
        evidenceFields: ['price']
      }
    ],
    pageSnapshot: {
      room_price_visible: true,
      sources: [
        {
          source: 'desktop',
          room_candidates_count: 2,
          room_price_visible: false,
          locked_price_detected: true
        }
      ]
    }
  });

  assert.equal(reviewInput.taskMeta.outputFingerprint.length, 64);
  assert.equal(reviewInput.finalHotels.length, 1);
  assert.equal(reviewInput.eligibleRoomTypes.length, 1);
  assert.equal(reviewInput.rejectedRoomTypes.length, 1);
  assert.equal(reviewInput.rejectedRoomTypes[0].rejectReasonCode, 'price_missing_or_locked');
  assert.equal(reviewInput.rawRoomCandidates.length, 2);
  assert.doesNotMatch(reviewInput.rawRoomCandidates[1].compactRawText, /secret-token/);
  assert.ok(reviewInput.normalizeLogs.some((item) => item.field === 'price'));
  assert.equal(reviewInput.selectionLogs[1].candidateId, 'room-candidate-002');
  assert.ok(
    reviewInput.finalHotelFieldLogs.some(
      (item) => item.field === 'room_area' && item.source === '房型详情面积解析'
    )
  );
  assert.ok(
    reviewInput.finalHotelFieldLogs.some(
      (item) => item.field === 'notes' && item.source === '房型详情中的早餐信息'
    )
  );
  assert.equal(reviewInput.pageSnapshotSummary.rejectedCount, 1);
});

test('task runner exposes reusable helpers for Electron integration', () => {
  assert.equal(typeof runHotelImportTask, 'function');
  assert.deepEqual(
    buildTemplateSnapshot(
      {
        id: 1,
        name: 'bw',
        destination: '上海',
        check_in_date: '2026-05-01',
        check_out_date: '2026-05-03',
        room_count: 2
      },
      'store.templates'
    ),
    {
      source: 'store.templates',
      id: 1,
      name: 'bw',
      destination: '上海',
      check_in_date: '2026-05-01',
      check_out_date: '2026-05-03',
      room_count: 2,
      created_at: null
    }
  );

  const failure = buildFailureResult(new Error('boom'), 'output/latest-run.json', 'start');
  assert.equal(failure.success, false);
  assert.equal(failure.error, 'boom');
});

test('shared module resolver supports packaged adjacent shared resources', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-module-'));
  const currentDir = path.join(tempRoot, 'scraper', 'src', 'compare-app');
  const sharedFile = path.join(tempRoot, 'shared', 'compare-app', 'constants.js');
  fs.mkdirSync(path.dirname(sharedFile), { recursive: true });
  fs.mkdirSync(currentDir, { recursive: true });
  fs.writeFileSync(sharedFile, 'module.exports = {};', 'utf-8');

  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  assert.equal(
    resolveSharedCompareAppModule('constants.js', {
      currentDir
    }),
    sharedFile
  );
});

test('write policy skips only when every candidate room is non cancellable or confirmation restricted', () => {
  assert.equal(classifyWriteCancelPolicy('不可取消'), 'non_cancellable');
  assert.equal(
    classifyWriteCancelPolicy('订单确认后30分钟内免费取消'),
    'restricted_free_cancellation'
  );
  assert.equal(classifyWriteCancelPolicy('入住前一天可免费取消'), 'cancellable');
  assert.equal(classifyWriteCancelPolicy(''), 'assumed_cancellable');

  assert.equal(
    shouldSkipHotelWrite([
      { cancel_policy: '不可取消' },
      { cancel_policy: '订单确认后30分钟内免费取消' }
    ]),
    true
  );

  assert.equal(
    shouldSkipHotelWrite([
      { cancel_policy: '不可取消' },
      { cancel_policy: '入住前一天可免费取消' }
    ]),
    false
  );
});

test('edge runtime resolves profile paths and detects reusable profile markers', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-runtime-'));
  const userDataDir = path.join(tempRoot, 'state', 'edge-profile');
  const profileDir = path.join(userDataDir, 'Profile 1');

  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  assert.equal(toBoolean('true', false), true);
  assert.equal(toBoolean('0', true), false);
  assert.equal(resolveEdgeProfileDirectory(' Profile 1 '), 'Profile 1');
  assert.equal(resolveEdgeUserDataDir(userDataDir), path.resolve(userDataDir));
  assert.equal(hasReusableEdgeProfile(userDataDir, 'Profile 1'), false);

  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'Preferences'), '{"ok":true}', 'utf-8');

  assert.equal(hasReusableEdgeProfile(userDataDir, 'Profile 1'), true);
});

test('parseArgs preserves underscore and kebab-case url flags for downstream compatibility', () => {
  const underscored = parseArgs(['node', 'cli.js', '--ctrip_url', 'https://example.com/hotel']);
  const kebab = parseArgs(['node', 'cli.js', '--ctrip-url', 'https://example.com/hotel']);

  assert.equal(underscored.ctrip_url, 'https://example.com/hotel');
  assert.equal(kebab['ctrip-url'], 'https://example.com/hotel');
});

test('mergeTemplateWithArgs accepts url aliases and keeps template validation passing', () => {
  const baseTemplate = {
    destination: '江汉路步行街',
    check_in_date: '2026-04-30',
    check_out_date: '2026-05-04',
    room_count: 2
  };

  const mergedFromUnderscore = mergeTemplateWithArgs(baseTemplate, {
    ctrip_url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=1'
  });
  const mergedFromKebab = mergeTemplateWithArgs(baseTemplate, {
    'ctrip-url': 'https://hotels.ctrip.com/hotels/detail/?hotelId=2'
  });

  assert.equal(mergedFromUnderscore.ctrip_url, 'https://hotels.ctrip.com/hotels/detail/?hotelId=1');
  assert.equal(mergedFromKebab.ctrip_url, 'https://hotels.ctrip.com/hotels/detail/?hotelId=2');
  assert.doesNotThrow(() => validateTemplate(mergedFromUnderscore));
  assert.doesNotThrow(() => validateTemplate(mergedFromKebab));
});

test('applyMatchedTemplate does not inject a default template name and reuses matched template metadata', () => {
  const explicitTemplate = applyMatchedTemplate(
    {
      ctrip_url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=1',
      template_name: '',
      check_in_date: '2026-05-01',
      check_out_date: '2026-05-03',
      room_count: 2
    },
    null
  );
  const matchedById = applyMatchedTemplate(
    {
      ctrip_url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=1',
      template_id: 2001,
      template_name: '',
      check_in_date: '',
      check_out_date: '',
      room_count: null
    },
    {
      id: 2001,
      name: '武汉',
      destination: '江汉路步行街',
      check_in_date: '2026-04-30',
      check_out_date: '2026-05-03',
      room_count: 3
    }
  );

  assert.equal(explicitTemplate.template_name, '');
  assert.equal(matchedById.template_name, '武汉');
  assert.equal(matchedById.destination, '江汉路步行街');
  assert.equal(matchedById.template_id, 2001);
});

test('cleanupOutputArtifacts removes stale edge debug artifacts and debug text files', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-output-'));
  const outputDir = path.join(tempRoot, 'output');
  const currentOutputPath = path.join(outputDir, 'current.json');
  const rawPagesDir = path.join(outputDir, 'raw-pages');
  const edgeDebugDir = path.join(outputDir, 'edge-debug');

  fs.mkdirSync(rawPagesDir, { recursive: true });
  fs.mkdirSync(edgeDebugDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, '.keep'), '', 'utf-8');
  fs.writeFileSync(path.join(outputDir, 'latest-run.json'), '{}', 'utf-8');
  fs.writeFileSync(currentOutputPath, '{}', 'utf-8');
  fs.writeFileSync(path.join(outputDir, 'debug-log.txt'), 'log', 'utf-8');
  fs.writeFileSync(path.join(outputDir, 'debug-timing.txt'), 'timing', 'utf-8');
  fs.writeFileSync(path.join(edgeDebugDir, 'hotel-api.json'), '{}', 'utf-8');
  fs.writeFileSync(path.join(rawPagesDir, 'keep.html'), '<html></html>', 'utf-8');
  fs.writeFileSync(path.join(rawPagesDir, 'stale.html'), '<html></html>', 'utf-8');

  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const result = cleanupOutputArtifacts(outputDir, currentOutputPath, [
    path.join(rawPagesDir, 'keep.html')
  ]);

  assert.equal(fs.existsSync(path.join(outputDir, 'latest-run.json')), true);
  assert.equal(fs.existsSync(currentOutputPath), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'debug-log.txt')), false);
  assert.equal(fs.existsSync(path.join(outputDir, 'debug-timing.txt')), false);
  assert.equal(fs.existsSync(path.join(edgeDebugDir, 'hotel-api.json')), false);
  assert.equal(fs.existsSync(path.join(rawPagesDir, 'keep.html')), true);
  assert.equal(fs.existsSync(path.join(rawPagesDir, 'stale.html')), false);
  assert.ok(result.deletedFiles.some((filePath) => filePath.endsWith('debug-log.txt')));
});
