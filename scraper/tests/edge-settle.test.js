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

function clearModules(paths) {
  for (const modulePath of paths) {
    delete require.cache[modulePath];
  }
}

function createPerfRecorder(records = []) {
  return {
    phase(phase, fields = {}) {
      return {
        end(status = 'success', extra = {}) {
          records.push({ event: 'phase', phase, status, ...fields, ...extra });
        },
        error(error, extra = {}) {
          records.push({
            event: 'phase_error',
            phase,
            status: 'error',
            error_message: error && error.message ? error.message : String(error),
            ...fields,
            ...extra
          });
        }
      };
    }
  };
}

test('settleRoomListInEdgeSession emits split settle phases and aggregate stats', async () => {
  const cdpUtilsPath = installMock('../src/scraper/cdp-utils', {
    evaluateInSession: async (_connection, _sessionId, expression) => {
      if (expression.includes('edge_settle_close_panels')) {
        throw new Error('phase marker should not be in browser expression');
      }
      return JSON.stringify({
        clickedCount: 1,
        scrollCount: 2,
        containerCount: 1,
        documentHeightBefore: 1000,
        documentHeightAfter: 1200,
        bodyTextLength: 3000,
        roomKeywordCount: 8
      });
    }
  });
  const settlePath = require.resolve('../src/scraper/edge-capture-modules/session-settle');
  delete require.cache[settlePath];

  try {
    const records = [];
    let trackedUrlCount = 0;
    const {
      settleRoomListInEdgeSession
    } = require('../src/scraper/edge-capture-modules/session-settle');
    const stats = await settleRoomListInEdgeSession({}, 'session-1', {
      perf: createPerfRecorder(records),
      fields: { url: 'https://example.test/hotel' },
      getTrackedUrlCount: () => {
        trackedUrlCount += 1;
        return trackedUrlCount;
      }
    });

    const phases = records.map((record) => record.phase);
    assert.deepEqual(phases, [
      'edge_settle_close_panels',
      'edge_settle_initial_expand',
      'edge_settle_main_scroll',
      'edge_settle_scroll_containers',
      'edge_settle_bottom_expand',
      'edge_settle_return_top'
    ]);
    assert.equal(stats.clickedCount, 6);
    assert.equal(stats.scrollCount, 12);
    assert.equal(stats.containerCount, 1);
    assert.ok(stats.totalMs >= 0);
    assert.equal(records[0].clicked_count, 1);
    assert.equal(records[0].scroll_count, 2);
    assert.equal(records[0].container_count, 1);
    assert.equal(typeof records[0].tracked_url_count_before, 'number');
    assert.equal(typeof records[0].tracked_url_count_after, 'number');
  } finally {
    clearModules([settlePath, cdpUtilsPath]);
  }
});
