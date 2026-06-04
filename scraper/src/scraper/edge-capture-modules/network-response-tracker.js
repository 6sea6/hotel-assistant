const { shouldInspectNetworkResponse } = require('../api-replay');
const { isRoomListNetworkResponse } = require('./network-response-classifier');
const { readEdgeResponseBodyWithRetry } = require('./response-body-reader');

const ROOM_RESPONSE_PREFETCH_TIMEOUT_MS = 2500;
const ROOM_RESPONSE_PREFETCH_MAX_ATTEMPTS = 2;

function createEdgeNetworkResponseTracker({ connection = null, sessionId = '', signal = null } = {}) {
  const requestMeta = new Map();
  const roomRequestMeta = new Map();
  const trackedUrls = new Set();
  const finishedRequestIds = new Set();
  let removeListener = null;

  const prefetchRoomResponseBody = (requestId, meta) => {
    if (!requestId || !meta || meta.bodyReadPromise || !connection) {
      return;
    }
    if (!isRoomListNetworkResponse(meta.url)) {
      return;
    }

    meta.bodyReadPromise = readEdgeResponseBodyWithRetry({
      connection,
      sessionId,
      requestId,
      isRoomResponse: true,
      timeoutMs: ROOM_RESPONSE_PREFETCH_TIMEOUT_MS,
      maxAttempts: ROOM_RESPONSE_PREFETCH_MAX_ATTEMPTS,
      signal
    })
      .then((result) => {
        meta.cachedBodyResult = result;
        if (result && result.body) {
          meta.cachedBody = result.body;
        } else if (result && result.error) {
          meta.cachedBodyError = result.error.message || String(result.error);
        }
        return result;
      })
      .catch((error) => {
        const result = {
          body: '',
          retryCount: 0,
          timeoutCount: 0,
          elapsedMs: 0,
          error
        };
        meta.cachedBodyResult = result;
        meta.cachedBodyError = error && error.message ? error.message : String(error);
        return result;
      });
  };

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
      if (finishedRequestIds.has(requestId)) {
        prefetchRoomResponseBody(requestId, nextMeta);
      }
    }
  };

  const handleLoadingFinished = (message = {}) => {
    if (message.sessionId !== sessionId || message.method !== 'Network.loadingFinished') {
      return;
    }

    const requestId = message.params && message.params.requestId;
    if (!requestId) {
      return;
    }
    finishedRequestIds.add(requestId);
    const meta = requestMeta.get(requestId);
    if (meta) {
      prefetchRoomResponseBody(requestId, meta);
    }
  };

  const handleNetworkEvent = (message = {}) => {
    handleResponseReceived(message);
    handleLoadingFinished(message);
  };

  const attach = () => {
    if (removeListener) {
      return removeListener;
    }
    if (!connection || typeof connection.addListener !== 'function') {
      removeListener = () => {};
      return removeListener;
    }
    removeListener = connection.addListener(handleNetworkEvent);
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
    handleLoadingFinished,
    handleNetworkEvent,
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
    },
    getPendingBodyReadPromises() {
      return [...requestMeta.values()]
        .map((meta) => meta && meta.bodyReadPromise)
        .filter(Boolean);
    },
    waitForPendingBodyReads() {
      return Promise.allSettled(this.getPendingBodyReadPromises());
    }
  };
}

module.exports = {
  createEdgeNetworkResponseTracker
};
