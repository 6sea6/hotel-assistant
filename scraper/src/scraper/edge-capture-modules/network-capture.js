const fs = require('fs');
const { parseHotelIdFromUrl } = require('../../ctrip-url');
const { mergeRoomCandidates, selectBestRoom, selectMatchingRooms } = require('../room-logic');
const {
  findRoomBlocksFromStructuredText,
  findRoomBlocksFromHtml,
  safeJsonParse
} = require('../html-parser');
const { shouldInspectNetworkResponse } = require('../api-replay');
const { killProcessTree, findEdgeExecutable } = require('../process-utils');
const {
  normalizeEdgeSessionOptions,
  launchManagedEdgeSession,
  connectToDebugger,
  waitForDebuggerEndpoint,
  evaluateInSession,
  waitForSessionCondition,
  waitForStableCount
} = require('../cdp-utils');
const { writeEdgeDebugArtifact } = require('./debug');
const { isReusableEdgeHotelTarget } = require('./target-reuse');
const { settleRoomListInEdgeSession } = require('./session-settle');
const {
  buildEdgeResponseReadPlan,
  getEdgeNetworkWaitCount,
  getEdgeNetworkWaitOptions,
  getPrioritizedEdgeResponseEntries,
  isRoomListNetworkResponse,
  shouldSkipEdgeResponseAfterRoomSuccess
} = require('./network-response-classifier');
const {
  EDGE_CDP_COMMAND_TIMEOUT_MS,
  EDGE_CDP_SHORT_TIMEOUT_MS,
  EDGE_CDP_CLEANUP_TIMEOUT_MS,
  EDGE_CDP_CONNECTION_CLOSE_TIMEOUT_MS,
  EDGE_SETTLE_EVALUATE_TIMEOUT_MS,
  assertEdgeNotAborted,
  buildCdpSendOptions,
  isAbortLikeError,
  isTransientEdgeExecutionContextError,
  sleep
} = require('./edge-retry-policy');
const {
  buildEdgeDomExtractExpression,
  buildLightweightEdgeDomExtractExpression
} = require('./dom-extract-script');
const {
  detectCtripLoginPromptFromText,
  detectCtripLoginPromptInSession
} = require('./login-detection');
const { isEdgeRoomFastPathComplete, parseEdgeNetworkResponses } = require('./response-parser');

function shouldAttemptSupplementalCapture(roomBlocks, selectedRoom, template, options = {}) {
  if (options.htmlPath) {
    return false;
  }

  const eligibleRooms = selectMatchingRooms(roomBlocks, template);
  if (!selectedRoom || selectedRoom.price === null) {
    return true;
  }

  if (eligibleRooms.length === 0) {
    return true;
  }

  const hiddenOrLockedCount = roomBlocks.filter(
    (room) => room.price === null || room.price_locked
  ).length;
  return Boolean(options.autoEdge) && hiddenOrLockedCount > 0 && eligibleRooms.length < 3;
}

function shouldPreferEdgeCapture(options = {}) {
  if (process.platform !== 'win32' || options.htmlPath) {
    return false;
  }

  const edgeSession =
    options.edgeSession && typeof options.edgeSession === 'object' ? options.edgeSession : {};

  return Boolean(
    options.autoEdge ||
    edgeSession.debuggerUrl ||
    edgeSession.debuggingPort ||
    edgeSession.userDataDir
  );
}

function collectRoomCandidatesFromDomPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const candidates = [];
  const snippets = Array.isArray(payload.snippets) ? payload.snippets : [];
  for (const snippet of snippets) {
    if (!snippet || typeof snippet !== 'string') {
      continue;
    }
    candidates.push(...findRoomBlocksFromStructuredText(snippet));
  }

  const snapshots = Array.isArray(payload.snapshots) ? payload.snapshots : [];
  for (const snapshot of snapshots) {
    if (!snapshot || typeof snapshot !== 'string') {
      continue;
    }
    candidates.push(...findRoomBlocksFromStructuredText(snapshot));
  }

  if (payload.bodyText && typeof payload.bodyText === 'string') {
    candidates.push(...findRoomBlocksFromStructuredText(payload.bodyText));
  }

  if (payload.bodyHtml && typeof payload.bodyHtml === 'string') {
    candidates.push(...findRoomBlocksFromHtml(payload.bodyHtml));
  }

  return mergeRoomCandidates(
    candidates.map((candidate) => ({
      ...candidate,
      source: candidate.source || 'edge-dom'
    }))
  );
}

function createNoopPerf() {
  const noopPhase = {
    end() {},
    error() {},
    async run(callback) {
      return callback();
    }
  };
  return {
    phase() {
      return { ...noopPhase };
    },
    async runPhase(_phase, fields, callback) {
      if (typeof fields === 'function') {
        return fields();
      }
      return callback();
    },
    event() {}
  };
}

const EDGE_BLOCKED_RESOURCE_PATTERNS = [
  '*://*/*.png*',
  '*://*/*.jpg*',
  '*://*/*.jpeg*',
  '*://*/*.gif*',
  '*://*/*.webp*',
  '*://*/*.avif*',
  '*://*/*.ico*',
  '*://*/*.woff*',
  '*://*/*.woff2*',
  '*://*/*.ttf*',
  '*://*/*.otf*',
  '*://*/*.eot*',
  '*://*/*.mp4*',
  '*://*/*.webm*',
  '*://*/*.mov*',
  '*://*/*.m3u8*'
];

function getEdgeBlockedResourcePatterns() {
  return [...EDGE_BLOCKED_RESOURCE_PATTERNS];
}

const EDGE_DOM_EXTRACT_TIMEOUT_MS = 6000;
const EDGE_DOM_EXTRACT_FAST_TIMEOUT_MS = 1800;
const EDGE_DOM_EXTRACT_API_COMPLETE_TIMEOUT_MS = 900;

async function configureEdgeStaticResourceBlocking(connection, sessionId, options = {}) {
  if (!connection || typeof connection.send !== 'function' || !sessionId) {
    return { enabled: false, blockedPatternCount: 0, reason: 'missing_cdp_session' };
  }
  if (options.blockStaticResources === false || options.disableStaticResourceBlocking === true) {
    return { enabled: false, blockedPatternCount: 0, reason: 'disabled_by_option' };
  }

  const urls = getEdgeBlockedResourcePatterns();
  try {
    await connection.send(
      'Network.setBlockedURLs',
      { urls },
      sessionId,
      buildCdpSendOptions(options.signal || null, EDGE_CDP_SHORT_TIMEOUT_MS)
    );
    return { enabled: true, blockedPatternCount: urls.length, reason: '' };
  } catch (error) {
    return {
      enabled: false,
      blockedPatternCount: urls.length,
      reason: 'cdp_set_blocked_urls_failed',
      errorMessage: error && error.message ? error.message : String(error)
    };
  }
}

