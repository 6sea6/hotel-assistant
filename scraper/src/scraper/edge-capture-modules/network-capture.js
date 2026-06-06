const { parseHotelIdFromUrl } = require('../../ctrip-url');
const { mergeRoomCandidates, selectBestRoom, selectMatchingRooms } = require('../room-logic');
const {
  buildEdgeResponseReadPlan,
  getEdgeNetworkWaitCount,
  getEdgeNetworkWaitOptions,
  getPrioritizedEdgeResponseEntries,
  isRoomListNetworkResponse,
  shouldSkipEdgeResponseAfterRoomSuccess
} = require('./network-response-classifier');
const {
  assertEdgeNotAborted,
  buildCdpSendOptions,
  isAbortLikeError
} = require('./edge-retry-policy');
const {
  detectCtripLoginPromptFromText,
  detectCtripLoginPromptInSession
} = require('./login-detection');
const { isEdgeRoomFastPathComplete, parseEdgeNetworkResponses } = require('./response-parser');
const { createEdgeNetworkResponseTracker } = require('./network-response-tracker');
const {
  configureEdgeStaticResourceBlocking,
  getEdgeBlockedResourcePatterns
} = require('./static-resource-blocker');
const {
  isTransientEdgeExecutionContextError,
  settleRoomListWithEdgeRetry,
  waitForEdgeExecutionContextStable,
  waitForEdgeNavigateSignal,
  waitForEdgePageReadyAfterNavigate
} = require('./navigation-settle');
const {
  createNoopPerf,
  extractEdgeDomRoomCandidates,
  getEdgeDomExtractTimeoutMs
} = require('./edge-dom-extract');
const { runEdgeTargetCapture } = require('./edge-target-capture');
const {
  acquireEdgeTarget,
  cleanupEdgeTargetSession,
  connectEdgeDebugger,
  findEdgeExecutable,
  getEdgeWebSocket,
  normalizeEdgeSessionOptions
} = require('./edge-target-session');

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

function emitEdgeEvent(options = {}, type, message, details = {}) {
  if (typeof options.onEvent !== 'function') {
    return;
  }

  options.onEvent(type, message, details);
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

  const EdgeWebSocket = getEdgeWebSocket();
  if (!EdgeWebSocket) {
    return {
      roomBlocks: [],
      selectedRoom: null,
      trackedUrls: [],
      error:
        'edge-cdp fallback unavailable: global WebSocket is not present and ws package not installed'
    };
  }

  const sessionOptions = normalizeEdgeSessionOptions(edgeSessionOptions);
  const edgeExecutable = findEdgeExecutable({
    browserPreference: sessionOptions.browserPreference
  });
  if (!sessionOptions.debuggerUrl && !edgeExecutable) {
    return {
      roomBlocks: [],
      selectedRoom: null,
      trackedUrls: [],
      error: 'edge-cdp fallback unavailable: Edge or 360 browser not found'
    };
  }

  let browser = null;
  let browserExecutable = '';
  let browserPort = 0;
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
          '当前采集浏览器登录态可能无效；请在采集浏览器中登录携程后重新采集。'
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
    const connectedSession = await connectEdgeDebugger({
      edgeSessionOptions,
      edgeExecutable,
      EdgeWebSocket,
      perf,
      url,
      captureMethod,
      signal
    });
    browser = connectedSession.browser;
    browserExecutable = connectedSession.browserExecutable || edgeExecutable;
    browserPort = connectedSession.browserPort || sessionOptions.debuggingPort || 0;
    connection = connectedSession.connection;
    userDataDir = connectedSession.userDataDir;
    shouldCleanupUserDataDir = connectedSession.shouldCleanupUserDataDir;

    const targetSession = await acquireEdgeTarget({
      connection,
      url,
      captureMethod,
      perf,
      signal
    });
    targetId = targetSession.targetId;
    sessionId = targetSession.sessionId;
    targetMode = targetSession.targetMode;
    targetInitialUrl = targetSession.targetInitialUrl;
    shouldCloseTarget = targetSession.shouldCloseTarget;
    if (targetSession.errorResult) {
      return targetSession.errorResult;
    }

    const networkTracker = createEdgeNetworkResponseTracker({ connection, sessionId, signal });
    const { requestMeta, roomRequestMeta, trackedUrls } = networkTracker;
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

    const targetCaptureResult = await runEdgeTargetCapture({
      perf,
      connection,
      sessionId,
      url,
      captureMethod,
      targetMode,
      networkTracker,
      requestMeta,
      roomRequestMeta,
      trackedUrls,
      template,
      roomBlocks,
      spiderErrorCodes,
      debugHotelId,
      roomApiDebugIndex,
      matchingOptions: options.matchingOptions || {},
      signal,
      notifyLoginPromptIfDetected,
      onSettleStats: (nextSettleStats) => {
        settleStats = nextSettleStats;
      },
      cacheDisabled: targetMode !== 'reused-match',
      navigateSignalTimeoutMs: targetMode === 'reused-match' ? 15000 : 12000,
      trackedLogLabel: targetMode === 'reused-match' ? 'tracked URLs' : 'new-tab tracked URLs',
      preNavigateLogMessage:
        targetMode === 'reused-match'
          ? `[edge-cdp] reusing matched tab and navigating: ${targetInitialUrl || 'about:blank'} -> ${url}`
          : ''
    });
    settleStats = targetCaptureResult.settleStats;
    edgeParseStats = targetCaptureResult.edgeParseStats;
    roomApiDebugIndex = targetCaptureResult.roomApiDebugIndex;

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
          selectedRoom: selectBestRoom(nextMergedBlocks, template, options.matchingOptions || {})
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
    await cleanupEdgeTargetSession({
      perf,
      url,
      captureMethod,
      targetMode,
      targetCreated: shouldCloseTarget,
      temporaryProfile: shouldCleanupUserDataDir,
      connection,
      sessionId,
      targetId,
      browser,
      browserExecutable,
      browserPort,
      userDataDir
    });
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
  runEdgeTargetCapture: {
    value: runEdgeTargetCapture,
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
