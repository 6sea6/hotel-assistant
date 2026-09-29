const { accessError } = require('../ctrip-access-controller');

const connections = new WeakMap();
function isCtripBusinessResponse(response = {}, type = '') {
  try {
    const url = new URL(response.url);
    return (
      /(^|\.)ctrip\.com$/i.test(url.hostname) &&
      (type === 'Document' || /\/restapi\/soa2\//i.test(url.pathname))
    );
  } catch (_error) {
    return false;
  }
}

function attachCtripCdpGuard(connection, sessionId, controller, signal) {
  if (!controller) return () => {};
  let state = connections.get(connection);
  if (!state) {
    const originalSend = connection.send.bind(connection);
    state = { sessions: new Map(), originalSend };
    connections.set(connection, state);
    connection.send = async (method, params = {}, targetSession = '', options = {}) => {
      const guard = state.sessions.get(targetSession);
      if (guard && /^(Page.navigate|Input\.|Runtime.evaluate)/.test(method)) {
        guard.controller.assertAllowed();
        if (guard.failure) throw guard.failure;
        if (guard.signal?.aborted)
          throw Object.assign(new Error('任务已取消'), { name: 'AbortError' });
      }
      const bodyKey = method === 'Network.getResponseBody' && guard ? params.requestId : null;
      let promise = bodyKey ? guard.bodies.get(bodyKey) : null;
      if (!promise) {
        promise = originalSend(method, params, targetSession, options);
        if (bodyKey) {
          guard.bodies.set(bodyKey, promise);
          promise.catch(() => guard.bodies.delete(bodyKey));
        }
      }
      const result = await promise;
      if (guard && method === 'Network.getResponseBody' && guard.requests.has(params.requestId)) {
        const body = result.base64Encoded
          ? Buffer.from(result.body || '', 'base64').toString('utf8')
          : result.body;
        let data = result.parsedPayload;
        try {
          if (!data) {
            data = JSON.parse(body);
            result.parsedPayload = data;
          }
        } catch (_error) {
          /* Main document need not be JSON. */
        }
        const code = data?.data?.htlSpiderActionErrorCode;
        if (Number(code) === 203) {
          guard.controller.report({ businessCode: 203, source: 'browser_response' });
          throw accessError(guard.controller.issue);
        }
      }
      return result;
    };
  }
  const guard = {
    controller,
    signal,
    signatures: new Set(),
    pending: new Set(),
    documents: new Set(),
    requests: new Set(),
    bodies: new Map(),
    roomRequests: new Set()
  };
  state.sessions.set(sessionId, guard);
  const unsubscribe = controller.subscribe(() => {
    controller.metrics.inFlightAtPause += guard.pending.size;
    state
      .originalSend('Runtime.terminateExecution', {}, sessionId, { timeoutMs: 1000 })
      .catch(() => {});
    state.originalSend('Page.stopLoading', {}, sessionId, { timeoutMs: 1000 }).catch(() => {});
  });
  const detach = connection.addListener((message) => {
    if (message.sessionId !== sessionId) return;
    if (
      message.method === 'Network.requestWillBeSent' &&
      isCtripBusinessResponse(message.params?.request, message.params?.type)
    ) {
      const request = message.params.request;
      const signature = JSON.stringify([request.url, request.method, request.postData]);
      if (guard.signatures.has(signature)) controller.metrics.duplicateRequests += 1;
      guard.signatures.add(signature);
      guard.pending.add(message.params.requestId);
    }
    if (/^Network.loading(Finished|Failed)$/.test(message.method))
      guard.pending.delete(message.params?.requestId);
    if (
      message.method === 'Network.loadingFinished' &&
      guard.roomRequests.has(message.params?.requestId)
    ) {
      connection
        .send('Network.getResponseBody', { requestId: message.params.requestId }, sessionId, {
          signal,
          timeoutMs: 2500
        })
        .catch(() => {});
    }
    if (message.method !== 'Network.responseReceived') return;
    const { response = {}, requestId, type } = message.params || {};
    if (!isCtripBusinessResponse(response, type)) return;
    guard.requests.add(requestId);
    if (type === 'Document') {
      guard.documents.add(requestId);
      guard.roomRequests.add(requestId);
    }
    if ([502, 503, 504].includes(Number(response.status)))
      guard.failure = Object.assign(new Error('携程服务暂时不可用'), {
        status: Number(response.status)
      });
    if (/getHotelRoomList|fetchHotelList|getHotelList/i.test(response.url))
      guard.roomRequests.add(requestId);
    controller.metrics.businessRequests += 1;
    controller.report({
      httpStatus: response.status,
      headers: response.headers,
      source: 'browser_response'
    });
  });
  const cancel = () => {
    state
      .originalSend('Runtime.terminateExecution', {}, sessionId, { timeoutMs: 1000 })
      .catch(() => {});
    state.originalSend('Page.stopLoading', {}, sessionId, { timeoutMs: 1000 }).catch(() => {});
  };
  signal?.addEventListener('abort', cancel, { once: true });
  return () => {
    signal?.removeEventListener('abort', cancel);
    detach();
    unsubscribe();
    state.sessions.delete(sessionId);
    if (state.sessions.size === 0) {
      connection.send = state.originalSend;
      connections.delete(connection);
    }
  };
}

module.exports = { attachCtripCdpGuard, isCtripBusinessResponse };
