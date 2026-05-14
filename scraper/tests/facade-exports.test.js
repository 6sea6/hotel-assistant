const test = require('node:test');
const assert = require('node:assert/strict');

test('compare-app bridge facade keeps stable exported helpers', () => {
  const compareAppBridge = require('../src/compare-app-bridge');

  assert.deepEqual(
    Object.keys(compareAppBridge).sort(),
    [
      'appendHotelToStore',
      'appendHotelsToStore',
      'buildTemplateInfo',
      'findTemplateInStore',
      'getCompareAppDataFolder',
      'getCompareAppStorePath',
      'getExplicitDataFolderOverride',
      'loadCompareAppStore'
    ].sort()
  );
});

test('amap facade keeps geo and transit helpers stable', () => {
  const amap = require('../src/amap');

  assert.deepEqual(
    Object.keys(amap).sort(),
    [
      'bd09ToGcj02',
      'buildSubwayStationCandidates',
      'getTransitInfo',
      'normalizeHotelGeoForAmap',
      'normalizeSubwayStationName',
      'pickNearestSubwayStation'
    ].sort()
  );
});

test('html-parser facade keeps room extraction helpers stable', () => {
  const htmlParser = require('../src/scraper/html-parser');

  assert.deepEqual(
    Object.keys(htmlParser).sort(),
    [
      'DESKTOP_HEADERS',
      'MOBILE_HEADERS',
      'extractEmbeddedObject',
      'extractExcludedPricesFromSnippet',
      'extractGeoInfoFromHtml',
      'extractHotelMetaFromHtml',
      'extractHotelScoreFromHtml',
      'extractJsonBlock',
      'extractRelevantPricesFromSnippet',
      'fetchHtml',
      'findRoomBlocksFromHtml',
      'findRoomBlocksFromStructuredText',
      'inferOccupancy',
      'loadHtmlFromFile',
      'safeJsonParse',
      'saveHtmlSnapshot'
    ].sort()
  );
});

test('edge-capture facade keeps supplemental capture helpers stable', () => {
  const edgeCapture = require('../src/scraper/edge-capture');

  assert.deepEqual(
    Object.keys(edgeCapture).sort(),
    [
      'captureRoomCandidatesWithEdge',
      'shouldAttemptSupplementalCapture',
      'shouldPreferEdgeCapture'
    ].sort()
  );
});
