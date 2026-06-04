const { waitForStableCount } = require('../cdp-utils');
const { logEdgeDebug = () => {} } = require('./debug');
const {
  getEdgeNetworkWaitCount,
  getEdgeNetworkWaitOptions
} = require('./network-response-classifier');
const {
  EDGE_CDP_COMMAND_TIMEOUT_MS,
  EDGE_CDP_SHORT_TIMEOUT_MS,
  buildCdpSendOptions
} = require('./edge-retry-policy');
const { parseEdgeNetworkResponses } = require('./response-parser');
const {
  buildSettlePhaseFields,
  settleRoomListWithEdgeRetry,
  waitForEdgeNavigateSignal,
  waitForEdgePageReadyAfterNavigate
} = require('./navigation-settle');

async function waitForEdgeNetworkStability({
  perf,
  url,
  captureMethod,
  targetMode,
  trackedUrls,
  requestMeta,
  roomRequestMeta,
  signal = null,
  getReadableRoomResponseCount = null
}) {
  const readableRoomResponseCount =
    typeof getReadableRoomResponseCount === 'function'
      ? Number(getReadableRoomResponseCount() || 0)
      : 0;
  const phase = perf.phase('edge_network_wait', {
    url,
    captureMethod,
    targetMode,
    trackedUrlCount: trackedUrls.size,
    roomTrackedUrlCount: roomRequestMeta.size,
    readableRoomResponseCount
  });
  try {
    const waitOptions = getEdgeNetworkWaitOptions(roomRequestMeta, requestMeta, {
      readableRoomResponseCount
    });
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
      readable_room_response_count: waitOptions.readableRoomResponseCount,
      network_wait_mode: waitOptions.waitMode
    });
  } catch (error) {
    const waitOptions = getEdgeNetworkWaitOptions(roomRequestMeta, requestMeta, {
      readableRoomResponseCount
    });
    phase.error(error, {
      tracked_url_count_after: trackedUrls.size,
      room_tracked_url_count_after: roomRequestMeta.size,
      network_wait_count: getEdgeNetworkWaitCount(roomRequestMeta, requestMeta),
      network_wait_stable_ms: waitOptions.stableMs,
      network_wait_max_ms: waitOptions.maxWaitMs,
      network_wait_interval_ms: waitOptions.intervalMs,
      room_response_seen: waitOptions.roomResponseSeen,
      room_response_count: waitOptions.roomResponseCount,
      readable_room_response_count: waitOptions.readableRoomResponseCount,
      network_wait_mode: waitOptions.waitMode
    });
    throw error;
  }
}

function buildEdgeResponseParseFields(parseStats) {
  return {
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
    cached_response_body_hit_count: parseStats.cachedResponseBodyHitCount,
    cached_room_response_body_hit_count: parseStats.cachedRoomResponseBodyHitCount,
    response_parse_elapsed_ms: parseStats.responseParseElapsedMs,
    response_parse_stopped_reason: parseStats.responseParseStoppedReason
  };
}

async function runEdgeTargetCapture({
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
  roomApiDebugIndex = 0,
  matchingOptions = {},
  signal = null,
  notifyLoginPromptIfDetected = async () => {},
  onSettleStats = null,
  cacheDisabled,
  navigateSignalTimeoutMs,
  trackedLogLabel,
  preNavigateLogMessage = ''
}) {
  if (preNavigateLogMessage) {
    logEdgeDebug(preNavigateLogMessage);
  }

  const removeListener = networkTracker.attach();
  let listenerAttached = true;
  const detachListener = () => {
    if (!listenerAttached) return;
    listenerAttached = false;
    removeListener();
  };

  try {
    await connection.send(
      'Network.setCacheDisabled',
      { cacheDisabled },
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
        timeoutMs: navigateSignalTimeoutMs,
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

    const getReadableRoomResponseCount = () =>
      [...roomRequestMeta.values()].filter((meta) =>
        Boolean(
          meta && ((meta.cachedBodyResult && meta.cachedBodyResult.body) || meta.cachedBody)
        )
      ).length;
    const settlePhase = perf.phase('edge_settle_room_list', { url, captureMethod, targetMode });
    let settleStats = null;
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
        getRoomTrackedUrlCount: () => roomRequestMeta.size,
        getReadableRoomResponseCount,
        signal
      });
      settleStats = settleResult.stats;
      if (typeof onSettleStats === 'function') {
        onSettleStats(settleStats);
      }
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
      getReadableRoomResponseCount,
      signal
    });

    logEdgeDebug(
      `[edge-cdp] ${trackedLogLabel} before expand: ${trackedBeforeExpand}, after: ${trackedUrls.size}`
    );

    detachListener();

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
        matchingOptions,
        signal
      });
      responseParsePhase.end('success', buildEdgeResponseParseFields(parseStats));
      return {
        settleStats,
        edgeParseStats: parseStats,
        roomApiDebugIndex: parseStats.roomApiDebugIndex
      };
    } catch (error) {
      responseParsePhase.error(error);
      throw error;
    }
  } finally {
    detachListener();
  }
}

module.exports = {
  buildEdgeResponseParseFields,
  runEdgeTargetCapture,
  waitForEdgeNetworkStability
};
