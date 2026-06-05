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

function clearPerfModules() {
  [
    '../src/runtime/perf',
    '../src/runtime/noop-perf',
    '../src/runtime/file-perf',
    '../../devtools/perf-log'
  ].forEach((modulePath) => {
    try {
      delete require.cache[require.resolve(modulePath)];
    } catch (_error) {
      // Module may not exist yet while running the red test.
    }
  });
}

function withEnv(env, callback) {
  const previous = {
    HOTEL_COLLECTOR_ENV: process.env.HOTEL_COLLECTOR_ENV,
    ENABLE_PERF_LOG: process.env.ENABLE_PERF_LOG
  };
  Object.assign(process.env, env);
  try {
    return callback();
  } finally {
    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
    clearPerfModules();
  }
}

test('production perf entry uses noop without creating logs or loading devtools', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-perf-noop-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(tempDir);
    await withEnv({ HOTEL_COLLECTOR_ENV: 'prod', ENABLE_PERF_LOG: '1' }, async () => {
      const { setup_perf_logger, PerfTimer, BatchStats } = require('../src/runtime/perf');
      const logger = setup_perf_logger();
      const perf = new PerfTimer(logger, { runId: 'run-prod', taskId: 'task-prod' });

      await perf.runPhase('goto_url', { url: 'https://example.test' }, async () => 'ok');
      const stats = new BatchStats(perf);
      stats.recordTask({ taskId: 'task-prod', status: 'success', elapsedMs: 1 });
      stats.flush();

      assert.equal(logger.enabled, false);
      assert.equal(fs.existsSync(path.join(tempDir, 'logs')), false);
      assert.equal(
        Object.keys(require.cache).some((key) => key.includes(`${path.sep}devtools${path.sep}`)),
        false
      );
    });
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('dev perf logger redacts sensitive fields and preserves observability fields', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-perf-redact-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(tempDir);
    await withEnv({ HOTEL_COLLECTOR_ENV: 'dev', ENABLE_PERF_LOG: '1' }, async () => {
      const { setup_perf_logger, PerfTimer } = require('../src/runtime/perf');
      const logger = setup_perf_logger({ date: '2026-05-19' });
      const perf = new PerfTimer(logger, {
        runId: 'run-redact',
        taskId: 'task-redact',
        taskKind: 'collect'
      });

      perf.event('phase', {
        phase: 'api_replay_request',
        status: 'success',
        endpoint: 'https://example.test/api?token=secret-token&hotelId=1',
        variantName: 'plain-1',
        cookie: 'SESSION=secret-cookie',
        authorization: 'Bearer secret-auth',
        apiKey: 'secret-api-key',
        amapKey: 'secret-amap-key',
        edgeProfilePath: 'C:\\Users\\Alice\\AppData\\Local\\Microsoft\\Edge\\User Data',
        wait_reason: 'missing_price',
        capture_method: 'html_then_api_replay',
        room_candidates_count: 3,
        room_price_visible: true
      });

      const logPath = path.join(tempDir, 'logs', 'perf', 'collect_perf_2026-05-19.jsonl');
      const record = JSON.parse(fs.readFileSync(logPath, 'utf8').trim());
      const serialized = JSON.stringify(record);

      assert.equal(record.task_kind, 'collect');
      assert.equal(record.variant_name, 'plain-1');
      assert.equal(record.wait_reason, 'missing_price');
      assert.equal(record.capture_method, 'html_then_api_replay');
      assert.equal(record.room_candidates_count, 3);
      assert.equal(record.room_price_visible, true);
      assert.doesNotMatch(
        serialized,
        /secret-token|secret-cookie|secret-auth|secret-api-key|secret-amap-key|Alice/
      );
      assert.match(serialized, /\[REDACTED\]/);
    });
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('dev perf child meta aliases override empty parent defaults', async () => {
  await withEnv({ HOTEL_COLLECTOR_ENV: 'dev', ENABLE_PERF_LOG: '1' }, async () => {
    const { PerfTimer } = require('../src/runtime/perf');
    const records = [];
    const perf = new PerfTimer(
      {
        enabled: true,
        write(record) {
          records.push(record);
          return record;
        }
      },
      {
        runId: 'run-child',
        taskId: 'task-child'
      }
    );

    perf
      .child({
        taskKind: 'collect',
        waitReason: 'missing_price',
        captureMethod: 'html_then_edge_cdp'
      })
      .event('phase', {
        phase: 'edge_connect',
        status: 'success'
      });

    assert.equal(records[0].task_kind, 'collect');
    assert.equal(records[0].wait_reason, 'missing_price');
    assert.equal(records[0].capture_method, 'html_then_edge_cdp');
  });
});

test('dev perf logger default filename includes local timestamp and is unique per run', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-perf-unique-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(tempDir);
    await withEnv({ HOTEL_COLLECTOR_ENV: 'dev', ENABLE_PERF_LOG: '1' }, async () => {
      const { setup_perf_logger } = require('../src/runtime/perf');
      const firstLogger = setup_perf_logger({
        date: new Date(2026, 4, 20, 8, 9, 10, 123)
      });
      const secondLogger = setup_perf_logger({
        date: new Date(2026, 4, 20, 8, 9, 10, 124)
      });

      assert.notEqual(firstLogger.logPath, secondLogger.logPath);
      assert.match(
        path.basename(firstLogger.logPath),
        /^collect_perf_2026-05-20_08-09-10-123\.jsonl$/
      );
      assert.match(
        path.basename(secondLogger.logPath),
        /^collect_perf_2026-05-20_08-09-10-124\.jsonl$/
      );
    });
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('BatchStats summary exposes item percentiles, phase totals and slowest items', async () => {
  await withEnv({ HOTEL_COLLECTOR_ENV: 'dev', ENABLE_PERF_LOG: '1' }, async () => {
    const { PerfTimer, BatchStats } = require('../src/runtime/perf');
    const records = [];
    const logger = {
      enabled: true,
      write(record) {
        records.push(record);
        return record;
      }
    };
    const perf = new PerfTimer(logger, {
      runId: 'run-batch',
      taskId: 'task-batch',
      taskKind: 'batch_collect'
    });
    const stats = new BatchStats(perf, { taskKind: 'batch_collect' });

    [
      {
        index: 1,
        hotelId: 'h1',
        hotelName: '快酒店',
        url: 'https://example.test/1',
        status: 'success',
        elapsedMs: 100,
        waitDataMs: 20,
        edgeMs: 10,
        apiReplayMs: 5,
        htmlMs: 30,
        transitMs: 15,
        saveMs: 8,
        captureMethod: 'html_only',
        waitReason: ''
      },
      {
        index: 2,
        hotelId: 'h2',
        hotelName: '慢酒店',
        url: 'https://example.test/2',
        status: 'success',
        elapsedMs: 300,
        waitDataMs: 120,
        edgeMs: 80,
        apiReplayMs: 20,
        htmlMs: 40,
        transitMs: 25,
        saveMs: 10,
        captureMethod: 'html_then_edge_cdp',
        waitReason: 'missing_price'
      },
      {
        index: 3,
        hotelId: 'h3',
        hotelName: '中酒店',
        url: 'https://example.test/3',
        status: 'failed',
        elapsedMs: 200,
        waitDataMs: 60,
        edgeMs: 0,
        apiReplayMs: 50,
        htmlMs: 35,
        transitMs: 0,
        saveMs: 4,
        captureMethod: 'html_then_api_replay',
        waitReason: 'retry_after_edge_failed'
      }
    ].forEach((item) => stats.recordTask(item));

    const summary = stats.flush({
      elapsed_ms: 700,
      list_expand_ms: 55,
      child_phase_sum: 999
    });
    const summaryRecord = records.find((record) => record.event === 'batch_summary');

    assert.equal(summary.item_count, 3);
    assert.equal(summary.succeeded_count, 2);
    assert.equal(summary.failed_count, 1);
    assert.equal(summary.total_elapsed_ms, 700);
    assert.equal(summary.item_total_ms_sum, 600);
    assert.equal(summary.average_item_ms, 200);
    assert.equal(summary.p50_item_ms, 200);
    assert.equal(summary.p90_item_ms, 300);
    assert.equal(summary.max_item_ms, 300);
    assert.equal(summary.wait_data_total_ms, 200);
    assert.equal(summary.wait_data_average_ms, 200 / 3);
    assert.equal(summary.edge_total_ms, 90);
    assert.equal(summary.api_replay_total_ms, 75);
    assert.equal(summary.html_total_ms, 105);
    assert.equal(summary.transit_total_ms, 40);
    assert.equal(summary.save_total_ms, 22);
    assert.equal(summary.list_expand_ms, 55);
    assert.equal(summary.wall_time, 700);
    assert.equal(summary.child_phase_sum, 999);
    assert.match(summary.nested_phase_note, /nested/i);
    assert.equal(summary.slowest_items[0].hotelName, '慢酒店');
    assert.equal(summary.slowest_items[0].waitDataMs, 120);
    assert.equal(summary.slowest_items[0].captureMethod, 'html_then_edge_cdp');
    assert.equal(summaryRecord.task_kind, 'batch_collect');
    assert.equal(summaryRecord.item_count, 3);
  });
});

test('direct API replay records internal phases without sensitive request data', async () => {
  await withEnv({ HOTEL_COLLECTOR_ENV: 'dev', ENABLE_PERF_LOG: '1' }, async () => {
    const apiReplayPath = require.resolve('../src/scraper/api-replay');
    const httpClientPath = installMock('../src/http-client', {
      post: async () => ({
        data: {
          data: {
            htlSpiderActionErrorCode: 203
          }
        }
      })
    });
    delete require.cache[apiReplayPath];

    try {
      const { PerfTimer } = require('../src/runtime/perf');
      const records = [];
      const perf = new PerfTimer(
        {
          enabled: true,
          write(record) {
            records.push(record);
            return record;
          }
        },
        {
          runId: 'run-api',
          taskId: 'task-api'
        }
      );
      const { captureRoomCandidatesDirect } = require('../src/scraper/api-replay');

      const result = await captureRoomCandidatesDirect(
        'https://hotels.ctrip.com/hotels/detail/?hotelId=12345',
        { check_in_date: '2026-06-01', check_out_date: '2026-06-02', room_count: 2 },
        [
          {
            source: 'desktop',
            html: '<html></html>',
            url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=12345',
            cookieHeader: 'SESSION=secret-cookie'
          }
        ],
        { perf }
      );

      assert.equal(result.selectedRoom, null);
      assert.deepEqual(result.spiderErrorCodes, [203]);
      assert.ok(records.some((record) => record.phase === 'api_replay_build_context'));
      assert.ok(records.some((record) => record.phase === 'api_replay_build_variants'));
      assert.ok(records.some((record) => record.phase === 'api_replay_request'));
      assert.ok(records.some((record) => record.phase === 'api_replay_total'));
      const requestRecord = records.find((record) => record.phase === 'api_replay_request');
      assert.equal(requestRecord.variant_name, 'plain-1');
      assert.equal(requestRecord.spider_error_code, 203);
      assert.equal(requestRecord.room_candidates_count, 0);
      assert.equal(requestRecord.room_price_visible, false);
      assert.doesNotMatch(JSON.stringify(records), /secret-cookie|body|cookie|authorization/i);
    } finally {
      delete require.cache[apiReplayPath];
      delete require.cache[httpClientPath];
    }
  });
});

test('phase error records child phase failures', async () => {
  await withEnv({ HOTEL_COLLECTOR_ENV: 'dev', ENABLE_PERF_LOG: '1' }, async () => {
    const { PerfTimer } = require('../src/runtime/perf');
    const records = [];
    const perf = new PerfTimer({
      enabled: true,
      write(record) {
        records.push(record);
        return record;
      }
    });

    await assert.rejects(
      () =>
        perf.runPhase('edge_response_parse', { captureMethod: 'html_then_edge_cdp' }, async () => {
          throw new SyntaxError('bad json');
        }),
      /bad json/
    );

    const errorRecord = records.find((record) => record.event === 'phase_error');
    assert.equal(errorRecord.phase, 'edge_response_parse');
    assert.equal(errorRecord.error_type, 'SyntaxError');
    assert.equal(errorRecord.capture_method, 'html_then_edge_cdp');
  });
});

test('dev perf logger writes JSONL phase success and error records', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-perf-dev-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(tempDir);
    await withEnv({ HOTEL_COLLECTOR_ENV: 'dev', ENABLE_PERF_LOG: '1' }, async () => {
      const { setup_perf_logger, PerfTimer, BatchStats } = require('../src/runtime/perf');
      const logger = setup_perf_logger({ date: '2026-05-18' });
      const perf = new PerfTimer(logger, {
        runId: 'run-dev',
        taskId: 'task-dev',
        city: '武汉'
      });

      await perf.runPhase('goto_url', { url: 'https://example.test/hotel' }, async () => 'ok');
      await assert.rejects(
        () =>
          perf.runPhase('wait_data', { retryCount: 2 }, async () => {
            throw new TypeError('network timeout');
          }),
        /network timeout/
      );
      const stats = new BatchStats(perf);
      stats.recordTask({ taskId: 'task-dev', status: 'failed', elapsedMs: 12 });
      stats.flush({ hotelCount: 1 });

      const logPath = path.join(tempDir, 'logs', 'perf', 'collect_perf_2026-05-18.jsonl');
      const lines = fs.readFileSync(logPath, 'utf8').trim().split(/\r?\n/);
      const records = lines.map((line) => JSON.parse(line));
      const success = records.find((item) => item.phase === 'goto_url');
      const error = records.find((item) => item.event === 'phase_error');
      const summary = records.find((item) => item.event === 'batch_summary');

      assert.equal(logger.enabled, true);
      assert.equal(success.event, 'phase');
      assert.equal(success.status, 'success');
      assert.equal(success.run_id, 'run-dev');
      assert.equal(success.task_id, 'task-dev');
      assert.equal(success.city, '武汉');
      assert.equal(success.url, 'https://example.test/hotel');
      assert.equal(typeof success.elapsed_ms, 'number');
      assert.equal(error.phase, 'wait_data');
      assert.equal(error.status, 'error');
      assert.equal(error.error_type, 'TypeError');
      assert.equal(error.error_message, 'network timeout');
      assert.equal(error.retry_count, 2);
      assert.equal(summary.hotel_count, 1);
      [
        'ts',
        'level',
        'event',
        'run_id',
        'task_id',
        'phase',
        'elapsed_ms',
        'status',
        'error_type',
        'error_message',
        'city',
        'url',
        'page_index',
        'hotel_count',
        'retry_count',
        'captcha_detected'
      ].forEach((key) => assert.ok(Object.prototype.hasOwnProperty.call(success, key)));
    });
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
