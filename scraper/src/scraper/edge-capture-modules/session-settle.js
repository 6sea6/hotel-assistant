const {
  evaluateInSession,
  createCdpAbortError = (method) => {
    const error = new Error(`CDP ${method} aborted`);
    error.name = 'AbortError';
    error.code = 'CDP_ABORTED';
    return error;
  }
} = require('../cdp-utils');
const {
  buildSessionSettleStepExpression
} = require('./session-settle-browser-script');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createNoopPerf() {
  return {
    phase() {
      return {
        end() {},
        error() {}
      };
    }
  };
}

function parseStepResult(result) {
  if (!result) {
    return {};
  }
  if (typeof result === 'string') {
    try {
      return JSON.parse(result);
    } catch (_error) {
      return {};
    }
  }
  return typeof result === 'object' ? result : {};
}

function normalizeStepStats(stats = {}) {
  return {
    clickedCount: Number(stats.clickedCount || 0),
    earlyStopCount: Number(stats.earlyStopCount || 0),
    emptyCloseFastPathCount: Number(stats.emptyCloseFastPathCount || 0),
    initialExpandFastPathCount: Number(stats.initialExpandFastPathCount || 0),
    scanCandidateCount: Number(stats.scanCandidateCount || 0),
    explicitCandidateCount: Number(stats.explicitCandidateCount || 0),
    genericCandidateCount: Number(stats.genericCandidateCount || 0),
    clickScanElapsedMs: Number(stats.clickScanElapsedMs || 0),
    explicitScanCandidateCount: Number(stats.explicitScanCandidateCount || 0),
    fallbackScanCandidateCount: Number(stats.fallbackScanCandidateCount || 0),
    genericFallbackScanCount: Number(stats.genericFallbackScanCount || 0),
    genericFallbackSuppressedCount: Number(stats.genericFallbackSuppressedCount || 0),
    roomSectionDetectedCount: Number(stats.roomSectionDetectedCount || 0),
    roomSectionScanOnlyCount: Number(stats.roomSectionScanOnlyCount || 0),
    nonRoomSectionReachedCount: Number(stats.nonRoomSectionReachedCount || 0),
    roomSectionElementCount: Number(stats.roomSectionElementCount || 0),
    roomCardCount: Number(stats.roomCardCount || 0),
    roomExpandButtonCount: Number(stats.roomExpandButtonCount || 0),
    roomSectionStartY: Number(stats.roomSectionStartY || 0),
    roomSectionEndY: Number(stats.roomSectionEndY || 0),
    selectorScanCount: Number(stats.selectorScanCount || 0),
    selectorScanElapsedMs: Number(stats.selectorScanElapsedMs || 0),
    slowestSelectorScanLabel:
      typeof stats.slowestSelectorScanLabel === 'string' ? stats.slowestSelectorScanLabel : '',
    slowestSelectorScanElapsedMs: Number(stats.slowestSelectorScanElapsedMs || 0),
    slowestSelectorScanCandidateCount: Number(stats.slowestSelectorScanCandidateCount || 0),
    skippedDuplicateClickCount: Number(stats.skippedDuplicateClickCount || 0),
    genericClickCount: Number(stats.genericClickCount || 0),
    scrollCount: Number(stats.scrollCount || 0),
    containerCount: Number(stats.containerCount || 0),
    likelyContainerCount: Number(stats.likelyContainerCount || 0),
    fallbackContainerCount: Number(stats.fallbackContainerCount || 0),
    skippedBottomExpandCount: Number(stats.skippedBottomExpandCount || 0),
    documentHeightBefore: Number(stats.documentHeightBefore || 0),
    documentHeightAfter: Number(stats.documentHeightAfter || 0),
    bodyTextLength: Number(stats.bodyTextLength || 0),
    roomKeywordCount: Number(stats.roomKeywordCount || 0)
  };
}

