const fs = require('fs');
const { parseHotelIdFromUrl } = require('../../ctrip-url');
const { mergeRoomCandidates, selectBestRoom, selectMatchingRooms } = require('../room-logic');
const {
  findRoomBlocksFromStructuredText,
  findRoomBlocksFromHtml,
  safeJsonParse
} = require('../html-parser');
const { collectRoomCandidatesFromPayload } = require('../structured-extractor');
const { extractSpiderErrorCode, shouldInspectNetworkResponse } = require('../api-replay');
const { killProcessTree, findEdgeExecutable } = require('../process-utils');
const {
  normalizeEdgeSessionOptions,
  launchManagedEdgeSession,
  connectToDebugger,
  waitForDebuggerEndpoint,
  evaluateInSession,
  waitForSessionCondition,
  waitForStableCount,
  createCdpAbortError
} = require('../cdp-utils');
const { writeEdgeDebugArtifact } = require('./debug');
const { isReusableEdgeHotelTarget } = require('./target-reuse');
const { settleRoomListInEdgeSession } = require('./session-settle');

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

function isRoomListNetworkResponse(url = '') {
  const normalizedUrl = String(url || '').toLowerCase();
  if (!normalizedUrl) {
    return false;
  }

  return (
    /gethotelroomlist|gethotelroompopinfo|hotelroom|roomlist|roomprice|roompriceinfo/.test(
      normalizedUrl
    ) ||
    (normalizedUrl.includes('/restapi/soa2/') &&
      normalizedUrl.includes('hotel') &&
      normalizedUrl.includes('room'))
  );
}

function getEdgeNetworkWaitCount(roomRequestMeta, requestMeta) {
  if (roomRequestMeta && roomRequestMeta.size > 0) {
    return roomRequestMeta.size;
  }

  return requestMeta && requestMeta.size ? requestMeta.size : 0;
}

function getEdgeNetworkWaitOptions(roomRequestMeta, requestMeta) {
  const roomResponseCount = roomRequestMeta && roomRequestMeta.size ? roomRequestMeta.size : 0;
  const hasRoomResponses = roomResponseCount > 0;
  const hasMultipleRoomResponses = roomResponseCount >= 2;
  return {
    stableMs: hasMultipleRoomResponses ? 300 : hasRoomResponses ? 650 : 1200,
    maxWaitMs: 4500,
    intervalMs: hasMultipleRoomResponses ? 100 : hasRoomResponses ? 150 : 200,
    networkWaitCount: getEdgeNetworkWaitCount(roomRequestMeta, requestMeta),
    roomResponseSeen: hasRoomResponses,
    roomResponseCount,
    waitMode: hasMultipleRoomResponses
      ? 'multiple_room_responses'
      : hasRoomResponses
        ? 'single_room_response'
        : 'all_tracked_responses'
  };
}

function getPrioritizedEdgeResponseEntries(requestMeta) {
  const entries = [
    ...(requestMeta && typeof requestMeta.entries === 'function' ? requestMeta.entries() : [])
  ];
  const roomEntries = entries.filter(([, meta]) => isRoomListNetworkResponse(meta && meta.url));
  const otherEntries = entries.filter(([, meta]) => !isRoomListNetworkResponse(meta && meta.url));
  return [...roomEntries, ...otherEntries];
}

function buildEdgeResponseReadPlan(entries) {
  const roomGroups = new Map();
  const roomGroupOrder = [];
  const otherEntries = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const [, meta] = entry;
    if (!isRoomListNetworkResponse(meta && meta.url)) {
      otherEntries.push(entry);
      continue;
    }
    const urlKey = String((meta && meta.url) || '');
    if (!roomGroups.has(urlKey)) {
      roomGroups.set(urlKey, []);
      roomGroupOrder.push(urlKey);
    }
    roomGroups.get(urlKey).push(entry);
  }

  const roomEntries = [];
  for (const urlKey of roomGroupOrder) {
    const group = roomGroups.get(urlKey) || [];
    for (let index = group.length - 1; index >= 0; index -= 1) {
      roomEntries.push(group[index]);
    }
  }

  return [...roomEntries, ...otherEntries];
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const EDGE_CDP_COMMAND_TIMEOUT_MS = 8000;
const EDGE_CDP_SHORT_TIMEOUT_MS = 3000;
const EDGE_CDP_CLEANUP_TIMEOUT_MS = 1200;
const EDGE_CDP_CONNECTION_CLOSE_TIMEOUT_MS = 250;
const EDGE_DOM_EXTRACT_TIMEOUT_MS = 6000;
const EDGE_DOM_EXTRACT_FAST_TIMEOUT_MS = 1800;
const EDGE_DOM_EXTRACT_API_COMPLETE_TIMEOUT_MS = 900;
const EDGE_SETTLE_EVALUATE_TIMEOUT_MS = 6000;
const EDGE_RESPONSE_PARSE_MAX_MS = 12000;
const EDGE_NON_ROOM_RESPONSE_TIMEOUT_BUDGET = 8;

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

