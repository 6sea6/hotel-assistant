const test = require('node:test');
const assert = require('node:assert/strict');

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

test('getTransitInfo reuses destination and route lookups through task cache', async () => {
  const transitPath = require.resolve('../src/amap-modules/transit');
  delete require.cache[transitPath];

  const calls = {
    geocode: 0,
    resolvePlace: 0,
    walking: 0,
    transit: 0,
    nearestSubway: 0
  };
  const mockedPaths = [];
  mockedPaths.push(
    installMock('../src/amap-modules/client', {
      DEFAULT_TRANSIT_TIME: '09:00',
      fetchTransitRoute: async () => {
        calls.transit += 1;
        return [
          {
            distance: 10000,
            duration: 1200,
            cost: 5,
            segments: []
          }
        ];
      },
      fetchWalkingRoute: async () => {
        calls.walking += 1;
        return {
          distanceKm: 9,
          durationMinutes: 99,
          hasSubway: false,
          subwayLineNames: [],
          subwayDistanceKm: 0,
          busRoute: '步行'
        };
      },
      geocodeAddress: async (address) => {
        calls.geocode += 1;
        const isA = String(address).includes('A');
        return {
          source: 'mock-geocode',
          formattedAddress: address,
          city: '武汉市',
          location: isA ? '114.000000,30.000000' : '115.000000,31.000000'
        };
      },
      getDefaultTransitDate: () => '2026-06-01'
    })
  );
  mockedPaths.push(
    installMock('../src/amap-modules/place', {
      normalizeHotelGeoForAmap: () => null,
      resolvePlace: async () => {
        calls.resolvePlace += 1;
        return {
          source: 'mock-place',
          city: '武汉市',
          location: '116.000000,32.000000'
        };
      }
    })
  );
  mockedPaths.push(
    installMock('../src/amap-modules/subway', {
      searchNearestSubwayDistanceKm: async () => {
        calls.nearestSubway += 1;
        return {
          name: '测试地铁站',
          distanceKm: 0.8
        };
      }
    })
  );

  try {
    const { getTransitInfo } = require('../src/amap-modules/transit');
    const cache = {};

    await getTransitInfo('酒店A地址', '武汉站', 'test-key', { cache });
    await getTransitInfo('酒店B地址', '武汉站', 'test-key', { cache });
    await getTransitInfo('酒店A地址', '武汉站', 'test-key', { cache });

    assert.equal(calls.resolvePlace, 1);
    assert.equal(calls.geocode, 2);
    assert.equal(calls.walking, 2);
    assert.equal(calls.transit, 2);
    assert.equal(calls.nearestSubway, 2);
  } finally {
    delete require.cache[transitPath];
    for (const modulePath of mockedPaths) {
      delete require.cache[modulePath];
    }
  }
});