function toPerfFields(stats, trackedUrlCountBefore, trackedUrlCountAfter) {
  return {
    clicked_count: stats.clickedCount,
    early_stop_count: stats.earlyStopCount,
    empty_close_fast_path_count: stats.emptyCloseFastPathCount,
    initial_expand_fast_path_count: stats.initialExpandFastPathCount,
    scan_candidate_count: stats.scanCandidateCount,
    explicit_candidate_count: stats.explicitCandidateCount,
    generic_candidate_count: stats.genericCandidateCount,
    click_scan_elapsed_ms: stats.clickScanElapsedMs,
    explicit_scan_candidate_count: stats.explicitScanCandidateCount,
    fallback_scan_candidate_count: stats.fallbackScanCandidateCount,
    generic_fallback_scan_count: stats.genericFallbackScanCount,
    generic_fallback_suppressed_count: stats.genericFallbackSuppressedCount,
    room_section_detected_count: stats.roomSectionDetectedCount,
    room_section_scan_only_count: stats.roomSectionScanOnlyCount,
    non_room_section_reached_count: stats.nonRoomSectionReachedCount,
    room_section_element_count: stats.roomSectionElementCount,
    room_card_count: stats.roomCardCount,
    room_expand_button_count: stats.roomExpandButtonCount,
    room_section_start_y: stats.roomSectionStartY,
    room_section_end_y: stats.roomSectionEndY,
    selector_scan_count: stats.selectorScanCount,
    selector_scan_elapsed_ms: stats.selectorScanElapsedMs,
    slowest_selector_scan_label: stats.slowestSelectorScanLabel,
    slowest_selector_scan_elapsed_ms: stats.slowestSelectorScanElapsedMs,
    slowest_selector_scan_candidate_count: stats.slowestSelectorScanCandidateCount,
    skipped_duplicate_click_count: stats.skippedDuplicateClickCount,
    generic_click_count: stats.genericClickCount,
    scroll_count: stats.scrollCount,
    container_count: stats.containerCount,
    likely_container_count: stats.likelyContainerCount,
    fallback_container_count: stats.fallbackContainerCount,
    skipped_bottom_expand_count: stats.skippedBottomExpandCount,
    document_height_before: stats.documentHeightBefore,
    document_height_after: stats.documentHeightAfter,
    body_text_length: stats.bodyTextLength,
    room_keyword_count: stats.roomKeywordCount,
    tracked_url_count_before: trackedUrlCountBefore,
    tracked_url_count_after: trackedUrlCountAfter
  };
}