function buildEdgeNavigateSignalResult(reason, startedAt, roomRequestMeta, trackedUrls) {
  return {
    reason,
    elapsedMs: Date.now() - startedAt,
    roomResponseSeen: Boolean(roomRequestMeta && roomRequestMeta.size > 0),
    roomTrackedUrlCount: roomRequestMeta && roomRequestMeta.size ? roomRequestMeta.size : 0,
    trackedUrlCount: trackedUrls && trackedUrls.size ? trackedUrls.size : 0
  };
}

async function waitForEdgeNavigateSignal({
  connection,
  sessionId,
  roomRequestMeta,
  trackedUrls,
  timeoutMs = 12000,
  pollMs = 100,
  pageCheckIntervalMs = 250,
  signal = null
}) {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let loadEventFired = false;
  let removeLoadListener = null;
  if (connection && typeof connection.addListener === 'function') {
    removeLoadListener = connection.addListener((message) => {
      if (message.sessionId === sessionId && message.method === 'Page.loadEventFired') {
        loadEventFired = true;
      }
    });
  }

  let lastPageCheckAt = 0;
  try {
    while (Date.now() < deadline) {
      assertEdgeNotAborted(signal, 'edge_navigate');
      if (loadEventFired) {
        return buildEdgeNavigateSignalResult('load_event', startedAt, roomRequestMeta, trackedUrls);
      }
      if (roomRequestMeta && roomRequestMeta.size > 0) {
        return buildEdgeNavigateSignalResult(
          'room_response',
          startedAt,
          roomRequestMeta,
          trackedUrls
        );
      }

      const now = Date.now();
      if (connection && sessionId && now - lastPageCheckAt >= pageCheckIntervalMs) {
        lastPageCheckAt = now;
        try {
          const ready = await evaluateInSession(
            connection,
            sessionId,
            `(() => {
              const bodyText = document.body && document.body.innerText ? document.body.innerText : '';
              return /^(interactive|complete)$/.test(document.readyState) && /(房型|展示额外|更多房型|登录看低价|¥|每晚)/.test(bodyText);
            })()`,
            {
              timeoutMs: 1000,
              signal
            }
          );
          if (ready === true || ready === 'true') {
            return buildEdgeNavigateSignalResult(
              'page_ready_signal',
              startedAt,
              roomRequestMeta,
              trackedUrls
            );
          }
        } catch (_error) {
          // The page may still be navigating; keep waiting for the next signal.
        }
      }

      await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
    }

    return buildEdgeNavigateSignalResult('timeout', startedAt, roomRequestMeta, trackedUrls);
  } finally {
    if (typeof removeLoadListener === 'function') {
      removeLoadListener();
    }
  }
}

const EDGE_PAGE_READY_EXPRESSION = `(() => {
  const bodyText = document.body && document.body.innerText ? document.body.innerText : '';
  return document.readyState === 'complete' && /(房型|展示额外|更多房型|登录看低价|¥|每晚)/.test(bodyText);
})()`;

const EDGE_PAGE_READY_SHORT_CONFIRM_EXPRESSION = `(() => {
  const bodyText = document.body && document.body.innerText ? document.body.innerText : '';
  return /^(interactive|complete)$/.test(document.readyState) && /(房型|展示额外|更多房型|登录看低价|¥|每晚)/.test(bodyText);
})()`;

function getNavigateSignalPerfFields(navigateSignal = {}) {
  return {
    navigate_wait_reason: navigateSignal.reason || '',
    navigate_wait_elapsed_ms:
      typeof navigateSignal.elapsedMs === 'number' ? navigateSignal.elapsedMs : null,
    room_response_seen: Boolean(navigateSignal.roomResponseSeen),
    room_tracked_url_count_after:
      typeof navigateSignal.roomTrackedUrlCount === 'number'
        ? navigateSignal.roomTrackedUrlCount
        : null,
    tracked_url_count_after:
      typeof navigateSignal.trackedUrlCount === 'number' ? navigateSignal.trackedUrlCount : null
  };
}

async function waitForEdgePageReadyAfterNavigate({
  perf,
  connection,
  sessionId,
  url,
  captureMethod,
  targetMode,
  navigateSignal,
  signal = null
}) {
  const phase = perf.phase('edge_page_ready', {
    url,
    captureMethod,
    targetMode,
    navigateWaitReason: navigateSignal && navigateSignal.reason ? navigateSignal.reason : ''
  });
  const signalFields = getNavigateSignalPerfFields(navigateSignal);
  try {
    const useShortConfirmation = navigateSignal && navigateSignal.reason === 'page_ready_signal';
    const ready = await waitForSessionCondition(
      connection,
      sessionId,
      useShortConfirmation ? EDGE_PAGE_READY_SHORT_CONFIRM_EXPRESSION : EDGE_PAGE_READY_EXPRESSION,
      useShortConfirmation ? 1500 : 4500,
      useShortConfirmation ? 150 : 250,
      {
        signal,
        evaluateTimeoutMs: useShortConfirmation ? 750 : 1000
      }
    );
    phase.end(ready ? 'success' : 'timeout', {
      ...signalFields,
      confirmation_mode: useShortConfirmation
        ? 'short_context_stability_check'
        : 'full_page_ready_check',
      page_ready_confirmed: Boolean(ready)
    });
    return {
      skipped: false,
      skipReason: '',
      confirmed: Boolean(ready),
      confirmationMode: useShortConfirmation
        ? 'short_context_stability_check'
        : 'full_page_ready_check'
    };
  } catch (error) {
    phase.error(error, signalFields);
    throw error;
  }
}

