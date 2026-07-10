const test = require('node:test');
const assert = require('node:assert/strict');

const { acquireEdgeTarget } = require('../src/scraper/edge-capture-modules/edge-target-session');

function createPerf() {
  return {
    phase() {
      return {
        end() {},
        error() {}
      };
    }
  };
}

test('edge capture attaches to its persistent batch worker target', async () => {
  const calls = [];
  const connection = {
    async send(method, params = {}) {
      calls.push({ method, params });
      if (method === 'Target.getTargets') {
        return {
          targetInfos: [
            { targetId: 'worker-1', type: 'page', url: 'about:blank' },
            { targetId: 'worker-2', type: 'page', url: 'about:blank' }
          ]
        };
      }
      if (method === 'Target.attachToTarget') {
        return { sessionId: 'session-worker-2' };
      }
      if (method === 'Target.createTarget') {
        throw new Error('persistent worker target should be reused');
      }
      return {};
    }
  };

  const result = await acquireEdgeTarget({
    connection,
    url: 'https://hotels.ctrip.com/hotels/detail/?hotelId=2',
    captureMethod: 'html_then_edge_cdp',
    preferredTargetId: 'worker-2',
    perf: createPerf()
  });

  assert.equal(result.targetId, 'worker-2');
  assert.equal(result.sessionId, 'session-worker-2');
  assert.equal(result.targetMode, 'reused-worker');
  assert.equal(result.shouldCloseTarget, false);
  assert.equal(
    calls.some((call) => call.method === 'Target.createTarget'),
    false
  );
});
