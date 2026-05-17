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
      normalizeListFiltersFromArgs: () => ({ desiredHotelCount: 2, maxPages: 1 })
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
