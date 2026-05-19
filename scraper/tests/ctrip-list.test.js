const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyCtripHotelUrl,
  extractCtripUrlsFromInput,
  isCtripHotelDetailUrl,
  isCtripHotelListUrl
} = require('../src/ctrip-url');
const {
  filterListPageCandidates,
  normalizeListPageFilterOptions,
  parseListPageCandidatesFromHtml
} = require('../src/scraper/list-page-parser');
const { expandCtripHotelInputs, normalizeListFiltersFromArgs } = require('../src/ctrip-list');
const {
  collectListPageCandidates: collectRawListPageCandidates
} = require('../src/scraper/list-page-collector');

function buildListHtml(cards = []) {
  return `
    <html>
      <body>
        ${cards
          .map(
            (card) => `
          <div class="right-card" data-offline-hotelId="${card.id}">
            <span class="hotelName">${card.name}</span>
            <span class="score">${card.score || '4.8'}</span>
          </div>
        `
          )
          .join('')}
      </body>
    </html>
  `;
}

test('extractCtripUrlsFromInput accepts mixed pasted detail and list URLs', () => {
  const urls = extractCtripUrlsFromInput({
    text: [
      '备选 https://hotels.ctrip.com/hotels/detail/?hotelId=1001&checkIn=2026-06-01 。',
      '列表：https://hotels.ctrip.com/hotels/list?city=2&keyword=test；',
      '重复 https://hotels.ctrip.com/hotels/detail/?hotelId=1001&checkIn=2026-06-01'
    ].join('\n')
  });

  assert.equal(urls.length, 2);
  assert.equal(isCtripHotelDetailUrl(urls[0]), true);
  assert.equal(isCtripHotelListUrl(urls[1]), true);
});

test('extractCtripUrlsFromInput trims prose after pasted list URL punctuation', () => {
  const urls = extractCtripUrlsFromInput(
    'https://hotels.ctrip.com/hotels/list?cityId=477&checkin=2026-06-01&checkout=2026-06-02&listFilters=29~1*29*1~3&locale=zh-CN,我将链接输入后显示解析错误'
  );

  assert.deepEqual(urls, [
    'https://hotels.ctrip.com/hotels/list?cityId=477&checkin=2026-06-01&checkout=2026-06-02&listFilters=29~1*29*1~3&locale=zh-CN'
  ]);
  assert.equal(isCtripHotelListUrl(urls[0]), true);
});

test('classifyCtripHotelUrl separates detail URLs from list URLs', () => {
  const detail = classifyCtripHotelUrl('https://hotels.ctrip.com/hotels/detail/?hotelId=1001');
  const legacyDetail = classifyCtripHotelUrl('https://hotels.ctrip.com/hotels/1002.html');
  const list = classifyCtripHotelUrl('https://hotels.ctrip.com/hotels/list?city=2&keyword=test');

  assert.equal(detail.type, 'detail');
  assert.equal(detail.hotelId, '1001');
  assert.equal(legacyDetail.type, 'detail');
  assert.equal(legacyDetail.hotelId, '1002');
  assert.equal(list.type, 'list');
  assert.equal(list.hotelId, '');
  assert.equal(isCtripHotelDetailUrl(list.url), false);
  assert.equal(isCtripHotelListUrl(list.url), true);
});