async function waitForEdgeExecutionContextStable({
  perf,
  connection,
  sessionId,
  url,
  captureMethod,
  targetMode,
  signal = null,
  requiredSuccessCount = 2,
  timeoutMs = 1200,
  intervalMs = 80
}) {
  const phase = perf.phase('edge_context_stable', {
    url,
    captureMethod,
    targetMode
  });
  const deadline = Date.now() + timeoutMs;
  let attemptCount = 0;
  let successCount = 0;
  try {
    while (Date.now() < deadline) {
      assertEdgeNotAborted(signal, 'edge_context_stable');
      attemptCount += 1;
      try {
        await evaluateInSession(connection, sessionId, '(() => true)()', {
          timeoutMs: 500,
          signal
        });
        successCount += 1;
        if (successCount >= requiredSuccessCount) {
          phase.end('success', {
            attempt_count: attemptCount,
            stable_check_success_count: successCount
          });
          return {
            confirmed: true,
            attemptCount,
            successCount
          };
        }
      } catch (error) {
        if (isAbortLikeError(error)) {
          throw error;
        }
        successCount = 0;
      }
      await sleep(successCount > 0 ? Math.min(30, intervalMs) : intervalMs);
    }
    phase.end('timeout', {
      attempt_count: attemptCount,
      stable_check_success_count: successCount
    });
    return {
      confirmed: false,
      attemptCount,
      successCount
    };
  } catch (error) {
    phase.error(error, {
      attempt_count: attemptCount,
      stable_check_success_count: successCount
    });
    throw error;
  }
}

async function settleRoomListWithEdgeRetry({
  perf,
  connection,
  sessionId,
  url,
  captureMethod,
  targetMode,
  navigateSignal,
  trackedUrls,
  getTrackedUrlCount,
  settleRoomList = settleRoomListInEdgeSession,
  waitForPageReady = waitForEdgePageReadyAfterNavigate,
  waitForContextStable = waitForEdgeExecutionContextStable,
  signal = null
}) {
  const fields = { url, captureMethod, targetMode };
  const runSettle = async () => {
    await waitForContextStable({
      perf,
      connection,
      sessionId,
      url,
      captureMethod,
      targetMode,
      signal
    });
    return settleRoomList(connection, sessionId, {
      perf,
      fields,
      getTrackedUrlCount,
      signal,
      evaluateTimeoutMs: EDGE_SETTLE_EVALUATE_TIMEOUT_MS
    });
  };

  try {
    return {
      stats: await runSettle(),
      retryCount: 0,
      retryReason: ''
    };
  } catch (error) {
    if (isAbortLikeError(error) || !isTransientEdgeExecutionContextError(error)) {
      throw error;
    }

    const retryReason = 'execution_context_destroyed';
    perf.event('edge_settle_retry', {
      phase: 'edge_settle_room_list',
      status: 'retry',
      url,
      captureMethod,
      targetMode,
      retry_count: 1,
      retry_reason: retryReason,
      tracked_url_count:
        trackedUrls && typeof trackedUrls.size === 'number' ? trackedUrls.size : null,
      error_type: error && error.name ? error.name : 'Error',
      error_message: error && error.message ? error.message : String(error)
    });

    await waitForPageReady({
      perf,
      connection,
      sessionId,
      url,
      captureMethod,
      targetMode,
      navigateSignal: {
        ...(navigateSignal && typeof navigateSignal === 'object' ? navigateSignal : {}),
        reason: 'retry_after_settle_context_destroyed'
      },
      signal
    });

    return {
      stats: await runSettle(),
      retryCount: 1,
      retryReason
    };
  }
}

function buildSettlePhaseFields(settleStats, settleResult = {}) {
  return {
    settle_total_ms: settleStats.totalMs,
    settle_clicked_count: settleStats.clickedCount,
    settle_skipped_duplicate_click_count: settleStats.skippedDuplicateClickCount || 0,
    settle_generic_click_count: settleStats.genericClickCount || 0,
    settle_scroll_count: settleStats.scrollCount,
    settle_container_count: settleStats.containerCount,
    settle_likely_container_count: settleStats.likelyContainerCount || 0,
    settle_fallback_container_count: settleStats.fallbackContainerCount || 0,
    settle_skipped_bottom_expand_count: settleStats.skippedBottomExpandCount || 0,
    settle_retry_count: settleResult.retryCount || 0,
    settle_retry_reason: settleResult.retryReason || ''
  };
}

function emitEdgeEvent(options = {}, type, message, details = {}) {
  if (typeof options.onEvent !== 'function') {
    return;
  }

  options.onEvent(type, message, details);
}

async function waitForEdgeNetworkStability({
  perf,
  url,
  captureMethod,
  targetMode,
  trackedUrls,
  requestMeta,
  roomRequestMeta,
  signal = null
}) {
  const phase = perf.phase('edge_network_wait', {
    url,
    captureMethod,
    targetMode,
    trackedUrlCount: trackedUrls.size,
    roomTrackedUrlCount: roomRequestMeta.size
  });
  try {
    const waitOptions = getEdgeNetworkWaitOptions(roomRequestMeta, requestMeta);
    await waitForStableCount(() => getEdgeNetworkWaitCount(roomRequestMeta, requestMeta), {
      stableMs: waitOptions.stableMs,
      maxWaitMs: waitOptions.maxWaitMs,
      intervalMs: waitOptions.intervalMs,
      signal
    });
    phase.end('success', {
      tracked_url_count_after: trackedUrls.size,
      room_tracked_url_count_after: roomRequestMeta.size,
      network_wait_count: getEdgeNetworkWaitCount(roomRequestMeta, requestMeta),
      network_wait_stable_ms: waitOptions.stableMs,
      network_wait_max_ms: waitOptions.maxWaitMs,
      network_wait_interval_ms: waitOptions.intervalMs,
      room_response_seen: waitOptions.roomResponseSeen,
      room_response_count: waitOptions.roomResponseCount,
      network_wait_mode: waitOptions.waitMode
    });
  } catch (error) {
    const waitOptions = getEdgeNetworkWaitOptions(roomRequestMeta, requestMeta);
    phase.error(error, {
      tracked_url_count_after: trackedUrls.size,
      room_tracked_url_count_after: roomRequestMeta.size,
      network_wait_count: getEdgeNetworkWaitCount(roomRequestMeta, requestMeta),
      network_wait_stable_ms: waitOptions.stableMs,
      network_wait_max_ms: waitOptions.maxWaitMs,
      network_wait_interval_ms: waitOptions.intervalMs,
      room_response_seen: waitOptions.roomResponseSeen,
      room_response_count: waitOptions.roomResponseCount,
      network_wait_mode: waitOptions.waitMode
    });
    throw error;
  }
}

