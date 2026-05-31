const { runBoundedWorkers } = require('./bounded-worker-runner');
const { SingleDetailRunner } = require('./single-detail-runner');
const { isCancellationError } = require('./task-context');

function normalizePreparedContext(preparedContext) {
  if (preparedContext && Object.prototype.hasOwnProperty.call(preparedContext, 'context')) {
    return {
      context: preparedContext.context,
      meta: preparedContext.meta || null
    };
  }

  return {
    context: preparedContext,
    meta: null
  };
}

async function runPreparedDetailBatch({
  items = [],
  requestedConcurrency = 1,
  workerContexts = [],
  maxConcurrency = 2,
  signal = null,
  singleDetailRunner = null,
  createDetailContext,
  mapPreparedResult = null,
  mapDetailError = null,
  isCancellableError = isCancellationError
} = {}) {
  if (typeof createDetailContext !== 'function') {
    throw new Error('runPreparedDetailBatch requires a createDetailContext function');
  }

  const runner = singleDetailRunner || new SingleDetailRunner();
  if (!runner || typeof runner.run !== 'function') {
    throw new Error('runPreparedDetailBatch requires a detail runner with a run method');
  }

  return runBoundedWorkers({
    items,
    requestedConcurrency,
    workerContexts,
    maxConcurrency,
    signal,
    runItem: async (workerArgs) => {
      let preparedContext = null;
      let detailContext = null;
      let meta = null;

      try {
        preparedContext = await createDetailContext(workerArgs);
        ({ context: detailContext, meta } = normalizePreparedContext(preparedContext));
        const preparedResult = await runner.run(detailContext);
        if (typeof mapPreparedResult === 'function') {
          return mapPreparedResult({
            ...workerArgs,
            detailContext,
            meta,
            preparedResult
          });
        }

        return preparedResult;
      } catch (error) {
        if (typeof isCancellableError === 'function' && isCancellableError(error, signal)) {
          throw error;
        }
        if (typeof mapDetailError === 'function') {
          return mapDetailError({
            ...workerArgs,
            detailContext,
            meta,
            error
          });
        }

        throw error;
      }
    }
  });
}

module.exports = {
  runPreparedDetailBatch
};
