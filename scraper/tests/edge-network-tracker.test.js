const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createEdgeNetworkResponseTracker
} = require('../src/scraper/edge-capture-modules/network-response-tracker');

function createMockConnection() {
  const listeners = [];
  return {
    listeners,
    send: async () => ({
      body: JSON.stringify({ roomName: '标准大床房' }),
      base64Encoded: false
    }),
    addListener(listener) {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) {
          listeners.splice(index, 1);
        }
      };
    },
    emit(message) {
      for (const listener of [...listeners]) {
        listener(message);
      }
    }
  };
}

test('edge network response tracker records inspectable room responses for one session', () => {
  const connection = createMockConnection();
  const tracker = createEdgeNetworkResponseTracker({ connection, sessionId: 'session-1' });

  tracker.attach();
  connection.emit({
    sessionId: 'session-1',
    method: 'Network.responseReceived',
    params: {
      requestId: 'room-1',
      response: {
        url: 'https://m.ctrip.com/restapi/soa2/30103/getHotelRoomList',
        mimeType: 'application/json'
      }
    }
  });
  connection.emit({
    sessionId: 'session-2',
    method: 'Network.responseReceived',
    params: {
      requestId: 'other-session',
      response: {
        url: 'https://m.ctrip.com/restapi/soa2/30103/getHotelRoomList',
        mimeType: 'application/json'
      }
    }
  });

  assert.equal(tracker.trackedUrls.size, 1);
  assert.equal(tracker.requestMeta.size, 1);
  assert.equal(tracker.roomRequestMeta.size, 1);
  assert.deepEqual(tracker.getTrackedUrls(), [
    'https://m.ctrip.com/restapi/soa2/30103/getHotelRoomList'
  ]);
  assert.equal(tracker.getRoomTrackedUrlCount(), 1);
});

test('edge network response tracker detaches its listener', () => {
  const connection = createMockConnection();
  const tracker = createEdgeNetworkResponseTracker({ connection, sessionId: 'session-1' });

  tracker.attach();
  assert.equal(connection.listeners.length, 1);
  tracker.detach();
  assert.equal(connection.listeners.length, 0);

  connection.emit({
    sessionId: 'session-1',
    method: 'Network.responseReceived',
    params: {
      requestId: 'room-1',
      response: {
        url: 'https://m.ctrip.com/restapi/soa2/30103/getHotelRoomList',
        mimeType: 'application/json'
      }
    }
  });

  assert.equal(tracker.trackedUrls.size, 0);
  assert.equal(tracker.roomRequestMeta.size, 0);
});

test('edge network response tracker prefetches room response body after loading finishes', async () => {
  const connection = createMockConnection();
  const tracker = createEdgeNetworkResponseTracker({ connection, sessionId: 'session-1' });

  tracker.attach();
  connection.emit({
    sessionId: 'session-1',
    method: 'Network.responseReceived',
    params: {
      requestId: 'room-1',
      response: {
        url: 'https://m.ctrip.com/restapi/soa2/30103/getHotelRoomList',
        mimeType: 'application/json'
      }
    }
  });
  connection.emit({
    sessionId: 'session-1',
    method: 'Network.loadingFinished',
    params: {
      requestId: 'room-1'
    }
  });

  const meta = tracker.requestMeta.get('room-1');
  assert.ok(meta.bodyReadPromise);
  const bodyResult = await meta.bodyReadPromise;

  assert.equal(bodyResult.body, JSON.stringify({ roomName: '标准大床房' }));
  assert.equal(meta.cachedBody, JSON.stringify({ roomName: '标准大床房' }));
});