test('parseListPageCandidatesFromHtml reads ctrip structured list cards', () => {
  const html = `
    <html>
      <body>
        <div class="right-card" data-offline-hotelId="117627065">
          <div class="hotel-title">
            <span class="hotelName">丽怡酒店(武汉泛海CBD汉口火车站店)</span>
            <span class="ad-info">广告</span>
          </div>
          <div class="comment-score"><span class="score">4.8</span></div>
          <div class="hotel-position"><span class="position-desc">近范湖地铁站</span></div>
        </div>
        <div class="right-card" data-exposure='{"data":{"masterhotelid":"712581"}}'>
          <span class="hotelName">武汉万达瑞华酒店</span>
          <span class="score">4.7</span>
        </div>
      </body>
    </html>
  `;

  const candidates = parseListPageCandidatesFromHtml(
    html,
    'https://hotels.ctrip.com/hotels/list?cityId=477',
    {
      template: {
        check_in_date: '2026-06-01',
        check_out_date: '2026-06-02',
        room_count: 1
      }
    }
  );

  assert.deepEqual(
    candidates.map((candidate) => candidate.hotelId),
    ['117627065', '712581']
  );
  assert.equal(candidates[0].hotelName, '丽怡酒店(武汉泛海CBD汉口火车站店)');
  assert.equal(candidates[0].ctripScore, 4.8);
  assert.equal(candidates[0].sourceOrder, 1);
  assert.match(candidates[0].detailUrl, /hotelId=117627065/);
  assert.match(candidates[0].detailUrl, /checkIn=2026-06-01/);
});

test('parseListPageCandidatesFromHtml reads embedded JSON and emits normalized candidates', () => {
  const html = `
    <html>
      <head>
        <script id="__NEXT_DATA__" type="application/json">
          {
            "props": {
              "pageProps": {
                "hotelList": [
                  {
                    "hotelId": 1001,
                    "hotelName": "江汉路示例酒店",
                    "commentScore": "4.8",
                    "hotelTypeName": "高档酒店",
                    "address": "江汉路1号"
                  },
                  {
                    "hotelId": 1002,
                    "hotelName": "青年旅舍示例店",
                    "commentScore": "4.7",
                    "hotelTypeName": "青年旅舍"
                  },
                  {
                    "hotelId": 1003,
                    "hotelName": "低分示例酒店",
                    "commentScore": "4.1",
                    "hotelTypeName": "酒店"
                  }
                ]
              }
            }
          }
        </script>
      </head>
      <body>
        <a href="/hotels/detail/?hotelId=1004">备用示例酒店</a>
      </body>
    </html>
  `;

  const candidates = parseListPageCandidatesFromHtml(
    html,
    'https://hotels.ctrip.com/hotels/list?city=2',
    {
      template: {
        check_in_date: '2026-06-01',
        check_out_date: '2026-06-02',
        room_count: 2
      }
    }
  );

  assert.ok(candidates.some((candidate) => candidate.hotelId === '1001'));
  assert.ok(
    candidates
      .find((candidate) => candidate.hotelId === '1001')
      .detailUrl.includes('checkIn=2026-06-01')
  );
  assert.equal(
    candidates.find((candidate) => candidate.hotelId === '1001').hotelName,
    '江汉路示例酒店'
  );
  assert.equal(candidates.find((candidate) => candidate.hotelId === '1001').ctripScore, 4.8);
  assert.equal(candidates.find((candidate) => candidate.hotelId === '1001').sourceOrder, 1);

  const prefilter = filterListPageCandidates(candidates, {
    excludeHotelTypes: ['青年旅舍'],
    desiredHotelCount: 2
  });

  assert.equal(prefilter.selected.length, 2);
  assert.equal(prefilter.selected[0].hotelId, '1001');
  assert.equal(prefilter.selected[1].hotelId, '1003');
  assert.ok(
    !prefilter.rejected.some((candidate) => candidate.rejectReason === 'score_below_minimum')
  );
  assert.ok(
    !prefilter.rejected.some((candidate) =>
      String(candidate.rejectReason).startsWith('name_keyword:')
    )
  );
  assert.ok(
    prefilter.rejected.some((candidate) => candidate.rejectReason === 'hotel_type_keyword:青年旅舍')
  );
  assert.deepEqual(
    prefilter.detailUrls,
    prefilter.selected.map((candidate) => candidate.detailUrl)
  );
});