function getEdgeDomExtractTimeoutMs(roomBlocks, options = {}) {
  if (options && options.apiCaptureComplete) {
    return EDGE_DOM_EXTRACT_API_COMPLETE_TIMEOUT_MS;
  }
  return Array.isArray(roomBlocks) && roomBlocks.length > 0
    ? EDGE_DOM_EXTRACT_FAST_TIMEOUT_MS
    : EDGE_DOM_EXTRACT_TIMEOUT_MS;
}

function isEdgeDomExtractTimeoutError(error) {
  const message = error && error.message ? String(error.message) : String(error || '');
  return /Runtime\.evaluate timed out|timed out after \d+ms/i.test(message);
}

async function extractEdgeDomRoomCandidates({
  connection,
  sessionId,
  url,
  captureMethod,
  targetMode,
  trackedUrls,
  debugHotelId,
  roomBlocks,
  perf,
  signal,
  apiCaptureComplete = false
}) {
  const safePerf = perf || createNoopPerf();
  const candidateList = Array.isArray(roomBlocks) ? roomBlocks : [];
  const timeoutMs = getEdgeDomExtractTimeoutMs(candidateList, { apiCaptureComplete });
  const beforeDomCount = candidateList.length;
  const trackedUrlCount = trackedUrls && trackedUrls.size ? trackedUrls.size : 0;
  const domExtractMode = apiCaptureComplete
    ? 'api_complete_lightweight'
    : beforeDomCount > 0
      ? 'api_partial_full'
      : 'dom_full';
  const domPhase = safePerf.phase('edge_dom_extract', {
    url,
    captureMethod,
    targetMode,
    trackedUrlCount,
    dom_extract_mode: domExtractMode,
    dom_extract_api_complete: Boolean(apiCaptureComplete),
    dom_extract_timeout_ms: timeoutMs,
    room_candidates_before: beforeDomCount
  });

  try {
    const domPayloadResult = await evaluateInSession(
      connection,
      sessionId,
      apiCaptureComplete
        ? buildLightweightEdgeDomExtractExpression()
        : buildEdgeDomExtractExpression(),
      {
        timeoutMs,
        signal
      }
    );
    const domPayload =
      typeof domPayloadResult === 'string' ? safeJsonParse(domPayloadResult) : domPayloadResult;
    writeEdgeDebugArtifact(`${debugHotelId}-dom-payload.json`, domPayload);
    const candidates = collectRoomCandidatesFromDomPayload(domPayload);
    candidateList.push(...candidates);
    domPhase.end('success', {
      roomCandidatesCount: candidateList.length - beforeDomCount,
      dom_extract_mode: domExtractMode,
      dom_extract_api_complete: Boolean(apiCaptureComplete),
      dom_extract_timeout_ms: timeoutMs,
      room_candidates_before: beforeDomCount,
      room_candidates_after: candidateList.length,
      dom_extract_timed_out: false
    });
    return {
      roomCandidatesCount: candidateList.length - beforeDomCount,
      roomCandidatesBefore: beforeDomCount,
      roomCandidatesAfter: candidateList.length,
      timeoutMs,
      timedOut: false
    };
  } catch (error) {
    const timedOut = isEdgeDomExtractTimeoutError(error);
    domPhase.error(error, {
      dom_extract_mode: domExtractMode,
      dom_extract_api_complete: Boolean(apiCaptureComplete),
      dom_extract_timeout_ms: timeoutMs,
      room_candidates_before: beforeDomCount,
      room_candidates_after: candidateList.length,
      dom_extract_timed_out: timedOut
    });
    if (isAbortLikeError(error)) {
      throw error;
    }
    writeEdgeDebugArtifact(`${debugHotelId}-dom-error.json`, {
      message: error && error.message ? error.message : String(error || ''),
      stack: error && error.stack ? error.stack : '',
      timeoutMs,
      timedOut
    });
    return {
      roomCandidatesCount: 0,
      roomCandidatesBefore: beforeDomCount,
      roomCandidatesAfter: candidateList.length,
      timeoutMs,
      timedOut,
      error: error && error.message ? error.message : String(error || '')
    };
  }
}

