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

function installMock(modulePath, exports) {
  const resolvedPath = require.resolve(modulePath);
  require.cache[resolvedPath] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports
  };
  return resolvedPath;
}

function clearModules(paths) {
  for (const modulePath of paths) {
    delete require.cache[modulePath];
  }
}

function getListCollectorModulePaths() {
  return [
    require.resolve('../src/scraper/list-page-collector'),
    require.resolve('../src/scraper/list-page-edge-capture'),
    require.resolve('../src/scraper/list-page-cdp-session'),
    require.resolve('../src/scraper/list-page-network-drain'),
    require.resolve('../src/scraper/list-page-scroll-policy')
  ];
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
    desiredHotelCount: 2
  });

  assert.equal(prefilter.selected.length, 2);
  assert.equal(prefilter.selected[0].hotelId, '1001');
  assert.equal(prefilter.selected[1].hotelId, '1002');
  assert.ok(
    !prefilter.rejected.some((candidate) => candidate.rejectReason === 'score_below_minimum')
  );
  assert.ok(
    !prefilter.rejected.some((candidate) =>
      String(candidate.rejectReason).startsWith('name_keyword:')
    )
  );
  assert.equal(
    prefilter.rejected.some((candidate) => String(candidate.rejectReason).includes('_keyword:')),
    false
  );
  assert.deepEqual(
    prefilter.detailUrls,
    prefilter.selected.map((candidate) => candidate.detailUrl)
  );
});

test('parseListPageCandidatesFromHtml reads Ctrip fetchHotelList JSON payloads', () => {
  const html = `
    <html>
      <body>
        <script type="application/json">
          {
            "data": {
              "hotelList": [
                {
                  "hotelInfo": {
                    "summary": {
                      "hotelId": "9001",
                      "masterHotelId": "9001",
                      "hotelType": "NORMAL",
                      "hotelTypeName": "酒店公寓"
                    },
                    "nameInfo": {
                      "name": "接口返回酒店"
                    },
                    "hotelTagList": [
                      { "tagTitle": "公寓" },
                      { "tagName": "亲子酒店" },
                      { "tagTitle": "兼具一线江景和百年历史的金库酒店" },
                      { "tagName": "https://images.example.test/hotel.jpg" }
                    ],
                    "commentInfo": {
                      "commentScore": 4.8
                    },
                    "positionInfo": {
                      "address": "武汉市江岸区"
                    }
                  }
                }
              ]
            }
          }
        </script>
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
        room_count: 3
      }
    }
  );

  assert.deepEqual(
    candidates.map((candidate) => candidate.hotelId),
    ['9001']
  );
  assert.equal(candidates[0].hotelName, '接口返回酒店');
  assert.equal(candidates[0].hotelType, '酒店公寓');
  assert.ok(candidates[0].badges.includes('公寓'));
  assert.ok(candidates[0].badges.includes('亲子酒店'));
  assert.ok(!candidates[0].badges.includes('兼具一线江景和百年历史的金库酒店'));
  assert.ok(!candidates[0].badges.includes('https://images.example.test/hotel.jpg'));
  assert.equal(candidates[0].ctripScore, 4.8);
  assert.match(candidates[0].detailUrl, /hotelId=9001/);
  assert.match(candidates[0].detailUrl, /adult=3/);

  const prefilter = filterListPageCandidates(candidates, {
    desiredHotelCount: 1
  });
  assert.equal(prefilter.selected.length, 1);
  assert.equal(prefilter.selected[0].hotelId, '9001');
});

test('list page filter keeps accommodation names in list candidates', () => {
  const prefilter = filterListPageCandidates(
    [
      {
        hotelId: '9101',
        detailUrl: 'https://hotels.ctrip.com/hotels/detail/?hotelId=9101',
        hotelName: '江汉路城市公寓酒店',
        hotelType: '酒店',
        badges: [],
        visibleTags: []
      },
      {
        hotelId: '9102',
        detailUrl: 'https://hotels.ctrip.com/hotels/detail/?hotelId=9102',
        hotelName: '江汉路商务酒店',
        hotelType: '酒店',
        badges: [],
        visibleTags: []
      }
    ],
    { desiredHotelCount: 2 }
  );

  assert.equal(prefilter.selected.length, 2);
  assert.deepEqual(
    prefilter.selected.map((candidate) => candidate.hotelId),
    ['9101', '9102']
  );
});

test('list page filter does not exclude accommodation types by default', () => {
  const candidates = Array.from({ length: 6 }, (_, index) => ({
    hotelId: String(9200 + index),
    detailUrl: `https://hotels.ctrip.com/hotels/detail/?hotelId=${9200 + index}`,
    hotelName: `江汉路民宿 ${index + 1}`,
    hotelType: '民宿',
    badges: ['民宿'],
    visibleTags: ['民宿']
  }));
  const prefilter = filterListPageCandidates(candidates, {
    desiredHotelCount: 5
  });

  assert.equal(prefilter.selected.length, 5);
  assert.equal(
    prefilter.rejected.some((candidate) =>
      String(candidate.rejectReason || '').includes('_keyword:')
    ),
    false
  );
  assert.deepEqual(
    prefilter.selected.map((candidate) => candidate.hotelId),
    ['9200', '9201', '9202', '9203', '9204']
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
});

