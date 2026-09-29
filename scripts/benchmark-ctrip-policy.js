// Offline comparison: real coordinator/room-selection/scheduler code, deterministic transport.
// This measures a specified network model, never a live Ctrip throughput guarantee.
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');

class VirtualClock {
  constructor() {
    this.now = 0;
    this.pending = [];
  }
  sleep(ms) {
    return new Promise((resolve) => this.pending.push({ at: this.now + ms, resolve }));
  }
  async drive(promise) {
    let done = false;
    let failure;
    promise.then(
      () => {
        done = true;
      },
      (error) => {
        done = true;
        failure = error;
      }
    );
    while (!done) {
      // Flush all real source promise continuations before advancing modeled network time.
      await new Promise((resolve) => setImmediate(resolve));
      if (this.pending.length) {
        this.pending.sort((a, b) => a.at - b.at);
        this.now = this.pending[0].at;
        const ready = this.pending.filter((entry) => entry.at === this.now);
        this.pending = this.pending.filter((entry) => entry.at !== this.now);
        ready.forEach((entry) => entry.resolve());
      } else if (!done) throw new Error('Virtual model has unresolved work without a timer');
    }
    if (failure) throw failure;
    return promise;
  }
}

function mock(root, relative, exports) {
  const filename = require.resolve(path.join(root, relative));
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

async function run(root, optimized, count, runIndex) {
  for (const filename of Object.keys(require.cache))
    if (filename.startsWith(root + path.sep)) delete require.cache[filename];
  const clock = new VirtualClock();
  const requests = { html: 0, browser: 0, replay: 0 };
  const rooms = [
    {
      title: '标准大床房',
      standard_title: '大床房',
      price: 220,
      prices: [220],
      occupancy: 2,
      cancelPolicy: '免费取消',
      source: 'edge-api'
    },
    {
      title: '优惠大床房',
      standard_title: '大床房',
      price: 180,
      prices: [180],
      occupancy: 2,
      cancelPolicy: '免费取消',
      source: 'edge-api'
    },
    {
      title: '不可退大床房',
      standard_title: '大床房',
      price: 150,
      prices: [150],
      occupancy: 2,
      cancelPolicy: '不可取消',
      source: 'edge-api'
    }
  ];
  const html = '<html><body>测试酒店 房型列表</body></html>';
  mock(root, 'scraper/html-parser.js', {
    DESKTOP_HEADERS: {},
    MOBILE_HEADERS: {},
    async fetchHtml() {
      requests.html += 1;
      await clock.sleep(550 + runIndex * 20);
      return { html };
    },
    loadHtmlFromFile: () => html,
    saveHtmlSnapshot: () => '',
    extractHotelMetaFromHtml: () => ({
      hotelName: '固定样本',
      address: '样本地址',
      geoInfo: { address: '样本地址' },
      score: 4.8
    }),
    extractHotelScoreFromHtml: () => 4.8,
    findRoomBlocksFromHtml: () => []
  });
  mock(root, 'scraper/api-replay.js', {
    async captureRoomCandidatesDirect() {
      requests.replay += 1;
      throw new Error('Unexpected replay');
    }
  });
  mock(root, 'scraper/edge-capture.js', {
    shouldAttemptSupplementalCapture: () => true,
    shouldPreferEdgeCapture: () => true,
    async captureRoomCandidatesWithEdge() {
      requests.browser += 1;
      await clock.sleep(900 + runIndex * 30);
      return {
        html,
        roomBlocks: structuredClone(rooms),
        selectedRoom: rooms[1],
        captureComplete: true,
        trackedUrls: ['room-api'],
        spiderErrorCodes: [],
        edgeWaitedForSettle: true,
        settleStats: { totalMs: 900 }
      };
    }
  });
  const { scrapeCtripHotel } = require(path.join(root, 'ctrip-scraper.js'));
  const { AdaptiveDetailScheduler } = require(path.join(root, 'adaptive-detail-scheduler.js'));
  const { runBoundedWorkers } = require(path.join(root, 'bounded-worker-runner.js'));
  const scheduler = new AdaptiveDetailScheduler({
    maxConcurrency: 3,
    warmupHotelCount: 3,
    detailStartIntervalMs: 2000,
    degradedStartIntervalMs: 3000,
    now: () => clock.now,
    delay: (ms) => clock.sleep(ms)
  });
  const started = performance.now();
  let firstResultMs = null;
  const outputs = [];
  const task = runBoundedWorkers({
    items: Array.from({ length: count }, (_, i) => i),
    requestedConcurrency: 3,
    maxConcurrency: 3,
    async runItem({ item }) {
      await scheduler.beforeStart({ index: item + 1, total: count });
      const template = {
        room_type: '大床房',
        room_count: 2,
        check_in_date: '2026-10-01',
        check_out_date: '2026-10-03',
        days: 2
      };
      const result = await scrapeCtripHotel(
        `https://hotels.ctrip.com/hotels/${1000 + item}.html`,
        template,
        {
          captureStrategy: optimized ? 'browser_first' : undefined,
          includeMobileHtml: false,
          directRoomReplay: false
        }
      );
      firstResultMs ??= clock.now;
      outputs[item] = {
        hotel: result.hotel_name,
        rooms: result.eligible_rooms.map((room) => [room.title, room.price]).sort(),
        selected: result.room?.price,
        dates: [template.check_in_date, template.check_out_date],
        total: result.room?.price * template.days * template.room_count
      };
      scheduler.recordOutcome({
        success: true,
        eligibleCount: result.eligible_rooms.length,
        totalPrice: result.room?.price,
        pageSnapshot: result.page_snapshot
      });
    }
  });
  await clock.drive(task);
  return {
    modeledTotalMs: clock.now,
    hostCpuWallMs: performance.now() - started,
    firstResultMs,
    validResultCount: outputs.filter((item) => item.rooms.length).length,
    criticalBusinessRequestCount: requests.html + requests.browser * 2,
    duplicateRequestCount: requests.html,
    requests,
    failureRate: 0,
    pauseCount: 0,
    recoveryCount: 0,
    actionsAfterRisk: 0,
    outputs
  };
}

async function main() {
  const project = path.resolve(__dirname, '..');
  const baseline =
    process.argv[2] ||
    fs.readFileSync(path.join(project, 'output/ctrip-baseline-path.txt'), 'utf8').trim();
  const currentRoot = path.join(project, 'scraper/src');
  const baselineRoot = path.resolve(baseline, 'src');
  const results = [];
  for (const count of [20, 50, 100]) {
    const pairs = [];
    for (let index = 0; index < 5; index += 1) {
      const before = await run(baselineRoot, false, count, index);
      const after = await run(currentRoot, true, count, index);
      assert.deepEqual(after.outputs, before.outputs);
      delete before.outputs;
      delete after.outputs;
      pairs.push({ before, after });
    }
    const median = (key) => pairs.map((pair) => pair[key].modeledTotalMs).sort((a, b) => a - b)[2];
    const ratio = median('after') / median('before');
    assert.ok(ratio <= 1.1, `Modeled slowdown exceeds 10% for ${count}`);
    results.push({
      count,
      runs: 5,
      baselineMedianMs: median('before'),
      optimizedMedianMs: median('after'),
      ratio,
      outputsEqual: true,
      pairs
    });
  }
  const report = {
    kind: 'offline deterministic transport model',
    generatedAt: new Date().toISOString(),
    baseline,
    sourceBaseline:
      'Git HEAD coordinator and scheduler, with preserved local room rules; original temporary snapshot no longer exists',
    limits: [
      'Browser, DOM, CDP transport and disk writeback are mocked; this is not a live end-to-end speed acceptance.',
      'Identical complete room fixtures and actual room filtering are used; response timing is modeled.',
      'Normal scheduler stays 3 workers, 3 warmup hotels and 2000 ms start interval.'
    ],
    results
  };
  fs.writeFileSync(
    path.join(project, 'output/ctrip-performance-comparison.json'),
    JSON.stringify(report, null, 2)
  );
  console.log(
    JSON.stringify(
      results.map(({ pairs: _pairs, ...summary }) => summary),
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