async function captureRoomCandidatesWithEdge(url, template, edgeSessionOptions = {}, options = {}) {
  const perf = options.perf || createNoopPerf();
  const captureMethod = options.captureMethod || 'html_then_edge_cdp';
  if (process.platform !== 'win32' || typeof fetch !== 'function') {
    return {
      roomBlocks: [],
      selectedRoom: null,
      trackedUrls: [],
      error: 'edge-cdp fallback unavailable: requires Windows and global fetch'
    };
  }

  let EdgeWebSocket = globalThis.WebSocket;
  if (typeof EdgeWebSocket !== 'function') {
    try {
      EdgeWebSocket = require('ws');
    } catch (_e) {
      return {
        roomBlocks: [],
        selectedRoom: null,
        trackedUrls: [],
        error:
          'edge-cdp fallback unavailable: global WebSocket is not present and ws package not installed'
      };
    }
  }

  const sessionOptions = normalizeEdgeSessionOptions(edgeSessionOptions);
  const edgeExecutable = findEdgeExecutable();
  if (!sessionOptions.debuggerUrl && !edgeExecutable) {
    return {
      roomBlocks: [],
      selectedRoom: null,
      trackedUrls: [],
      error: 'edge-cdp fallback unavailable: msedge.exe not found'
    };
  }

  let browser = null;
  let connection = null;
  let userDataDir = '';
  let shouldCleanupUserDataDir = false;
  let targetId = '';
  let sessionId = '';
  let targetMode = 'create';
  let targetInitialUrl = '';
  let shouldCloseTarget = false;
  let settleStats = null;
  let edgeParseStats = null;
  let loginPromptNotified = false;
  const signal = options.signal || null;
  const notifyLoginPromptIfDetected = async (stage) => {
    if (loginPromptNotified || !connection || !sessionId) {
      return;
    }
    try {
      const detection = await detectCtripLoginPromptInSession(connection, sessionId, { signal });
      if (!detection.detected) {
        return;
      }
      loginPromptNotified = true;
      emitEdgeEvent(options, 'edge:login-required', '检测到携程登录提示，采集仍会继续尝试', {
        reason: detection.reason,
        stage,
        url,
        instruction:
          '请在已打开的 Edge 携程页面完成登录；本次采集会继续，若仍缺价格可登录后重新采集。'
      });
      perf.event('edge_login_prompt_detected', {
        phase: stage,
        status: 'warning',
        url,
        captureMethod,
        targetMode,
        waitReason: 'login_prompt_detected'
      });
    } catch (_error) {
      // Login prompt detection is best-effort and must not affect collection.
    }
  };
  try {
    assertEdgeNotAborted(signal, 'edge_connect');
    await perf.runPhase(
      'edge_connect',
      {
        url,
        captureMethod,
        hasDebuggerUrl: Boolean(sessionOptions.debuggerUrl),
        hasDebuggingPort: Boolean(sessionOptions.debuggingPort)
      },
      async () => {
        assertEdgeNotAborted(signal, 'edge_connect');
        if (sessionOptions.debuggerUrl) {
          connection = await connectToDebugger(sessionOptions.debuggerUrl, EdgeWebSocket);
        } else if (sessionOptions.debuggingPort) {
          try {
            const debuggerUrl = await waitForDebuggerEndpoint(sessionOptions.debuggingPort, 3000);
            connection = await connectToDebugger(debuggerUrl, EdgeWebSocket);
          } catch (_error) {
            if (!edgeExecutable) {
              throw _error;
            }
            const launched = await launchManagedEdgeSession(
              edgeExecutable,
              sessionOptions,
              sessionOptions.debuggingPort
            );
            browser = launched.browser;
            userDataDir = launched.userDataDir;
            shouldCleanupUserDataDir = launched.shouldCleanupUserDataDir;
            connection = await connectToDebugger(launched.debuggerUrl, EdgeWebSocket);
          }
        } else {
          const launched = await launchManagedEdgeSession(edgeExecutable, sessionOptions);
          browser = launched.browser;
          userDataDir = launched.userDataDir;
          shouldCleanupUserDataDir = launched.shouldCleanupUserDataDir;
          connection = await connectToDebugger(launched.debuggerUrl, EdgeWebSocket);
        }
      }
    );

    const targetPhase = perf.phase('edge_target', { url, captureMethod });
    try {
      assertEdgeNotAborted(signal, 'edge_target');
      try {
        const targetsResponse = await connection.send(
          'Target.getTargets',
          {},
          '',
          buildCdpSendOptions(signal, EDGE_CDP_COMMAND_TIMEOUT_MS)
        );
        const targets = (targetsResponse && targetsResponse.targetInfos) || [];
        const matchingTarget = targets.find((t) => {
          if (t.type !== 'page') return false;
          if (!t.url) return false;
          return isReusableEdgeHotelTarget(t.url, url);
        });
        if (matchingTarget) {
          targetId = matchingTarget.targetId;
          targetInitialUrl = matchingTarget.url || '';
          targetMode = 'reused-match';
        } else {
          const blankTarget = targets.find(
            (t) => t.type === 'page' && (!t.url || t.url === 'about:blank')
          );
          if (blankTarget) {
            targetId = blankTarget.targetId;
            targetInitialUrl = blankTarget.url || '';
            targetMode = 'reused-blank';
          }
        }
      } catch (_e) {
        // ignore listing failure, fall through to createTarget
      }

      if (!targetId) {
        const createdTarget = await connection.send(
          'Target.createTarget',
          { url: 'about:blank' },
          '',
          buildCdpSendOptions(signal, EDGE_CDP_COMMAND_TIMEOUT_MS)
        );
        targetId = createdTarget && createdTarget.targetId;
        shouldCloseTarget = true;
      }

      if (!targetId) {
        targetPhase.end('failed', { targetMode, targetCreated: shouldCloseTarget });
        return {
          roomBlocks: [],
          selectedRoom: null,
          trackedUrls: [],
          error: 'edge-cdp fallback failed: could not find or create a target tab'
        };
      }

      const attachedTarget = await connection.send(
        'Target.attachToTarget',
        {
          targetId,
          flatten: true
        },
        '',
        buildCdpSendOptions(signal, EDGE_CDP_COMMAND_TIMEOUT_MS)
      );
      sessionId = attachedTarget && attachedTarget.sessionId;
      if (!sessionId) {
        targetPhase.end('failed', { targetMode, targetCreated: shouldCloseTarget });
        return {
          roomBlocks: [],
          selectedRoom: null,
          trackedUrls: [],
          error: 'edge-cdp fallback failed: attachToTarget returned no sessionId'
        };
      }
      targetPhase.end('success', { targetMode, targetCreated: shouldCloseTarget });
    } catch (error) {
      targetPhase.error(error, { targetMode, targetCreated: shouldCloseTarget });
      throw error;
    }

    const requestMeta = new Map();
    const roomRequestMeta = new Map();
    const trackedUrls = new Set();
    const roomBlocks = [];
    const spiderErrorCodes = new Set();
    const debugHotelId = parseHotelIdFromUrl(url) || 'hotel';
    let roomApiDebugIndex = 0;

    await connection.send('Page.enable', {}, sessionId, buildCdpSendOptions(signal));
    await connection.send('Network.enable', {}, sessionId, buildCdpSendOptions(signal));
    await connection.send('Runtime.enable', {}, sessionId, buildCdpSendOptions(signal));

    const staticResourceBlockPhase = perf.phase('edge_static_resource_block', {
      url,
      captureMethod,
      targetMode
    });
    const staticResourceBlockResult = await configureEdgeStaticResourceBlocking(
      connection,
      sessionId,
      {
        ...edgeSessionOptions,
        ...options,
        signal
      }
    );
    staticResourceBlockPhase.end(staticResourceBlockResult.enabled ? 'success' : 'skipped', {
      static_resource_block_enabled: staticResourceBlockResult.enabled,
      blocked_resource_pattern_count: staticResourceBlockResult.blockedPatternCount,
      skip_reason: staticResourceBlockResult.reason || '',
      error_message: staticResourceBlockResult.errorMessage || ''
    });

    if (targetMode === 'reused-match') {
      console.log(
        `[edge-cdp] reusing matched tab and navigating: ${targetInitialUrl || 'about:blank'} -> ${url}`
      );
      const removeListener = connection.addListener((message) => {
        if (message.sessionId !== sessionId || message.method !== 'Network.responseReceived') {
          return;
        }
        const params = message.params || {};
        const response = params.response || {};
        const requestId = params.requestId;
        const responseUrl = response.url;
        if (!requestId || !responseUrl) return;
        if (!shouldInspectNetworkResponse(responseUrl, response.mimeType)) return;
        const nextMeta = { url: responseUrl, mimeType: response.mimeType };
        trackedUrls.add(responseUrl);
        requestMeta.set(requestId, nextMeta);
        if (isRoomListNetworkResponse(responseUrl)) {
          roomRequestMeta.set(requestId, nextMeta);
        }
      });

      await connection.send(
        'Network.setCacheDisabled',
        { cacheDisabled: false },
        sessionId,
        buildCdpSendOptions(signal, EDGE_CDP_SHORT_TIMEOUT_MS)
      );

      const navigatePhase = perf.phase('edge_navigate', { url, captureMethod, targetMode });
      let navigateSignal = null;
      try {
        await connection.send(
          'Page.navigate',
          { url },
          sessionId,
          buildCdpSendOptions(signal, EDGE_CDP_COMMAND_TIMEOUT_MS)
        );
        navigateSignal = await waitForEdgeNavigateSignal({
          connection,
          sessionId,
          roomRequestMeta,
          trackedUrls,
          timeoutMs: 15000,
          signal
        });
        navigatePhase.end('success', {
          navigate_wait_reason: navigateSignal.reason,
          navigate_wait_elapsed_ms: navigateSignal.elapsedMs,
          room_response_seen: navigateSignal.roomResponseSeen,
          room_tracked_url_count_after: navigateSignal.roomTrackedUrlCount,
          tracked_url_count_after: navigateSignal.trackedUrlCount
        });
      } catch (error) {
        navigatePhase.error(error, {
          room_tracked_url_count_after: roomRequestMeta.size,
          tracked_url_count_after: trackedUrls.size
        });
        throw error;
      }
      await waitForEdgePageReadyAfterNavigate({
        perf,
        connection,
        sessionId,
        url,
        captureMethod,
        targetMode,
        navigateSignal,
        signal
      });
      await notifyLoginPromptIfDetected('edge_page_ready');
      const settlePhase = perf.phase('edge_settle_room_list', { url, captureMethod, targetMode });
      try {
        const settleResult = await settleRoomListWithEdgeRetry({
          perf,
          connection,
          sessionId,
          url,
          captureMethod,
          targetMode,
          navigateSignal,
          trackedUrls,
          getTrackedUrlCount: () => trackedUrls.size,
          signal
        });
        settleStats = settleResult.stats;
        settlePhase.end('success', buildSettlePhaseFields(settleStats, settleResult));
        await notifyLoginPromptIfDetected('edge_settle_room_list');
      } catch (error) {
        settlePhase.error(error);
        throw error;
      }

      const trackedBeforeExpand = trackedUrls.size;

      await waitForEdgeNetworkStability({
        perf,
        url,
        captureMethod,
        targetMode,
        trackedUrls,
        requestMeta,
        roomRequestMeta,
        signal
      });

      console.log(
        `[edge-cdp] tracked URLs before expand: ${trackedBeforeExpand}, after: ${trackedUrls.size}`
      );

      removeListener();

      const responseParsePhase = perf.phase('edge_response_parse', {
        url,
        captureMethod,
        targetMode,
        trackedUrlCount: trackedUrls.size
      });
      try {
        const parseStats = await parseEdgeNetworkResponses({
          connection,
          sessionId,
          requestMeta,
          template,
          roomBlocks,
          spiderErrorCodes,
          debugHotelId,
          roomApiDebugIndex,
          signal
        });
        edgeParseStats = parseStats;
        roomApiDebugIndex = parseStats.roomApiDebugIndex;
        responseParsePhase.end('success', {
          response_parse_entry_count: parseStats.responseParseEntryCount,
          room_response_entry_count: parseStats.roomResponseEntryCount,
          non_room_response_entry_count: parseStats.nonRoomResponseEntryCount,
          unique_response_url_count: parseStats.uniqueResponseUrlCount,
          duplicate_response_url_count: parseStats.duplicateResponseUrlCount,
          parsed_response_count: parseStats.parsedResponseCount,
          room_response_count: parseStats.roomResponseCount,
          skipped_response_count: parseStats.skippedResponseCount,
          duplicate_room_response_skipped_count: parseStats.duplicateRoomResponseSkippedCount,
          room_response_url_fallback_count: parseStats.roomResponseUrlFallbackCount,
          fallback_full_parse_used: parseStats.fallbackFullParseUsed,
          response_fast_path_complete: parseStats.fastPathComplete,
          response_parse_candidate_count: parseStats.responseParseCandidateCount,
          structured_candidate_count: parseStats.structuredCandidateCount,
          raw_fallback_used_count: parseStats.rawFallbackUsedCount,
          raw_fallback_skipped_count: parseStats.rawFallbackSkippedCount,
          raw_fallback_candidate_count: parseStats.rawFallbackCandidateCount,
          response_body_retry_count: parseStats.responseBodyRetryCount,
          response_body_timeout_count: parseStats.responseBodyTimeoutCount,
          response_body_read_count: parseStats.responseBodyReadCount,
          response_body_read_elapsed_ms: parseStats.responseBodyReadElapsedMs,
          response_body_read_max_ms: parseStats.responseBodyReadMaxMs,
          response_body_total_bytes: parseStats.responseBodyTotalBytes,
          response_body_max_bytes: parseStats.responseBodyMaxBytes,
          response_body_parse_elapsed_ms: parseStats.responseBodyParseElapsedMs,
          response_body_parse_max_ms: parseStats.responseBodyParseMaxMs,
          slowest_response_body_ms: parseStats.slowestResponseBodyMs,
          slowest_response_body_kind: parseStats.slowestResponseBodyKind,
          slowest_response_body_bytes: parseStats.slowestResponseBodyBytes,
          room_response_body_read_count: parseStats.roomResponseBodyReadCount,
          non_room_response_body_read_count: parseStats.nonRoomResponseBodyReadCount,
          room_response_body_error_count: parseStats.roomResponseBodyErrorCount,
          room_response_body_timeout_count: parseStats.roomResponseBodyTimeoutCount,
          room_response_body_empty_count: parseStats.roomResponseBodyEmptyCount,
          room_response_body_parse_error_count: parseStats.roomResponseBodyParseErrorCount,
          non_room_response_body_timeout_count: parseStats.nonRoomResponseBodyTimeoutCount,
          response_parse_elapsed_ms: parseStats.responseParseElapsedMs,
          response_parse_stopped_reason: parseStats.responseParseStoppedReason
        });
      } catch (error) {
        responseParsePhase.error(error);
        throw error;
      }
    } else {
      const removeListener = connection.addListener((message) => {
        if (message.sessionId !== sessionId || message.method !== 'Network.responseReceived') {
          return;
        }
        const params = message.params || {};
        const response = params.response || {};
        const requestId = params.requestId;
        const responseUrl = response.url;
        if (!requestId || !responseUrl) return;
        if (!shouldInspectNetworkResponse(responseUrl, response.mimeType)) return;
        const nextMeta = { url: responseUrl, mimeType: response.mimeType };
        trackedUrls.add(responseUrl);
        requestMeta.set(requestId, nextMeta);
        if (isRoomListNetworkResponse(responseUrl)) {
          roomRequestMeta.set(requestId, nextMeta);
        }
      });

      await connection.send(
        'Network.setCacheDisabled',
        { cacheDisabled: true },
        sessionId,
        buildCdpSendOptions(signal, EDGE_CDP_SHORT_TIMEOUT_MS)
      );

      const navigatePhase = perf.phase('edge_navigate', { url, captureMethod, targetMode });
      let navigateSignal = null;
      try {
        await connection.send(
          'Page.navigate',
          { url },
          sessionId,
          buildCdpSendOptions(signal, EDGE_CDP_COMMAND_TIMEOUT_MS)
        );
        navigateSignal = await waitForEdgeNavigateSignal({
          connection,
          sessionId,
          roomRequestMeta,
          trackedUrls,
          timeoutMs: 12000,
          signal
        });
        navigatePhase.end('success', {
          navigate_wait_reason: navigateSignal.reason,
          navigate_wait_elapsed_ms: navigateSignal.elapsedMs,
          room_response_seen: navigateSignal.roomResponseSeen,
          room_tracked_url_count_after: navigateSignal.roomTrackedUrlCount,
          tracked_url_count_after: navigateSignal.trackedUrlCount
        });
      } catch (error) {
        navigatePhase.error(error, {
          room_tracked_url_count_after: roomRequestMeta.size,
          tracked_url_count_after: trackedUrls.size
        });
        throw error;
      }
      await waitForEdgePageReadyAfterNavigate({
        perf,
        connection,
        sessionId,
        url,
        captureMethod,
        targetMode,
        navigateSignal,
        signal
      });
      await notifyLoginPromptIfDetected('edge_page_ready');
      const settlePhase = perf.phase('edge_settle_room_list', { url, captureMethod, targetMode });
      try {
        const settleResult = await settleRoomListWithEdgeRetry({
          perf,
          connection,
          sessionId,
          url,
          captureMethod,
          targetMode,
          navigateSignal,
          trackedUrls,
          getTrackedUrlCount: () => trackedUrls.size,
          signal
        });
        settleStats = settleResult.stats;
        settlePhase.end('success', buildSettlePhaseFields(settleStats, settleResult));
        await notifyLoginPromptIfDetected('edge_settle_room_list');
      } catch (error) {
        settlePhase.error(error);
        throw error;
      }

      const trackedBeforeExpand = trackedUrls.size;

      await waitForEdgeNetworkStability({
        perf,
        url,
        captureMethod,
        targetMode,
        trackedUrls,
        requestMeta,
        roomRequestMeta,
        signal
      });

      console.log(
        `[edge-cdp] new-tab tracked URLs before expand: ${trackedBeforeExpand}, after: ${trackedUrls.size}`
      );
      removeListener();

      const responseParsePhase = perf.phase('edge_response_parse', {
        url,
        captureMethod,
        targetMode,
        trackedUrlCount: trackedUrls.size
      });
      try {
        const parseStats = await parseEdgeNetworkResponses({
          connection,
          sessionId,
          requestMeta,
          template,
          roomBlocks,
          spiderErrorCodes,
          debugHotelId,
          roomApiDebugIndex,
          signal
        });
        edgeParseStats = parseStats;
        roomApiDebugIndex = parseStats.roomApiDebugIndex;
        responseParsePhase.end('success', {
          response_parse_entry_count: parseStats.responseParseEntryCount,
          room_response_entry_count: parseStats.roomResponseEntryCount,
          non_room_response_entry_count: parseStats.nonRoomResponseEntryCount,
          unique_response_url_count: parseStats.uniqueResponseUrlCount,
          duplicate_response_url_count: parseStats.duplicateResponseUrlCount,
          parsed_response_count: parseStats.parsedResponseCount,
          room_response_count: parseStats.roomResponseCount,
          skipped_response_count: parseStats.skippedResponseCount,
          duplicate_room_response_skipped_count: parseStats.duplicateRoomResponseSkippedCount,
          room_response_url_fallback_count: parseStats.roomResponseUrlFallbackCount,
          fallback_full_parse_used: parseStats.fallbackFullParseUsed,
          response_fast_path_complete: parseStats.fastPathComplete,
          response_parse_candidate_count: parseStats.responseParseCandidateCount,
          structured_candidate_count: parseStats.structuredCandidateCount,
          raw_fallback_used_count: parseStats.rawFallbackUsedCount,
          raw_fallback_skipped_count: parseStats.rawFallbackSkippedCount,
          raw_fallback_candidate_count: parseStats.rawFallbackCandidateCount,
          response_body_retry_count: parseStats.responseBodyRetryCount,
          response_body_timeout_count: parseStats.responseBodyTimeoutCount,
          response_body_read_count: parseStats.responseBodyReadCount,
          response_body_read_elapsed_ms: parseStats.responseBodyReadElapsedMs,
          response_body_read_max_ms: parseStats.responseBodyReadMaxMs,
          response_body_total_bytes: parseStats.responseBodyTotalBytes,
          response_body_max_bytes: parseStats.responseBodyMaxBytes,
          response_body_parse_elapsed_ms: parseStats.responseBodyParseElapsedMs,
          response_body_parse_max_ms: parseStats.responseBodyParseMaxMs,
          slowest_response_body_ms: parseStats.slowestResponseBodyMs,
          slowest_response_body_kind: parseStats.slowestResponseBodyKind,
          slowest_response_body_bytes: parseStats.slowestResponseBodyBytes,
          room_response_body_read_count: parseStats.roomResponseBodyReadCount,
          non_room_response_body_read_count: parseStats.nonRoomResponseBodyReadCount,
          room_response_body_error_count: parseStats.roomResponseBodyErrorCount,
          room_response_body_timeout_count: parseStats.roomResponseBodyTimeoutCount,
          room_response_body_empty_count: parseStats.roomResponseBodyEmptyCount,
          room_response_body_parse_error_count: parseStats.roomResponseBodyParseErrorCount,
          non_room_response_body_timeout_count: parseStats.nonRoomResponseBodyTimeoutCount,
          response_parse_elapsed_ms: parseStats.responseParseElapsedMs,
          response_parse_stopped_reason: parseStats.responseParseStoppedReason
        });
      } catch (error) {
        responseParsePhase.error(error);
        throw error;
      }
    }

    // Always run DOM extraction (works for both reused and new tabs), but keep it best-effort
    // once room API data has already produced candidates.
    const apiCaptureComplete = Boolean(
      edgeParseStats &&
      edgeParseStats.roomResponseCount > 0 &&
      edgeParseStats.fastPathComplete &&
      isEdgeRoomFastPathComplete(roomBlocks, template)
    );
    await extractEdgeDomRoomCandidates({
      connection,
      sessionId,
      url,
      captureMethod,
      targetMode,
      trackedUrls,
      debugHotelId,
      roomBlocks,
      perf,
      signal,
      apiCaptureComplete
    });

    const { mergedBlocks, selectedRoom } = await perf.runPhase(
      'edge_merge_select',
      {
        url,
        captureMethod,
        targetMode,
        roomCandidatesCount: roomBlocks.length,
        trackedUrlCount: trackedUrls.size,
        spiderErrorCodes: [...spiderErrorCodes]
      },
      async () => {
        const nextMergedBlocks = mergeRoomCandidates(roomBlocks);
        return {
          mergedBlocks: nextMergedBlocks,
          selectedRoom: selectBestRoom(nextMergedBlocks, template)
        };
      }
    );
    if (!selectedRoom) {
      return {
        roomBlocks: mergedBlocks,
        selectedRoom: null,
        trackedUrls: [...trackedUrls],
        spiderErrorCodes: [...spiderErrorCodes],
        edgeWaitedForSettle: Boolean(settleStats),
        settleStats,
        error:
          spiderErrorCodes.size > 0
            ? `edge-cdp fallback blocked by anti-spider code(s): ${[...spiderErrorCodes].join(', ')}`
            : 'edge-cdp fallback captured network responses but did not find a matching priced room'
      };
    }

    return {
      roomBlocks: mergedBlocks,
      selectedRoom,
      trackedUrls: [...trackedUrls],
      spiderErrorCodes: [...spiderErrorCodes],
      edgeWaitedForSettle: Boolean(settleStats),
      settleStats,
      error: ''
    };
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw error;
    }
    return {
      roomBlocks: [],
      selectedRoom: null,
      trackedUrls: [],
      spiderErrorCodes: [],
      edgeWaitedForSettle: Boolean(settleStats),
      settleStats,
      error: error && error.message ? error.message : 'edge-cdp fallback failed with unknown error'
    };
  } finally {
    const cleanupPhase = perf.phase('edge_cleanup', {
      url,
      captureMethod,
      targetMode,
      targetCreated: shouldCloseTarget,
      temporaryProfile: shouldCleanupUserDataDir
    });
    try {
      if (connection && sessionId) {
        await connection
          .send('Target.detachFromTarget', { sessionId }, '', {
            timeoutMs: EDGE_CDP_CLEANUP_TIMEOUT_MS
          })
          .catch(() => undefined);
      }
      if (connection && targetId && shouldCloseTarget) {
        await connection
          .send('Target.closeTarget', { targetId }, '', { timeoutMs: EDGE_CDP_CLEANUP_TIMEOUT_MS })
          .catch(() => undefined);
      }
      if (connection) {
        await connection.close(EDGE_CDP_CONNECTION_CLOSE_TIMEOUT_MS).catch(() => undefined);
      }
      if (browser && browser.pid) {
        killProcessTree(browser.pid);
      }
      if (shouldCleanupUserDataDir && userDataDir) {
        try {
          fs.rmSync(userDataDir, { recursive: true, force: true });
        } catch (_error) {
          // Edge may keep profile files locked briefly; cleanup failure should not fail scraping.
        }
      }
      cleanupPhase.end('success');
    } catch (error) {
      cleanupPhase.error(error);
    }
  }
}

