const { createCdpAbortError } = require('../cdp-utils');

const EDGE_CDP_COMMAND_TIMEOUT_MS = 8000;
const EDGE_CDP_SHORT_TIMEOUT_MS = 3000;
const EDGE_CDP_CLEANUP_TIMEOUT_MS = 1200;
const EDGE_CDP_CONNECTION_CLOSE_TIMEOUT_MS = 250;
const EDGE_SETTLE_EVALUATE_TIMEOUT_MS = 6000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildCdpSendOptions(signal, timeoutMs = EDGE_CDP_COMMAND_TIMEOUT_MS) {
  return {
    timeoutMs,
    signal: signal || null
  };
}

function createEdgeAbortError(method) {
  if (typeof createCdpAbortError === 'function') {
    return createCdpAbortError(method);
  }
  const error = new Error(`CDP ${method} aborted`);
  error.name = 'AbortError';
  error.code = 'CDP_ABORTED';
  return error;
}

function assertEdgeNotAborted(signal, method = 'edge_capture') {
  if (signal && signal.aborted) {
    throw createEdgeAbortError(method);
  }
}

function isAbortLikeError(error) {
  return Boolean(error && (error.name === 'AbortError' || error.code === 'CDP_ABORTED'));
}

function isTimeoutLikeError(error) {
  return Boolean(
    error &&
    (error.code === 'EDGE_RESPONSE_BODY_TIMEOUT' ||
      error.code === 'CDP_TIMEOUT' ||
      /timed out/i.test(error.message || ''))
  );
}

function createEdgeResponseBodyTimeoutError(timeoutMs) {
  const error = new Error(`Network.getResponseBody timed out after ${timeoutMs}ms`);
  error.code = 'EDGE_RESPONSE_BODY_TIMEOUT';
  return error;
}

function isTransientEdgeExecutionContextError(error) {
  const message = error && error.message ? error.message : String(error || '');
  return /Execution context was destroyed|Cannot find context with specified id|Cannot find context/i.test(
    message
  );
}

module.exports = {
  EDGE_CDP_COMMAND_TIMEOUT_MS,
  EDGE_CDP_SHORT_TIMEOUT_MS,
  EDGE_CDP_CLEANUP_TIMEOUT_MS,
  EDGE_CDP_CONNECTION_CLOSE_TIMEOUT_MS,
  EDGE_SETTLE_EVALUATE_TIMEOUT_MS,
  sleep,
  buildCdpSendOptions,
  createEdgeAbortError,
  assertEdgeNotAborted,
  isAbortLikeError,
  isTimeoutLikeError,
  createEdgeResponseBodyTimeoutError,
  isTransientEdgeExecutionContextError
};