function mergeStepStats(aggregate, stats) {
  aggregate.clickedCount += stats.clickedCount;
  aggregate.earlyStopCount += stats.earlyStopCount;
  aggregate.emptyCloseFastPathCount += stats.emptyCloseFastPathCount;
  aggregate.initialExpandFastPathCount += stats.initialExpandFastPathCount;
  aggregate.scanCandidateCount += stats.scanCandidateCount;
  aggregate.explicitCandidateCount += stats.explicitCandidateCount;
  aggregate.genericCandidateCount += stats.genericCandidateCount;
  aggregate.clickScanElapsedMs += stats.clickScanElapsedMs;
  aggregate.explicitScanCandidateCount += stats.explicitScanCandidateCount;
  aggregate.fallbackScanCandidateCount += stats.fallbackScanCandidateCount;
  aggregate.genericFallbackScanCount += stats.genericFallbackScanCount;
  aggregate.genericFallbackSuppressedCount += stats.genericFallbackSuppressedCount;
  aggregate.roomSectionDetectedCount += stats.roomSectionDetectedCount;
  aggregate.roomSectionScanOnlyCount += stats.roomSectionScanOnlyCount;
  aggregate.nonRoomSectionReachedCount += stats.nonRoomSectionReachedCount;
  aggregate.roomSectionElementCount = Math.max(
    aggregate.roomSectionElementCount,
    stats.roomSectionElementCount
  );
  aggregate.roomCardCount = Math.max(aggregate.roomCardCount, stats.roomCardCount);
  aggregate.roomExpandButtonCount = Math.max(
    aggregate.roomExpandButtonCount,
    stats.roomExpandButtonCount
  );
  aggregate.roomSectionStartY = stats.roomSectionStartY || aggregate.roomSectionStartY;
  aggregate.roomSectionEndY = stats.roomSectionEndY || aggregate.roomSectionEndY;
  aggregate.selectorScanCount += stats.selectorScanCount;
  aggregate.selectorScanElapsedMs += stats.selectorScanElapsedMs;
  if (stats.slowestSelectorScanElapsedMs > aggregate.slowestSelectorScanElapsedMs) {
    aggregate.slowestSelectorScanLabel = stats.slowestSelectorScanLabel;
    aggregate.slowestSelectorScanElapsedMs = stats.slowestSelectorScanElapsedMs;
    aggregate.slowestSelectorScanCandidateCount = stats.slowestSelectorScanCandidateCount;
  }
  aggregate.skippedDuplicateClickCount += stats.skippedDuplicateClickCount;
  aggregate.genericClickCount += stats.genericClickCount;
  aggregate.scrollCount += stats.scrollCount;
  aggregate.containerCount = Math.max(aggregate.containerCount, stats.containerCount);
  aggregate.likelyContainerCount += stats.likelyContainerCount;
  aggregate.fallbackContainerCount += stats.fallbackContainerCount;
  aggregate.skippedBottomExpandCount += stats.skippedBottomExpandCount;
  if (!aggregate.documentHeightBefore && stats.documentHeightBefore) {
    aggregate.documentHeightBefore = stats.documentHeightBefore;
  }
  aggregate.documentHeightAfter = stats.documentHeightAfter || aggregate.documentHeightAfter;
  aggregate.bodyTextLength = stats.bodyTextLength || aggregate.bodyTextLength;
  aggregate.roomKeywordCount = stats.roomKeywordCount || aggregate.roomKeywordCount;
}

function shouldSkipBottomExpandAfterStableSettle(aggregate) {
  const containerStats = aggregate.steps.edge_settle_scroll_containers;
  if (!containerStats) {
    return false;
  }

  const heightStable =
    containerStats.documentHeightBefore > 0 &&
    Math.abs(containerStats.documentHeightAfter - containerStats.documentHeightBefore) <= 24;
  const noNewExpansion =
    containerStats.clickedCount === 0 && containerStats.genericClickCount === 0;
  const roomContainerWasTargeted =
    containerStats.likelyContainerCount > 0 && containerStats.fallbackContainerCount === 0;

  return (
    heightStable &&
    noNewExpansion &&
    roomContainerWasTargeted &&
    containerStats.roomKeywordCount > 0
  );
}

function buildSkippedBottomExpandStats(aggregate) {
  const containerStats = aggregate.steps.edge_settle_scroll_containers || {};
  const documentHeight =
    containerStats.documentHeightAfter ||
    aggregate.documentHeightAfter ||
    containerStats.documentHeightBefore ||
    0;
  return normalizeStepStats({
    skippedBottomExpandCount: 1,
    documentHeightBefore: documentHeight,
    documentHeightAfter: documentHeight,
    bodyTextLength: containerStats.bodyTextLength || aggregate.bodyTextLength || 0,
    roomKeywordCount: containerStats.roomKeywordCount || aggregate.roomKeywordCount || 0
  });
}

function getRoomApiFastSettleThreshold(options = {}) {
  const value = Number(options.roomApiFastSettleThreshold);
  if (Number.isFinite(value) && value > 0) {
    return Math.max(1, Math.trunc(value));
  }
  return 1;
}

