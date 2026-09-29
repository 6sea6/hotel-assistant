const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  CtripAccessController,
  classifyAccessIssue,
  retryAfterMs,
  wait
} = require('../src/ctrip-access-controller');
const { TaskCaptureCache, captureKey } = require('../src/task-capture-cache');
const { TaskCheckpoint } = require('../src/task-checkpoint');
const { attachCtripCdpGuard } = require('../src/scraper/ctrip-cdp-guard');
const { isCompleteRoomPayload } = require('../src/scraper/room-response-completeness');

test('HTTP and business codes remain separate; no rooms is not an access issue', () => {
  assert.equal(classifyAccessIssue({ httpStatus: 203 }), null);
  assert.equal(classifyAccessIssue({ businessCode: 203 }).kind, 'risk_control');
  assert.equal(classifyAccessIssue({ httpStatus: 403 }).kind, 'access_denied');
  assert.equal(classifyAccessIssue({ httpStatus: 429 }).kind, 'rate_limited');
  assert.equal(classifyAccessIssue({ login: true }).kind, 'login_required');
  assert.equal(classifyAccessIssue({ businessCode: 0 }), null);
});

test('Retry-After honors seconds and HTTP date beyond local backoff cap', () => {
  const now = Date.parse('2026-09-29T00:00:00Z');
  assert.equal(retryAfterMs({ 'Retry-After': '120' }, now), 120000);
  assert.equal(retryAfterMs({ 'retry-after': 'Tue, 29 Sep 2026 00:02:00 GMT' }, now), 120000);
  assert.equal(retryAfterMs({ 'Retry-After': 'invalid' }, now), null);
  assert.equal(classifyAccessIssue({ httpStatus: 429, headers: {} }, now).resumeAt, now + 60000);
});

test('risk with visible prices persists across controller instances and requires two confirmations', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'access-test-'));
  const statePath = path.join(dir, 'access.json');
  try {
    const controller = new CtripAccessController({ statePath });
    let count = 0;
    await assert.rejects(
      controller.run(async () => {
        count += 1;
        controller.report({ businessCode: 203 });
        return { price: 200 };
      }),
      { code: 'CTRIP_ACCESS_PAUSED' }
    );
    const restarted = new CtripAccessController({ statePath });
    await assert.rejects(
      restarted.run(() => {
        count += 1;
      }),
      { code: 'CTRIP_ACCESS_PAUSED' }
    );
    assert.equal(count, 1);
    assert.equal(restarted.confirmRecovery({ userConfirmed: false, pageVerified: true }), false);
    assert.equal(restarted.confirmRecovery({ userConfirmed: true, pageVerified: false }), false);
    assert.equal(restarted.confirmRecovery({ userConfirmed: true, pageVerified: true }), true);
    assert.equal(await restarted.run(async () => 'ok'), 'ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('shared cooldown allows one recovery attempt, repeated limit becomes manual', async () => {
  let now = 0;
  const waits = [];
  const controller = new CtripAccessController({
    now: () => now,
    sleep: async (ms) => {
      waits.push(ms);
      now += ms;
    }
  });
  let attempts = 0;
  await assert.rejects(
    controller.run(async () => {
      attempts += 1;
      controller.report({ httpStatus: 429, headers: { 'Retry-After': '120' } });
      controller.assertAllowed();
    }),
    { code: 'CTRIP_ACCESS_PAUSED' }
  );
  assert.equal(attempts, 2);
  assert.deepEqual(waits, [60000, 60000]);
  assert.equal(controller.issue.requiresUserAction, true);
  await assert.rejects(
    controller.run(async () => {
      attempts += 1;
    }),
    { code: 'CTRIP_ACCESS_PAUSED' }
  );
  assert.equal(attempts, 2);
});