test('normalizeListFiltersFromArgs supports target count aliases', () => {
  const filters = normalizeListFiltersFromArgs({
    'target-count': '3'
  });

  assert.equal(filters.minScore, undefined);
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

test('captureListHtmlPagesWithEdge keeps scrolling while unique list candidates grow', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Edge CDP list fallback is Windows-only');
    return;
  }

  let evaluateCalls = 0;
  const listeners = [];
  const cdpUtilsPath = installMock('../src/scraper/cdp-utils', {
    connectToDebugger: async () => ({
      async send(method) {
        if (method === 'Target.getTargets') {
          return { targetInfos: [] };
        }
        if (method === 'Target.createTarget') {
          return { targetId: 'target-1' };
        }
        if (method === 'Target.attachToTarget') {
          return { sessionId: 'session-1' };
        }
        if (method === 'Page.navigate') {
          setImmediate(() => {
            listeners.forEach((listener) =>
              listener({ sessionId: 'session-1', method: 'Page.loadEventFired' })
            );
          });
        }
        return {};
      },
      addListener(listener) {
        listeners.push(listener);
        return () => {
          const index = listeners.indexOf(listener);
          if (index >= 0) {
            listeners.splice(index, 1);
          }
        };
      },
      async close() {}
    }),
    evaluateInSession: async () => {
      evaluateCalls += 1;
      return JSON.stringify({
        scrollHeight: 1200,
        candidateCount: 12,
        scrollContainerCount: 1,
        scrollActions: evaluateCalls,
        html: buildListHtml([{ id: `700${evaluateCalls}`, name: `Edge 第 ${evaluateCalls} 家` }])
      });
    },
    launchManagedEdgeSession: async () => ({
      browser: { pid: 123 },
      userDataDir: '',
      shouldCleanupUserDataDir: false,
      debuggerUrl: 'ws://edge.test/devtools/browser'
    }),
    normalizeEdgeSessionOptions: () => ({}),
    waitForDebuggerEndpoint: async () => 'ws://edge.test/devtools/browser',
    waitForSessionCondition: async () => true
  });
  const processUtilsPath = installMock('../src/scraper/process-utils', {
    findEdgeExecutable: () => 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    killBrowserProcessesByCommandLine: () => false,
    killProcessTree: () => undefined
  });
  const collectorModulePaths = getListCollectorModulePaths();
  clearModules(collectorModulePaths);

  try {
    const { captureListHtmlPagesWithEdge } = require('../src/scraper/list-page-collector');
    const seen = new Set();
    const result = await captureListHtmlPagesWithEdge(
      ['https://hotels.ctrip.com/hotels/list?city=2'],
      {},
      {
        maxScrollRounds: 10,
        stableRoundLimit: 1,
        initialSettleMs: 0,
        onPage: (page) => {
          const match = String(page.html).match(/data-offline-hotelId="(\d+)"/);
          if (match) {
            seen.add(match[1]);
          }
          return {
            continue: seen.size < 3,
            uniqueCandidateCount: seen.size
          };
        }
      }
    );

    assert.equal(result.error, '');
    assert.equal(result.pages.length, 3);
    assert.equal(evaluateCalls, 3);
    assert.deepEqual([...seen], ['7001', '7002', '7003']);
    assert.equal(result.pages[0].scrollContainerCount, 1);
  } finally {
    clearModules([...collectorModulePaths, cdpUtilsPath, processUtilsPath]);
  }
});

