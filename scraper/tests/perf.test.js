const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function clearPerfModules() {
  ['../src/runtime/perf', '../src/runtime/noop-perf', '../../devtools/perf-log'].forEach(
    (modulePath) => {
      try {
        delete require.cache[require.resolve(modulePath)];
      } catch (_error) {
        // Module may not exist yet while running the red test.
      }
    }
  );
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