function shouldSkipRemainingSettleAfterRoomApi(stepPhase, options = {}) {
  if (options.roomApiFastSettle === false) {
    return false;
  }

  const fastSettleGatePhases = new Set([
    'edge_settle_close_panels',
    'edge_settle_initial_expand',
    'edge_settle_main_scroll',
    'edge_settle_scroll_containers'
  ]);
  if (!fastSettleGatePhases.has(stepPhase)) {
    return false;
  }

  const getFastSettleCount =
    typeof options.getReadableRoomResponseCount === 'function'
      ? options.getReadableRoomResponseCount
      : options.getRoomTrackedUrlCount;

  if (typeof getFastSettleCount !== 'function') {
    return false;
  }

  return Number(getFastSettleCount() || 0) >= getRoomApiFastSettleThreshold(options);
}

function buildRoomApiFastPathSkippedStats(aggregate, stepPhase) {
  const documentHeight = aggregate.documentHeightAfter || aggregate.documentHeightBefore || 0;
  return normalizeStepStats({
    skippedBottomExpandCount: stepPhase === 'edge_settle_bottom_expand' ? 1 : 0,
    documentHeightBefore: documentHeight,
    documentHeightAfter: documentHeight,
    bodyTextLength: aggregate.bodyTextLength || 0,
    roomKeywordCount: aggregate.roomKeywordCount || 0
  });
}

function getTransientSettleRetryReason(error) {
  const message = error && error.message ? String(error.message) : String(error || '');
  if (/Execution context was destroyed|Cannot find context with specified id/i.test(message)) {
    return 'execution_context_destroyed';
  }
  return '';
}

async function runSettleStep({
  connection,
  sessionId,
  perf,
  phase,
  baseFields,
  getTrackedUrlCount,
  body,
  signal,
  evaluateTimeoutMs
}) {
  const trackedUrlCountBefore = getTrackedUrlCount();
  const phaseTimer = perf.phase(phase, {
    ...baseFields,
    tracked_url_count_before: trackedUrlCountBefore
  });
  let retryCount = 0;
  let retryReason = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await evaluateInSession(
        connection,
        sessionId,
        buildSessionSettleStepExpression(body),
        {
          timeoutMs:
            Number.isFinite(evaluateTimeoutMs) && evaluateTimeoutMs > 0 ? evaluateTimeoutMs : 6000,
          signal: signal || null
        }
      );
      const stats = normalizeStepStats(parseStepResult(result));
      const trackedUrlCountAfter = getTrackedUrlCount();
      phaseTimer.end('success', {
        ...toPerfFields(stats, trackedUrlCountBefore, trackedUrlCountAfter),
        retry_count: retryCount,
        retry_reason: retryReason
      });
      return stats;
    } catch (error) {
      retryReason = getTransientSettleRetryReason(error);
      if (retryReason && attempt === 0 && !(signal && signal.aborted)) {
        retryCount += 1;
        if (perf && typeof perf.event === 'function') {
          perf.event('edge_settle_step_retry', {
            ...baseFields,
            phase,
            retry_count: retryCount,
            retry_reason: retryReason
          });
        }
        await sleep(120);
        continue;
      }
      phaseTimer.error(error, {
        tracked_url_count_before: trackedUrlCountBefore,
        tracked_url_count_after: getTrackedUrlCount(),
        retry_count: retryCount,
        retry_reason: retryReason
      });
      throw error;
    }
  }

  throw new Error(`Failed to run settle step ${phase}`);
}

