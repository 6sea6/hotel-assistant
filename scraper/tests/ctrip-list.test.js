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
const {
  expandCtripHotelInputs,
  normalizeListFiltersFromArgs
} = require('../src/ctrip-list');

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

  assert.deepEqual(candidates.map((candidate) => candidate.hotelId), ['117627065', '712581']);
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
  assert.ok(candidates.find((candidate) => candidate.hotelId === '1001').detailUrl.includes('checkIn=2026-06-01'));
  assert.equal(candidates.find((candidate) => candidate.hotelId === '1001').hotelName, '江汉路示例酒店');
  assert.equal(candidates.find((candidate) => candidate.hotelId === '1001').ctripScore, 4.8);
  assert.equal(candidates.find((candidate) => candidate.hotelId === '1001').sourceOrder, 1);

  const prefilter = filterListPageCandidates(candidates, {
    minScore: 4.5,
    excludeHotelTypes: ['青年旅舍'],
    excludeKeywords: ['备用'],
    desiredHotelCount: 1
  });

  assert.equal(prefilter.selected.length, 1);
  assert.equal(prefilter.selected[0].hotelId, '1001');
  assert.ok(prefilter.rejected.some((candidate) => candidate.rejectReason === 'score_below_minimum'));
  assert.ok(prefilter.rejected.some((candidate) => candidate.rejectReason === 'hotel_type_keyword:青年旅舍'));
  assert.deepEqual(prefilter.detailUrls, [prefilter.selected[0].detailUrl]);
});

test('list page filters support defaults, desired count and max candidates per page', () => {
  const filters = normalizeListPageFilterOptions({
    minScore: '4.6',
    desiredHotelCount: '2',
    maxPages: '3',
    maxCandidatesPerPage: '5'
  });

  assert.equal(filters.minScore, 4.6);
  assert.equal(filters.desiredHotelCount, 2);
  assert.equal(filters.targetCount, 2);
  assert.equal(filters.maxPages, 3);
  assert.equal(filters.maxCandidatesPerPage, 5);
  assert.ok(filters.excludeHotelTypes.includes('民宿'));
  assert.ok(filters.excludeHotelTypes.includes('客栈'));
  assert.ok(filters.excludeHotelTypes.includes('青年旅舍'));
  assert.ok(filters.excludeHotelTypes.includes('公寓'));
});

test('normalizeListFiltersFromArgs supports CLI aliases', () => {
  const filters = normalizeListFiltersFromArgs({
    'min-rating': '4.6',
    'exclude-accommodation-keywords': '民宿,公寓',
    'exclude-name-keywords': '青年',
    'target-count': '3',
    'max-pages': '2'
  });

  assert.equal(filters.minScore, 4.6);
  assert.deepEqual(filters.excludeAccommodationKeywords, ['民宿', '公寓']);
  assert.deepEqual(filters.excludeNameKeywords, ['青年']);
  assert.equal(filters.desiredHotelCount, 3);
  assert.equal(filters.targetCount, 3);
  assert.equal(filters.maxPages, 2);
});

test('expandCtripHotelInputs expands list URLs to ordered detail URLs', async () => {
  const calls = [];
  const expanded = await expandCtripHotelInputs({
    url: 'https://hotels.ctrip.com/hotels/list?city=2'
  }, {
    check_in_date: '2026-06-01',
    check_out_date: '2026-06-02',
    room_count: 2
  }, {
    desiredHotelCount: 2,
    maxPages: 1
  }, {
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
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].filters.desiredHotelCount, 2);
  assert.equal(expanded.inputMode, 'list');
  assert.deepEqual(expanded.hotelInputs.map((item) => item.hotelId), ['2001', '2002']);
  assert.deepEqual(expanded.hotelInputs.map((item) => item.source), ['list-prefilter', 'list-prefilter']);
  assert.ok(expanded.hotelInputs[0].url.includes('checkIn=2026-06-01'));
  assert.equal(expanded.summary.expandedHotelCount, 2);
});
