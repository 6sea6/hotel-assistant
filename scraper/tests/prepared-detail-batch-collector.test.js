const test = require('node:test');
const assert = require('node:assert/strict');

const { runPreparedDetailBatch } = require('../src/prepared-detail-batch-collector');

test('prepared detail batch collector runs prepared contexts with bounded workers', async () => {
  const active = new Set();
  const seenContexts = [];
  let activeCount = 0;
  let maxActiveCount = 0;

  const runner = {
    async run(context) {
      active.add(context.workerId);
      activeCount += 1;
      maxActiveCount = Math.max(maxActiveCount, activeCount);
      seenContexts.push(context);
      await new Promise((resolve) => setTimeout(resolve, context.index === 1 ? 20 : 5));
      activeCount -= 1;
      active.delete(context.workerId);
      return {
        result: {
          success: true,
          hotelName: `酒店${context.index}`,
          eligibleHotels: [{ name: `酒店${context.index}`, room_type: '大床房' }]
        }
      };
    }
  };

  const result = await runPreparedDetailBatch({
    items: ['one', 'two', 'three'],
    requestedConcurrency: 2,
    workerContexts: [{ id: 'edge-1' }, { id: 'edge-2' }],
    maxConcurrency: 2,
    singleDetailRunner: runner,
    createDetailContext: async ({ item, index, worker }) => ({
      context: {
        item,
        index,
        workerId: worker.id
      },
      meta: {
        source: item
      }
    }),
    mapPreparedResult: ({ preparedResult, meta, index, worker }) => ({
      index,
      source: meta.source,
      workerId: worker.id,
      hotelName: preparedResult.result.hotelName
    })
  });

  assert.equal(result.effectiveConcurrency, 2);
  assert.equal(maxActiveCount, 2);
  assert.deepEqual(
    result.results.map((item) => `${item.index}:${item.source}:${item.hotelName}`),
    ['1:one:酒店1', '2:two:酒店2', '3:three:酒店3']
  );
  assert.deepEqual(
    [...new Set(seenContexts.map((item) => item.workerId))].sort(),
    ['edge-1', 'edge-2']
  );
});

test('prepared detail batch collector maps non-cancelled detail errors', async () => {
  const runner = {
    async run(context) {
      if (context.index === 2) {
        throw new Error('房型采集失败');
      }
      return { result: { success: true, hotelName: `酒店${context.index}` } };
    }
  };

  const result = await runPreparedDetailBatch({
    items: ['one', 'two', 'three'],
    requestedConcurrency: 1,
    singleDetailRunner: runner,
    createDetailContext: async ({ item, index }) => ({
      context: { item, index },
      meta: { item }
    }),
    mapPreparedResult: ({ preparedResult, index }) => ({
      index,
      status: 'updated',
      hotelName: preparedResult.result.hotelName
    }),
    mapDetailError: ({ error, index, meta }) => ({
      index,
      status: 'failed',
      item: meta.item,
      error: error.message
    })
  });

  assert.equal(result.effectiveConcurrency, 1);
  assert.deepEqual(result.results, [
    { index: 1, status: 'updated', hotelName: '酒店1' },
    { index: 2, status: 'failed', item: 'two', error: '房型采集失败' },
    { index: 3, status: 'updated', hotelName: '酒店3' }
  ]);
});