test('transient failure retries once and cancellation interrupts waits', async () => {
  const waits = [];
  const controller = new CtripAccessController({
    random: () => 0.5,
    sleep: async (ms) => waits.push(ms)
  });
  let attempts = 0;
  await assert.rejects(
    controller.run(async () => {
      attempts += 1;
      throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    }),
    /timeout/
  );
  assert.equal(attempts, 2);
  assert.deepEqual(waits, [1500]);
  const abort = new AbortController();
  const pending = wait(60000, abort.signal);
  abort.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('other business operations wait until the single rate-limit recovery probe succeeds', async () => {
  const controller = new CtripAccessController();
  let release;
  let enteredProbe;
  const probeStarted = new Promise((resolve) => {
    enteredProbe = resolve;
  });
  const probeGate = new Promise((resolve) => {
    release = resolve;
  });
  let attempts = 0;
  const first = controller.run(async () => {
    attempts += 1;
    if (attempts === 1) {
      controller.report({ httpStatus: 429, headers: { 'Retry-After': '0' } });
      controller.assertAllowed();
    }
    enteredProbe();
    await probeGate;
    return 'recovered';
  });
  await probeStarted;
  let secondStarted = false;
  const second = controller.run(async () => {
    secondStarted = true;
    return 'next';
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(secondStarted, false);
  release();
  assert.deepEqual(await Promise.all([first, second]), ['recovered', 'next']);
  assert.equal(controller.metrics.recoveries, 1);
});

test('task cache merges in-flight work and separates dates, occupants, rooms and sessions', async () => {
  const cache = new TaskCaptureCache();
  const template = { check_in_date: '2026-10-01', room_count: 1, adults: 2, children: [4] };
  const url = 'https://hotels.ctrip.com/hotels/123.html';
  const key = captureKey(url, template);
  for (const change of [
    { check_in_date: '2026-10-02' },
    { room_count: 2 },
    { adults: 3 },
    { children: [5] }
  ]) {
    assert.notEqual(key, captureKey(url, { ...template, ...change }));
  }
  assert.notEqual(key, captureKey(url, template, 1));
  let calls = 0;
  const collect = async () => {
    calls += 1;
    return { page_snapshot: { capture_complete: true }, rooms: [100, 90] };
  };
  const values = await Promise.all([
    cache.getOrCollect(key, collect),
    cache.getOrCollect(key, collect)
  ]);
  assert.equal(calls, 1);
  values[0].rooms[0] = 999;
  assert.equal(values[1].rooms[0], 100);
  cache.clear();
  await cache.getOrCollect(key, collect);
  assert.equal(calls, 2);
  const incomplete = async () => {
    calls += 1;
    return { page_snapshot: { capture_complete: false } };
  };
  await cache.getOrCollect('partial', incomplete);
  await cache.getOrCollect('partial', incomplete);
  assert.equal(calls, 4);
});

test('complete room data requires every sale reference, no pagination and no risk', () => {
  const payload = {
    data: {
      roomCount: 2,
      roomList: [{ key: 'p', subRoomList: [{ skey: 'a' }, { skey: 'b' }] }],
      saleRoomMap: { a: { price: 200 }, b: { price: 100 } },
      physicRoomMap: { p: {} }
    }
  };
  assert.equal(isCompleteRoomPayload(payload), true);
  for (const patch of [
    { hasMore: true },
    { htlSpiderActionErrorCode: 203 },
    { roomCount: 3 },
    { saleRoomMap: { a: {} } }
  ]) {
    assert.equal(isCompleteRoomPayload({ data: { ...payload.data, ...patch } }), false);
  }
  assert.equal(isCompleteRoomPayload({ roomName: 'priced room', price: 100 }), false);
});

test('CDP guard shares body reads and prevents automatic actions after mixed price and 203', async () => {
  const listeners = new Set();
  const calls = [];
  const controller = new CtripAccessController();
  const connection = {
    addListener(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async send(method) {
      calls.push(method);
      return { body: JSON.stringify({ data: { htlSpiderActionErrorCode: 203, price: 100 } }) };
    }
  };
  const detach = attachCtripCdpGuard(connection, 's', controller);
  for (const listener of listeners)
    listener({
      sessionId: 's',
      method: 'Network.responseReceived',
      params: {
        requestId: 'r',
        response: { url: 'https://m.ctrip.com/restapi/soa2/30103/getHotelRoomList', status: 200 }
      }
    });
  await Promise.all(
    [1, 2].map(() =>
      assert.rejects(connection.send('Network.getResponseBody', { requestId: 'r' }, 's'), {
        code: 'CTRIP_ACCESS_PAUSED'
      })
    )
  );
  await assert.rejects(
    connection.send('Page.navigate', { url: 'https://hotels.ctrip.com/' }, 's'),
    { code: 'CTRIP_ACCESS_PAUSED' }
  );
  assert.equal(calls.filter((value) => value === 'Network.getResponseBody').length, 1);
  assert.equal(calls.includes('Page.navigate'), false);
  assert.equal(calls.includes('Page.stopLoading'), true);
  detach();
});

test('checkpoint preserves complete results and rejects changed query', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkpoint-test-'));
  try {
    const key = 'a'.repeat(64);
    const checkpoint = new TaskCheckpoint(dir, 'test', { date: '2026-10-01' });
    checkpoint.record(key, {
      result: { success: true, pageSnapshot: { capture_complete: false } }
    });
    assert.equal(checkpoint.get(key), null);
    checkpoint.record(key, {
      result: { success: true, collectedAt: 'original', pageSnapshot: { capture_complete: true } }
    });
    checkpoint.markWritten(key);
    checkpoint.pause({ hotelInputs: [{ url: 'public' }] });
    const restored = new TaskCheckpoint(dir, 'test', { date: '2026-10-01' }, true);
    assert.equal(restored.get(key).result.collectedAt, 'original');
    assert.equal(restored.get(key).result.resumedFromCheckpoint, true);
    assert.throws(() => new TaskCheckpoint(dir, 'test', { date: '2026-10-02' }, true), /查询条件/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('batch writeback excludes incomplete and risk results even without reports', () => {
  const { prepareBatchCollections } = require('../src/batch-artifact-writer');
  for (const reportDisabled of [false, true]) {
    const itemResults = [
      { capture_complete: false },
      { capture_complete: true, spider_error_codes: [203] },
      { capture_complete: true }
    ].map((pageSnapshot, index) => ({
      index,
      childResult: { success: true, pageSnapshot, eligibleHotels: [{ id: index }] },
      childPayload: { hotels: [{ id: index }] }
    }));
    const result = prepareBatchCollections({ itemResults, reportDisabled });
    assert.deepEqual(result.allHotels, [{ id: 2 }]);
    assert.equal(result.resultPayloads.length, 1);
    assert.equal(result.childResults.length, 3);
  }
});

test('desktop timing includes cleanup, writeback and pauses without double subtracting manual time', () => {
  const { finishDesktopCaptureTiming } = require('../../src/main/ai/capture-timing');
  const result = finishDesktopCaptureTiming(
    {
      performance: {
        startedAtMs: 100,
        measuredAtMs: 900,
        totalMs: 800,
        pausedMs: 500,
        checkpointPauseInterval: [100, 600],
        manualWaitMs: 20,
        cooldownMs: 30
      }
    },
    400,
    [[450, 650]],
    1000
  );
  assert.equal(result.performance.totalMs, 900);
  assert.equal(result.performance.manualWaitMs, 220);
  assert.equal(result.performance.activeMs, 300);
});
