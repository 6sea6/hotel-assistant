const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const taskRunnerRelatedModules = [
  '../src/task-runner',
  '../src/task-context',
  '../src/task-events',
  '../src/task-writeback',
  '../src/batch-artifact-writer',
  '../src/batch-result-builder',
  '../src/single-detail-runner',
  '../src/batch-orchestrator',
  '../src/batch-edge-worker-pool'
].map((modulePath) => require.resolve(modulePath));

function clearTaskRunnerModules() {
  for (const modulePath of taskRunnerRelatedModules) {
    delete require.cache[modulePath];
  }
}

function installMock(modulePath, exports) {
  clearTaskRunnerModules();
  const resolvedPath = require.resolve(modulePath);
  require.cache[resolvedPath] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports
  };
  return resolvedPath;
}

function clearModules(paths) {
  for (const modulePath of paths) {
    delete require.cache[modulePath];
  }
  if (paths.some((modulePath) => taskRunnerRelatedModules.includes(modulePath))) {
    clearTaskRunnerModules();
  }
}

function installFastModeTaskRunnerMocks(tempDir, options = {}) {
  const hotelInputs = options.hotelInputs || [
    {
      url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=fast1',
      hotelId: 'fast1',
      source: 'detail-input'
    }
  ];
  const calls = {
    appendHotelsToStore: 0,
    appendedHotels: [],
    buildReviewInput: 0,
    buildReviewInputSummary: 0,
    order: [],
    scrape: 0,
    scrapeOptions: [],
    transit: 0
  };
  const mockedPaths = [];

  mockedPaths.push(
    installMock('../src/compare-app-bridge', {
      appendHotelsToStore: (hotels) => {
        calls.appendHotelsToStore += 1;
        calls.appendedHotels.push(hotels);
        calls.order.push('append');
        return { operation: 'append', count: hotels.length };
      },
      findTemplateInStore: () => ({
        template_id: 'tpl-fast',
        template_name: '极速模板',
        destination: '武汉站'
      }),
      getCompareAppStorePath: () => path.join(tempDir, 'hotel-data.json'),
      loadCompareAppStore: () => ({
        settings: {},
        templates: []
      })
    })
  );
  mockedPaths.push(
    installMock('../src/ctrip-list', {
      buildListResultsSummary: () => [],
      describeExpandedInput: () =>
        hotelInputs.length > 1
          ? `模式=multi-detail，展开酒店=${hotelInputs.length}`
          : '模式=detail，展开酒店=1',
      expandCtripHotelInputs: async () => ({
        inputMode: hotelInputs.length > 1 ? 'multi-detail' : 'detail',
        requestedUrls: hotelInputs.map((item) => item.url),
        hotelInputs,
        listResults: [],
        skippedUrls: [],
        performance: { totalMs: 1, listCollectMs: 0, lists: [] },
        summary: {
          inputMode: hotelInputs.length > 1 ? 'multi-detail' : 'detail',
          requestedUrlCount: hotelInputs.length,
          detailInputCount: hotelInputs.length,
          listInputCount: 0,
          expandedHotelCount: hotelInputs.length,
          filters: {},
          performance: { totalMs: 1, listCollectMs: 0, lists: [] }
        }
      }),
      normalizeListFiltersFromArgs: () => ({})
    })
  );
  mockedPaths.push(
    installMock('../src/cli/auto-edge', {
      closeAutoEdge: (pid) => {
        calls.order.push(`close-edge:${pid}`);
      },
      hasReusableEdgeProfile: () => true,
      launchAndWaitForEdge: async (edgeOptions = {}) => ({
        pid: Number(edgeOptions.port || 9222) + 10000,
        port: Number(edgeOptions.port || 9222)
      }),
      runInteractiveEdgeLoginPrep: async () => undefined
    })
  );
  mockedPaths.push(
    installMock('../src/ctrip-scraper', {
      scrapeCtripHotel: async (url, _template, scrapeOptions = {}) => {
        calls.scrape += 1;
        calls.scrapeOptions.push(scrapeOptions);
        if (typeof options.onScrapeOptions === 'function') {
          options.onScrapeOptions(scrapeOptions, url);
        }
        const hotelInput = hotelInputs.find((item) => item.url === url) || hotelInputs[0];
        calls.order.push(`scrape:${hotelInput.hotelId}`);
        if (typeof options.scrapeResultForHotelInput === 'function') {
          return options.scrapeResultForHotelInput(hotelInput, url, scrapeOptions);
        }
        return {
          hotel_name: `极速酒店${hotelInput.hotelId}`,
          address: `极速地址${hotelInput.hotelId}`,
          ctrip_score: 4.8,
          geo: { location: '114.1,30.1' },
          room: { title: '大床房', price: 188, prices: [188], occupancy: 2 },
          room_candidates: [{ title: '大床房', price: 188 }],
          raw_room_candidates: [{ title: '大床房', price: 188, raw: true }],
          eligible_rooms: [{ title: '大床房', price: 188, occupancy: 2 }],
          room_selection_diagnostics: { evaluations: [{ action: 'selected' }], eligibleRooms: [] },
          page_snapshot: {
            source_url: url,
            saved_html_files: [],
            room_candidates_count: 1,
            room_price_visible: true,
            capture_method: 'html_only',
            wait_reason: ''
          },
          performance: {
            totalMs: 3,
            htmlMs: 1,
            directReplayMs: 0,
            edgeCaptureMs: 0,
            waitDataMs: 1
          }
        };
      }
    })
  );
  mockedPaths.push(
    installMock('../src/amap', {
      getTransitInfo: async () => {
        calls.transit += 1;
        calls.order.push('transit');
        return {
          route: { durationMinutes: 20 },
          nearestSubway: { name: '测试站', distanceKm: 0.6 }
        };
      }
    })
  );
  mockedPaths.push(
    installMock('../src/hotel-record', {
      buildHotelRecord: (template, scraped) => ({
        template_id: template.template_id,
        name: scraped.hotel_name,
        room_type:
          scraped.room && (scraped.room.standard_title || scraped.room.title)
            ? scraped.room.standard_title || scraped.room.title
            : '大床房',
        total_price: scraped.room && scraped.room.price != null ? scraped.room.price : null,
        ctrip_score: scraped.ctrip_score,
        subway_distance: '0.6',
        transport_time: '20',
        bus_route: '测试路线'
      }),
      buildEligibleRoomRecords: (template, scraped) => {
        const eligibleRooms = Array.isArray(scraped.eligible_rooms) ? scraped.eligible_rooms : [];
        return eligibleRooms.map((room) => ({
          template_id: template.template_id,
          name: scraped.hotel_name,
          room_type: room.standard_title || room.title || '大床房',
          original_room_type: room.title || room.standard_title || '大床房',
          daily_price: room.price ?? 188,
          total_price: room.price ?? 188,
          ctrip_score: scraped.ctrip_score,
          subway_distance: '0.6',
          transport_time: '20',
          bus_route: '测试路线'
        }));
      }
    })
  );
  mockedPaths.push(
    installMock('../src/review-input', {
      buildReviewInput: () => {
        calls.buildReviewInput += 1;
        if (options.throwOnReviewInput) {
          throw new Error('buildReviewInput should not run');
        }
        return { taskMeta: {}, rawRoomCandidates: [] };
      },
      buildReviewInputSummary: () => {
        calls.buildReviewInputSummary += 1;
        if (options.throwOnReviewInputSummary) {
          throw new Error('buildReviewInputSummary should not run');
        }
        return { finalHotelCount: 1, rawCandidateCount: 1 };
      }
    })
  );
  mockedPaths.push(
    installMock('../src/template-loader', {
      applyMatchedTemplate: (template, matchedTemplate) => ({
        ...template,
        ...matchedTemplate,
        template_id: 'tpl-fast',
        template_name: '极速模板',
        destination: '武汉站',
        check_in_date: '2026-06-01',
        check_out_date: '2026-06-02',
        room_count: 1
      }),
      loadTemplate: () => ({}),
      mergeTemplateWithArgs: (_templateFromFile, args) => ({
        template_id: args.templateId || 'tpl-fast',
        template_name: args.templateName || '极速模板',
        ctrip_url: args.url,
        destination: '武汉站',
        check_in_date: '2026-06-01',
        check_out_date: '2026-06-02',
        room_count: 1
      }),
      validateTemplate: () => undefined
    })
  );

  return { calls, mockedPaths };
}