function shouldSkipEdgeResponseAfterRoomSuccess(meta = {}, state = {}) {
  if (!state.fastPathComplete) {
    return false;
  }

  return !isRoomListNetworkResponse(meta.url || '');
}

function shouldUseEdgeRawTextFallback({
  isRoomResponse,
  roomBlocks,
  structuredCandidates,
  template
}) {
  if (!isRoomResponse) {
    return true;
  }
  if (!Array.isArray(structuredCandidates) || structuredCandidates.length === 0) {
    return true;
  }
  const hasTemplateSignal = Boolean(
    template &&
    (template.room_type ||
      template.roomType ||
      template.room_count ||
      template.roomCount ||
      template.occupancy)
  );
  if (!hasTemplateSignal) {
    return true;
  }

  const normalizedTemplate = {
    ...template,
    room_type: template.room_type || template.roomType || '',
    room_count: template.room_count || template.roomCount || template.occupancy
  };

  return !isEdgeRoomFastPathComplete([...roomBlocks, ...structuredCandidates], normalizedTemplate);
}

function detectCtripLoginPromptFromText(text = '') {
  const normalizedText = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalizedText) {
    return {
      detected: false,
      reason: ''
    };
  }

  const priceLoginPattern =
    /登录看低价|解锁优惠|登录后(?:查看|享|可|才)?[^。；，,.]{0,16}(?:低价|价格|优惠|房价)/;
  if (priceLoginPattern.test(normalizedText)) {
    return {
      detected: true,
      reason: '携程页面提示登录后才能查看价格或优惠。'
    };
  }

  const loginDialogPattern =
    /扫码登录|手机号登录|账号密码登录|验证码登录|携程账号登录|登录携程|会员登录|立即登录|请登录后|登录后继续/;
  if (loginDialogPattern.test(normalizedText)) {
    return {
      detected: true,
      reason: '携程页面出现登录弹窗或登录入口。'
    };
  }

  return {
    detected: false,
    reason: ''
  };
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

