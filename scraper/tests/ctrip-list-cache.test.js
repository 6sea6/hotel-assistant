const test = require('node:test');
const assert = require('node:assert/strict');

const ctripListPath = require.resolve('../src/ctrip-list');
const collectorPath = require.resolve('../src/scraper/list-page-collector');

test('list candidate URLs are cached for repeated normalized queries without caching prices', async (t) => {
  const previousCollector = require.cache[collectorPath];
  let collectCount = 0;
  require.cache[collectorPath] = {
    id: collectorPath,
    filename: collectorPath,
    loaded: true,
    exports: {
      collectListPageCandidates: async (listUrl) => {
        collectCount += 1;
        return {
          inputUrl: listUrl,
          selected: [
            {
              hotelId: '91001',
              detailUrl: 'https://hotels.ctrip.com/hotels/detail/?hotelId=91001'
            }
          ],
          candidates: [],
          rejected: [],
          errors: [],
          totalCandidates: 1,
          performance: { totalMs: 5 }
        };
      }
    }
  };
  delete require.cache[ctripListPath];
  t.after(() => {
    delete require.cache[ctripListPath];
    if (previousCollector) {
      require.cache[collectorPath] = previousCollector;
    } else {
      delete require.cache[collectorPath];
    }
  });

  const { clearListCandidateCache, expandCtripHotelInputs } = require('../src/ctrip-list');
  clearListCandidateCache();
  const input = {
    url: 'https://hotels.ctrip.com/hotels/list?cityId=2&searchWord=%E5%A4%96%E6%BB%A9'
  };
  const equivalentInput = {
    url: 'https://hotels.ctrip.com/hotels/list?searchWord=%E5%A4%96%E6%BB%A9&cityId=2'
  };
  const template = {
    check_in_date: '2026-07-30',
    check_out_date: '2026-08-02',
    room_count: 2
  };
  const filters = { desiredHotelCount: 1 };
  const options = { listCandidateCacheTtlMs: 15 * 60 * 1000 };

  const first = await expandCtripHotelInputs(input, template, filters, options);
  const second = await expandCtripHotelInputs(equivalentInput, template, filters, options);

  assert.equal(collectCount, 1);
  assert.equal(first.listResults[0].performance.cacheHit, false);
  assert.equal(second.listResults[0].performance.cacheHit, true);
  assert.deepEqual(
    second.hotelInputs.map((item) => item.hotelId),
    ['91001']
  );
  assert.deepEqual(second.listResults[0].pages, []);
  assert.deepEqual(second.listResults[0].pageUrls, []);
  assert.equal(Object.hasOwn(second.listResults[0], 'price'), false);
  assert.doesNotMatch(JSON.stringify(second.listResults[0]), /lowestPrice|salePrice|roomPrice/i);
});
