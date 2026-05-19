/**
 * ctrip-scraper.js — Coordinator module
 *
 * Orchestrates a three-layer scraping strategy (HTML → API replay → Edge CDP)
 * to extract hotel room data from Ctrip.  All low-level logic lives in the
 * submodules under ./scraper/.
 */

const path = require('path');
const { normalizeText, pickFirst, slugify } = require('./utils');
const {
  buildDesktopUrl,
  buildMobileUrl,
  buildUrlOverridesFromTemplate,
  parseHotelIdFromUrl
} = require('./ctrip-url');
const {
  extractHotelMetaFromHtml,
  extractHotelScoreFromHtml,
  findRoomBlocksFromHtml,
  fetchHtml,
  loadHtmlFromFile,
  saveHtmlSnapshot,
  DESKTOP_HEADERS,
  MOBILE_HEADERS
} = require('./scraper/html-parser');
const {
  mergeRoomCandidates,
  selectBestRoom,
  buildRoomSelectionDiagnostics,
  isPersistableRoomCandidate
} = require('./scraper/room-logic');
const { captureRoomCandidatesDirect } = require('./scraper/api-replay');
const {
  shouldAttemptSupplementalCapture,
  shouldPreferEdgeCapture,
  captureRoomCandidatesWithEdge
} = require('./scraper/edge-capture');
const { setup_perf_logger, PerfTimer } = require('./runtime/perf');

function durationSince(startedAt) {
  return Math.max(0, Date.now() - startedAt);
}

function sumSourceRoomCount(parsedSources = [], sourceName) {
  return parsedSources
    .filter((item) => !sourceName || item.source === sourceName)
    .reduce((sum, item) => sum + (Array.isArray(item.roomBlocks) ? item.roomBlocks.length : 0), 0);
}

function deriveWaitReason(roomBlocks = [], selectedRoom = null, template = {}, options = {}) {
  if (!selectedRoom) {
    const diagnostics = buildRoomSelectionDiagnostics(
      roomBlocks,
      template,
      options.matchingOptions || {}
    );
    return diagnostics.eligibleRooms && diagnostics.eligibleRooms.length > 0
      ? 'missing_selected_room'
      : 'no_eligible_rooms';
  }

  if (selectedRoom.price === null || selectedRoom.price === undefined) {
    return selectedRoom.price_locked ? 'hidden_or_locked_price' : 'missing_price';
  }

  if (
    options.autoEdge &&
    roomBlocks.some((room) => room && (room.price_locked || room.price === null))
  ) {
    return 'auto_edge_supplement';
  }

  return '';
}

function deriveCaptureMethod(captureSteps = []) {
  if (!captureSteps.length) {
    return 'html_only';
  }

  const hasEdge = captureSteps.includes('edge_cdp');
  const hasApi = captureSteps.includes('api_replay');
  if (hasEdge && hasApi) {
    return captureSteps.indexOf('edge_cdp') < captureSteps.indexOf('api_replay')
      ? 'edge_cdp_then_api_replay'
      : 'html_then_api_replay';
  }
  if (hasEdge) return 'html_then_edge_cdp';
  if (hasApi) return 'html_then_api_replay';
  return 'html_only';
}

function normalizeCaptureStrategy(value) {
  const normalized = String(value || 'auto')
    .trim()
    .toLowerCase();
  return ['auto', 'html_first', 'parallel_edge', 'edge_full'].includes(normalized)
    ? normalized
    : 'auto';
}

function normalizeSettleStats(settleStats = null) {
  if (!settleStats || typeof settleStats !== 'object') {
    return {
      totalMs: 0,
      clickedCount: 0,
      scrollCount: 0,
      containerCount: 0
    };
  }

  return {
    totalMs: Number(settleStats.totalMs ?? settleStats.total_ms ?? 0) || 0,
    clickedCount: Number(settleStats.clickedCount ?? settleStats.clicked_count ?? 0) || 0,
    scrollCount: Number(settleStats.scrollCount ?? settleStats.scroll_count ?? 0) || 0,
    containerCount: Number(settleStats.containerCount ?? settleStats.container_count ?? 0) || 0
  };
}

