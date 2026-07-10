const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AdaptiveDetailScheduler,
  CTRIP_RISK_CONTROL_ABORT_CODE,
  isSoftPriceFailureResult
} = require('../src/adaptive-detail-scheduler');

function pricedResult() {
  return {
    totalPrice: 300,
    pageSnapshot: {
      edge_fallback_used: true,
      room_price_visible: true,
      sources: [{ source: 'edge-cdp', room_price_visible: true }]
    }
  };
}

function softFailureResult() {
  return {
    totalPrice: null,
    pageSnapshot: {
      edge_fallback_used: true,
      room_price_visible: false,
      booking_unavailable: false,
      sources: [{ source: 'edge-cdp', room_price_visible: false }]
    }
  };
}

test('adaptive scheduler warms up serially, spaces starts, then allows three active details', async () => {
  let now = 0;
  const waits = [];
  const scheduler = new AdaptiveDetailScheduler({
    maxConcurrency: 3,
    detailStartIntervalMs: 2000,
    warmupHotelCount: 3,
    now: () => now,
    delay: async (ms) => {
      waits.push(ms);
      now += ms;
    }
  });

  await scheduler.beforeStart({ index: 1, total: 6 });
  const secondStart = scheduler.beforeStart({ index: 2, total: 6 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scheduler.startedCount, 1);
  scheduler.recordOutcome(pricedResult(), { index: 1, total: 6 });
  await secondStart;
  assert.equal(now, 2000);

  const thirdStart = scheduler.beforeStart({ index: 3, total: 6 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scheduler.startedCount, 2);
  scheduler.recordOutcome(pricedResult(), { index: 2, total: 6 });
  await thirdStart;
  scheduler.recordOutcome(pricedResult(), { index: 3, total: 6 });

  assert.equal(scheduler.snapshot().scheduler_mode, 'normal');
  await scheduler.beforeStart({ index: 4, total: 6 });
  await scheduler.beforeStart({ index: 5, total: 6 });
  await scheduler.beforeStart({ index: 6, total: 6 });

  assert.equal(scheduler.activeCount, 3);
  assert.equal(scheduler.getAllowedConcurrency(), 3);
  assert.ok(waits.every((waitMs) => waitMs === 2000));
});

test('adaptive scheduler degrades after two soft failures and recovers after ten clean results', async () => {
  let now = 0;
  const scheduler = new AdaptiveDetailScheduler({
    maxConcurrency: 3,
    warmupHotelCount: 0,
    detailStartIntervalMs: 0,
    degradedStartIntervalMs: 3000,
    now: () => now,
    delay: async (ms) => {
      now += ms;
    }
  });

  assert.equal(isSoftPriceFailureResult(softFailureResult()), true);
  for (let index = 1; index <= 2; index += 1) {
    await scheduler.beforeStart({ index, total: 12 });
    scheduler.recordOutcome(softFailureResult(), { index, total: 12 });
  }
  assert.equal(scheduler.snapshot().scheduler_mode, 'degraded');
  assert.equal(scheduler.snapshot().recent_soft_failure_rate, 1);
  assert.equal(scheduler.getAllowedConcurrency(), 2);
  assert.equal(scheduler.getStartIntervalMs(), 3000);

  for (let index = 3; index <= 12; index += 1) {
    await scheduler.beforeStart({ index, total: 12 });
    scheduler.recordOutcome(pricedResult(), { index, total: 12 });
  }
  assert.equal(scheduler.snapshot().scheduler_mode, 'normal');
  assert.equal(scheduler.getAllowedConcurrency(), 3);
});

test('adaptive scheduler opens a hard circuit on first 203 and rejects pending starts', async () => {
  const scheduler = new AdaptiveDetailScheduler({
    maxConcurrency: 3,
    warmupHotelCount: 0,
    detailStartIntervalMs: 0
  });

  await scheduler.beforeStart({ index: 1, total: 10 });
  scheduler.recordOutcome(
    {
      totalPrice: null,
      pageSnapshot: {
        room_price_visible: false,
        spider_error_codes: [203],
        login_reason: '携程房价接口返回 203'
      }
    },
    { index: 1, total: 10 }
  );

  await assert.rejects(
    scheduler.beforeStart({ index: 2, total: 10 }),
    (error) => error && error.code === CTRIP_RISK_CONTROL_ABORT_CODE
  );
  assert.equal(scheduler.snapshot().risk_control_count, 1);
  assert.equal(scheduler.snapshot().circuit_open, true);
});