test('list page filters support defaults, desired count and max candidates per page', () => {
  const filters = normalizeListPageFilterOptions({
    minScore: '4.6',
    desiredHotelCount: '2',
    maxCandidatesPerPage: '5'
  });

  assert.equal(filters.minScore, undefined);
  assert.equal(filters.desiredHotelCount, 2);
  assert.equal(filters.targetCount, 2);
  assert.equal(filters.maxPages, undefined);
  assert.equal(filters.maxCandidatesPerPage, 5);
  assert.ok(filters.excludeHotelTypes.includes('民宿'));
  assert.ok(filters.excludeHotelTypes.includes('客栈'));
  assert.ok(filters.excludeHotelTypes.includes('青年旅舍'));
  assert.ok(filters.excludeHotelTypes.includes('公寓'));
});

test('normalizeListFiltersFromArgs supports CLI aliases', () => {
  const filters = normalizeListFiltersFromArgs({
    'exclude-accommodation-keywords': '民宿,公寓',
    'target-count': '3'
  });

  assert.equal(filters.minScore, undefined);
  assert.deepEqual(filters.excludeAccommodationKeywords, ['民宿', '公寓']);
  assert.equal(filters.excludeNameKeywords, undefined);
  assert.equal(filters.desiredHotelCount, 3);
  assert.equal(filters.targetCount, 3);
  assert.equal(filters.maxPages, undefined);
});

test('expandCtripHotelInputs expands list URLs to ordered detail URLs', async () => {
  const calls = [];
  const expanded = await expandCtripHotelInputs(
    {
      url: 'https://hotels.ctrip.com/hotels/list?city=2'
    },
    {
      check_in_date: '2026-06-01',
      check_out_date: '2026-06-02',
      room_count: 2
    },
    {
      desiredHotelCount: 2
    },
    {
      collectListPageCandidates: async (url, template, filters) => {
        calls.push({ url, template, filters });
        return {
          inputUrl: url,
          pageUrls: [url],
          pages: [],
          filters,
          totalCandidates: 2,
          candidates: [],
          rejected: [],
          detailUrls: [
            'https://hotels.ctrip.com/hotels/detail/?hotelId=2001',
            'https://hotels.ctrip.com/hotels/detail/?hotelId=2002'
          ],
          selected: [
            {
              hotelId: '2001',
              hotelName: '第一家酒店',
              ctripScore: 4.8,
              detailUrl: 'https://hotels.ctrip.com/hotels/detail/?hotelId=2001',
              badges: [],
              hotelType: '酒店',
              visibleTags: [],
              sourceOrder: 1
            },
            {
              hotelId: '2002',
              hotelName: '第二家酒店',
              ctripScore: 4.7,
              detailUrl: 'https://hotels.ctrip.com/hotels/detail/?hotelId=2002',
              badges: [],
              hotelType: '酒店',
              visibleTags: [],
              sourceOrder: 2
            }
          ],
          errors: [],
          edgeFallbackUsed: false
        };
      }
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].filters.desiredHotelCount, 2);
  assert.equal(expanded.inputMode, 'list');
  assert.deepEqual(
    expanded.hotelInputs.map((item) => item.hotelId),
    ['2001', '2002']
  );
  assert.deepEqual(
    expanded.hotelInputs.map((item) => item.source),
    ['list-prefilter', 'list-prefilter']
  );
  assert.ok(expanded.hotelInputs[0].url.includes('checkIn=2026-06-01'));
  assert.equal(expanded.summary.expandedHotelCount, 2);
});

