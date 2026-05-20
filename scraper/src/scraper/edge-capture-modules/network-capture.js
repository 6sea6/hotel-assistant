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
  waitForStableCount
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
  const hasRoomResponses = Boolean(roomRequestMeta && roomRequestMeta.size > 0);
  return {
    stableMs: hasRoomResponses ? 650 : 1200,
    maxWaitMs: 4500,
    intervalMs: hasRoomResponses ? 150 : 200,
    networkWaitCount: getEdgeNetworkWaitCount(roomRequestMeta, requestMeta),
    roomResponseSeen: hasRoomResponses
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

async function configureEdgeStaticResourceBlocking(connection, sessionId, options = {}) {
  if (!connection || typeof connection.send !== 'function' || !sessionId) {
    return { enabled: false, blockedPatternCount: 0, reason: 'missing_cdp_session' };
  }
  if (options.blockStaticResources === false || options.disableStaticResourceBlocking === true) {
    return { enabled: false, blockedPatternCount: 0, reason: 'disabled_by_option' };
  }

  const urls = getEdgeBlockedResourcePatterns();
  try {
    await connection.send('Network.setBlockedURLs', { urls }, sessionId);
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
  pageCheckIntervalMs = 250
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
            })()`
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

function isClearlyIrrelevantEdgeResponse(url = '') {
  const normalizedUrl = String(url || '').toLowerCase();
  if (!normalizedUrl || isRoomListNetworkResponse(normalizedUrl)) {
    return false;
  }

  return /\/(?:log|logs|trace|tracing|analytics|ubt|collect|monitor|metrics|sentry|beacon)(?:[./?#]|$)/.test(
    normalizedUrl
  );
}

function shouldSkipEdgeResponseAfterRoomSuccess(meta = {}, state = {}) {
  if (!state.fastPathComplete) {
    return false;
  }

  return isClearlyIrrelevantEdgeResponse(meta.url || '');
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

function emitEdgeEvent(options = {}, type, message, details = {}) {
  if (typeof options.onEvent !== 'function') {
    return;
  }

  options.onEvent(type, message, details);
}

async function detectCtripLoginPromptInSession(connection, sessionId) {
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
    })()`
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
  roomRequestMeta
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
      intervalMs: waitOptions.intervalMs
    });
    phase.end('success', {
      tracked_url_count_after: trackedUrls.size,
      room_tracked_url_count_after: roomRequestMeta.size,
      network_wait_count: getEdgeNetworkWaitCount(roomRequestMeta, requestMeta),
      network_wait_stable_ms: waitOptions.stableMs,
      network_wait_max_ms: waitOptions.maxWaitMs,
      network_wait_interval_ms: waitOptions.intervalMs,
      room_response_seen: waitOptions.roomResponseSeen
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
      room_response_seen: waitOptions.roomResponseSeen
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

async function parseEdgeNetworkResponses({
  connection,
  sessionId,
  requestMeta,
  template,
  roomBlocks,
  spiderErrorCodes,
  debugHotelId,
  roomApiDebugIndex = 0
}) {
  const entries = getPrioritizedEdgeResponseEntries(requestMeta);
  const roomEntryCount = entries.filter(([, meta]) =>
    isRoomListNetworkResponse(meta && meta.url)
  ).length;
  const stats = {
    parsedResponseCount: 0,
    roomResponseCount: 0,
    skippedResponseCount: 0,
    fallbackFullParseUsed: roomEntryCount === 0,
    responseParseCandidateCount: 0,
    roomApiDebugIndex
  };
  const state = {
    fastPathComplete: false
  };

  for (const [requestId, meta] of entries) {
    if (shouldSkipEdgeResponseAfterRoomSuccess(meta, state)) {
      stats.skippedResponseCount += 1;
      continue;
    }
    try {
      const responseBody = await connection.send(
        'Network.getResponseBody',
        { requestId },
        sessionId
      );
      const rawBody = responseBody && responseBody.body ? responseBody.body : '';
      if (!rawBody) continue;
      const body = responseBody.base64Encoded
        ? Buffer.from(rawBody, 'base64').toString('utf8')
        : rawBody;
      const parsed = safeJsonParse(body);
      if (!parsed) continue;
      stats.parsedResponseCount += 1;
      const isRoomResponse = isRoomListNetworkResponse(meta.url);
      if (isRoomResponse) {
        stats.roomResponseCount += 1;
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
      const fallbackTextCandidates = findRoomBlocksFromStructuredText(body).map((candidate) => ({
        ...candidate,
        source: candidate.source || 'edge-cdp-raw'
      }));
      roomBlocks.push(...structuredCandidates, ...fallbackTextCandidates);
      const extractedCount = roomBlocks.length - beforeCount;
      stats.responseParseCandidateCount += Math.max(0, extractedCount);
      if (extractedCount > 0 || meta.url.includes('Room') || meta.url.includes('room')) {
        console.log(
          `[edge-cdp] API ${meta.url.substring(0, 80)} → extracted ${extractedCount} rooms, has 套房: ${body.includes('套房')}, has 开放: ${body.includes('开放')}`
        );
      }
      if (isRoomResponse && isEdgeRoomFastPathComplete(roomBlocks, template)) {
        state.fastPathComplete = true;
      }
    } catch (_error) {
      /* skip */
    }
  }

  stats.fastPathComplete = state.fastPathComplete;
  if (roomEntryCount > 0 && !state.fastPathComplete) {
    stats.fallbackFullParseUsed = true;
  }

  return stats;
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
  let loginPromptNotified = false;
  const notifyLoginPromptIfDetected = async (stage) => {
    if (loginPromptNotified || !connection || !sessionId) {
      return;
    }
    try {
      const detection = await detectCtripLoginPromptInSession(connection, sessionId);
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
    await perf.runPhase(
      'edge_connect',
      {
        url,
        captureMethod,
        hasDebuggerUrl: Boolean(sessionOptions.debuggerUrl),
        hasDebuggingPort: Boolean(sessionOptions.debuggingPort)
      },
      async () => {
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
      try {
        const targetsResponse = await connection.send('Target.getTargets');
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
        const createdTarget = await connection.send('Target.createTarget', { url: 'about:blank' });
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

      const attachedTarget = await connection.send('Target.attachToTarget', {
        targetId,
        flatten: true
      });
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

    await connection.send('Page.enable', {}, sessionId);
    await connection.send('Network.enable', {}, sessionId);
    await connection.send('Runtime.enable', {}, sessionId);

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
        ...options
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

      await connection.send('Network.setCacheDisabled', { cacheDisabled: false }, sessionId);

      const navigatePhase = perf.phase('edge_navigate', { url, captureMethod, targetMode });
      try {
        await connection.send('Page.navigate', { url }, sessionId);
        const navigateSignal = await waitForEdgeNavigateSignal({
          connection,
          sessionId,
          roomRequestMeta,
          trackedUrls,
          timeoutMs: 15000
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
      await perf.runPhase('edge_page_ready', { url, captureMethod, targetMode }, async () =>
        waitForSessionCondition(
          connection,
          sessionId,
          `(() => {
        const bodyText = document.body && document.body.innerText ? document.body.innerText : '';
        return document.readyState === 'complete' && /(房型|展示额外|更多房型|登录看低价|¥|每晚)/.test(bodyText);
      })()`,
          4500,
          250
        )
      );
      await notifyLoginPromptIfDetected('edge_page_ready');
      const settlePhase = perf.phase('edge_settle_room_list', { url, captureMethod, targetMode });
      try {
        settleStats = await settleRoomListInEdgeSession(connection, sessionId, {
          perf,
          fields: { url, captureMethod, targetMode },
          getTrackedUrlCount: () => trackedUrls.size
        });
        settlePhase.end('success', {
          settle_total_ms: settleStats.totalMs,
          settle_clicked_count: settleStats.clickedCount,
          settle_skipped_duplicate_click_count: settleStats.skippedDuplicateClickCount || 0,
          settle_generic_click_count: settleStats.genericClickCount || 0,
          settle_scroll_count: settleStats.scrollCount,
          settle_container_count: settleStats.containerCount,
          settle_likely_container_count: settleStats.likelyContainerCount || 0,
          settle_fallback_container_count: settleStats.fallbackContainerCount || 0,
          settle_skipped_bottom_expand_count: settleStats.skippedBottomExpandCount || 0
        });
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
        roomRequestMeta
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
          roomApiDebugIndex
        });
        roomApiDebugIndex = parseStats.roomApiDebugIndex;
        responseParsePhase.end('success', {
          parsed_response_count: parseStats.parsedResponseCount,
          room_response_count: parseStats.roomResponseCount,
          skipped_response_count: parseStats.skippedResponseCount,
          fallback_full_parse_used: parseStats.fallbackFullParseUsed,
          response_fast_path_complete: parseStats.fastPathComplete,
          response_parse_candidate_count: parseStats.responseParseCandidateCount
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

      await connection.send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);

      const navigatePhase = perf.phase('edge_navigate', { url, captureMethod, targetMode });
      try {
        await connection.send('Page.navigate', { url }, sessionId);
        const navigateSignal = await waitForEdgeNavigateSignal({
          connection,
          sessionId,
          roomRequestMeta,
          trackedUrls,
          timeoutMs: 12000
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
      await perf.runPhase('edge_page_ready', { url, captureMethod, targetMode }, async () =>
        waitForSessionCondition(
          connection,
          sessionId,
          `(() => {
        const bodyText = document.body && document.body.innerText ? document.body.innerText : '';
        return document.readyState === 'complete' && /(房型|展示额外|更多房型|登录看低价|¥|每晚)/.test(bodyText);
      })()`,
          4500,
          250
        )
      );
      await notifyLoginPromptIfDetected('edge_page_ready');
      const settlePhase = perf.phase('edge_settle_room_list', { url, captureMethod, targetMode });
      try {
        settleStats = await settleRoomListInEdgeSession(connection, sessionId, {
          perf,
          fields: { url, captureMethod, targetMode },
          getTrackedUrlCount: () => trackedUrls.size
        });
        settlePhase.end('success', {
          settle_total_ms: settleStats.totalMs,
          settle_clicked_count: settleStats.clickedCount,
          settle_skipped_duplicate_click_count: settleStats.skippedDuplicateClickCount || 0,
          settle_generic_click_count: settleStats.genericClickCount || 0,
          settle_scroll_count: settleStats.scrollCount,
          settle_container_count: settleStats.containerCount,
          settle_likely_container_count: settleStats.likelyContainerCount || 0,
          settle_fallback_container_count: settleStats.fallbackContainerCount || 0,
          settle_skipped_bottom_expand_count: settleStats.skippedBottomExpandCount || 0
        });
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
        roomRequestMeta
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
          roomApiDebugIndex
        });
        roomApiDebugIndex = parseStats.roomApiDebugIndex;
        responseParsePhase.end('success', {
          parsed_response_count: parseStats.parsedResponseCount,
          room_response_count: parseStats.roomResponseCount,
          skipped_response_count: parseStats.skippedResponseCount,
          fallback_full_parse_used: parseStats.fallbackFullParseUsed,
          response_fast_path_complete: parseStats.fastPathComplete,
          response_parse_candidate_count: parseStats.responseParseCandidateCount
        });
      } catch (error) {
        responseParsePhase.error(error);
        throw error;
      }
    }

    // Always run DOM extraction (works for both reused and new tabs).
    const domPhase = perf.phase('edge_dom_extract', {
      url,
      captureMethod,
      targetMode,
      trackedUrlCount: trackedUrls.size
    });
    try {
      const domPayloadResult = await evaluateInSession(
        connection,
        sessionId,
        `(async () => {
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
      })()`
      );
      const domPayload =
        typeof domPayloadResult === 'string' ? safeJsonParse(domPayloadResult) : domPayloadResult;
      writeEdgeDebugArtifact(`${debugHotelId}-dom-payload.json`, domPayload);
      const beforeDomCount = roomBlocks.length;
      roomBlocks.push(...collectRoomCandidatesFromDomPayload(domPayload));
      domPhase.end('success', {
        roomCandidatesCount: roomBlocks.length - beforeDomCount
      });
    } catch (error) {
      domPhase.error(error);
      writeEdgeDebugArtifact(`${debugHotelId}-dom-error.json`, {
        message: error && error.message ? error.message : String(error || ''),
        stack: error && error.stack ? error.stack : ''
      });
      // DOM extraction is best-effort; keep network-derived results when evaluation fails.
    }

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
        await connection.send('Target.detachFromTarget', { sessionId }).catch(() => undefined);
      }
      if (connection && targetId && shouldCloseTarget) {
        await connection.send('Target.closeTarget', { targetId }).catch(() => undefined);
      }
      if (connection) {
        await connection.close().catch(() => undefined);
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