function isTransientEdgeExecutionContextError(error) {
  const message = error && error.message ? error.message : String(error || '');
  return /Execution context was destroyed|Cannot find context with specified id|Cannot find context/i.test(
    message
  );
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

async function detectCtripLoginPromptInSession(connection, sessionId, options = {}) {
  const result = await evaluateInSession(
    connection,
    sessionId,
    `(() => {
      const readText = (element) => element ? String(element.innerText || element.textContent || '') : '';
      const selectors = [
        '[role="dialog"]',
        '[class*="login"]',
        '[class*="Login"]',
        '[class*="modal"]',
        '[class*="Modal"]',
        '[class*="popup"]',
        '[class*="Popup"]',
        '[class*="mask"]',
        '[class*="Mask"]'
      ];
      const snippets = [];
      for (const selector of selectors) {
        try {
          for (const element of Array.from(document.querySelectorAll(selector)).slice(0, 12)) {
            const text = readText(element).replace(/\\s+/g, ' ').trim();
            if (text && !snippets.includes(text)) snippets.push(text.slice(0, 600));
          }
        } catch (_error) {}
      }
      const bodyText = readText(document.body).replace(/\\s+/g, ' ').trim();
      return JSON.stringify({
        title: document.title || '',
        url: location.href || '',
        modalText: snippets.join('\\n').slice(0, 1800),
        bodyText: bodyText.slice(0, 2400)
      });
    })()`,
    {
      timeoutMs: 2500,
      signal: options.signal || null
    }
  );
  const payload = typeof result === 'string' ? safeJsonParse(result) : result;
  const combinedText = [
    payload && payload.title,
    payload && payload.modalText,
    payload && payload.bodyText
  ]
    .filter(Boolean)
    .join('\n');
  return detectCtripLoginPromptFromText(combinedText);
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

function isEdgeRoomFastPathComplete(roomBlocks, template) {
  const mergedBlocks = mergeRoomCandidates(roomBlocks);
  const selectedRoom = selectBestRoom(mergedBlocks, template);
  const eligibleRooms = selectMatchingRooms(mergedBlocks, template);
  return Boolean(
    selectedRoom &&
    selectedRoom.price !== null &&
    selectedRoom.price !== undefined &&
    eligibleRooms.length > 0
  );
}

function decodeEdgeResponseBody(responseBody) {
  const rawBody = responseBody && responseBody.body ? responseBody.body : '';
  if (!rawBody) {
    return '';
  }
  return responseBody.base64Encoded ? Buffer.from(rawBody, 'base64').toString('utf8') : rawBody;
}

function buildResponseEntryDiagnostics(entries) {
  const seenUrls = new Set();
  let duplicateResponseUrlCount = 0;
  let roomResponseEntryCount = 0;
  for (const [, meta] of entries) {
    const url = meta && meta.url ? String(meta.url) : '';
    if (url) {
      if (seenUrls.has(url)) {
        duplicateResponseUrlCount += 1;
      } else {
        seenUrls.add(url);
      }
    }
    if (isRoomListNetworkResponse(url)) {
      roomResponseEntryCount += 1;
    }
  }
  return {
    responseParseEntryCount: entries.length,
    roomResponseEntryCount,
    nonRoomResponseEntryCount: Math.max(0, entries.length - roomResponseEntryCount),
    uniqueResponseUrlCount: seenUrls.size,
    duplicateResponseUrlCount
  };
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

async function parseEdgeNetworkResponses({
  connection,
  sessionId,
  requestMeta,
  template,
  roomBlocks,
  spiderErrorCodes,
  debugHotelId,
  roomApiDebugIndex = 0,
  responseBodyTimeoutMs = null,
  roomResponseBodyMaxAttempts = 2,
  signal = null,
  responseParseMaxMs = EDGE_RESPONSE_PARSE_MAX_MS,
  nonRoomResponseBodyTimeoutBudget = EDGE_NON_ROOM_RESPONSE_TIMEOUT_BUDGET
}) {
  const startedAt = Date.now();
  const maxElapsedMs =
    Number.isFinite(responseParseMaxMs) && responseParseMaxMs > 0
      ? responseParseMaxMs
      : EDGE_RESPONSE_PARSE_MAX_MS;
  const nonRoomTimeoutBudget =
    Number.isFinite(nonRoomResponseBodyTimeoutBudget) && nonRoomResponseBodyTimeoutBudget >= 0
      ? nonRoomResponseBodyTimeoutBudget
      : EDGE_NON_ROOM_RESPONSE_TIMEOUT_BUDGET;
  const entries = getPrioritizedEdgeResponseEntries(requestMeta);
  const readPlan = buildEdgeResponseReadPlan(entries);
  const entryDiagnostics = buildResponseEntryDiagnostics(entries);
  const roomEntryCount = entryDiagnostics.roomResponseEntryCount;
  const stats = {
    ...entryDiagnostics,
    parsedResponseCount: 0,
    roomResponseCount: 0,
    skippedResponseCount: 0,
    duplicateRoomResponseSkippedCount: 0,
    roomResponseUrlFallbackCount: 0,
    fallbackFullParseUsed: roomEntryCount === 0,
    responseParseCandidateCount: 0,
    responseBodyRetryCount: 0,
    responseBodyTimeoutCount: 0,
    responseBodyReadCount: 0,
    responseBodyReadElapsedMs: 0,
    responseBodyReadMaxMs: 0,
    responseBodyTotalBytes: 0,
    responseBodyMaxBytes: 0,
    responseBodyParseElapsedMs: 0,
    responseBodyParseMaxMs: 0,
    slowestResponseBodyMs: 0,
    slowestResponseBodyKind: '',
    slowestResponseBodyBytes: 0,
    roomResponseBodyReadCount: 0,
    nonRoomResponseBodyReadCount: 0,
    roomResponseBodyErrorCount: 0,
    roomResponseBodyTimeoutCount: 0,
    roomResponseBodyEmptyCount: 0,
    roomResponseBodyParseErrorCount: 0,
    nonRoomResponseBodyTimeoutCount: 0,
    rawFallbackUsedCount: 0,
    rawFallbackSkippedCount: 0,
    rawFallbackCandidateCount: 0,
    structuredCandidateCount: 0,
    responseParseElapsedMs: 0,
    responseParseStoppedReason: '',
    roomApiDebugIndex
  };
  const state = {
    fastPathComplete: false
  };
  const attemptedRoomResponseUrls = new Set();
  const successfulRoomResponseUrls = new Set();

  for (let entryIndex = 0; entryIndex < readPlan.length; entryIndex += 1) {
    const [requestId, meta] = readPlan[entryIndex];
    assertEdgeNotAborted(signal, 'edge_response_parse');
    if (Date.now() - startedAt >= maxElapsedMs && stats.roomResponseCount > 0) {
      stats.responseParseStoppedReason = 'max_elapsed_after_room_response';
      break;
    }
    if (shouldSkipEdgeResponseAfterRoomSuccess(meta, state)) {
      stats.skippedResponseCount += readPlan.length - entryIndex;
      stats.responseParseStoppedReason = 'room_fast_path_complete';
      break;
    }
    try {
      const isRoomResponse = isRoomListNetworkResponse(meta.url);
      const roomResponseUrl = isRoomResponse ? String(meta.url || '') : '';
      if (isRoomResponse && successfulRoomResponseUrls.has(roomResponseUrl)) {
        stats.duplicateRoomResponseSkippedCount += 1;
        stats.skippedResponseCount += 1;
        continue;
      }
      if (isRoomResponse && attemptedRoomResponseUrls.has(roomResponseUrl)) {
        stats.roomResponseUrlFallbackCount += 1;
      }
      if (isRoomResponse) {
        attemptedRoomResponseUrls.add(roomResponseUrl);
      }
      if (
        !isRoomResponse &&
        stats.roomResponseCount > 0 &&
        stats.nonRoomResponseBodyTimeoutCount >= nonRoomTimeoutBudget
      ) {
        stats.responseParseStoppedReason = 'non_room_timeout_budget';
        break;
      }
      const bodyResult = await readEdgeResponseBodyWithRetry({
        connection,
        sessionId,
        requestId,
        isRoomResponse,
        timeoutMs:
          Number.isFinite(responseBodyTimeoutMs) && responseBodyTimeoutMs > 0
            ? responseBodyTimeoutMs
            : isRoomResponse
              ? 1200
              : 350,
        maxAttempts: isRoomResponse ? roomResponseBodyMaxAttempts : 1,
        signal
      });
      const bodyReadElapsedMs = Number(bodyResult.elapsedMs) || 0;
      stats.responseBodyReadElapsedMs += bodyReadElapsedMs;
      stats.responseBodyReadMaxMs = Math.max(stats.responseBodyReadMaxMs, bodyReadElapsedMs);
      stats.responseBodyRetryCount += bodyResult.retryCount;
      stats.responseBodyTimeoutCount += bodyResult.timeoutCount;
      if (isRoomResponse) {
        stats.roomResponseBodyTimeoutCount += bodyResult.timeoutCount;
      } else {
        stats.nonRoomResponseBodyTimeoutCount += bodyResult.timeoutCount;
      }
      if (bodyResult.error) {
        if (isRoomResponse) {
          stats.roomResponseBodyErrorCount += 1;
        }
        continue;
      }
      if (!bodyResult.body) {
        if (isRoomResponse) {
          stats.roomResponseBodyEmptyCount += 1;
        }
        continue;
      }
      const responseBodyBytes = Buffer.byteLength(bodyResult.body, 'utf8');
      if (bodyReadElapsedMs > stats.slowestResponseBodyMs) {
        stats.slowestResponseBodyMs = bodyReadElapsedMs;
        stats.slowestResponseBodyKind = isRoomResponse ? 'room' : 'non_room';
        stats.slowestResponseBodyBytes = responseBodyBytes;
      }
      stats.responseBodyReadCount += 1;
      stats.responseBodyTotalBytes += responseBodyBytes;
      stats.responseBodyMaxBytes = Math.max(stats.responseBodyMaxBytes, responseBodyBytes);
      if (isRoomResponse) {
        stats.roomResponseBodyReadCount += 1;
      } else {
        stats.nonRoomResponseBodyReadCount += 1;
      }
      const parseStartedAt = Date.now();
      const parsed = safeJsonParse(bodyResult.body);
      const parseElapsedMs = Date.now() - parseStartedAt;
      stats.responseBodyParseElapsedMs += parseElapsedMs;
      stats.responseBodyParseMaxMs = Math.max(stats.responseBodyParseMaxMs, parseElapsedMs);
      if (!parsed) {
        if (isRoomResponse) {
          stats.roomResponseBodyParseErrorCount += 1;
        }
        continue;
      }
      stats.parsedResponseCount += 1;
      if (isRoomResponse) {
        stats.roomResponseCount += 1;
        successfulRoomResponseUrls.add(roomResponseUrl);
      }
      if (/getHotelRoomList|getHotelRoomPopInfo/i.test(meta.url)) {
        stats.roomApiDebugIndex += 1;
        writeEdgeDebugArtifact(
          `${debugHotelId}-api-${String(stats.roomApiDebugIndex).padStart(2, '0')}.json`,
          {
            url: meta.url,
            mimeType: meta.mimeType || '',
            body: parsed
          }
        );
      }
      const spiderErrorCode = extractSpiderErrorCode(parsed);
      if (spiderErrorCode !== null) spiderErrorCodes.add(spiderErrorCode);
      const beforeCount = roomBlocks.length;
      const structuredCandidates = collectRoomCandidatesFromPayload(parsed, template);
      stats.structuredCandidateCount += structuredCandidates.length;
      const shouldUseRawFallback = shouldUseEdgeRawTextFallback({
        isRoomResponse,
        roomBlocks,
        structuredCandidates,
        template
      });
      const fallbackTextCandidates = shouldUseRawFallback
        ? findRoomBlocksFromStructuredText(bodyResult.body).map((candidate) => ({
            ...candidate,
            source: candidate.source || 'edge-cdp-raw'
          }))
        : [];
      if (shouldUseRawFallback) {
        stats.rawFallbackUsedCount += 1;
        stats.rawFallbackCandidateCount += fallbackTextCandidates.length;
      } else {
        stats.rawFallbackSkippedCount += 1;
      }
      roomBlocks.push(...structuredCandidates, ...fallbackTextCandidates);
      const extractedCount = roomBlocks.length - beforeCount;
      stats.responseParseCandidateCount += Math.max(0, extractedCount);
      if (extractedCount > 0 || meta.url.includes('Room') || meta.url.includes('room')) {
        console.log(
          `[edge-cdp] API ${meta.url.substring(0, 80)} → extracted ${extractedCount} rooms, has 套房: ${bodyResult.body.includes('套房')}, has 开放: ${bodyResult.body.includes('开放')}`
        );
      }
      if (isRoomResponse && isEdgeRoomFastPathComplete(roomBlocks, template)) {
        state.fastPathComplete = true;
      }
    } catch (error) {
      if (isAbortLikeError(error)) {
        throw error;
      }
      /* skip */
    }
  }

  stats.fastPathComplete = state.fastPathComplete;
  stats.responseParseElapsedMs = Date.now() - startedAt;
  if (roomEntryCount > 0 && !state.fastPathComplete) {
    stats.fallbackFullParseUsed = true;
  }

  return stats;
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

function buildEdgeDomExtractExpression() {
  return `(async () => {
        const roomPattern = /(家庭房|家庭间|双床房|双床间|大床房|大床间|三人间|三人房|三床房|套房|单人间|标准间|高级房|高级间|豪华房|豪华间|商务房|商务间|景观房|景观间|亲子房|亲子间|影音房|影音间|电竞房|电竞间|榻榻米房|榻榻米间|棋牌房|棋牌间)/;
        const pricePattern = /(¥|登录看低价|解锁优惠|券后|每晚|起)/;
        const titlePattern = /[\\u4e00-\\u9fa5A-Za-z0-9（）()·\\-]{2,40}(?:大床房|大床间|双床房|双床间|家庭房|家庭间|三床房|三人房|三人间|景观房|景观间|商务房|商务间|豪华房|豪华间|特惠房|特惠间|标准房|标准间|高级房|高级间|精品房|精品间|影音房|影音间|电竞房|电竞间|榻榻米房|榻榻米间|棋牌房|棋牌间|亲子房|亲子间|套房)/g;
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const isVisible = (element) => {
          if (!element || !(element instanceof Element)) return false;
          const style = window.getComputedStyle(element);
          if (!style || style.display === 'none' || style.visibility === 'hidden') return false;
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };
        const clickElement = (element) => {
          if (!element || !isVisible(element)) return false;
          try { element.click(); } catch(_e) {}
          try {
            const rect = element.getBoundingClientRect();
            ['mousedown', 'mouseup', 'click'].forEach((eventType) => {
              element.dispatchEvent(new MouseEvent(eventType, {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: rect.left + rect.width / 2,
                clientY: rect.top + rect.height / 2
              }));
            });
          } catch(_e) {}
          return true;
        };
        const readBodyText = () => (document.body && document.body.innerText) ? document.body.innerText : '';
        const toNormalizedText = (text) => String(text || '')
          .replace(/\u00a0/g, ' ')
          .replace(/[ \t]+/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        const extractRoomSection = (text) => {
          const normalized = toNormalizedText(text);
          if (!normalized) {
            return '';
          }
          const startMarkers = ['选择房间', '房型摘要', '可住人数 今日价格', '立即确认', '登录看低价'];
          const endMarkers = ['地点', '服务及设施', '酒店政策', '酒店简介', '订房必读', '附近的酒店', '住客点评', '位置周边'];
          let startIndex = -1;
          for (const marker of startMarkers) {
            const markerIndex = normalized.indexOf(marker);
            if (markerIndex !== -1 && (startIndex === -1 || markerIndex < startIndex)) {
              startIndex = markerIndex;
            }
          }
          if (startIndex === -1) {
            return normalized.slice(0, 18000);
          }
          let endIndex = normalized.length;
          for (const marker of endMarkers) {
            const markerIndex = normalized.indexOf(marker, startIndex + 1);
            if (markerIndex !== -1 && markerIndex < endIndex) {
              endIndex = markerIndex;
            }
          }
          return normalized.slice(startIndex, Math.min(endIndex, startIndex + 18000));
        };
        const extractTitleWindows = (text) => {
          const normalized = toNormalizedText(text);
          const windows = [];
          const seenWindows = new Set();
          const matches = [...normalized.matchAll(titlePattern)];
          for (let index = 0; index < matches.length; index += 1) {
            const current = matches[index];
            const next = matches[index + 1];
            const start = Math.max(0, (current.index || 0) - 80);
            const end = next
              ? Math.min(normalized.length, (next.index || 0) + 120)
              : Math.min(normalized.length, start + 900);
            const snippet = normalized.slice(start, end).trim();
            if (!snippet || seenWindows.has(snippet)) {
              continue;
            }
            seenWindows.add(snippet);
            windows.push(snippet);
            if (windows.length >= 40) {
              break;
            }
          }
          return windows;
        };
        const texts = [];
        const seen = new Set();
        const snapshots = [];
        const addSnapshot = (text) => {
          const normalized = extractRoomSection(text);
          if (!normalized || snapshots.includes(normalized)) return;
          snapshots.push(normalized);
        };
        addSnapshot(readBodyText());

        const triggerTexts = ['展示额外', '更多房型', '房间详情', '房型详情'];
        const triggerElements = Array.from(document.querySelectorAll('button, a, div, span'));
        const clickedTriggers = new Set();
        for (const element of triggerElements) {
          if (!isVisible(element)) continue;
          const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
          if (!text || !triggerTexts.some((item) => text.includes(item))) continue;
          const dedupeKey = text.slice(0, 40);
          if (clickedTriggers.has(dedupeKey)) continue;
          clickedTriggers.add(dedupeKey);
          if (!clickElement(element)) continue;
          await sleep(280);
          addSnapshot(readBodyText());
          try {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          } catch(_e) {}
          await sleep(120);
        }

        const nodes = document.querySelectorAll('div, li, section, article');
        for (const node of nodes) {
          if (!isVisible(node)) continue;
          const text = toNormalizedText(node.innerText || '');
          if (!text || text.length < 4) continue;
          if (!roomPattern.test(text) || !pricePattern.test(text)) continue;
          const normalized = text.length > 1800 ? extractRoomSection(text) : text;
          if (seen.has(normalized)) continue;
          seen.add(normalized);
          texts.push(normalized);
          if (texts.length >= 80) break;
        }
        const bodyText = readBodyText();
        for (const snippet of extractTitleWindows(bodyText)) {
          if (seen.has(snippet)) continue;
          seen.add(snippet);
          texts.push(snippet);
          if (texts.length >= 120) break;
        }
        const relevantBodyText = extractRoomSection(bodyText);
        return JSON.stringify({
          bodyText: relevantBodyText,
          bodyHtml: '',
          snippets: texts,
          snapshots
        });
        })()`;
}

function buildLightweightEdgeDomExtractExpression() {
  return `(async () => {
        const titlePattern = /[\\u4e00-\\u9fa5A-Za-z0-9（）()·\\-]{2,40}(?:大床房|大床间|双床房|双床间|家庭房|家庭间|三床房|三人房|三人间|景观房|景观间|商务房|商务间|豪华房|豪华间|特惠房|特惠间|标准房|标准间|高级房|高级间|精品房|精品间|影音房|影音间|电竞房|电竞间|榻榻米房|榻榻米间|棋牌房|棋牌间|亲子房|亲子间|套房)/g;
        const toNormalizedText = (text) => String(text || '')
          .replace(/\u00a0/g, ' ')
          .replace(/[ \t]+/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        const extractRoomSection = (text) => {
          const normalized = toNormalizedText(text);
          if (!normalized) return '';
          const startMarkers = ['选择房间', '房型摘要', '可住人数 今日价格', '立即确认', '登录看低价'];
          const endMarkers = ['地点', '服务及设施', '酒店政策', '酒店简介', '订房必读', '附近的酒店', '住客点评', '位置周边'];
          let startIndex = -1;
          for (const marker of startMarkers) {
            const markerIndex = normalized.indexOf(marker);
            if (markerIndex !== -1 && (startIndex === -1 || markerIndex < startIndex)) {
              startIndex = markerIndex;
            }
          }
          if (startIndex === -1) return normalized.slice(0, 12000);
          let endIndex = normalized.length;
          for (const marker of endMarkers) {
            const markerIndex = normalized.indexOf(marker, startIndex + 1);
            if (markerIndex !== -1 && markerIndex < endIndex) {
              endIndex = markerIndex;
            }
          }
          return normalized.slice(startIndex, Math.min(endIndex, startIndex + 12000));
        };
        const bodyText = document.body && document.body.innerText ? document.body.innerText : '';
        const relevantBodyText = extractRoomSection(bodyText);
        const snippets = [];
        const seen = new Set();
        const matches = [...relevantBodyText.matchAll(titlePattern)];
        for (let index = 0; index < matches.length && snippets.length < 40; index += 1) {
          const match = matches[index];
          const next = matches[index + 1];
          const start = Math.max(0, match.index - 80);
          const end = next && next.index > match.index
            ? Math.min(relevantBodyText.length, next.index + 80)
            : Math.min(relevantBodyText.length, match.index + 420);
          const snippet = toNormalizedText(relevantBodyText.slice(start, end));
          if (snippet && !seen.has(snippet)) {
            seen.add(snippet);
            snippets.push(snippet);
          }
        }
        return JSON.stringify({
          bodyText: relevantBodyText,
          bodyHtml: '',
          snippets,
          snapshots: []
        });
      })()`;
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