test('captureListHtmlPagesWithEdge returns candidate HTML without full document by default', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Edge CDP list fallback is Windows-only');
    return;
  }

  let evaluatedExpression = '';
  const listeners = [];
  const cdpUtilsPath = installMock('../src/scraper/cdp-utils', {
    connectToDebugger: async () => ({
      async send(method) {
        if (method === 'Target.getTargets') {
          return { targetInfos: [] };
        }
        if (method === 'Target.createTarget') {
          return { targetId: 'target-1' };
        }
        if (method === 'Target.attachToTarget') {
          return { sessionId: 'session-1' };
        }
        if (method === 'Page.navigate') {
          setImmediate(() => {
            listeners.forEach((listener) =>
              listener({ sessionId: 'session-1', method: 'Page.loadEventFired' })
            );
          });
        }
        return {};
      },
      addListener(listener) {
        listeners.push(listener);
        return () => {
          const index = listeners.indexOf(listener);
          if (index >= 0) {
            listeners.splice(index, 1);
          }
        };
      },
      async close() {}
    }),
    evaluateInSession: async (_connection, _sessionId, expression) => {
      evaluatedExpression = String(expression);
      return JSON.stringify({
        scrollHeight: 1200,
        candidateCount: 1,
        scrollContainerCount: 0,
        scrollActions: 1,
        candidateHtml: buildListHtml([{ id: '9301', name: '轻量候选酒店' }]),
        fullHtmlIncluded: false
      });
    },
    launchManagedEdgeSession: async () => ({
      browser: { pid: 123 },
      userDataDir: '',
      shouldCleanupUserDataDir: false,
      debuggerUrl: 'ws://edge.test/devtools/browser'
    }),
    normalizeEdgeSessionOptions: () => ({}),
    waitForDebuggerEndpoint: async () => 'ws://edge.test/devtools/browser',
    waitForSessionCondition: async () => true
  });
  const processUtilsPath = installMock('../src/scraper/process-utils', {
    findEdgeExecutable: () => 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    killBrowserProcessesByCommandLine: () => false,
    killProcessTree: () => undefined
  });
  const collectorModulePaths = getListCollectorModulePaths();
  clearModules(collectorModulePaths);

  try {
    const { captureListHtmlPagesWithEdge } = require('../src/scraper/list-page-collector');
    const result = await captureListHtmlPagesWithEdge(
      ['https://hotels.ctrip.com/hotels/list?city=2'],
      {},
      {
        maxScrollRounds: 1,
        stableRoundLimit: 1,
        initialSettleMs: 0
      }
    );

    const candidates = parseListPageCandidatesFromHtml(
      result.pages[0].html,
      'https://hotels.ctrip.com/hotels/list?city=2'
    );

    assert.equal(evaluatedExpression.includes('document.documentElement.outerHTML'), false);
    assert.equal(evaluatedExpression.includes('candidateHtml'), true);
    assert.equal(result.pages[0].fullHtmlIncluded, false);
    assert.deepEqual(
      candidates.map((candidate) => candidate.hotelId),
      ['9301']
    );
  } finally {
    clearModules([...collectorModulePaths, cdpUtilsPath, processUtilsPath]);
  }
});