test('expandCtripHotelInputs merges Ctrip URL filters before collecting list pages', async () => {
  const calls = [];
  await expandCtripHotelInputs(
    {
      url: 'https://hotels.ctrip.com/hotels/list?city=2&listFilters=29~1*29*1~3*2,17~3*17*3',
      listUrlFilters: {
        priceMin: 50,
        priceMax: 200,
        sortMode: 'review_high',
        freeCancel: true
      }
    },
    {
      check_in_date: '2026-06-01',
      check_out_date: '2026-06-02',
      room_count: 2
    },
    {
      desiredHotelCount: 1
    },
    {
      collectListPageCandidates: async (url, template, filters) => {
        calls.push({ url, template, filters });
        return {
          inputUrl: url,
          pageUrls: [url],
          pages: [],
          filters,
          totalCandidates: 1,
          candidates: [],
          rejected: [],
          detailUrls: ['https://hotels.ctrip.com/hotels/detail/?hotelId=2001'],
          selected: [
            {
              hotelId: '2001',
              hotelName: '第一家酒店',
              ctripScore: 4.8,
              detailUrl: 'https://hotels.ctrip.com/hotels/detail/?hotelId=2001',
              badges: [],
              hotelType: '酒店',
              visibleTags: [],
              sourceOrder: 1
            }
          ],
          errors: [],
          edgeFallbackUsed: false
        };
      }
    }
  );

  assert.equal(calls.length, 1);
  const decodedUrl = decodeURIComponent(calls[0].url);
  assert.match(decodedUrl, /29~1\*29\*1~3\*2/);
  assert.match(decodedUrl, /15~Range\*15\*50~200/);
  assert.doesNotMatch(decodedUrl, /17~3\*17\*3/);
  assert.match(decodedUrl, /17~6\*17\*6/);
  assert.match(decodedUrl, /23~10\*23\*10/);
});

test('collectListPageCandidates skips Edge fallback when HTML prefilter reaches target', async () => {
  let fetchCount = 0;
  let edgeCalled = false;
  const result = await collectRawListPageCandidates(
    'https://hotels.ctrip.com/hotels/list?city=2',
    {},
    {
      desiredHotelCount: 1
    },
    {
      autoEdge: true,
      fetchHtml: async () => {
        fetchCount += 1;
        return {
          html: buildListHtml([{ id: '3001', name: 'HTML 第一家' }])
        };
      },
      captureListHtmlPagesWithEdge: async () => {
        edgeCalled = true;
        return { pages: [], error: '' };
      }
    }
  );

  assert.equal(fetchCount, 1);
  assert.equal(edgeCalled, false);
  assert.equal(result.edgeFallbackUsed, false);
  assert.equal(result.selected.length, 1);
  assert.equal(result.performance.htmlPages.length, 1);
});

test('collectListPageCandidates uses Edge fallback when HTML pages stall below target', async () => {
  let fetchCount = 0;
  let edgeCalled = false;
  const result = await collectRawListPageCandidates(
    'https://hotels.ctrip.com/hotels/list?city=2',
    {},
    {
      desiredHotelCount: 2
    },
    {
      autoEdge: true,
      fetchHtml: async () => {
        fetchCount += 1;
        return {
          html: buildListHtml([{ id: '6001', name: 'HTML 重复酒店' }])
        };
      },
      captureListHtmlPagesWithEdge: async (urls, _edgeSession, options = {}) => {
        edgeCalled = true;
        assert.deepEqual(urls, ['https://hotels.ctrip.com/hotels/list?city=2']);
        const page = {
          url: urls[0],
          html: buildListHtml([
            { id: '6001', name: 'HTML 重复酒店' },
            { id: '6002', name: 'Edge 新增酒店' }
          ]),
          source: 'edge-cdp',
          durationMs: 1,
          scrollRound: 1
        };
        await options.onPage(page);
        return { pages: [page], error: '' };
      }
    }
  );

  assert.equal(edgeCalled, true);
  assert.equal(fetchCount, 1);
  assert.equal(result.edgeFallbackUsed, true);
  assert.deepEqual(
    result.selected.map((candidate) => candidate.hotelId),
    ['6001', '6002']
  );
});

test('collectListPageCandidates Edge fallback parses pages incrementally and stops at target', async () => {
  const processedEdgeUrls = [];
  const result = await collectRawListPageCandidates(
    'https://hotels.ctrip.com/hotels/list?city=2',
    {},
    {
      desiredHotelCount: 1
    },
    {
      autoEdge: true,
      fetchHtml: async () => ({ html: buildListHtml([]) }),
      captureListHtmlPagesWithEdge: async (urls, _edgeSession, options = {}) => {
        const pages = [];
        for (const url of urls) {
          processedEdgeUrls.push(url);
          const page = {
            url,
            html: buildListHtml([
              {
                id: `400${processedEdgeUrls.length}`,
                name: `Edge 第 ${processedEdgeUrls.length} 家`
              }
            ]),
            source: 'edge-cdp',
            durationMs: 1,
            scrollRound: 1
          };
          pages.push(page);
          const shouldContinue = await options.onPage(page);
          if (shouldContinue === false) {
            break;
          }
        }
        return { pages, error: '' };
      }
    }
  );

  assert.equal(processedEdgeUrls.length, 1);
  assert.equal(result.edgeFallbackUsed, true);
  assert.equal(result.selected.length, 1);
  assert.equal(result.pages.filter((page) => page.source === 'edge-cdp').length, 1);
  assert.equal(result.performance.edgePages.length, 1);
});

