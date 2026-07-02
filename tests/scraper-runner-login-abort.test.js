const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function installMock(modulePath, exports) {
  const resolvedPath = require.resolve(modulePath);
  const original = require.cache[resolvedPath];
  require.cache[resolvedPath] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports
  };
  return { resolvedPath, original };
}

function restoreMock(mock) {
  if (!mock) return;
  if (mock.original) {
    require.cache[mock.resolvedPath] = mock.original;
  } else {
    delete require.cache[mock.resolvedPath];
  }
}

test('collect runner aborts first batch as soon as hard Ctrip login lock is detected', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scraper-login-abort-'));
  const scraperRunnerPath = require.resolve('../src/main/ai/scraper-runner');
  const scraperPathsPath = '../src/main/ai/scraper-paths';
  const originalRunner = require.cache[scraperRunnerPath];
  delete require.cache[scraperRunnerPath];

  const events = [];
  const calls = {
    collect: 0,
    apply: 0,
    loginPrep: 0
  };
  let firstCollectSignal = null;

  const scraperPathsMock = installMock(scraperPathsPath, {
    ensureScraperRuntimeDirs() {},
    resolveRootPerfLogDir() {
      return path.join(tempDir, 'logs', 'perf');
    },
    resolveScraperPath() {
      return path.join(tempDir, 'scraper');
    },
    resolveScraperWorkDir() {
      return tempDir;
    },
    async withScraperEnvironment(_dataFolderPath, _scraperPath, task) {
      return task();
    },
    async loadScraperModule(_scraperPath, moduleFile) {
      if (moduleFile === 'cli/auto-edge.js') {
        return {
          runInteractiveEdgeLoginPrep: async () => {
            calls.loginPrep += 1;
            return { loginConfirmed: true };
          }
        };
      }

      if (moduleFile === 'task-runner.js') {
        return {
          runHotelImportTask: async (args, options = {}) => {
            if (args['apply-output']) {
              calls.apply += 1;
              return { writeResult: { operation: 'inserted' } };
            }

            calls.collect += 1;
            if (calls.collect === 1) {
              firstCollectSignal = options.signal;
              options.onEvent({
                type: 'batch:start',
                message: '正在批量采集携程酒店页面',
                details: {
                  summary: '模式=list，输入URL=1，展开酒店=44',
                  effectiveConcurrency: 3
                }
              });
              options.onEvent({
                type: 'edge:login-required',
                message: '检测到携程登录提示，需要重新登录后继续采集',
                details: {
                  actionRequired: true,
                  reason: '携程页面提示登录后才能查看价格或优惠。',
                  instruction: '当前采集浏览器登录态可能无效；请在可见浏览器中登录携程后继续。'
                }
              });
              assert.equal(firstCollectSignal.aborted, true);
              const error = new Error('任务已取消');
              error.name = 'AbortError';
              throw error;
            }

            return {
              success: true,
              batchMode: false,
              hotelName: '重试成功酒店',
              eligibleCount: 1,
              eligibleRoomTypes: [{ dailyPrice: 300, totalPrice: 300 }],
              roomPrices: [300],
              totalPrice: 300,
              outputPath: path.join(tempDir, 'retry-output.json'),
              pageSnapshot: {
                room_candidates_count: 1,
                room_price_visible: true,
                sources: []
              }
            };
          }
        };
      }

      if (moduleFile === 'compare-app-bridge.js') {
        return {
          getCompareAppStorePath() {
            return path.join(tempDir, 'hotel-data.json');
          }
        };
      }

      throw new Error(`Unexpected module request: ${moduleFile}`);
    }
  });

  try {
    const { collectAndWriteCtripHotel } = require('../src/main/ai/scraper-runner');
    const result = await collectAndWriteCtripHotel(
      {
        url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=1',
        templateName: '测试模板'
      },
      {
        taskId: 'task-login-abort',
        dataFolderPath: path.join(tempDir, 'data'),
        signal: new AbortController().signal,
        onEvent(event) {
          events.push(event);
        }
      }
    );

    assert.equal(calls.collect, 2);
    assert.equal(calls.loginPrep, 1);
    assert.equal(calls.apply, 1);
    assert.equal(result.hotelName, '重试成功酒店');
    assert.equal(result.loginRetry.attempted, true);
    assert.equal(firstCollectSignal.aborted, true);
    assert.deepEqual(
      events.map((event) => event.type),
      ['batch:start', 'edge:login-required', 'edge:login-window', 'edge:login-done', 'scrape:retry']
    );
    assert.equal(
      events.filter((event) => event.type === 'edge:login-required').length,
      1
    );
  } finally {
    restoreMock(scraperPathsMock);
    if (originalRunner) {
      require.cache[scraperRunnerPath] = originalRunner;
    } else {
      delete require.cache[scraperRunnerPath];
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
