const {
  assertEdgeNotAborted,
  buildCdpSendOptions,
  createEdgeResponseBodyTimeoutError,
  isAbortLikeError,
  isTimeoutLikeError,
  sleep
} = require('./edge-retry-policy');

function decodeEdgeResponseBody(responseBody) {
  const rawBody = responseBody && responseBody.body ? responseBody.body : '';
  if (!rawBody) {
    return '';
  }
  return responseBody.base64Encoded ? Buffer.from(rawBody, 'base64').toString('utf8') : rawBody;
}

function withTimeout(promise, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(createEdgeResponseBodyTimeoutError(timeoutMs)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

async function readEdgeResponseBodyWithRetry({
  connection,
  sessionId,
  requestId,
  isRoomResponse,
  timeoutMs,
  maxAttempts,
  signal = null
}) {
  const startedAt = Date.now();
  const attemptLimit = Math.max(1, Number(maxAttempts) || (isRoomResponse ? 2 : 1));
  const attemptTimeoutMs =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : isRoomResponse ? 1200 : 700;
  let lastError = null;
  let timeoutCount = 0;
  let retryCount = 0;
  for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
    assertEdgeNotAborted(signal, 'Network.getResponseBody');
    try {
      const responseBody = await withTimeout(
        connection.send(
          'Network.getResponseBody',
          { requestId },
          sessionId,
          buildCdpSendOptions(signal, attemptTimeoutMs)
        ),
        attemptTimeoutMs
      );
      const body = decodeEdgeResponseBody(responseBody);
      if (body) {
        return {
          body,
          retryCount,
          timeoutCount,
          elapsedMs: Date.now() - startedAt,
          error: null
        };
      }
    } catch (error) {
      if (isAbortLikeError(error)) {
        throw error;
      }
      lastError = error;
      if (isTimeoutLikeError(error)) {
        timeoutCount += 1;
      }
    }

    if (attempt < attemptLimit) {
      retryCount += 1;
      assertEdgeNotAborted(signal, 'Network.getResponseBody');
      await sleep(attempt * 150);
    }
  }

  return {
    body: '',
    retryCount,
    timeoutCount,
    elapsedMs: Date.now() - startedAt,
    error: lastError
  };
}

module.exports = {
  decodeEdgeResponseBody,
  withTimeout,
  readEdgeResponseBodyWithRetry
};
