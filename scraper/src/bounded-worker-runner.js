const { assertNotCancelled } = require('./task-context');

function normalizePositiveInteger(value, fallback = 1) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }

  return Math.floor(number);
}

function getEffectiveBoundedConcurrency({
  requestedConcurrency = 1,
  total = 0,
  workerContexts = [],
  maxConcurrency = 2
} = {}) {
  const requested = normalizePositiveInteger(requestedConcurrency);
  const itemLimit = Math.max(1, normalizePositiveInteger(total));
  const workerLimit =
    Array.isArray(workerContexts) && workerContexts.length > 0
      ? workerContexts.length
      : normalizePositiveInteger(maxConcurrency);

  return Math.max(
    1,
    Math.min(
      requested,
      itemLimit,
      Math.max(1, workerLimit),
      normalizePositiveInteger(maxConcurrency)
    )
  );
}

function buildWorkerContexts({ workerContexts = [], effectiveConcurrency = 1 } = {}) {
  if (Array.isArray(workerContexts) && workerContexts.length > 0) {
    return workerContexts.slice(0, effectiveConcurrency);
  }

  return Array.from({ length: effectiveConcurrency }, (_item, index) => ({ id: index + 1 }));
}

async function runBoundedWorkers({
  items = [],
  requestedConcurrency = 1,
  workerContexts = [],
  maxConcurrency = 2,
  signal = null,
  runItem
} = {}) {
  if (typeof runItem !== 'function') {
    throw new Error('runBoundedWorkers requires a runItem function');
  }

  const workItems = Array.isArray(items) ? items : [];
  const normalizedRequestedConcurrency = normalizePositiveInteger(requestedConcurrency);
  const effectiveConcurrency = getEffectiveBoundedConcurrency({
    requestedConcurrency: normalizedRequestedConcurrency,
    total: workItems.length,
    workerContexts,
    maxConcurrency
  });
  const workers = buildWorkerContexts({
    workerContexts,
    effectiveConcurrency
  });
  const results = new Array(workItems.length);
  let nextIndex = 0;
  let stopped = false;

  const runWorker = async (worker) => {
    while (!stopped) {
      assertNotCancelled(signal);
      const zeroBasedIndex = nextIndex;
      nextIndex += 1;
      if (zeroBasedIndex >= workItems.length) {
        return;
      }

      try {
        results[zeroBasedIndex] = await runItem({
          item: workItems[zeroBasedIndex],
          zeroBasedIndex,
          index: zeroBasedIndex + 1,
          total: workItems.length,
          worker
        });
      } catch (error) {
        stopped = true;
        throw error;
      }
    }
  };

  const settled = await Promise.allSettled(workers.map((worker) => runWorker(worker)));
  const rejected = settled.find((result) => result.status === 'rejected');
  if (rejected) {
    throw rejected.reason;
  }

  return {
    requestedConcurrency: normalizedRequestedConcurrency,
    effectiveConcurrency,
    workers,
    results
  };
}

module.exports = {
  getEffectiveBoundedConcurrency,
  runBoundedWorkers
};
