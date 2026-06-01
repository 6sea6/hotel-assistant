const { shouldInspectNetworkResponse } = require('../api-replay');
const { isRoomListNetworkResponse } = require('./network-response-classifier');

function createEdgeNetworkResponseTracker({ connection = null, sessionId = '' } = {}) {
  const requestMeta = new Map();
  const roomRequestMeta = new Map();
  const trackedUrls = new Set();
  let removeListener = null;

  const handleResponseReceived = (message = {}) => {
    if (message.sessionId !== sessionId || message.method !== 'Network.responseReceived') {
      return;
    }

    const params = message.params || {};
    const response = params.response || {};
    const requestId = params.requestId;
    const responseUrl = response.url;
    if (!requestId || !responseUrl) {
      return;
    }
    if (!shouldInspectNetworkResponse(responseUrl, response.mimeType)) {
      return;
    }

    const nextMeta = { url: responseUrl, mimeType: response.mimeType };
    trackedUrls.add(responseUrl);
    requestMeta.set(requestId, nextMeta);
    if (isRoomListNetworkResponse(responseUrl)) {
      roomRequestMeta.set(requestId, nextMeta);
    }
  };

  const attach = () => {
    if (removeListener) {
      return removeListener;
    }
    if (!connection || typeof connection.addListener !== 'function') {
      removeListener = () => {};
      return removeListener;
    }
    removeListener = connection.addListener(handleResponseReceived);
    return removeListener;
  };

  const detach = () => {
    if (typeof removeListener === 'function') {
      removeListener();
    }
    removeListener = null;
  };

  return {
    requestMeta,
    roomRequestMeta,
    trackedUrls,
    handleResponseReceived,
    attach,
    detach,
    getTrackedUrlCount() {
      return trackedUrls.size;
    },
    getRoomTrackedUrlCount() {
      return roomRequestMeta.size;
    },
    getTrackedUrls() {
      return [...trackedUrls];
    }
  };
}

module.exports = {
  createEdgeNetworkResponseTracker
};
