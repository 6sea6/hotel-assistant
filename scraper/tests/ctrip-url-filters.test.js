const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCtripListUrl,
  mergeCtripFilters,
  parseCtripListUrl
} = require('../src/ctrip-url-filters');

function parseFromFilters(listFilters) {
  return parseCtripListUrl(`https://hotels.ctrip.com/hotels/list?cityId=2&listFilters=${encodeURIComponent(listFilters)}`);
}

test('parseCtripListUrl parses price range and preserves unknown filters', () => {
  const parsed = parseFromFilters('29~1*29*1~3*2,15~Range*15*50~200,80~2*80*2');

  assert.equal(parsed.knownSettings.priceMin, 50);
  assert.equal(parsed.knownSettings.priceMax, 200);
  assert.deepEqual(parsed.unknownFilters, ['29~1*29*1~3*2', '80~2*80*2']);
  assert.equal(parsed.hasKnownFilters, true);
  assert.deepEqual(parsed.detectedKnownFilterKeys, ['priceMin', 'priceMax']);
});

test('parseCtripListUrl does not mark unknown native filters as known settings', () => {
  const parsed = parseFromFilters('29~1*29*1~3*2,80~2*80*2');

  assert.equal(parsed.hasKnownFilters, false);
  assert.deepEqual(parsed.detectedKnownFilterKeys, []);
  assert.deepEqual(parsed.unknownFilters, ['29~1*29*1~3*2', '80~2*80*2']);
});

test('parseCtripListUrl reports only detected known filter keys', () => {
  const parsed = parseFromFilters('29~1*29*1~3*2,15~Range*15*50~200,16~4*16*4');

  assert.equal(parsed.hasKnownFilters, true);
  assert.deepEqual(parsed.detectedKnownFilterKeys, ['priceMin', 'priceMax', 'starLevels']);
  assert.deepEqual(parsed.unknownFilters, ['29~1*29*1~3*2']);
});

test('parseCtripListUrl parses 1500 plus price range', () => {
  const parsed = parseFromFilters('15~Range*15*1500~max');

  assert.equal(parsed.knownSettings.priceMin, 1500);
  assert.equal(parsed.knownSettings.priceMax, 'max');
});

test('parseCtripListUrl parses multiple star levels', () => {
  const parsed = parseFromFilters('16~3*16*3,16~4*16*4');

  assert.deepEqual(parsed.knownSettings.starLevels, [3, 4]);
});

test('parseCtripListUrl parses sort mode', () => {
  const parsed = parseFromFilters('17~6*17*6');

  assert.equal(parsed.knownSettings.sortMode, 'review_high');
});

test('parseCtripListUrl parses free cancel filter', () => {
  const parsed = parseFromFilters('23~10*23*10');

  assert.equal(parsed.knownSettings.freeCancel, true);
});

test('parseCtripListUrl parses review count filter', () => {
  const parsed = parseFromFilters('25~7*25*500');

  assert.equal(parsed.knownSettings.reviewCountMin, 500);
});

test('parseCtripListUrl parses Ctrip score filter', () => {
  const parsed = parseFromFilters('6~3*6*3');

  assert.equal(parsed.knownSettings.ctripScoreMin, 4.0);
});

test('buildCtripListUrl generates combined known filters and keeps query params', () => {
  const originalUrl = 'https://hotels.ctrip.com/hotels/list?flexType=1&fixedDate=0&cityId=2&provinceId=0&districtId=0&countryId=1&destName=%E4%B8%8A%E6%B5%B7&searchType=CT&optionId=2&checkin=2026-06-01&checkout=2026-06-02&crn=1&listFilters=29~1*29*1~3*2&curr=CNY&locale=zh-CN&old=1&v2_mod=79&v2_version=E';
  const generated = buildCtripListUrl(originalUrl, {
    priceMin: 50,
    priceMax: 200,
    starLevels: [3, 4],
    sortMode: 'review_high',
    freeCancel: true,
    reviewCountMin: 500,
    ctripScoreMin: 4.0
  });
  const parsed = parseCtripListUrl(generated);

  assert.ok(parsed.listFilterParts.includes('29~1*29*1~3*2'));
  assert.ok(parsed.listFilterParts.includes('15~Range*15*50~200'));
  assert.ok(parsed.listFilterParts.includes('16~3*16*3'));
  assert.ok(parsed.listFilterParts.includes('16~4*16*4'));
  assert.ok(parsed.listFilterParts.includes('17~6*17*6'));
  assert.ok(parsed.listFilterParts.includes('23~10*23*10'));
  assert.ok(parsed.listFilterParts.includes('25~7*25*500'));
  assert.ok(parsed.listFilterParts.includes('6~3*6*3'));
  assert.equal(parsed.queryParams.cityId, '2');
  assert.equal(parsed.queryParams.optionId, '2');
  assert.equal(parsed.queryParams.checkin, '2026-06-01');
  assert.equal(parsed.queryParams.checkout, '2026-06-02');
  assert.equal(parsed.queryParams.curr, 'CNY');
  assert.equal(parsed.queryParams.locale, 'zh-CN');
  assert.equal(parsed.queryParams.v2_mod, '79');
  assert.equal(parsed.queryParams.v2_version, 'E');
});

test('mergeCtripFilters replaces existing sort mode', () => {
  const merged = mergeCtripFilters(['29~1*29*1~3*2', '17~3*17*3'], {
    sortMode: 'review_high'
  });

  assert.deepEqual(merged, ['29~1*29*1~3*2', '17~6*17*6']);
});

test('mergeCtripFilters removes unknown old sort and star type filters when controlled', () => {
  const merged = mergeCtripFilters(['17~99*17*99', '16~9*16*9', '80~2*80*2'], {
    sortMode: 'price_low',
    starLevels: [5]
  });

  assert.deepEqual(merged, ['80~2*80*2', '16~5*16*5', '17~3*17*3']);
});

test('buildCtripListUrl clears price range when price is unlimited', () => {
  const generated = buildCtripListUrl(
    'https://hotels.ctrip.com/hotels/list?cityId=2&listFilters=15~Range*15*50~200',
    {
      priceMin: null,
      priceMax: null
    }
  );

  assert.doesNotMatch(decodeURIComponent(generated), /15~Range/);
});

test('mergeCtripFilters preserves unknown filters when changing price', () => {
  const merged = mergeCtripFilters([
    '29~1*29*1~3*2',
    '80~2*80*2',
    '999~abc*999*xyz'
  ], {
    priceMin: 100,
    priceMax: 300
  });

  assert.ok(merged.includes('29~1*29*1~3*2'));
  assert.ok(merged.includes('80~2*80*2'));
  assert.ok(merged.includes('999~abc*999*xyz'));
  assert.ok(merged.includes('15~Range*15*100~300'));
});