test('captureListHtmlPagesWithEdge appends Ctrip list network responses to snapshots', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Edge CDP list fallback is Windows-only');
    return;
  }

  const listeners = [];
  const cdpUtilsPath = installMock('../src/scraper/cdp-utils', {
    connectToDebugger: async () => ({
      async send(method) {
        if (method === 'Target.getTargets') {
          return { targetInfos: [] };
        }
        if (method === 'Target.createTarget') {
          return { targetId: 'target-1' };
        }
        if (method === 'Target.attachToTarget') {
          return { sessionId: 'session-1' };
        }
        if (method === 'Page.navigate') {
          setImmediate(() => {
            listeners.forEach((listener) =>
              listener({ sessionId: 'session-1', method: 'Page.loadEventFired' })
            );
            listeners.forEach((listener) =>
              listener({
                sessionId: 'session-1',
                method: 'Network.responseReceived',
                params: {
                  requestId: 'network-1',
                  response: {
                    url: 'https://m.ctrip.com/restapi/soa2/34951/fetchHotelList',
                    status: 200,
                    mimeType: 'application/json'
                  }
                }
              })
            );
          });
        }
        if (method === 'Network.getResponseBody') {
          return {
            body: JSON.stringify({
              data: {
                hotelList: [
                  {
                    hotelInfo: {
                      summary: { hotelId: '9101', masterHotelId: '9101' },
                      nameInfo: { name: '网络接口酒店' },
                      commentInfo: { commentScore: 4.9 }
                    }
                  }
                ]
              }
            })
          };
        }
        return {};
      },
      addListener(listener) {
        listeners.push(listener);
        return () => {
          const index = listeners.indexOf(listener);
          if (index >= 0) {
            listeners.splice(index, 1);
          }
        };
      },
      async close() {}
    }),
    evaluateInSession: async () =>
      JSON.stringify({
        scrollHeight: 1200,
        candidateCount: 0,
        scrollContainerCount: 0,
        scrollActions: 0,
        html: '<html><body>列表首屏</body></html>'
      }),
    launchManagedEdgeSession: async () => ({
      browser: { pid: 123 },
      userDataDir: '',
      shouldCleanupUserDataDir: false,
      debuggerUrl: 'ws://edge.test/devtools/browser'
    }),
    normalizeEdgeSessionOptions: () => ({}),
    waitForDebuggerEndpoint: async () => 'ws://edge.test/devtools/browser',
    waitForSessionCondition: async () => true
  });
  const processUtilsPath = installMock('../src/scraper/process-utils', {
    findEdgeExecutable: () => 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    killBrowserProcessesByCommandLine: () => false,
    killProcessTree: () => undefined
  });
  const collectorModulePaths = getListCollectorModulePaths();
  clearModules(collectorModulePaths);

  try {
    const { captureListHtmlPagesWithEdge } = require('../src/scraper/list-page-collector');
    const result = await captureListHtmlPagesWithEdge(
      ['https://hotels.ctrip.com/hotels/list?city=2'],
      {},
      {
        maxScrollRounds: 1,
        stableRoundLimit: 1,
        initialSettleMs: 0
      }
    );
    const candidates = parseListPageCandidatesFromHtml(
      result.pages[0].html,
      'https://hotels.ctrip.com/hotels/list?city=2'
    );

    assert.equal(result.pages[0].networkResponseCount, 1);
    assert.deepEqual(
      candidates.map((candidate) => candidate.hotelId),
      ['9101']
    );
  } finally {
    clearModules([...collectorModulePaths, cdpUtilsPath, processUtilsPath]);
  }
});