test('collectListPageCandidates Edge fallback accepts multiple scroll snapshots from same URL', async () => {
  const result = await collectRawListPageCandidates(
    'https://hotels.ctrip.com/hotels/list?city=2',
    {},
    {
      desiredHotelCount: 3
    },
    {
      autoEdge: true,
      fetchHtml: async () => ({ html: buildListHtml([]) }),
      captureListHtmlPagesWithEdge: async (urls, _edgeSession, options = {}) => {
        assert.deepEqual(urls, ['https://hotels.ctrip.com/hotels/list?city=2']);
        const snapshots = [
          { id: '6001', name: 'Edge 滚动第1轮' },
          { id: '6001', name: 'Edge 滚动第1轮' },
          { id: '6002', name: 'Edge 滚动第2轮' },
          { id: '6003', name: 'Edge 滚动第3轮' }
        ];
        const pages = [];
        for (let i = 0; i < snapshots.length; i += 1) {
          const page = {
            url: urls[0],
            html: buildListHtml([snapshots[i]]),
            source: 'edge-cdp',
            durationMs: 1,
            scrollRound: i + 1
          };
          pages.push(page);
          const shouldContinue = await options.onPage(page);
          if (shouldContinue === false) {
            break;
          }
        }
        return { pages, error: '' };
      }
    }
  );

  assert.equal(result.edgeFallbackUsed, true);
  assert.deepEqual(
    result.selected.map((candidate) => candidate.hotelId),
    ['6001', '6002', '6003']
  );
  const edgePages = result.pages.filter((page) => page.source === 'edge-cdp');
  assert.ok(edgePages.length > 0);
  for (const page of edgePages) {
    assert.equal(page.url, 'https://hotels.ctrip.com/hotels/list?city=2');
    assert.doesNotMatch(page.url, /pageIndex/);
  }
});

test('collectListPageCandidates does not fetch pageIndex URLs', async () => {
  const fetchedUrls = [];
  const result = await collectRawListPageCandidates(
    'https://hotels.ctrip.com/hotels/list?city=2',
    {},
    {
      desiredHotelCount: 20
    },
    {
      fetchHtml: async (url) => {
        fetchedUrls.push(url);
        return {
          html: buildListHtml([{ id: '1001', name: 'HTML 第一家' }])
        };
      }
    }
  );

  assert.equal(fetchedUrls.length, 1);
  assert.equal(fetchedUrls[0], 'https://hotels.ctrip.com/hotels/list?city=2');
  assert.doesNotMatch(fetchedUrls[0], /pageIndex/);
  assert.deepEqual(result.pageUrls, ['https://hotels.ctrip.com/hotels/list?city=2']);
  assert.equal(result.selected.length, 1);
});

test('buildListPageUrls returns only the original URL', () => {
  const { buildListPageUrls } = require('../src/scraper/list-page-collector');
  const urls = buildListPageUrls('https://hotels.ctrip.com/hotels/list?city=2');
  assert.deepEqual(urls, ['https://hotels.ctrip.com/hotels/list?city=2']);
});

test('buildListPageUrls returns empty array for falsy input', () => {
  const { buildListPageUrls } = require('../src/scraper/list-page-collector');
  assert.deepEqual(buildListPageUrls(''), []);
  assert.deepEqual(buildListPageUrls(null), []);
  assert.deepEqual(buildListPageUrls(undefined), []);
});