function buildScrapeQualityFields({
  selectedRoom,
  normalizedRoomBlocks,
  persistedRoomBlocks,
  eligibleRooms,
  parsedSources,
  directReplay,
  fallbackCapture,
  captureMethod,
  waitReason,
  captureStrategy = 'auto',
  htmlEdgeParallelUsed = false,
  edgeStartedBeforeHtmlDone = false,
  warnings = []
}) {
  const directTrackedUrls =
    directReplay && Array.isArray(directReplay.trackedUrls) ? directReplay.trackedUrls : [];
  const edgeTrackedUrls =
    fallbackCapture && Array.isArray(fallbackCapture.trackedUrls)
      ? fallbackCapture.trackedUrls
      : [];
  const spiderErrorCodes = [
    ...new Set([
      ...((directReplay && directReplay.spiderErrorCodes) || []),
      ...((fallbackCapture && fallbackCapture.spiderErrorCodes) || [])
    ])
  ];
  const settleStats = normalizeSettleStats(fallbackCapture && fallbackCapture.settleStats);

  return {
    selected_room_source: selectedRoom ? selectedRoom.source || '' : '',
    selected_room_price_locked: Boolean(selectedRoom && selectedRoom.price_locked),
    room_candidates_count: persistedRoomBlocks.length,
    eligible_room_count: eligibleRooms.length,
    raw_room_candidates_count: normalizedRoomBlocks.length,
    room_price_visible: Boolean(selectedRoom && selectedRoom.price !== null),
    spider_error_codes: spiderErrorCodes,
    tracked_url_count: new Set([...directTrackedUrls, ...edgeTrackedUrls]).size,
    edge_fallback_used: Boolean(fallbackCapture),
    api_replay_used: Boolean(directReplay),
    html_room_count: sumSourceRoomCount(parsedSources),
    mobile_room_count: sumSourceRoomCount(parsedSources, 'mobile'),
    desktop_room_count: sumSourceRoomCount(parsedSources, 'desktop'),
    capture_method: captureMethod,
    wait_reason: waitReason,
    capture_strategy: captureStrategy,
    html_edge_parallel_used: Boolean(htmlEdgeParallelUsed),
    edge_started_before_html_done: Boolean(edgeStartedBeforeHtmlDone),
    edge_waited_for_settle: Boolean(fallbackCapture && fallbackCapture.edgeWaitedForSettle),
    settle_total_ms: settleStats.totalMs,
    settle_clicked_count: settleStats.clickedCount,
    settle_scroll_count: settleStats.scrollCount,
    settle_container_count: settleStats.containerCount,
    warnings
  };
}

async function runHtmlCapture({ desktopUrl, mobileUrl, template, options, perf }) {
  const sources = [];
  const htmlStartedAt = Date.now();
  await perf.runPhase('page_open', { url: desktopUrl }, async () => {
    if (options.htmlPath) {
      sources.push({
        source: 'local-html',
        url: desktopUrl,
        html: loadHtmlFromFile(options.htmlPath),
        cookieHeader: ''
      });
    } else {
      const [desktopPage, mobilePage] = await perf.runPhase(
        'goto_url',
        { url: desktopUrl },
        async () =>
          Promise.all([
            fetchHtml(desktopUrl, DESKTOP_HEADERS),
            mobileUrl ? fetchHtml(mobileUrl, MOBILE_HEADERS) : Promise.resolve(null)
          ])
      );

      sources.push({
        source: 'desktop',
        url: desktopUrl,
        html: desktopPage.html,
        cookieHeader: desktopPage.cookieHeader
      });

      if (mobilePage) {
        sources.push({
          source: 'mobile',
          url: mobileUrl,
          html: mobilePage.html,
          cookieHeader: mobilePage.cookieHeader
        });
      }
    }
  });

  const { parsedSources, mergedRoomBlocks } = await perf.runPhase(
    'extract_data',
    { url: desktopUrl, hotelCount: sources.length },
    async () => {
      const nextParsedSources = sources.map((item) => ({
        ...item,
        meta: extractHotelMetaFromHtml(item.html, item.url),
        roomBlocks: findRoomBlocksFromHtml(item.html)
      }));

      const nextMergedRoomBlocks = [];
      const seen = new Set();
      for (const source of nextParsedSources) {
        for (const room of source.roomBlocks) {
          const key = `${room.title}-${room.occupancy || ''}-${room.price || ''}-${room.price_locked ? 'locked' : 'open'}`;
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          nextMergedRoomBlocks.push({
            ...room,
            source: source.source
          });
        }
      }

      return {
        parsedSources: nextParsedSources,
        mergedRoomBlocks: nextMergedRoomBlocks
      };
    }
  );

  const normalizedRoomBlocks = await perf.runPhase('parse_data', { url: desktopUrl }, async () =>
    mergeRoomCandidates(mergedRoomBlocks)
  );

  return {
    sources,
    parsedSources,
    mergedRoomBlocks,
    normalizedRoomBlocks,
    selectedRoom: selectBestRoom(normalizedRoomBlocks, template),
    htmlMs: durationSince(htmlStartedAt)
  };
}