test('captureListHtmlPagesWithEdge appends Ctrip list API replay responses to snapshots', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Edge CDP list fallback is Windows-only');
    return;
  }

  const listeners = [];
  let apiReplayCalled = false;
  let scrollCalled = false;
  const cdpUtilsPath = installMock('../src/scraper/cdp-utils', {
    connectToDebugger: async () => ({
      async send(method) {
        if (method === 'Target.getTargets') {
          return { targetInfos: [] };
        }
        if (method === 'Target.createTarget') {
          return { targetId: 'target-1' };
        }
        if (method === 'Target.attachToTarget') {
          return { sessionId: 'session-1' };
        }
        if (method === 'Page.navigate') {
          setImmediate(() => {
            listeners.forEach((listener) =>
              listener({ sessionId: 'session-1', method: 'Page.loadEventFired' })
            );
          });
        }
        return {};
      },
      addListener(listener) {
        listeners.push(listener);
        return () => {
          const index = listeners.indexOf(listener);
          if (index >= 0) {
            listeners.splice(index, 1);
          }
        };
      },
      async close() {}
    }),
    evaluateInSession: async (_connection, _sessionId, expression) => {
      if (String(expression).includes('fetchHotelList')) {
        apiReplayCalled = true;
        return JSON.stringify({
          responses: [
            {
              pageIndex: 2,
              status: 200,
              data: {
                data: {
                  hotelList: [
                    {
                      hotelInfo: {
                        summary: { hotelId: '9201', masterHotelId: '9201' },
                        nameInfo: { name: '页面接口酒店' },
                        commentInfo: { commentScore: 4.8 }
                      }
                    }
                  ]
                }
              }
            }
          ],
          pageIndexes: [2],
          error: ''
        });
      }
      scrollCalled = true;
      return JSON.stringify({
        scrollHeight: 1200,
        candidateCount: 0,
        scrollContainerCount: 0,
        scrollActions: 0,
        html: '<html><body>列表首屏</body></html>'
      });
    },
    launchManagedEdgeSession: async () => ({
      browser: { pid: 123 },
      userDataDir: '',
      shouldCleanupUserDataDir: false,
      debuggerUrl: 'ws://edge.test/devtools/browser'
    }),
    normalizeEdgeSessionOptions: () => ({}),
    waitForDebuggerEndpoint: async () => 'ws://edge.test/devtools/browser',
    waitForSessionCondition: async () => true
  });
  const processUtilsPath = installMock('../src/scraper/process-utils', {
    findEdgeExecutable: () => 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    killBrowserProcessesByCommandLine: () => false,
    killProcessTree: () => undefined
  });
  const collectorModulePaths = getListCollectorModulePaths();
  clearModules(collectorModulePaths);

  try {
    const { captureListHtmlPagesWithEdge } = require('../src/scraper/list-page-collector');
    const result = await captureListHtmlPagesWithEdge(
      ['https://hotels.ctrip.com/hotels/list?city=2'],
      {},
      {
        desiredHotelCount: 21,
        maxScrollRounds: 1,
        stableRoundLimit: 1,
        initialSettleMs: 0
      }
    );
    const candidates = parseListPageCandidatesFromHtml(
      result.pages[0].html,
      'https://hotels.ctrip.com/hotels/list?city=2'
    );

    assert.equal(apiReplayCalled, true);
    assert.equal(scrollCalled, true);
    assert.equal(result.pages[0].listApiResponseCount, 1);
    assert.deepEqual(result.pages[0].listApiPageIndexes, [2]);
    assert.deepEqual(
      candidates.map((candidate) => candidate.hotelId),
      ['9201']
    );
  } finally {
    clearModules([...collectorModulePaths, cdpUtilsPath, processUtilsPath]);
  }
});

