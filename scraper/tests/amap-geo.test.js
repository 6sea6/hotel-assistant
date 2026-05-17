const test = require('node:test');
const assert = require('node:assert/strict');

const { extractGeoInfoFromHtml } = require('../src/scraper/html-parser');
const {
  bd09ToGcj02,
  buildSubwayStationCandidates,
  normalizeHotelGeoForAmap,
  pickNearestSubwayStation
} = require('../src/amap');

test('extractGeoInfoFromHtml reads hotelPositionInfo even when lng and lat appear before address', () => {
  const html = `<script>window.__HOTEL__={"hotelPositionInfo":{"lng":"114.303931","lat":"30.503373","mapType":"bd","address":"湖北武汉洪山区张家湾街道烽火崇文兰庭武梁路","placeInfo":{"placeList":[{"type":"metro","desc":"距张家湾地铁站480米"}]}}};</script>`;

  assert.deepEqual(extractGeoInfoFromHtml(html), {
    address: '湖北武汉洪山区张家湾街道烽火崇文兰庭武梁路',
    lng: '114.303931',
    lat: '30.503373',
    mapType: 'bd',
    location: '114.303931,30.503373',
    nearestSubway: {
      name: '张家湾地铁站',
      distanceMeters: 480,
      distanceKm: 0.5,
      source: 'ctrip-page'
    }
  });
});

test('extractGeoInfoFromHtml prefers wholePoiInfoList walking metro distance when present', () => {
  const html = `<script>window.__HOTEL__={"hotelPositionInfo":{"lng":"114.308255","lat":"30.590953","mapType":"bd","address":"湖北武汉江岸区沿江大道159号","placeInfo":{"placeList":[{"type":"metro","desc":"距大智路地铁站1.4公里","distance":"1.4公里"}],"wholePoiInfoList":[{"desc":"大智路地铁站","type":"metro","distance":"1.4千米","descWithType":"地铁: 大智路地铁站","distType":"WALK","poiId":"64283818","poiName":"大智路地铁站","poiType":"7","walkDriveDistance":"1399.999976158142"},{"desc":"江汉路地铁站","type":"metro","distance":"1.5千米","descWithType":"地铁: 江汉路地铁站","distType":"WALK","poiId":"64283816","poiName":"江汉路地铁站","poiType":"7","walkDriveDistance":"1539.9999618530273"}]}}};</script>`;

  assert.deepEqual(extractGeoInfoFromHtml(html), {
    address: '湖北武汉江岸区沿江大道159号',
    lng: '114.308255',
    lat: '30.590953',
    mapType: 'bd',
    location: '114.308255,30.590953',
    nearestSubway: {
      name: '大智路地铁站',
      distanceMeters: 1400,
      distanceKm: 1.4,
      source: 'ctrip-page'
    }
  });
});

test('normalizeHotelGeoForAmap converts bd09 hotel coordinates before calling AMap', () => {
  const normalized = normalizeHotelGeoForAmap(
    {
      address: '湖北武汉洪山区张家湾街道烽火崇文兰庭武梁路',
      location: '114.303931,30.503373',
      mapType: 'bd',
      nearestSubway: {
        name: '张家湾地铁站',
        distanceMeters: 480,
        distanceKm: 0.5,
        source: 'ctrip-page'
      }
    },
    ''
  );

  assert.equal(normalized.source, 'hotel-geo-bd09-converted');
  assert.equal(normalized.location, '114.297325,30.497709');
  assert.deepEqual(normalized.nearestSubway, {
    name: '张家湾地铁站',
    distanceMeters: 480,
    distanceKm: 0.5,
    source: 'ctrip-page'
  });

  const converted = bd09ToGcj02(114.303931, 30.503373);
  assert.equal(normalized.location, `${converted.lng.toFixed(6)},${converted.lat.toFixed(6)}`);
});

test('pickNearestSubwayStation collapses exits into station names and prefers station-level distance', () => {
  const nearest = pickNearestSubwayStation([
    {
      name: '张家湾地铁站B口',
      distance: '392',
      type: '交通设施服务;地铁站;出入口'
    },
    {
      name: '张家湾(地铁站)',
      distance: '459',
      type: '交通设施服务;地铁站;地铁站'
    },
    {
      name: '烽火村(地铁站)',
      distance: '1260',
      type: '交通设施服务;地铁站;地铁站'
    }
  ]);

  assert.deepEqual(nearest, {
    name: '张家湾地铁站',
    distanceKm: 0.5,
    distanceMeters: 459
  });
});

test('buildSubwayStationCandidates keeps station-level and exit locations for later walking lookup', () => {
  const candidates = buildSubwayStationCandidates([
    {
      name: '张家湾地铁站B口',
      distance: '392',
      location: '114.100000,30.100000',
      type: '交通设施服务;地铁站;出入口'
    },
    {
      name: '张家湾(地铁站)',
      distance: '459',
      location: '114.200000,30.200000',
      type: '交通设施服务;地铁站;地铁站'
    },
    {
      name: '烽火村(地铁站)',
      distance: '1260',
      location: '114.300000,30.300000',
      type: '交通设施服务;地铁站;地铁站'
    }
  ]);

  assert.deepEqual(candidates[0], {
    name: '张家湾地铁站',
    distanceKm: 0.5,
    distanceMeters: 459,
    stationLocation: '114.200000,30.200000',
    anyLocation: '114.100000,30.100000'
  });
});