async function runEdgeCapture({
  desktopUrl,
  template,
  options,
  perf,
  retryCount,
  waitReason,
  captureMethod,
  captureStrategy
}) {
  const edgeStartedAt = Date.now();
  const result = await perf.runPhase(
    'wait_data',
    {
      url: desktopUrl,
      retryCount,
      waitReason,
      captureMethod,
      capture_strategy: captureStrategy
    },
    async () =>
      captureRoomCandidatesWithEdge(desktopUrl, template, options.edgeSession || {}, {
        perf: perf.child({
          url: desktopUrl,
          waitReason,
          captureMethod,
          capture_strategy: captureStrategy
        }),
        captureMethod,
        captureStrategy
      })
  );

  return {
    result,
    elapsedMs: durationSince(edgeStartedAt)
  };
}

async function scrapeCtripHotel(url, template, options = {}) {
  const perf =
    options.perf ||
    new PerfTimer(setup_perf_logger(), {
      runId: options.runId,
      taskId: options.taskId,
      url
    });
  const totalStartedAt = Date.now();
  const performance = {
    totalMs: 0,
    htmlMs: 0,
    directReplayMs: 0,
    edgeCaptureMs: 0,
    waitDataMs: 0
  };
  const { desktopUrl, mobileUrl } = await perf.runPhase('build_url', { url }, async () => {
    const urlOverrides = buildUrlOverridesFromTemplate(template);
    const resolvedDesktopUrl = buildDesktopUrl(url, urlOverrides) || normalizeText(url);
    return {
      desktopUrl: resolvedDesktopUrl,
      mobileUrl: buildMobileUrl(resolvedDesktopUrl, urlOverrides)
    };
  });
  const captureStrategy = normalizeCaptureStrategy(options.captureStrategy);
  const basePreferEdgeCapture = shouldPreferEdgeCapture(options);
  const preferEdgeCapture = captureStrategy === 'html_first' ? false : basePreferEdgeCapture;
  const useParallelEdge =
    captureStrategy === 'parallel_edge' && basePreferEdgeCapture && !options.htmlPath;
  const warnings = [];
  let parsedSources = [];
  let normalizedRoomBlocks = [];
  let selectedRoom = null;
  let directReplay = null;
  let fallbackCapture = null;
  const captureSteps = [];
  let waitReason = '';
  let htmlEdgeParallelUsed = false;
  let edgeStartedBeforeHtmlDone = false;
  let htmlDone = false;

  const applyCaptureResult = (captureResult) => {
    if (
      !captureResult ||
      !Array.isArray(captureResult.roomBlocks) ||
      captureResult.roomBlocks.length === 0
    ) {
      return false;
    }

    normalizedRoomBlocks.splice(0, normalizedRoomBlocks.length, ...captureResult.roomBlocks);
    selectedRoom = captureResult.selectedRoom || selectBestRoom(normalizedRoomBlocks, template);
    return true;
  };

  const applyHtmlResult = (htmlResult) => {
    parsedSources = htmlResult.parsedSources;
    normalizedRoomBlocks = htmlResult.normalizedRoomBlocks;
    selectedRoom = htmlResult.selectedRoom;
    performance.htmlMs = htmlResult.htmlMs;
  };

  if (useParallelEdge) {
    htmlEdgeParallelUsed = true;
    const htmlTask = runHtmlCapture({ desktopUrl, mobileUrl, template, options, perf }).then(
      (htmlResult) => {
        htmlDone = true;
        return htmlResult;
      },
      (error) => {
        htmlDone = true;
        throw error;
      }
    );
    const edgeTask = (async () => {
      edgeStartedBeforeHtmlDone = !htmlDone;
      return runEdgeCapture({
        desktopUrl,
        template,
        options,
        perf,
        retryCount: 1,
        waitReason: 'auto_edge_supplement',
        captureMethod: 'html_then_edge_cdp',
        captureStrategy
      });
    })();

    const [htmlOutcome, edgeOutcome] = await Promise.allSettled([htmlTask, edgeTask]);
    if (htmlOutcome.status === 'fulfilled') {
      applyHtmlResult(htmlOutcome.value);
    } else {
      warnings.push(
        `HTML capture failed: ${htmlOutcome.reason && htmlOutcome.reason.message ? htmlOutcome.reason.message : String(htmlOutcome.reason)}`
      );
    }

    if (edgeOutcome.status === 'fulfilled') {
      fallbackCapture = edgeOutcome.value.result;
      performance.edgeCaptureMs += edgeOutcome.value.elapsedMs;
      performance.waitDataMs += edgeOutcome.value.elapsedMs;
      captureSteps.push('edge_cdp');
      if (fallbackCapture && fallbackCapture.error) {
        warnings.push(`Edge capture warning: ${fallbackCapture.error}`);
      }
      applyCaptureResult(fallbackCapture);
    } else {
      warnings.push(
        `Edge capture failed: ${edgeOutcome.reason && edgeOutcome.reason.message ? edgeOutcome.reason.message : String(edgeOutcome.reason)}`
      );
    }

    if (!parsedSources.length && (!selectedRoom || !fallbackCapture)) {
      throw htmlOutcome.reason || new Error('HTML and Edge capture both failed');
    }

    if (
      (!selectedRoom || selectedRoom.price === null) &&
      shouldAttemptSupplementalCapture(normalizedRoomBlocks, selectedRoom, template, options)
    ) {
      waitReason = fallbackCapture
        ? 'retry_after_edge_failed'
        : deriveWaitReason(normalizedRoomBlocks, selectedRoom, template, options);
      const replayStartedAt = Date.now();
      directReplay = await perf.runPhase(
        'wait_data',
        {
          url: desktopUrl,
          retryCount: 2,
          waitReason,
          captureMethod: 'edge_cdp_then_api_replay',
          capture_strategy: captureStrategy
        },
        async () =>
          captureRoomCandidatesDirect(desktopUrl, template, parsedSources, {
            perf: perf.child({
              url: desktopUrl,
              waitReason,
              captureMethod: 'edge_cdp_then_api_replay',
              capture_strategy: captureStrategy
            }),
            captureMethod: 'edge_cdp_then_api_replay'
          })
      );
      performance.directReplayMs += durationSince(replayStartedAt);
      performance.waitDataMs += durationSince(replayStartedAt);
      captureSteps.push('api_replay');
      applyCaptureResult(directReplay);
    }
  } else {
    const htmlResult = await runHtmlCapture({ desktopUrl, mobileUrl, template, options, perf });
    applyHtmlResult(htmlResult);
  }

  if (!useParallelEdge && preferEdgeCapture) {
    if (
      captureStrategy === 'edge_full' ||
      shouldAttemptSupplementalCapture(normalizedRoomBlocks, selectedRoom, template, options)
    ) {
      waitReason = deriveWaitReason(normalizedRoomBlocks, selectedRoom, template, options);
      const edgeCapture = await runEdgeCapture({
        desktopUrl,
        template,
        options,
        perf,
        retryCount: 1,
        waitReason,
        captureMethod: 'html_then_edge_cdp',
        captureStrategy
      });
      fallbackCapture = edgeCapture.result;
      performance.edgeCaptureMs += edgeCapture.elapsedMs;
      performance.waitDataMs += edgeCapture.elapsedMs;
      captureSteps.push('edge_cdp');
      applyCaptureResult(fallbackCapture);
    }

    if (
      (!selectedRoom || selectedRoom.price === null) &&
      shouldAttemptSupplementalCapture(normalizedRoomBlocks, selectedRoom, template, options)
    ) {
      waitReason = fallbackCapture
        ? 'retry_after_edge_failed'
        : deriveWaitReason(normalizedRoomBlocks, selectedRoom, template, options);
      const replayStartedAt = Date.now();
      directReplay = await perf.runPhase(
        'wait_data',
        {
          url: desktopUrl,
          retryCount: 2,
          waitReason,
          captureMethod: 'edge_cdp_then_api_replay',
          capture_strategy: captureStrategy
        },
        async () =>
          captureRoomCandidatesDirect(desktopUrl, template, parsedSources, {
            perf: perf.child({
              url: desktopUrl,
              waitReason,
              captureMethod: 'edge_cdp_then_api_replay',
              capture_strategy: captureStrategy
            }),
            captureMethod: 'edge_cdp_then_api_replay'
          })
      );
      performance.directReplayMs += durationSince(replayStartedAt);
      performance.waitDataMs += durationSince(replayStartedAt);
      captureSteps.push('api_replay');
      applyCaptureResult(directReplay);
    }
  } else if (!useParallelEdge) {
    if (shouldAttemptSupplementalCapture(normalizedRoomBlocks, selectedRoom, template, options)) {
      waitReason = deriveWaitReason(normalizedRoomBlocks, selectedRoom, template, options);
      const replayStartedAt = Date.now();
      directReplay = await perf.runPhase(
        'wait_data',
        {
          url: desktopUrl,
          retryCount: 1,
          waitReason,
          captureMethod: 'html_then_api_replay',
          capture_strategy: captureStrategy
        },
        async () =>
          captureRoomCandidatesDirect(desktopUrl, template, parsedSources, {
            perf: perf.child({
              url: desktopUrl,
              waitReason,
              captureMethod: 'html_then_api_replay',
              capture_strategy: captureStrategy
            }),
            captureMethod: 'html_then_api_replay'
          })
      );
      performance.directReplayMs += durationSince(replayStartedAt);
      performance.waitDataMs += durationSince(replayStartedAt);
      captureSteps.push('api_replay');
      applyCaptureResult(directReplay);
    }

    if (shouldAttemptSupplementalCapture(normalizedRoomBlocks, selectedRoom, template, options)) {
      waitReason = directReplay
        ? 'retry_after_api_failed'
        : deriveWaitReason(normalizedRoomBlocks, selectedRoom, template, options);
      const edgeCapture = await runEdgeCapture({
        desktopUrl,
        template,
        options,
        perf,
        retryCount: 2,
        waitReason,
        captureMethod: 'html_then_edge_cdp',
        captureStrategy
      });
      fallbackCapture = edgeCapture.result;
      performance.edgeCaptureMs += edgeCapture.elapsedMs;
      performance.waitDataMs += edgeCapture.elapsedMs;
      captureSteps.push('edge_cdp');
      applyCaptureResult(fallbackCapture);
    }
  }

  const primarySource = parsedSources.find((item) => item.meta.hotelName || item.meta.address) ||
    parsedSources[0] || { meta: {} };
  const resolvedScore = pickFirst(
    ...parsedSources.map((item) => item.meta.score),
    ...parsedSources.map((item) => extractHotelScoreFromHtml(item.html))
  );
  const shouldSaveSnapshots =
    !options.htmlPath && (options.saveHtml || !selectedRoom || selectedRoom.price === null);
  const snapshotDir = shouldSaveSnapshots
    ? path.resolve(options.snapshotDir || path.join('output', 'raw-pages'))
    : null;
  const snapshotStem = slugify(
    primarySource.meta.hotelName || parseHotelIdFromUrl(desktopUrl) || 'hotel-page'
  );
  const snapshotFiles = shouldSaveSnapshots
    ? parsedSources
        .map((item) => saveHtmlSnapshot(snapshotDir, snapshotStem, item.source, item.html))
        .filter(Boolean)
    : [];

  const persistedRoomBlocks = normalizedRoomBlocks.filter(isPersistableRoomCandidate);
  const selectionDiagnostics = buildRoomSelectionDiagnostics(
    normalizedRoomBlocks,
    template,
    options.matchingOptions || {}
  );
  const eligibleRooms = selectionDiagnostics.eligibleRooms;
  performance.totalMs = durationSince(totalStartedAt);
  const captureMethod = deriveCaptureMethod(captureSteps);
  const qualityFields = buildScrapeQualityFields({
    selectedRoom,
    normalizedRoomBlocks,
    persistedRoomBlocks,
    eligibleRooms,
    parsedSources,
    directReplay,
    fallbackCapture,
    captureMethod,
    waitReason,
    captureStrategy,
    htmlEdgeParallelUsed,
    edgeStartedBeforeHtmlDone,
    warnings
  });
  perf.event('detail_quality', {
    phase: 'task_total',
    status: selectedRoom ? 'success' : 'failed',
    url: desktopUrl,
    ...qualityFields
  });

  return {
    hotel_name: primarySource.meta.hotelName || '',
    address: pickFirst(
      primarySource.meta.geoInfo && primarySource.meta.geoInfo.address,
      primarySource.meta.address
    ),
    ctrip_score: resolvedScore,
    geo: primarySource.meta.geoInfo,
    room: selectedRoom,
    room_candidates: persistedRoomBlocks,
    raw_room_candidates: normalizedRoomBlocks,
    eligible_rooms: eligibleRooms,
    room_selection_diagnostics: selectionDiagnostics,
    quality: qualityFields,
    warnings,
    performance,
    page_snapshot: {
      source_url: desktopUrl,
      html_source: options.htmlPath || 'remote',
      room_candidates_count: persistedRoomBlocks.length,
      room_price_visible: Boolean(selectedRoom && selectedRoom.price !== null),
      selected_room_source: selectedRoom ? selectedRoom.source : '',
      sources: parsedSources
        .map((item) => ({
          source: item.source,
          url: item.url,
          room_candidates_count: item.roomBlocks.length,
          room_price_visible: item.roomBlocks.some((room) => room.price !== null),
          locked_price_detected: item.roomBlocks.some((room) => room.price_locked)
        }))
        .concat(
          directReplay
            ? [
                {
                  source: 'direct-room-list-replay',
                  url: desktopUrl,
                  room_candidates_count: directReplay.roomBlocks.length,
                  room_price_visible: directReplay.roomBlocks.some((room) => room.price !== null),
                  locked_price_detected: directReplay.roomBlocks.some((room) => room.price_locked),
                  tracked_urls: directReplay.trackedUrls,
                  spider_error_codes: directReplay.spiderErrorCodes || [],
                  attempts: directReplay.attempts || [],
                  error: directReplay.error || ''
                }
              ]
            : []
        )
        .concat(
          fallbackCapture
            ? [
                {
                  source: 'edge-cdp',
                  url: desktopUrl,
                  room_candidates_count: fallbackCapture.roomBlocks.length,
                  room_price_visible: fallbackCapture.roomBlocks.some(
                    (room) => room.price !== null
                  ),
                  locked_price_detected: fallbackCapture.roomBlocks.some(
                    (room) => room.price_locked
                  ),
                  tracked_urls: fallbackCapture.trackedUrls,
                  spider_error_codes: fallbackCapture.spiderErrorCodes || [],
                  error: fallbackCapture.error || ''
                }
              ]
            : []
        ),
      selected_room_price_locked: Boolean(selectedRoom && selectedRoom.price_locked),
      ...qualityFields,
      performance,
      saved_html_files: snapshotFiles
    }
  };
}

module.exports = {
  scrapeCtripHotel
};