test('captureListHtmlPagesWithEdge can stop before slow DOM scan when API replay reaches target', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Edge CDP list fallback is Windows-only');
    return;
  }

  const listeners = [];
  let apiReplayCalled = false;
  let scrollCalled = false;
  const cdpUtilsPath = installMock('../src/scraper/cdp-utils', {
    connectToDebugger: async () => ({
      async send(method) {
        if (method === 'Target.getTargets') {
          return { targetInfos: [] };
        }
        if (method === 'Target.createTarget') {
          return { targetId: 'target-1' };
        }
        if (method === 'Target.attachToTarget') {
          return { sessionId: 'session-1' };
        }
        if (method === 'Page.navigate') {
          setImmediate(() => {
            listeners.forEach((listener) =>
              listener({ sessionId: 'session-1', method: 'Page.loadEventFired' })
            );
            listeners.forEach((listener) =>
              listener({
                sessionId: 'session-1',
                method: 'Network.responseReceived',
                params: {
                  requestId: 'network-fast',
                  response: {
                    url: 'https://m.ctrip.com/restapi/soa2/34951/fetchHotelList',
                    status: 200,
                    mimeType: 'application/json'
                  }
                }
              })
            );
          });
        }
        if (method === 'Network.getResponseBody') {
          return {
            body: JSON.stringify({
              data: {
                hotelList: [
                  {
                    hotelInfo: {
                      summary: { hotelId: '9400', masterHotelId: '9400' },
                      nameInfo: { name: '首屏接口酒店' },
                      commentInfo: { commentScore: 4.8 }
                    }
                  }
                ]
              }
            })
          };
        }
        return {};
      },
      addListener(listener) {
        listeners.push(listener);
        return () => {
          const index = listeners.indexOf(listener);
          if (index >= 0) {
            listeners.splice(index, 1);
          }
        };
      },
      async close() {}
    }),
    evaluateInSession: async (_connection, _sessionId, expression) => {
      if (String(expression).includes('fetchHotelList')) {
        apiReplayCalled = true;
        return JSON.stringify({
          responses: [
            {
              pageIndex: 2,
              status: 200,
              data: {
                data: {
                  hotelList: [
                    {
                      hotelInfo: {
                        summary: { hotelId: '9401', masterHotelId: '9401' },
                        nameInfo: { name: '快速接口酒店' },
                        commentInfo: { commentScore: 4.9 }
                      }
                    }
                  ]
                }
              }
            }
          ],
          pageIndexes: [2],
          error: ''
        });
      }
      scrollCalled = true;
      return JSON.stringify({
        scrollHeight: 1200,
        candidateCount: 0,
        scrollContainerCount: 0,
        scrollActions: 0,
        html: '<html><body>慢 DOM 扫描不应执行</body></html>'
      });
    },
    launchManagedEdgeSession: async () => ({
      browser: { pid: 123 },
      userDataDir: '',
      shouldCleanupUserDataDir: false,
      debuggerUrl: 'ws://edge.test/devtools/browser'
    }),
    normalizeEdgeSessionOptions: () => ({}),
    waitForDebuggerEndpoint: async () => 'ws://edge.test/devtools/browser',
    waitForSessionCondition: async () => true
  });
  const processUtilsPath = installMock('../src/scraper/process-utils', {
    findEdgeExecutable: () => 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    killBrowserProcessesByCommandLine: () => false,
    killProcessTree: () => undefined
  });
  const collectorModulePaths = getListCollectorModulePaths();
  clearModules(collectorModulePaths);

  try {
    const { captureListHtmlPagesWithEdge } = require('../src/scraper/list-page-collector');
    const result = await captureListHtmlPagesWithEdge(
      ['https://hotels.ctrip.com/hotels/list?city=2'],
      {},
      {
        desiredHotelCount: 2,
        maxScrollRounds: 1,
        stableRoundLimit: 1,
        initialSettleMs: 0,
        onPage: (page) => {
          const candidates = parseListPageCandidatesFromHtml(
            page.html,
            'https://hotels.ctrip.com/hotels/list?city=2'
          );
          return {
            continue: candidates.length < 2,
            uniqueCandidateCount: candidates.length
          };
        }
      }
    );
    const candidates = parseListPageCandidatesFromHtml(
      result.pages[0].html,
      'https://hotels.ctrip.com/hotels/list?city=2'
    );

    assert.equal(apiReplayCalled, true);
    assert.equal(scrollCalled, false);
    assert.equal(result.pages.length, 1);
    assert.equal(result.pages[0].source, 'edge-list-api-replay');
    assert.equal(result.pages[0].networkResponseCount, 1);
    assert.equal(result.pages[0].listApiResponseCount, 1);
    assert.deepEqual(result.pages[0].listApiPageIndexes, [2]);
    assert.deepEqual(
      candidates.map((candidate) => candidate.hotelId),
      ['9400', '9401']
    );
  } finally {
    clearModules([...collectorModulePaths, cdpUtilsPath, processUtilsPath]);
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
