const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getEffectiveBoundedConcurrency,
  runBoundedWorkers
} = require('../src/bounded-worker-runner');

test('bounded worker runner caps active work and preserves result order', async () => {
  const activeWorkers = new Set();
  const usedWorkers = new Set();
  let activeCount = 0;
  let maxActiveCount = 0;

  const result = await runBoundedWorkers({
    items: ['first', 'second', 'third'],
    requestedConcurrency: 2,
    workerContexts: [{ id: 'edge-1' }, { id: 'edge-2' }, { id: 'edge-3' }],
    maxConcurrency: 2,
    runItem: async ({ item, index, total, worker }) => {
      activeWorkers.add(worker.id);
      usedWorkers.add(worker.id);
      activeCount += 1;
      maxActiveCount = Math.max(maxActiveCount, activeCount);
      await new Promise((resolve) => setTimeout(resolve, index === 1 ? 20 : 5));
      activeCount -= 1;
      activeWorkers.delete(worker.id);
      return { item, index, total, workerId: worker.id };
    }
  });

  assert.equal(result.requestedConcurrency, 2);
  assert.equal(result.effectiveConcurrency, 2);
  assert.equal(maxActiveCount, 2);
  assert.deepEqual(
    result.results.map((item) => item.item),
    ['first', 'second', 'third']
  );
  assert.deepEqual([...usedWorkers].sort(), ['edge-1', 'edge-2']);
});

test('bounded worker runner stays serial when requested concurrency is one', async () => {
  let activeCount = 0;
  let maxActiveCount = 0;

  const result = await runBoundedWorkers({
    items: ['one', 'two'],
    requestedConcurrency: 1,
    runItem: async ({ item, index }) => {
      activeCount += 1;
      maxActiveCount = Math.max(maxActiveCount, activeCount);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeCount -= 1;
      return `${index}:${item}`;
    }
  });

  assert.equal(result.effectiveConcurrency, 1);
  assert.equal(maxActiveCount, 1);
  assert.deepEqual(result.results, ['1:one', '2:two']);
});

test('bounded worker runner effective concurrency is capped by total and workers', () => {
  assert.equal(
    getEffectiveBoundedConcurrency({
      requestedConcurrency: 3,
      total: 1,
      workerContexts: [{ id: 1 }, { id: 2 }],
      maxConcurrency: 2
    }),
    1
  );
  assert.equal(
    getEffectiveBoundedConcurrency({
      requestedConcurrency: 3,
      total: 4,
      workerContexts: [{ id: 1 }],
      maxConcurrency: 2
    }),
    1
  );
});