async function settleRoomListInEdgeSession(connection, sessionId, options = {}) {
  const perf = options.perf || createNoopPerf();
  const baseFields = options.fields || {};
  const getTrackedUrlCount =
    typeof options.getTrackedUrlCount === 'function' ? options.getTrackedUrlCount : () => 0;
  const assertNotAborted = () => {
    if (options.signal && options.signal.aborted) {
      throw createCdpAbortError('settleRoomListInEdgeSession');
    }
  };
  const startedAt = Date.now();
  const aggregate = {
    totalMs: 0,
    clickedCount: 0,
    earlyStopCount: 0,
    emptyCloseFastPathCount: 0,
    initialExpandFastPathCount: 0,
    scanCandidateCount: 0,
    explicitCandidateCount: 0,
    genericCandidateCount: 0,
    clickScanElapsedMs: 0,
    explicitScanCandidateCount: 0,
    fallbackScanCandidateCount: 0,
    genericFallbackScanCount: 0,
    genericFallbackSuppressedCount: 0,
    roomSectionDetectedCount: 0,
    roomSectionScanOnlyCount: 0,
    nonRoomSectionReachedCount: 0,
    roomSectionElementCount: 0,
    roomCardCount: 0,
    roomExpandButtonCount: 0,
    roomSectionStartY: 0,
    roomSectionEndY: 0,
    selectorScanCount: 0,
    selectorScanElapsedMs: 0,
    slowestSelectorScanLabel: '',
    slowestSelectorScanElapsedMs: 0,
    slowestSelectorScanCandidateCount: 0,
    skippedDuplicateClickCount: 0,
    genericClickCount: 0,
    scrollCount: 0,
    containerCount: 0,
    likelyContainerCount: 0,
    fallbackContainerCount: 0,
    skippedBottomExpandCount: 0,
    documentHeightBefore: 0,
    documentHeightAfter: 0,
    bodyTextLength: 0,
    roomKeywordCount: 0,
    apiFastPathSkippedStepCount: 0,
    apiFastPathSettleActive: false,
    steps: {}
  };

  const steps = [
    {
      phase: 'edge_settle_close_panels',
      body: `
        const before = collectStats();
        const clickedCount = closeReviewPanels();
        let emptyCloseFastPathCount = 0;
        if (clickedCount > 0) {
          await waitForDomIdle(180, 700);
        } else {
          emptyCloseFastPathCount = 1;
          await sleep(35);
        }
        window.scrollTo({ top: 0, behavior: 'instant' });
        await sleep(clickedCount > 0 ? 120 : 35);
        return JSON.stringify(finishStats(before, { clickedCount, emptyCloseFastPathCount, scrollCount: 1 }));
      `
    },
    {
      phase: 'edge_settle_initial_expand',
      body: `
        const before = collectStats();
        window.scrollTo({ top: 0, behavior: 'instant' });
        await sleep(90);
        const clickStats = clickExpandButtons();
        let initialExpandFastPathCount = 0;
        if (clickStats.clickedCount > 0) {
          await waitForDomIdle(200, 800);
        } else {
          initialExpandFastPathCount = 1;
          await sleep(55);
        }
        return JSON.stringify(finishStats(before, { ...clickStats, initialExpandFastPathCount, scrollCount: 1 }));
      `
    },
    {
      phase: 'edge_settle_main_scroll',
      body: `
        const before = collectStats();
        const maxScroll = getDocumentHeight();
        const steps = 6;
        let previousHeight = maxScroll;
        let stableHeightRounds = 0;
        let clickedCount = 0;
        let earlyStopCount = 0;
        let skippedDuplicateClickCount = 0;
        let genericClickCount = 0;
        let scanCandidateCount = 0;
        let explicitCandidateCount = 0;
        let genericCandidateCount = 0;
        let clickScanElapsedMs = 0;
        let explicitScanCandidateCount = 0;
        let fallbackScanCandidateCount = 0;
        let genericFallbackScanCount = 0;
        let genericFallbackSuppressedCount = 0;
        let roomSectionDetectedCount = 0;
        let roomSectionScanOnlyCount = 0;
        let nonRoomSectionReachedCount = 0;
        let roomSectionElementCount = 0;
        let roomCardCount = 0;
        let roomExpandButtonCount = 0;
        let roomSectionStartY = 0;
        let roomSectionEndY = 0;
        let scrollCount = 0;
        let previousRoomKeywordCount = before.roomKeywordCount;
        let stableRoomSignalRounds = 0;
        for (let index = 0; index <= steps; index += 1) {
          const currentMaxScroll = getDocumentHeight();
          const y = Math.round((currentMaxScroll * index) / steps);
          window.scrollTo({ top: y, behavior: 'instant' });
          scrollCount += 1;
          await sleep(150);
          const preClickStats = collectStats();
          const roomSignalStableBeforeClick =
            preClickStats.roomKeywordCount >= 4 &&
            Math.abs(preClickStats.roomKeywordCount - previousRoomKeywordCount) <= 2;
          const allowGenericFallback = index >= 2 && roomSignalStableBeforeClick;
          const clicked = clickExpandButtons({ allowGenericFallback });
          clickedCount += clicked.clickedCount;
          skippedDuplicateClickCount += clicked.skippedDuplicateClickCount;
          genericClickCount += clicked.genericClickCount;
          scanCandidateCount += clicked.scanCandidateCount;
          explicitCandidateCount += clicked.explicitCandidateCount;
          genericCandidateCount += clicked.genericCandidateCount;
          clickScanElapsedMs += clicked.clickScanElapsedMs;
          explicitScanCandidateCount += clicked.explicitScanCandidateCount;
          fallbackScanCandidateCount += clicked.fallbackScanCandidateCount;
          genericFallbackScanCount += clicked.genericFallbackScanCount;
          genericFallbackSuppressedCount += clicked.genericFallbackSuppressedCount;
          roomSectionDetectedCount += clicked.roomSectionDetectedCount;
          roomSectionScanOnlyCount += clicked.roomSectionScanOnlyCount;
          nonRoomSectionReachedCount += clicked.nonRoomSectionReachedCount;
          roomSectionElementCount = Math.max(roomSectionElementCount, clicked.roomSectionElementCount);
          roomCardCount = Math.max(roomCardCount, clicked.roomCardCount);
          roomExpandButtonCount = Math.max(roomExpandButtonCount, clicked.roomExpandButtonCount);
          roomSectionStartY = clicked.roomSectionStartY || roomSectionStartY;
          roomSectionEndY = clicked.roomSectionEndY || roomSectionEndY;
          if (clicked.clickedCount > 0) {
            await waitForDomIdle(180, 750);
          } else {
            await sleep(45);
          }
          const currentStats = collectStats();
          const currentHeight = currentStats.documentHeight;
          if (Math.abs(currentHeight - previousHeight) <= 24) {
            stableHeightRounds += 1;
          } else {
            stableHeightRounds = 0;
          }
          previousHeight = currentHeight;
          if (
            currentStats.roomKeywordCount >= 4 &&
            Math.abs(currentStats.roomKeywordCount - previousRoomKeywordCount) <= 2
          ) {
            stableRoomSignalRounds += 1;
          } else {
            stableRoomSignalRounds = 0;
          }
          previousRoomKeywordCount = currentStats.roomKeywordCount;
          const noNewExpansion = clicked.clickedCount === 0 && clicked.genericClickCount === 0;
          if (
            stableHeightRounds >= 1 &&
            stableRoomSignalRounds >= 1 &&
            noNewExpansion &&
            index >= 2
          ) {
            earlyStopCount = 1;
            break;
          }
          if (stableHeightRounds >= 2 && noNewExpansion && index >= Math.floor(steps / 2)) {
            earlyStopCount = 1;
            break;
          }
        }
        return JSON.stringify(finishStats(before, {
          clickedCount,
          earlyStopCount,
          skippedDuplicateClickCount,
          genericClickCount,
          scanCandidateCount,
          explicitCandidateCount,
          genericCandidateCount,
          clickScanElapsedMs,
          explicitScanCandidateCount,
          fallbackScanCandidateCount,
          genericFallbackScanCount,
          genericFallbackSuppressedCount,
          roomSectionDetectedCount,
          roomSectionScanOnlyCount,
          nonRoomSectionReachedCount,
          roomSectionElementCount,
          roomCardCount,
          roomExpandButtonCount,
          roomSectionStartY,
          roomSectionEndY,
          scrollCount
        }));
      `
    },
    {
      phase: 'edge_settle_scroll_containers',
      body: `
        const before = collectStats();
        const stats = await scrollAllContainers();
        return JSON.stringify(finishStats(before, stats));
      `
    },
    {
      phase: 'edge_settle_bottom_expand',
      body: `
        const before = collectStats();
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });
        await sleep(260);
        const clickStats = clickExpandButtons();
        if (clickStats.clickedCount > 0) {
          await waitForDomIdle(320, 1100);
        } else {
          await sleep(320);
        }
        return JSON.stringify(finishStats(before, { ...clickStats, scrollCount: 1 }));
      `
    },
    {
      phase: 'edge_settle_return_top',
      body: `
        const before = collectStats();
        window.scrollTo({ top: 0, behavior: 'instant' });
        await sleep(100);
        return JSON.stringify(finishStats(before, { scrollCount: 1 }));
      `
    }
  ];

  for (const step of steps) {
    assertNotAborted();
    if (aggregate.apiFastPathSettleActive) {
      const trackedUrlCount = getTrackedUrlCount();
      const roomTrackedUrlCount =
        typeof options.getRoomTrackedUrlCount === 'function'
          ? Number(options.getRoomTrackedUrlCount() || 0)
          : null;
      const readableRoomResponseCount =
        typeof options.getReadableRoomResponseCount === 'function'
          ? Number(options.getReadableRoomResponseCount() || 0)
          : null;
      const phaseTimer = perf.phase(step.phase, {
        ...baseFields,
        tracked_url_count_before: trackedUrlCount
      });
      const stats = buildRoomApiFastPathSkippedStats(aggregate, step.phase);
      aggregate.steps[step.phase] = stats;
      aggregate.apiFastPathSkippedStepCount += 1;
      mergeStepStats(aggregate, stats);
      phaseTimer.end('skipped', {
        ...toPerfFields(stats, trackedUrlCount, trackedUrlCount),
        room_tracked_url_count: roomTrackedUrlCount,
        readable_room_response_count: readableRoomResponseCount,
        skip_reason: 'room_api_fast_path'
      });
      continue;
    }

    if (
      step.phase === 'edge_settle_bottom_expand' &&
      shouldSkipBottomExpandAfterStableSettle(aggregate)
    ) {
      const trackedUrlCount = getTrackedUrlCount();
      const phaseTimer = perf.phase(step.phase, {
        ...baseFields,
        tracked_url_count_before: trackedUrlCount
      });
      const stats = buildSkippedBottomExpandStats(aggregate);
      aggregate.steps[step.phase] = stats;
      mergeStepStats(aggregate, stats);
      phaseTimer.end('skipped', {
        ...toPerfFields(stats, trackedUrlCount, trackedUrlCount),
        skip_reason: 'stable_after_room_container_scroll'
      });
      continue;
    }

    const stats = await runSettleStep({
      connection,
      sessionId,
      perf,
      phase: step.phase,
      baseFields,
      getTrackedUrlCount,
      body: step.body,
      signal: options.signal || null,
      evaluateTimeoutMs: options.evaluateTimeoutMs
    });
    aggregate.steps[step.phase] = stats;
    mergeStepStats(aggregate, stats);
    if (typeof options.onSettleStepComplete === 'function') {
      options.onSettleStepComplete(step.phase, stats);
    }
    if (shouldSkipRemainingSettleAfterRoomApi(step.phase, options)) {
      aggregate.apiFastPathSettleActive = true;
    }
  }

  aggregate.totalMs = Date.now() - startedAt;
  return aggregate;
}

module.exports = {
  settleRoomListInEdgeSession
};
