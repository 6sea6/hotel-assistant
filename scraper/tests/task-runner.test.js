const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function installMock(modulePath, exports) {
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
