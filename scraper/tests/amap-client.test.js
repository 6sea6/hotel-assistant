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

test('amap client limits concurrent HTTP requests to three', async () => {
  const clientPath = require.resolve('../src/amap-modules/client');
  delete require.cache[clientPath];

  let activeRequests = 0;
  let maxActiveRequests = 0;
  const httpClientPath = installMock('../src/http-client', {
    get: async (url) => {
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 20));
      activeRequests -= 1;

      if (/place\/text/.test(url)) {
        return {
          data: {
            pois: [
              {
                id: 'poi-1',
                name: '武汉站',
                location: '114.424,30.607',
                pname: '湖北省',
                cityname: '武汉市',
                adname: '洪山区',
                address: '白云路'
              }
            ]
          }
        };
      }

      return { data: {} };
    }
  });

  try {
    const { searchPlace } = require('../src/amap-modules/client');
    await Promise.all([
      searchPlace('武汉站', { key: 'test-key' }),
      searchPlace('汉口站', { key: 'test-key' }),
      searchPlace('武昌站', { key: 'test-key' }),
      searchPlace('武汉天河机场', { key: 'test-key' })
    ]);

    assert.equal(maxActiveRequests, 3);
  } finally {
    delete require.cache[clientPath];
    delete require.cache[httpClientPath];
  }
});
