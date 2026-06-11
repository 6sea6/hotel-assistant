const {
  evaluateInSession,
  waitForSessionCondition
} = require('../cdp-utils');
const { settleRoomListInEdgeSession } = require('./session-settle');
const {
  EDGE_SETTLE_EVALUATE_TIMEOUT_MS,
  assertEdgeNotAborted,
  isAbortLikeError,
  isTransientEdgeExecutionContextError,
  sleep
} = require('./edge-retry-policy');

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
  getRoomTrackedUrlCount,
  getReadableRoomResponseCount,
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
      getRoomTrackedUrlCount,
      getReadableRoomResponseCount,
      splitMainScroll: true,
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
    settle_api_fast_path_skipped_step_count: settleStats.apiFastPathSkippedStepCount || 0,
    settle_retry_count: settleResult.retryCount || 0,
    settle_retry_reason: settleResult.retryReason || ''
  };
}

module.exports = {
  buildEdgeNavigateSignalResult,
  buildSettlePhaseFields,
  getNavigateSignalPerfFields,
  isTransientEdgeExecutionContextError,
  settleRoomListWithEdgeRetry,
  waitForEdgeExecutionContextStable,
  waitForEdgeNavigateSignal,
  waitForEdgePageReadyAfterNavigate
};