const exported = {
  shouldAttemptSupplementalCapture,
  shouldPreferEdgeCapture,
  captureRoomCandidatesWithEdge
};

Object.defineProperties(exported, {
  isRoomListNetworkResponse: {
    value: isRoomListNetworkResponse,
    enumerable: false
  },
  getEdgeNetworkWaitCount: {
    value: getEdgeNetworkWaitCount,
    enumerable: false
  },
  getEdgeNetworkWaitOptions: {
    value: getEdgeNetworkWaitOptions,
    enumerable: false
  },
  getPrioritizedEdgeResponseEntries: {
    value: getPrioritizedEdgeResponseEntries,
    enumerable: false
  },
  buildEdgeResponseReadPlan: {
    value: buildEdgeResponseReadPlan,
    enumerable: false
  },
  getEdgeBlockedResourcePatterns: {
    value: getEdgeBlockedResourcePatterns,
    enumerable: false
  },
  configureEdgeStaticResourceBlocking: {
    value: configureEdgeStaticResourceBlocking,
    enumerable: false
  },
  waitForEdgeNavigateSignal: {
    value: waitForEdgeNavigateSignal,
    enumerable: false
  },
  waitForEdgePageReadyAfterNavigate: {
    value: waitForEdgePageReadyAfterNavigate,
    enumerable: false
  },
  isTransientEdgeExecutionContextError: {
    value: isTransientEdgeExecutionContextError,
    enumerable: false
  },
  waitForEdgeExecutionContextStable: {
    value: waitForEdgeExecutionContextStable,
    enumerable: false
  },
  settleRoomListWithEdgeRetry: {
    value: settleRoomListWithEdgeRetry,
    enumerable: false
  },
  parseEdgeNetworkResponses: {
    value: parseEdgeNetworkResponses,
    enumerable: false
  },
  extractEdgeDomRoomCandidates: {
    value: extractEdgeDomRoomCandidates,
    enumerable: false
  },
  getEdgeDomExtractTimeoutMs: {
    value: getEdgeDomExtractTimeoutMs,
    enumerable: false
  },
  shouldSkipEdgeResponseAfterRoomSuccess: {
    value: shouldSkipEdgeResponseAfterRoomSuccess,
    enumerable: false
  },
  isEdgeRoomFastPathComplete: {
    value: isEdgeRoomFastPathComplete,
    enumerable: false
  },
  detectCtripLoginPromptFromText: {
    value: detectCtripLoginPromptFromText,
    enumerable: false
  }
});

module.exports = exported;