test('runHotelImportTask marks apply-output perf records as apply_output task kind', async () => {
  const taskRunnerPath = require.resolve('../src/task-runner');
  const perfPath = require.resolve('../src/runtime/perf');
  const devPerfPath = require.resolve('../../devtools/perf-log');
  const previousEnv = {
    HOTEL_COLLECTOR_ENV: process.env.HOTEL_COLLECTOR_ENV,
    ENABLE_PERF_LOG: process.env.ENABLE_PERF_LOG
  };
  process.env.HOTEL_COLLECTOR_ENV = 'dev';
  process.env.ENABLE_PERF_LOG = '1';
  delete require.cache[taskRunnerPath];
  delete require.cache[perfPath];
  delete require.cache[devPerfPath];

  const mockedPaths = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-task-runner-apply-'));
  const outputPath = path.join(tempDir, 'reviewed-output.json');
  const latestRunPath = path.join(tempDir, 'latest-run.json');
  fs.writeFileSync(
    outputPath,
    JSON.stringify({
      hotels: [{ id: '1', name: '已复核酒店' }],
      hotel: { name: '已复核酒店' }
    }),
    'utf8'
  );

  mockedPaths.push(
    installMock('../src/cli/reviewed-output', {
      applyReviewedOutput: (_outputPath, nextLatestRunPath, startedAt) => {
        fs.writeFileSync(
          nextLatestRunPath,
          JSON.stringify({
            success: true,
            startedAt,
            finishedAt: new Date().toISOString(),
            hotelName: '已复核酒店',
            eligibleCount: 1
          }),
          'utf8'
        );
      }
    })
  );

  try {
    const records = [];
    const perfLogger = {
      enabled: true,
      write(record) {
        records.push(record);
        return record;
      }
    };
    const { runHotelImportTask } = require('../src/task-runner');
    await runHotelImportTask(
      {
        'apply-output': outputPath,
        latestRun: latestRunPath
      },
      {
        workingDirectory: tempDir,
        perfLogger
      }
    );

    const scriptStart = records.find((record) => record.event === 'script_start');
    const taskTotal = records.find((record) => record.phase === 'task_total');
    assert.equal(scriptStart.task_kind, 'apply_output');
    assert.equal(taskTotal.task_kind, 'apply_output');
  } finally {
    if (previousEnv.HOTEL_COLLECTOR_ENV === undefined) {
      delete process.env.HOTEL_COLLECTOR_ENV;
    } else {
      process.env.HOTEL_COLLECTOR_ENV = previousEnv.HOTEL_COLLECTOR_ENV;
    }
    if (previousEnv.ENABLE_PERF_LOG === undefined) {
      delete process.env.ENABLE_PERF_LOG;
    } else {
      process.env.ENABLE_PERF_LOG = previousEnv.ENABLE_PERF_LOG;
    }
    clearModules([taskRunnerPath, perfPath, devPerfPath, ...mockedPaths]);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('batch perf logs uncollected hotel urls and reasons', async () => {
  const taskRunnerPath = require.resolve('../src/task-runner');
  const perfPath = require.resolve('../src/runtime/perf');
  const devPerfPath = require.resolve('../../devtools/perf-log');
  const previousEnv = {
    HOTEL_COLLECTOR_ENV: process.env.HOTEL_COLLECTOR_ENV,
    ENABLE_PERF_LOG: process.env.ENABLE_PERF_LOG
  };
  process.env.HOTEL_COLLECTOR_ENV = 'dev';
  process.env.ENABLE_PERF_LOG = '1';
  delete require.cache[taskRunnerPath];
  delete require.cache[perfPath];
  delete require.cache[devPerfPath];

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-task-runner-uncollected-'));
  const hotelInputs = [
    {
      url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=ok1',
      hotelId: 'ok1',
      source: 'detail-input'
    },
    {
      url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=miss1',
      hotelId: 'miss1',
      source: 'detail-input'
    }
  ];
  const { mockedPaths } = installFastModeTaskRunnerMocks(tempDir, {
    hotelInputs,
    scrapeResultForHotelInput: (hotelInput, url) => {
      if (hotelInput.hotelId !== 'miss1') {
        return {
          hotel_name: '可写入酒店',
          address: '地址',
          ctrip_score: 4.8,
          geo: { location: '114.1,30.1' },
          room: { title: '大床房', standard_title: '大床房', price: 188, prices: [188] },
          room_candidates: [{ title: '大床房', standard_title: '大床房', price: 188 }],
          raw_room_candidates: [{ title: '大床房', price: 188, raw: true }],
          eligible_rooms: [{ title: '大床房', standard_title: '大床房', price: 188 }],
          room_selection_diagnostics: { evaluations: [{ action: 'selected' }], eligibleRooms: [] },
          page_snapshot: {
            source_url: url,
            room_candidates_count: 1,
            raw_room_candidates_count: 1,
            eligible_room_count: 1,
            room_price_visible: true,
            selected_room_source: 'api-json',
            capture_method: 'html_then_edge_cdp',
            wait_reason: 'auto_edge_supplement',
            edge_fallback_used: true,
            api_replay_used: false,
            sources: []
          },
          performance: { totalMs: 3, htmlMs: 1, edgeCaptureMs: 1, waitDataMs: 1 }
        };
      }

      return {
        hotel_name: '未写入酒店',
        address: '地址',
        ctrip_score: 4.8,
        geo: { location: '114.1,30.1' },
        room: { title: '高级双床房', standard_title: '双床房', price: null, prices: [] },
        room_candidates: [{ title: '高级双床房', standard_title: '双床房', price: null }],
        raw_room_candidates: [{ title: '高级双床房', price: null, raw: true }],
        eligible_rooms: [],
        room_selection_diagnostics: { evaluations: [{ action: 'rejected' }], eligibleRooms: [] },
        warnings: ['Edge capture warning: Execution context was destroyed.'],
        page_snapshot: {
          source_url: url,
          room_candidates_count: 1,
          raw_room_candidates_count: 1,
          eligible_room_count: 0,
          room_price_visible: false,
          selected_room_source: 'desktop',
          capture_method: 'html_then_edge_cdp',
          wait_reason: 'auto_edge_supplement',
          edge_fallback_used: true,
          api_replay_used: true,
          tracked_url_count: 0,
          sources: [
            {
              source: 'desktop',
              room_candidates_count: 1,
              room_price_visible: false,
              error: ''
            },
            {
              source: 'edge-cdp',
              room_candidates_count: 0,
              room_price_visible: false,
              error: 'Execution context was destroyed.'
            },
            {
              source: 'direct-room-list-replay',
              room_candidates_count: 0,
              room_price_visible: false,
              error: 'HTTP 400'
            }
          ]
        },
        performance: { totalMs: 3, htmlMs: 1, edgeCaptureMs: 1, directReplayMs: 1, waitDataMs: 1 }
      };
    }
  });
  const records = [];

  try {
    const { runHotelImportTask } = require('../src/task-runner');
    await runHotelImportTask(
      {
        url: hotelInputs.map((item) => item.url),
        latestRun: path.join(tempDir, 'latest-run.json'),
        reportLevel: 'off'
      },
      {
        workingDirectory: tempDir,
        perfLogger: {
          enabled: true,
          write(record) {
            records.push(record);
            return record;
          }
        }
      }
    );

    const uncollected = records.find((record) => record.event === 'uncollected_hotel');
    assert.ok(uncollected);
    assert.equal(uncollected.url, hotelInputs[1].url);
    assert.equal(uncollected.hotelId, 'miss1');
    assert.equal(uncollected.hotelName, '未写入酒店');
    assert.equal(uncollected.uncollected_reason, 'edge_capture_failed');
    assert.match(uncollected.uncollected_reason_detail, /Execution context was destroyed/);
    assert.equal(uncollected.eligible_count, 0);
    assert.equal(uncollected.selected_room_source, 'desktop');
    assert.equal(uncollected.room_price_visible, false);

    const summary = records.find((record) => record.event === 'batch_summary');
    assert.equal(summary.uncollected_count, 1);
    assert.equal(summary.uncollected_items[0].url, hotelInputs[1].url);
    assert.equal(summary.uncollected_items[0].uncollected_reason, 'edge_capture_failed');
  } finally {
    clearModules([taskRunnerPath, perfPath, devPerfPath, ...mockedPaths]);
    process.env.HOTEL_COLLECTOR_ENV = previousEnv.HOTEL_COLLECTOR_ENV;
    process.env.ENABLE_PERF_LOG = previousEnv.ENABLE_PERF_LOG;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('reportLevel off skips review/report output for single hotel', async () => {
  const taskRunnerPath = require.resolve('../src/task-runner');
  delete require.cache[taskRunnerPath];

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-task-runner-fast-single-'));
  const latestRunPath = path.join(tempDir, 'latest-run.json');
  const { calls, mockedPaths } = installFastModeTaskRunnerMocks(tempDir, {
    throwOnReviewInput: true,
    throwOnReviewInputSummary: true
  });

  try {
    const records = [];
    const { runHotelImportTask } = require('../src/task-runner');
    const result = await runHotelImportTask(
      {
        url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=fast1',
        latestRun: latestRunPath,
        'skip-report': true
      },
      {
        workingDirectory: tempDir,
        perfLogger: {
          enabled: true,
          write(record) {
            records.push(record);
            return record;
          }
        }
      }
    );

    assert.equal(calls.buildReviewInput, 0);
    assert.equal(calls.buildReviewInputSummary, 0);
    assert.equal(result.success, true);
    assert.equal(result.hotelName, '极速酒店fast1');
    assert.equal(result.eligibleCount, 1);
    assert.equal(result.totalPrice, 188);
    assert.equal(result.outputPath || '', '');
    assert.equal(Object.prototype.hasOwnProperty.call(result, 'reviewInput'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(result, 'reviewInputSummary'), false);
    assert.equal(result.pageSnapshot.room_candidates_count, 1);

    const outputDir = path.join(tempDir, 'output');
    const outputJsonFiles = fs.existsSync(outputDir)
      ? fs.readdirSync(outputDir).filter((entry) => entry.endsWith('.json'))
      : [];
    assert.deepEqual(outputJsonFiles, []);
    assert.equal(
      records.some((record) =>
        ['build_review_input', 'build_review_summary', 'build_report', 'write_report'].includes(
          record.phase
        )
      ),
      false
    );

    const latestRun = JSON.parse(fs.readFileSync(latestRunPath, 'utf8'));
    assert.equal(latestRun.success, true);
    assert.equal(latestRun.hotelName, '极速酒店fast1');
    assert.equal(latestRun.eligibleCount, 1);
    assert.equal(latestRun.totalPrice, 188);
    assert.equal(latestRun.outputPath || '', '');
    assert.equal(latestRun.items, undefined);
    assert.equal(latestRun.eligibleHotels, undefined);
    assert.equal(latestRun.reviewInput, undefined);
    assert.equal(latestRun.performance, undefined);
  } finally {
    clearModules([taskRunnerPath, ...mockedPaths]);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('reportLevel off batch skips item reports and can still write app data', async () => {
  const taskRunnerPath = require.resolve('../src/task-runner');
  delete require.cache[taskRunnerPath];

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-task-runner-fast-batch-'));
  const latestRunPath = path.join(tempDir, 'latest-run.json');
  const { calls, mockedPaths } = installFastModeTaskRunnerMocks(tempDir, {
    throwOnReviewInput: true,
    throwOnReviewInputSummary: true,
    hotelInputs: [
      {
        url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=fast1',
        hotelId: 'fast1',
        source: 'detail-input'
      },
      {
        url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=fast2',
        hotelId: 'fast2',
        source: 'detail-input'
      }
    ]
  });

  try {
    const records = [];
    const { runHotelImportTask } = require('../src/task-runner');
    const result = await runHotelImportTask(
      {
        url: [
          'https://hotels.ctrip.com/hotels/detail/?hotelId=fast1',
          'https://hotels.ctrip.com/hotels/detail/?hotelId=fast2'
        ],
        latestRun: latestRunPath,
        'report-level': 'off',
        'write-app-data': true,
        'unsafe-allow-unreviewed-write': true
      },
      {
        workingDirectory: tempDir,
        perfLogger: {
          enabled: true,
          write(record) {
            records.push(record);
            return record;
          }
        }
      }
    );

    assert.equal(calls.buildReviewInput, 0);
    assert.equal(calls.buildReviewInputSummary, 0);
    assert.equal(calls.appendHotelsToStore, 1);
    assert.equal(calls.appendedHotels[0].length, 2);
    assert.equal(result.success, true);
    assert.equal(result.batchMode, true);
    assert.equal(result.eligibleCount, 2);
    assert.equal(result.outputPath || '', '');
    assert.equal(result.writeResult.operation, 'append');

    const outputDir = path.join(tempDir, 'output');
    const batchItemsDir = path.join(outputDir, 'batch-items');
    assert.equal(fs.existsSync(batchItemsDir), false);
    const outputJsonFiles = fs.existsSync(outputDir)
      ? fs.readdirSync(outputDir).filter((entry) => entry.endsWith('.json'))
      : [];
    assert.deepEqual(outputJsonFiles, []);
    assert.equal(
      records.some((record) =>
        ['build_review_input', 'build_review_summary', 'build_report', 'write_report'].includes(
          record.phase
        )
      ),
      false
    );

    const latestRun = JSON.parse(fs.readFileSync(latestRunPath, 'utf8'));
    assert.equal(latestRun.success, true);
    assert.equal(latestRun.batchMode, true);
    assert.equal(latestRun.eligibleCount, 2);
    assert.equal(latestRun.outputPath || '', '');
    assert.equal(latestRun.items, undefined);
    assert.equal(latestRun.eligibleHotels, undefined);
    assert.equal(latestRun.performance, undefined);
  } finally {
    clearModules([taskRunnerPath, ...mockedPaths]);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('batch events include item index and total counts', async () => {
  const taskRunnerPath = require.resolve('../src/task-runner');
  delete require.cache[taskRunnerPath];

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-task-runner-batch-events-'));
  const latestRunPath = path.join(tempDir, 'latest-run.json');
  const hotelInputs = [
    {
      url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=event1',
      hotelId: 'event1',
      source: 'detail-input'
    },
    {
      url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=event2',
      hotelId: 'event2',
      source: 'detail-input'
    }
  ];
  const { mockedPaths } = installFastModeTaskRunnerMocks(tempDir, { hotelInputs });

  try {
    const events = [];
    const { runHotelImportTask } = require('../src/task-runner');
    await runHotelImportTask(
      {
        url: hotelInputs.map((item) => item.url),
        latestRun: latestRunPath,
        'report-level': 'off'
      },
      {
        workingDirectory: tempDir,
        taskId: 'task',
        onEvent: (event) => events.push(event)
      }
    );

    const starts = events.filter((event) => event.type === 'batch:item-start');
    const dones = events.filter((event) => event.type === 'batch:item-done');
    const taskErrors = events.filter((event) => event.type === 'batch:item-error');
    assert.deepEqual(
      starts.map((event) => [event.details.index, event.details.total]),
      [
        [1, 2],
        [2, 2]
      ]
    );
    assert.deepEqual(
      dones.map((event) => [event.details.index, event.details.total]),
      [
        [1, 2],
        [2, 2]
      ]
    );
    assert.deepEqual(
      starts.map((event) => [
        event.details.taskId,
        event.details.hotelId,
        event.details.url,
        event.details.source
      ]),
      [
        ['task-1', 'event1', hotelInputs[0].url, 'detail-input'],
        ['task-2', 'event2', hotelInputs[1].url, 'detail-input']
      ]
    );
    assert.deepEqual(
      dones.map((event) => [
        event.details.taskId,
        event.details.hotelId,
        event.details.url,
        event.details.source
      ]),
      [
        ['task-1', 'event1', hotelInputs[0].url, 'detail-input'],
        ['task-2', 'event2', hotelInputs[1].url, 'detail-input']
      ]
    );
    assert.equal(taskErrors.length, 0);
  } finally {
    clearModules([taskRunnerPath, ...mockedPaths]);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('batch result items are sorted by input index', () => {
  const { buildBatchItems } = require('../src/batch-result-builder');

  const items = buildBatchItems(
    [
      { inputIndex: 3, success: true, hotelName: 'third' },
      { inputIndex: 1, success: true, hotelName: 'first' }
    ],
    [{ index: 2, url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=failed', error: 'boom' }]
  );

  assert.deepEqual(
    items.map((item) => item.index),
    [1, 2, 3]
  );
  assert.deepEqual(
    items.map((item) => item.success),
    [true, false, true]
  );
});

test('batch artifact writer derives ordered collections from itemResults', () => {
  const { prepareBatchCollections } = require('../src/batch-artifact-writer');

  const collections = prepareBatchCollections({
    reportDisabled: false,
    itemResults: [
      {
        index: 2,
        hotelInput: { hotelId: 'second' },
        childResult: { inputIndex: 2, success: true, eligibleHotels: [{ name: 'ignored' }] },
        childPayload: { hotels: [{ name: 'Hotel 2' }] },
        savedHtmlFiles: ['second.html'],
        failedItem: null,
        durationMs: 7,
        performanceItem: { index: 2 },
        uncollectedItem: null
      },
      {
        index: 1,
        hotelInput: { hotelId: 'first' },
        childResult: null,
        childPayload: null,
        savedHtmlFiles: [],
        failedItem: { index: 1, url: 'https://example.test/1', error: 'boom' },
        durationMs: 0,
        performanceItem: null,
        uncollectedItem: null
      }
    ]
  });

  assert.deepEqual(
    collections.orderedItemResults.map((item) => item.index),
    [1, 2]
  );
  assert.deepEqual(collections.childResults, [
    { inputIndex: 2, success: true, eligibleHotels: [{ name: 'ignored' }] }
  ]);
  assert.deepEqual(collections.resultPayloads, [{ hotels: [{ name: 'Hotel 2' }] }]);
  assert.deepEqual(collections.failedItems, [
    { index: 1, url: 'https://example.test/1', error: 'boom' }
  ]);
  assert.deepEqual(collections.allHotels, [{ name: 'Hotel 2' }]);
  assert.equal(collections.itemMs, 7);
});

test('batch report writer propagates report failures before latest-run is written', async () => {
  const {
    writeBatchLatestRunSummary,
    writeBatchReportArtifact
  } = require('../src/batch-artifact-writer');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-task-runner-report-fail-'));
  const latestRunPath = path.join(tempDir, 'latest-run.json');
  const phases = [];
  const batchPerf = {
    runPhase: async (phaseName, _meta, action) => {
      phases.push(phaseName);
      return action();
    },
    phase: (phaseName) => {
      phases.push(phaseName);
      return {
        end(status) {
          phases.push(`${phaseName}:${status}`);
        }
      };
    }
  };

  try {
    assert.throws(
      () =>
        writeBatchReportArtifact({
          batchPerf,
          outputPath: path.join(tempDir, 'report.json'),
          outputPayload: { success: true },
          performance: {},
          reportLevel: 'normal',
          allHotels: [],
          writeJsonFileImpl: () => {
            throw new Error('report disk failure');
          }
        }),
      /report disk failure/
    );

    assert.equal(fs.existsSync(latestRunPath), false);
    assert.deepEqual(phases, ['write_report']);

    await writeBatchLatestRunSummary({
      batchPerf,
      latestRunPath,
      result: { success: true, eligibleCount: 0 },
      allHotels: []
    });
    assert.equal(fs.existsSync(latestRunPath), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('batch app writeback runs only after all serial detail items finish', async () => {
  const taskRunnerPath = require.resolve('../src/task-runner');
  delete require.cache[taskRunnerPath];

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-task-runner-write-order-'));
  const latestRunPath = path.join(tempDir, 'latest-run.json');
  const hotelInputs = [
    {
      url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=order1',
      hotelId: 'order1',
      source: 'detail-input'
    },
    {
      url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=order2',
      hotelId: 'order2',
      source: 'detail-input'
    }
  ];
  const { calls, mockedPaths } = installFastModeTaskRunnerMocks(tempDir, { hotelInputs });

  try {
    const { runHotelImportTask } = require('../src/task-runner');
    await runHotelImportTask(
      {
        url: hotelInputs.map((item) => item.url),
        latestRun: latestRunPath,
        'report-level': 'off',
        'write-app-data': true,
        'unsafe-allow-unreviewed-write': true
      },
      {
        workingDirectory: tempDir
      }
    );

    const appendIndex = calls.order.indexOf('append');
    assert.notEqual(appendIndex, -1);
    assert.ok(appendIndex > calls.order.lastIndexOf('scrape:order2'));
    assert.equal(calls.appendHotelsToStore, 1);
  } finally {
    clearModules([taskRunnerPath, ...mockedPaths]);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('batch continues after one detail item fails', async () => {
  const taskRunnerPath = require.resolve('../src/task-runner');
  delete require.cache[taskRunnerPath];

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-task-runner-partial-fail-'));
  const latestRunPath = path.join(tempDir, 'latest-run.json');
  const hotelInputs = [
    {
      url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=fail1',
      hotelId: 'fail1',
      source: 'detail-input'
    },
    {
      url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=ok2',
      hotelId: 'ok2',
      source: 'detail-input'
    }
  ];
  const { calls, mockedPaths } = installFastModeTaskRunnerMocks(tempDir, {
    hotelInputs,
    scrapeResultForHotelInput: (hotelInput) => {
      if (hotelInput.hotelId === 'fail1') {
        throw new Error('simulated scrape failure');
      }
      return {
        hotel_name: '继续成功酒店',
        address: '继续成功地址',
        ctrip_score: 4.8,
        geo: { location: '114.1,30.1' },
        room: { title: '大床房', price: 188, prices: [188], occupancy: 2 },
        room_candidates: [{ title: '大床房', price: 188 }],
        raw_room_candidates: [{ title: '大床房', price: 188, raw: true }],
        eligible_rooms: [{ title: '大床房', price: 188, occupancy: 2 }],
        room_selection_diagnostics: { evaluations: [{ action: 'selected' }], eligibleRooms: [] },
        page_snapshot: {
          source_url: hotelInput.url,
          saved_html_files: [],
          room_candidates_count: 1,
          room_price_visible: true,
          capture_method: 'html_only',
          wait_reason: ''
        },
        performance: { totalMs: 3, htmlMs: 1, directReplayMs: 0, edgeCaptureMs: 0, waitDataMs: 1 }
      };
    }
  });

  try {
    const { runHotelImportTask } = require('../src/task-runner');
    const result = await runHotelImportTask(
      {
        url: hotelInputs.map((item) => item.url),
        latestRun: latestRunPath,
        'report-level': 'off'
      },
      {
        workingDirectory: tempDir
      }
    );

    assert.equal(calls.scrape, 2);
    assert.equal(result.success, true);
    assert.equal(result.batchMode, true);
    assert.equal(result.failedItems.length, 1);
    assert.equal(result.failedItems[0].index, 1);
    assert.equal(result.items.length, 2);
    assert.deepEqual(
      result.items.map((item) => [item.index, item.success]),
      [
        [1, false],
        [2, true]
      ]
    );
  } finally {
    clearModules([taskRunnerPath, ...mockedPaths]);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('batch rethrows cancellation from the last detail item instead of partial success', async () => {
  const taskRunnerPath = require.resolve('../src/task-runner');
  delete require.cache[taskRunnerPath];

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-task-runner-batch-cancel-'));
  const latestRunPath = path.join(tempDir, 'latest-run.json');
  const hotelInputs = [
    {
      url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=cancel-ok1',
      hotelId: 'cancel-ok1',
      source: 'detail-input'
    },
    {
      url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=cancel-ok2',
      hotelId: 'cancel-ok2',
      source: 'detail-input'
    },
    {
      url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=cancel-last',
      hotelId: 'cancel-last',
      source: 'detail-input'
    }
  ];
  const { calls, mockedPaths } = installFastModeTaskRunnerMocks(tempDir, {
    hotelInputs,
    scrapeResultForHotelInput: (hotelInput) => {
      if (hotelInput.hotelId === 'cancel-last') {
        const error = new Error('任务已取消');
        error.name = 'AbortError';
        throw error;
      }
      return {
        hotel_name: `取消前成功酒店${hotelInput.hotelId}`,
        address: `取消前成功地址${hotelInput.hotelId}`,
        ctrip_score: 4.8,
        geo: { location: '114.1,30.1' },
        room: { title: '大床房', price: 188, prices: [188], occupancy: 2 },
        room_candidates: [{ title: '大床房', price: 188 }],
        raw_room_candidates: [{ title: '大床房', price: 188, raw: true }],
        eligible_rooms: [{ title: '大床房', price: 188, occupancy: 2 }],
        room_selection_diagnostics: { evaluations: [{ action: 'selected' }], eligibleRooms: [] },
        page_snapshot: {
          source_url: hotelInput.url,
          saved_html_files: [],
          room_candidates_count: 1,
          room_price_visible: true,
          capture_method: 'html_only',
          wait_reason: ''
        },
        performance: { totalMs: 3, htmlMs: 1, directReplayMs: 0, edgeCaptureMs: 0, waitDataMs: 1 }
      };
    }
  });

  try {
    const { runHotelImportTask } = require('../src/task-runner');
    await assert.rejects(
      () =>
        runHotelImportTask(
          {
            url: hotelInputs.map((item) => item.url),
            latestRun: latestRunPath,
            'report-level': 'off'
          },
          {
            workingDirectory: tempDir
          }
        ),
      /任务已取消/
    );

    assert.equal(calls.scrape, 3);
    assert.equal(fs.existsSync(latestRunPath), false);
  } finally {
    clearModules([taskRunnerPath, ...mockedPaths]);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runHotelImportTask aborts before collection when signal is already cancelled', async () => {
  const taskRunnerPath = require.resolve('../src/task-runner');
  delete require.cache[taskRunnerPath];

  const controller = new AbortController();
  controller.abort();

  try {
    const { runHotelImportTask } = require('../src/task-runner');
    await assert.rejects(
      () =>
        runHotelImportTask(
          {
            url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=cancelled'
          },
          {
            signal: controller.signal
          }
        ),
      /任务已取消/
    );
  } finally {
    clearModules([taskRunnerPath]);
  }
});

test('batch concurrency greater than one runs with bounded parallel workers', async () => {
  const taskRunnerPath = require.resolve('../src/task-runner');
  delete require.cache[taskRunnerPath];

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-task-runner-concurrency-'));
  const latestRunPath = path.join(tempDir, 'latest-run.json');
  const hotelInputs = [
    {
      url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=concurrency1',
      hotelId: 'concurrency1',
      source: 'detail-input'
    },
    {
      url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=concurrency2',
      hotelId: 'concurrency2',
      source: 'detail-input'
    },
    {
      url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=concurrency3',
      hotelId: 'concurrency3',
      source: 'detail-input'
    }
  ];
  let activeScrapes = 0;
  let maxActiveScrapes = 0;
  const { mockedPaths } = installFastModeTaskRunnerMocks(tempDir, {
    hotelInputs,
    scrapeResultForHotelInput: async (hotelInput) => {
      activeScrapes += 1;
      maxActiveScrapes = Math.max(maxActiveScrapes, activeScrapes);
      await new Promise((resolve) =>
        setTimeout(resolve, hotelInput.hotelId === 'concurrency1' ? 30 : 5)
      );
      activeScrapes -= 1;
      return {
        hotel_name: `并发酒店${hotelInput.hotelId}`,
        address: `并发地址${hotelInput.hotelId}`,
        ctrip_score: 4.8,
        geo: { location: '114.1,30.1' },
        room: { title: '大床房', price: 188, prices: [188], occupancy: 2 },
        room_candidates: [{ title: '大床房', price: 188 }],
        raw_room_candidates: [{ title: '大床房', price: 188, raw: true }],
        eligible_rooms: [{ title: '大床房', price: 188, occupancy: 2 }],
        room_selection_diagnostics: { evaluations: [{ action: 'selected' }], eligibleRooms: [] },
        page_snapshot: {
          source_url: hotelInput.url,
          saved_html_files: [],
          room_candidates_count: 1,
          room_price_visible: true,
          capture_method: 'html_only',
          wait_reason: ''
        },
        performance: { totalMs: 3, htmlMs: 1, directReplayMs: 0, edgeCaptureMs: 0, waitDataMs: 1 }
      };
    }
  });

  try {
    const records = [];
    const events = [];
    const { runHotelImportTask } = require('../src/task-runner');
    const result = await runHotelImportTask(
      {
        url: hotelInputs.map((item) => item.url),
        latestRun: latestRunPath,
        'report-level': 'off'
      },
      {
        workingDirectory: tempDir,
        concurrency: 3,
        perfLogger: {
          enabled: true,
          write(record) {
            records.push(record);
            return record;
          }
        },
        onEvent(event) {
          events.push(event);
        }
      }
    );

    assert.equal(result.performance.concurrency, 3);
    assert.equal(result.performance.effectiveConcurrency, 2);
    assert.equal(result.performance.parallelRequestedButDisabled, false);
    assert.equal(maxActiveScrapes, 2);
    assert.deepEqual(
      result.items.map((item) => item.index),
      [1, 2, 3]
    );
    assert.equal(
      records.some((record) => record.event === 'parallel_requested_but_disabled'),
      false
    );
    const batchStartEvent = events.find((event) => event.type === 'batch:start');
    assert.ok(batchStartEvent);
    assert.equal(batchStartEvent.details.requestedConcurrency, 3);
    assert.equal(batchStartEvent.details.effectiveConcurrency, 2);
    assert.equal(batchStartEvent.details.parallelRequestedButDisabled, false);
  } finally {
    clearModules([taskRunnerPath, ...mockedPaths]);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('batch-concurrency argument enables parallel collection while preserving result order', async () => {
  const taskRunnerPath = require.resolve('../src/task-runner');
  delete require.cache[taskRunnerPath];

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-task-runner-arg-concurrency-'));
  const latestRunPath = path.join(tempDir, 'latest-run.json');
  const hotelInputs = [
    {
      url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=arg-concurrency1',
      hotelId: 'arg-concurrency1',
      source: 'detail-input'
    },
    {
      url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=arg-concurrency2',
      hotelId: 'arg-concurrency2',
      source: 'detail-input'
    }
  ];
  let activeScrapes = 0;
  let maxActiveScrapes = 0;
  const { calls, mockedPaths } = installFastModeTaskRunnerMocks(tempDir, {
    hotelInputs,
    scrapeResultForHotelInput: async (hotelInput) => {
      activeScrapes += 1;
      maxActiveScrapes = Math.max(maxActiveScrapes, activeScrapes);
      await new Promise((resolve) =>
        setTimeout(resolve, hotelInput.hotelId === 'arg-concurrency1' ? 25 : 5)
      );
      activeScrapes -= 1;
      return {
        hotel_name: `参数并发酒店${hotelInput.hotelId}`,
        address: `参数并发地址${hotelInput.hotelId}`,
        ctrip_score: 4.8,
        geo: { location: '114.1,30.1' },
        room: { title: '大床房', price: 188, prices: [188], occupancy: 2 },
        room_candidates: [{ title: '大床房', price: 188 }],
        raw_room_candidates: [{ title: '大床房', price: 188, raw: true }],
        eligible_rooms: [{ title: '大床房', price: 188, occupancy: 2 }],
        room_selection_diagnostics: { evaluations: [{ action: 'selected' }], eligibleRooms: [] },
        page_snapshot: {
          source_url: hotelInput.url,
          saved_html_files: [],
          room_candidates_count: 1,
          room_price_visible: true,
          capture_method: 'html_only',
          wait_reason: ''
        },
        performance: { totalMs: 3, htmlMs: 1, directReplayMs: 0, edgeCaptureMs: 0, waitDataMs: 1 }
      };
    }
  });

  try {
    const records = [];
    const events = [];
    const { runHotelImportTask } = require('../src/task-runner');
    const result = await runHotelImportTask(
      {
        url: hotelInputs.map((item) => item.url),
        latestRun: latestRunPath,
        'report-level': 'off',
        'batch-concurrency': 2
      },
      {
        workingDirectory: tempDir,
        perfLogger: {
          enabled: true,
          write(record) {
            records.push(record);
            return record;
          }
        },
        onEvent(event) {
          events.push(event);
        }
      }
    );

    assert.equal(calls.scrape, 2);
    assert.equal(result.performance.concurrency, 2);
    assert.equal(result.performance.effectiveConcurrency, 2);
    assert.equal(result.performance.parallelRequestedButDisabled, false);
    assert.equal(maxActiveScrapes, 2);
    assert.deepEqual(
      result.items.map((item) => item.index),
      [1, 2]
    );
    assert.equal(
      records.some((record) => record.event === 'parallel_requested_but_disabled'),
      false
    );
    const batchStartEvent = events.find((event) => event.type === 'batch:start');
    assert.ok(batchStartEvent);
    assert.equal(batchStartEvent.details.requestedConcurrency, 2);
    assert.equal(batchStartEvent.details.effectiveConcurrency, 2);
    assert.equal(batchStartEvent.details.parallelRequestedButDisabled, false);
  } finally {
    clearModules([taskRunnerPath, ...mockedPaths]);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('batch auto-edge defaults detail items to parallel_edge capture strategy', async () => {
  const taskRunnerPath = require.resolve('../src/task-runner');
  delete require.cache[taskRunnerPath];

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-task-runner-parallel-edge-'));
  const latestRunPath = path.join(tempDir, 'latest-run.json');
  const hotelInputs = [
    {
      url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=edge1',
      hotelId: 'edge1',
      source: 'detail-input'
    },
    {
      url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=edge2',
      hotelId: 'edge2',
      source: 'detail-input'
    }
  ];
  const { calls, mockedPaths } = installFastModeTaskRunnerMocks(tempDir, { hotelInputs });

  try {
    const { runHotelImportTask } = require('../src/task-runner');
    const result = await runHotelImportTask(
      {
        url: hotelInputs.map((item) => item.url),
        latestRun: latestRunPath,
        'auto-edge': true,
        'report-level': 'off'
      },
      {
        workingDirectory: tempDir
      }
    );

    assert.equal(result.success, true);
    assert.equal(result.batchMode, true);
    assert.equal(calls.scrape, 2);
    assert.equal(calls.scrapeOptions.length, 2);
    assert.deepEqual(
      calls.scrapeOptions.map((item) => item.captureStrategy),
      ['parallel_edge', 'parallel_edge']
    );
    assert.deepEqual(
      calls.scrapeOptions.map((item) => item.edgeParallelCancelPolicy),
      ['none', 'none']
    );
  } finally {
    clearModules([taskRunnerPath, ...mockedPaths]);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('batch explicit captureStrategy is preserved when auto-edge is enabled', async () => {
  const taskRunnerPath = require.resolve('../src/task-runner');
  delete require.cache[taskRunnerPath];

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-task-runner-explicit-strategy-'));
  const latestRunPath = path.join(tempDir, 'latest-run.json');
  const hotelInputs = [
    {
      url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=edge-explicit-1',
      hotelId: 'edge-explicit-1',
      source: 'detail-input'
    },
    {
      url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=edge-explicit-2',
      hotelId: 'edge-explicit-2',
      source: 'detail-input'
    }
  ];
  const { calls, mockedPaths } = installFastModeTaskRunnerMocks(tempDir, { hotelInputs });

  try {
    const { runHotelImportTask } = require('../src/task-runner');
    const result = await runHotelImportTask(
      {
        url: hotelInputs.map((item) => item.url),
        latestRun: latestRunPath,
        'auto-edge': true,
        'capture-strategy': 'html_first',
        'report-level': 'off'
      },
      {
        workingDirectory: tempDir
      }
    );

    assert.equal(result.success, true);
    assert.equal(result.batchMode, true);
    assert.equal(calls.scrape, 2);
    assert.deepEqual(
      calls.scrapeOptions.map((item) => item.captureStrategy),
      ['html_first', 'html_first']
    );
  } finally {
    clearModules([taskRunnerPath, ...mockedPaths]);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('batch auto-edge concurrency assigns separate worker debugging ports', async () => {
  const taskRunnerPath = require.resolve('../src/task-runner');
  delete require.cache[taskRunnerPath];

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-task-runner-edge-concurrency-'));
  const latestRunPath = path.join(tempDir, 'latest-run.json');
  const hotelInputs = [
    {
      url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=edge-concurrent-1',
      hotelId: 'edge-concurrent-1',
      source: 'detail-input'
    },
    {
      url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=edge-concurrent-2',
      hotelId: 'edge-concurrent-2',
      source: 'detail-input'
    }
  ];
  let activeScrapes = 0;
  let maxActiveScrapes = 0;
  const observedPorts = [];
  const { calls, mockedPaths } = installFastModeTaskRunnerMocks(tempDir, {
    hotelInputs,
    onScrapeOptions: (scrapeOptions) => {
      observedPorts.push(scrapeOptions.edgeSession && scrapeOptions.edgeSession.debuggingPort);
    },
    scrapeResultForHotelInput: async (hotelInput) => {
      activeScrapes += 1;
      maxActiveScrapes = Math.max(maxActiveScrapes, activeScrapes);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeScrapes -= 1;
      return {
        hotel_name: `Edge 并发酒店${hotelInput.hotelId}`,
        address: `Edge 并发地址${hotelInput.hotelId}`,
        ctrip_score: 4.8,
        geo: { location: '114.1,30.1' },
        room: { title: '大床房', price: 188, prices: [188], occupancy: 2 },
        room_candidates: [{ title: '大床房', price: 188 }],
        raw_room_candidates: [{ title: '大床房', price: 188, raw: true }],
        eligible_rooms: [{ title: '大床房', price: 188, occupancy: 2 }],
        room_selection_diagnostics: { evaluations: [{ action: 'selected' }], eligibleRooms: [] },
        page_snapshot: {
          source_url: hotelInput.url,
          saved_html_files: [],
          room_candidates_count: 1,
          room_price_visible: true,
          capture_method: 'html_only',
          wait_reason: ''
        },
        performance: { totalMs: 3, htmlMs: 1, directReplayMs: 0, edgeCaptureMs: 0, waitDataMs: 1 }
      };
    }
  });

  try {
    const { runHotelImportTask } = require('../src/task-runner');
    const result = await runHotelImportTask(
      {
        url: hotelInputs.map((item) => item.url),
        latestRun: latestRunPath,
        'auto-edge': true,
        'edge-user-data-dir': path.join(tempDir, 'edge-profile'),
        'report-level': 'off',
        'batch-concurrency': 2
      },
      {
        workingDirectory: tempDir
      }
    );

    assert.equal(result.success, true);
    assert.equal(result.performance.effectiveConcurrency, 2);
    assert.equal(maxActiveScrapes, 2);
    assert.equal(new Set(observedPorts).size, 2);
    assert.ok(calls.order.some((item) => item.startsWith('close-edge:')));
  } finally {
    clearModules([taskRunnerPath, ...mockedPaths]);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('task runner forwards scraper login prompt events to task console', async () => {
  const taskRunnerPath = require.resolve('../src/task-runner');
  delete require.cache[taskRunnerPath];

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-task-runner-login-event-'));
  const latestRunPath = path.join(tempDir, 'latest-run.json');
  const { mockedPaths } = installFastModeTaskRunnerMocks(tempDir, {
    onScrapeOptions: (scrapeOptions) => {
      assert.equal(typeof scrapeOptions.onEvent, 'function');
      scrapeOptions.onEvent('edge:login-required', '检测到携程登录提示', {
        reason: '页面出现携程登录弹窗。',
        stage: 'edge_page_ready'
      });
    }
  });

  try {
    const events = [];
    const { runHotelImportTask } = require('../src/task-runner');
    const result = await runHotelImportTask(
      {
        url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=login-event',
        latestRun: latestRunPath,
        'report-level': 'off'
      },
      {
        workingDirectory: tempDir,
        onEvent: (event) => events.push(event)
      }
    );

    assert.equal(result.success, true);
    assert.ok(
      events.some(
        (event) =>
          event.type === 'edge:login-required' &&
          event.message === '检测到携程登录提示' &&
          event.details &&
          event.details.stage === 'edge_page_ready'
      )
    );
  } finally {
    clearModules([taskRunnerPath, ...mockedPaths]);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runHotelImportTask reuses prepared context for batch detail items', async () => {
  const taskRunnerPath = require.resolve('../src/task-runner');
  delete require.cache[taskRunnerPath];

  const calls = {
    loadStore: 0,
    scrape: 0,
    transit: 0
  };
  const mockedPaths = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-task-runner-'));

  mockedPaths.push(
    installMock('../src/compare-app-bridge', {
      appendHotelsToStore: () => ({ operation: 'append', count: 1 }),
      findTemplateInStore: () => ({
        template_id: 'tpl-1',
        template_name: '实验',
        destination: '武汉站'
      }),
      getCompareAppStorePath: () => path.join(tempDir, 'hotel-data.json'),
      loadCompareAppStore: () => {
        calls.loadStore += 1;
        return {
          settings: {},
          templates: []
        };
      }
    })
  );
  mockedPaths.push(
    installMock('../src/ctrip-list', {
      buildListResultsSummary: () => [],
      describeExpandedInput: () => '模式=multi-detail，展开酒店=2',
      expandCtripHotelInputs: async () => ({
        inputMode: 'multi-detail',
        requestedUrls: [
          'https://hotels.ctrip.com/hotels/detail/?hotelId=9001',
          'https://hotels.ctrip.com/hotels/detail/?hotelId=9002'
        ],
        hotelInputs: [
          {
            url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=9001',
            hotelId: '9001',
            source: 'detail-input'
          },
          {
            url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=9002',
            hotelId: '9002',
            source: 'detail-input'
          }
        ],
        listResults: [],
        skippedUrls: [],
        performance: { totalMs: 2, listCollectMs: 0, lists: [] },
        summary: {
          inputMode: 'multi-detail',
          requestedUrlCount: 2,
          detailInputCount: 2,
          listInputCount: 0,
          expandedHotelCount: 2,
          filters: {},
          performance: { totalMs: 2, listCollectMs: 0, lists: [] }
        }
      }),
      normalizeListFiltersFromArgs: () => ({ desiredHotelCount: 2 })
    })
  );
  mockedPaths.push(
    installMock('../src/ctrip-scraper', {
      scrapeCtripHotel: async (url) => {
        calls.scrape += 1;
        const hotelId = url.includes('9002') ? '9002' : '9001';
        return {
          hotel_name: `测试酒店${hotelId}`,
          address: `测试地址${hotelId}`,
          ctrip_score: 4.8,
          geo: { location: `114.${hotelId.slice(-1)},30.${hotelId.slice(-1)}` },
          room: { title: '大床房', price: 188, prices: [188], occupancy: 2 },
          room_candidates: [],
          raw_room_candidates: [],
          eligible_rooms: [],
          room_selection_diagnostics: { evaluations: [], eligibleRooms: [] },
          page_snapshot: {
            source_url: url,
            saved_html_files: [],
            room_candidates_count: 1,
            room_price_visible: true
          },
          performance: { totalMs: 3, htmlMs: 1, directReplayMs: 0, edgeCaptureMs: 0 }
        };
      }
    })
  );
  mockedPaths.push(
    installMock('../src/amap', {
      getTransitInfo: async () => {
        calls.transit += 1;
        return {
          route: { durationMinutes: 20 },
          nearestSubway: { name: '测试站', distanceKm: 0.6 }
        };
      }
    })
  );
  mockedPaths.push(
    installMock('../src/hotel-record', {
      buildHotelRecord: (template, scraped) => ({
        template_id: template.template_id,
        name: scraped.hotel_name,
        room_type: '大床房',
        total_price: 188,
        ctrip_score: scraped.ctrip_score,
        subway_distance: '0.6',
        transport_time: '20',
        bus_route: '测试路线'
      }),
      buildEligibleRoomRecords: (template, scraped) => [
        {
          template_id: template.template_id,
          name: scraped.hotel_name,
          room_type: '大床房',
          original_room_type: '大床房',
          daily_price: 188,
          total_price: 188,
          ctrip_score: scraped.ctrip_score,
          subway_distance: '0.6',
          transport_time: '20',
          bus_route: '测试路线'
        }
      ]
    })
  );
  mockedPaths.push(
    installMock('../src/review-input', {
      buildReviewInput: () => ({
        selectionLogs: [],
        rejectedRoomTypes: [],
        normalizeLogs: []
      }),
      buildReviewInputSummary: () => ({
        finalHotelCount: 1,
        rawCandidateCount: 0,
        eligibleCount: 1,
        rejectedCount: 0
      })
    })
  );
  mockedPaths.push(
    installMock('../src/template-loader', {
      applyMatchedTemplate: (template, matchedTemplate) => ({
        ...template,
        ...matchedTemplate,
        template_id: 'tpl-1',
        template_name: '实验',
        destination: '武汉站',
        check_in_date: '2026-06-01',
        check_out_date: '2026-06-02',
        room_count: 1
      }),
      loadTemplate: () => ({}),
      mergeTemplateWithArgs: (_templateFromFile, args) => ({
        template_id: args.templateId || 'tpl-1',
        template_name: args.templateName || '实验',
        ctrip_url: args.url,
        destination: '武汉站',
        check_in_date: '2026-06-01',
        check_out_date: '2026-06-02',
        room_count: 1
      }),
      validateTemplate: () => undefined
    })
  );

  try {
    const { runHotelImportTask } = require('../src/task-runner');
    const result = await runHotelImportTask(
      {
        url: [
          'https://hotels.ctrip.com/hotels/detail/?hotelId=9001',
          'https://hotels.ctrip.com/hotels/detail/?hotelId=9002'
        ],
        latestRun: path.join(tempDir, 'latest-run.json')
      },
      {
        workingDirectory: tempDir
      }
    );

    assert.equal(calls.loadStore, 1);
    assert.deepEqual(result.failedItems, []);
    assert.equal(calls.scrape, 2);
    assert.equal(calls.transit, 2);
    assert.equal(result.batchMode, true);
    assert.equal(result.success, true);
    assert.equal(result.items.length, 2);
    assert.equal(result.eligibleCount, 2);
    assert.equal(result.batchStats.succeededCount, 2);
    assert.ok(result.batchStats.performance);
    assert.ok(Array.isArray(result.batchStats.performance.items));
    assert.equal(result.batchStats.performance.items.length, 2);
    assert.match(result.items[0].outputPath, /batch-items/);

    const outputPayload = JSON.parse(fs.readFileSync(result.outputPath, 'utf8'));
    assert.equal(outputPayload.batchMode, true);
    assert.equal(outputPayload.items.length, 2);
    assert.ok(outputPayload.batchStats.performance);
    assert.ok(outputPayload.scrape_debug.performance);
  } finally {
    clearModules([taskRunnerPath, ...mockedPaths]);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runHotelImportTask completes a single detail URL without batch writeResult scope leak', async () => {
  const taskRunnerPath = require.resolve('../src/task-runner');
  delete require.cache[taskRunnerPath];

  const events = [];
  const mockedPaths = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-task-runner-single-'));

  mockedPaths.push(
    installMock('../src/compare-app-bridge', {
      appendHotelsToStore: () => ({ operation: 'append', count: 1 }),
      findTemplateInStore: () => ({
        template_id: 'tpl-1',
        template_name: '实验',
        destination: '武汉站'
      }),
      getCompareAppStorePath: () => path.join(tempDir, 'hotel-data.json'),
      loadCompareAppStore: () => ({
        settings: {},
        templates: []
      })
    })
  );
  mockedPaths.push(
    installMock('../src/ctrip-list', {
      buildListResultsSummary: () => [],
      describeExpandedInput: () => '模式=detail，展开酒店=1',
      expandCtripHotelInputs: async () => ({
        inputMode: 'detail',
        requestedUrls: ['https://hotels.ctrip.com/hotels/detail/?hotelId=997775'],
        hotelInputs: [
          {
            url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=997775',
            hotelId: '997775',
            source: 'detail-input'
          }
        ],
        listResults: [],
        skippedUrls: [],
        performance: { totalMs: 1, listCollectMs: 0, lists: [] },
        summary: {
          inputMode: 'detail',
          requestedUrlCount: 1,
          detailInputCount: 1,
          listInputCount: 0,
          expandedHotelCount: 1,
          filters: {},
          performance: { totalMs: 1, listCollectMs: 0, lists: [] }
        }
      }),
      normalizeListFiltersFromArgs: () => ({})
    })
  );
  mockedPaths.push(
    installMock('../src/ctrip-scraper', {
      scrapeCtripHotel: async (url) => ({
        hotel_name: '武汉测试酒店',
        address: '武汉测试地址',
        ctrip_score: 4.8,
        geo: { location: '114.1,30.1' },
        room: { title: '大床房', price: 188, prices: [188], occupancy: 2 },
        room_candidates: [],
        raw_room_candidates: [],
        eligible_rooms: [],
        room_selection_diagnostics: { evaluations: [], eligibleRooms: [] },
        page_snapshot: {
          source_url: url,
          saved_html_files: [],
          room_candidates_count: 1,
          room_price_visible: true
        },
        performance: { totalMs: 3, htmlMs: 1, directReplayMs: 0, edgeCaptureMs: 0 }
      })
    })
  );
  mockedPaths.push(
    installMock('../src/amap', {
      getTransitInfo: async () => ({
        route: { durationMinutes: 20 },
        nearestSubway: { name: '测试站', distanceKm: 0.6 }
      })
    })
  );
  mockedPaths.push(
    installMock('../src/hotel-record', {
      buildHotelRecord: (template, scraped) => ({
        template_id: template.template_id,
        name: scraped.hotel_name,
        room_type: '大床房',
        total_price: 188,
        ctrip_score: scraped.ctrip_score,
        subway_distance: '0.6',
        transport_time: '20',
        bus_route: '测试路线'
      }),
      buildEligibleRoomRecords: (template, scraped) => [
        {
          template_id: template.template_id,
          name: scraped.hotel_name,
          room_type: '大床房',
          original_room_type: '大床房',
          daily_price: 188,
          total_price: 188,
          ctrip_score: scraped.ctrip_score,
          subway_distance: '0.6',
          transport_time: '20',
          bus_route: '测试路线'
        }
      ]
    })
  );
  mockedPaths.push(
    installMock('../src/review-input', {
      buildReviewInput: () => ({
        selectionLogs: [],
        rejectedRoomTypes: [],
        normalizeLogs: []
      }),
      buildReviewInputSummary: () => ({
        finalHotelCount: 1,
        rawCandidateCount: 0,
        eligibleCount: 1,
        rejectedCount: 0
      })
    })
  );
  mockedPaths.push(
    installMock('../src/template-loader', {
      applyMatchedTemplate: (template, matchedTemplate) => ({
        ...template,
        ...matchedTemplate,
        template_id: 'tpl-1',
        template_name: '实验',
        destination: '武汉站',
        check_in_date: '2026-06-01',
        check_out_date: '2026-06-02',
        room_count: 1
      }),
      loadTemplate: () => ({}),
      mergeTemplateWithArgs: (_templateFromFile, args) => ({
        template_id: args.templateId || 'tpl-1',
        template_name: args.templateName || '实验',
        ctrip_url: args.url,
        destination: '武汉站',
        check_in_date: '2026-06-01',
        check_out_date: '2026-06-02',
        room_count: 1
      }),
      validateTemplate: () => undefined
    })
  );

  try {
    const { runHotelImportTask } = require('../src/task-runner');
    const result = await runHotelImportTask(
      {
        url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=997775&checkIn=2026-06-01&checkOut=2026-06-02&adult=3',
        latestRun: path.join(tempDir, 'latest-run.json')
      },
      {
        workingDirectory: tempDir,
        onEvent: (event) => events.push(event)
      }
    );

    assert.equal(result.success, true);
    assert.notEqual(result.batchMode, true);
    assert.equal(result.hotelName, '武汉测试酒店');
    assert.equal(result.writeResult, null);
    assert.ok(
      events.some(
        (event) => event.type === 'task:done' && event.details && event.details.wrote === false
      )
    );
  } finally {
    clearModules([taskRunnerPath, ...mockedPaths]);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('write_report perf phase includes report_bytes and timing fields for single hotel', async () => {
  const taskRunnerPath = require.resolve('../src/task-runner');
  const perfPath = require.resolve('../src/runtime/perf');
  const devPerfPath = require.resolve('../../devtools/perf-log');
  const previousEnv = {
    HOTEL_COLLECTOR_ENV: process.env.HOTEL_COLLECTOR_ENV,
    ENABLE_PERF_LOG: process.env.ENABLE_PERF_LOG
  };
  process.env.HOTEL_COLLECTOR_ENV = 'dev';
  process.env.ENABLE_PERF_LOG = '1';
  delete require.cache[taskRunnerPath];
  delete require.cache[perfPath];
  delete require.cache[devPerfPath];

  const mockedPaths = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-task-runner-perf-'));

  mockedPaths.push(
    installMock('../src/compare-app-bridge', {
      appendHotelsToStore: () => ({ operation: 'append', count: 1 }),
      findTemplateInStore: () => ({
        template_id: 'tpl-1',
        template_name: '实验',
        destination: '武汉站'
      }),
      getCompareAppStorePath: () => path.join(tempDir, 'hotel-data.json'),
      loadCompareAppStore: () => ({
        settings: {},
        templates: []
      })
    })
  );
  mockedPaths.push(
    installMock('../src/ctrip-list', {
      buildListResultsSummary: () => [],
      describeExpandedInput: () => '模式=detail，展开酒店=1',
      expandCtripHotelInputs: async () => ({
        inputMode: 'detail',
        requestedUrls: ['https://hotels.ctrip.com/hotels/detail/?hotelId=1001'],
        hotelInputs: [
          {
            url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=1001',
            hotelId: '1001',
            source: 'detail-input'
          }
        ],
        listResults: [],
        skippedUrls: [],
        performance: { totalMs: 1, listCollectMs: 0, lists: [] },
        summary: {
          inputMode: 'detail',
          requestedUrlCount: 1,
          detailInputCount: 1,
          listInputCount: 0,
          expandedHotelCount: 1,
          filters: {},
          performance: { totalMs: 1, listCollectMs: 0, lists: [] }
        }
      }),
      normalizeListFiltersFromArgs: () => ({})
    })
  );
  mockedPaths.push(
    installMock('../src/ctrip-scraper', {
      scrapeCtripHotel: async () => ({
        hotel_name: '测试酒店',
        address: '测试地址',
        ctrip_score: 4.8,
        geo: { location: '114.1,30.1' },
        room: { title: '大床房', price: 188, prices: [188], occupancy: 2 },
        room_candidates: [],
        raw_room_candidates: [],
        eligible_rooms: [],
        room_selection_diagnostics: { evaluations: [], eligibleRooms: [] },
        page_snapshot: {
          source_url: 'https://example.com',
          saved_html_files: [],
          room_candidates_count: 1,
          room_price_visible: true
        },
        performance: { totalMs: 3, htmlMs: 1, directReplayMs: 0, edgeCaptureMs: 0 }
      })
    })
  );
  mockedPaths.push(
    installMock('../src/amap', {
      getTransitInfo: async () => ({
        route: { durationMinutes: 20 },
        nearestSubway: { name: '测试站', distanceKm: 0.6 }
      })
    })
  );
  mockedPaths.push(
    installMock('../src/hotel-record', {
      buildHotelRecord: (template, scraped) => ({
        template_id: template.template_id,
        name: scraped.hotel_name,
        room_type: '大床房',
        total_price: 188,
        ctrip_score: scraped.ctrip_score,
        subway_distance: '0.6',
        transport_time: '20',
        bus_route: '测试路线'
      }),
      buildEligibleRoomRecords: (template, scraped) => [
        {
          template_id: template.template_id,
          name: scraped.hotel_name,
          room_type: '大床房',
          original_room_type: '大床房',
          daily_price: 188,
          total_price: 188,
          ctrip_score: scraped.ctrip_score,
          subway_distance: '0.6',
          transport_time: '20',
          bus_route: '测试路线'
        }
      ]
    })
  );
  mockedPaths.push(
    installMock('../src/review-input', {
      buildReviewInput: () => ({
        selectionLogs: [],
        rejectedRoomTypes: [],
        normalizeLogs: []
      }),
      buildReviewInputSummary: () => ({
        finalHotelCount: 1,
        rawCandidateCount: 0,
        eligibleCount: 1,
        rejectedCount: 0
      })
    })
  );
  mockedPaths.push(
    installMock('../src/template-loader', {
      applyMatchedTemplate: (template, matchedTemplate) => ({
        ...template,
        ...matchedTemplate,
        template_id: 'tpl-1',
        template_name: '实验',
        destination: '武汉站',
        check_in_date: '2026-06-01',
        check_out_date: '2026-06-02',
        room_count: 1
      }),
      loadTemplate: () => ({}),
      mergeTemplateWithArgs: (_templateFromFile, args) => ({
        template_id: args.templateId || 'tpl-1',
        template_name: args.templateName || '实验',
        ctrip_url: args.url,
        destination: '武汉站',
        check_in_date: '2026-06-01',
        check_out_date: '2026-06-02',
        room_count: 1
      }),
      validateTemplate: () => undefined
    })
  );

  try {
    const records = [];
    const perfLogger = {
      enabled: true,
      write(record) {
        records.push(record);
        return record;
      }
    };
    const { runHotelImportTask } = require('../src/task-runner');
    await runHotelImportTask(
      {
        url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=1001&checkIn=2026-06-01&checkOut=2026-06-02',
        latestRun: path.join(tempDir, 'latest-run.json')
      },
      {
        workingDirectory: tempDir,
        perfLogger
      }
    );

    const writeReportRecords = records.filter(
      (record) => record.phase === 'write_report' && record.status === 'success'
    );
    assert.ok(writeReportRecords.length > 0, 'write_report phase should exist in perf records');

    const writeReport = writeReportRecords[0];
    assert.ok(
      typeof writeReport.report_bytes === 'number',
      'write_report should include report_bytes'
    );
    assert.ok(writeReport.report_bytes > 0, 'report_bytes should be greater than 0');
    assert.ok(
      typeof writeReport.report_stringify_ms === 'number',
      'write_report should include report_stringify_ms'
    );
    assert.ok(
      typeof writeReport.report_file_write_ms === 'number',
      'write_report should include report_file_write_ms'
    );
    assert.ok(
      typeof writeReport.report_total_write_ms === 'number',
      'write_report should include report_total_write_ms'
    );
    assert.equal(writeReport.reportLevel, 'normal');
  } finally {
    if (previousEnv.HOTEL_COLLECTOR_ENV === undefined) {
      delete process.env.HOTEL_COLLECTOR_ENV;
    } else {
      process.env.HOTEL_COLLECTOR_ENV = previousEnv.HOTEL_COLLECTOR_ENV;
    }
    if (previousEnv.ENABLE_PERF_LOG === undefined) {
      delete process.env.ENABLE_PERF_LOG;
    } else {
      process.env.ENABLE_PERF_LOG = previousEnv.ENABLE_PERF_LOG;
    }
    clearModules([taskRunnerPath, perfPath, devPerfPath, ...mockedPaths]);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
