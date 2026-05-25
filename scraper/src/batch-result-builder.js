const { getCompareAppStorePath } = require('./compare-app-bridge');
const { buildTemplateSnapshot } = require('./task-context');
const { sanitizeSensitiveData } = require('./utils');

function summarizeSnapshotSources(pageSnapshot = {}) {
  return Array.isArray(pageSnapshot.sources)
    ? pageSnapshot.sources
        .filter((source) => source && typeof source === 'object')
        .map((source) => ({
          source: source.source || '',
          room_candidates_count: source.room_candidates_count ?? 0,
          room_price_visible: Boolean(source.room_price_visible),
          locked_price_detected: Boolean(source.locked_price_detected),
          tracked_url_count: source.tracked_url_count ?? 0,
          attempt_count: source.attempt_count ?? 0,
          spider_error_codes: Array.isArray(source.spider_error_codes)
            ? source.spider_error_codes
            : [],
          error: source.error || ''
        }))
    : [];
}

function findSnapshotSource(pageSnapshot = {}, sourceName = '') {
  return summarizeSnapshotSources(pageSnapshot).find((source) => source.source === sourceName);
}

function deriveUncollectedHotelReason(childResult = {}) {
  const pageSnapshot = childResult.pageSnapshot || {};
  const sources = summarizeSnapshotSources(pageSnapshot);
  const sourceErrors = sources
    .filter((source) => source.error)
    .map((source) => `${source.source}: ${source.error}`);
  const edgeSource = findSnapshotSource(pageSnapshot, 'edge-cdp');
  const apiSource = findSnapshotSource(pageSnapshot, 'direct-room-list-replay');
  const roomCandidateCount = Number(pageSnapshot.room_candidates_count || 0);
  const rawRoomCandidateCount = Number(pageSnapshot.raw_room_candidates_count || 0);
  const roomPriceVisible = Boolean(pageSnapshot.room_price_visible);

  if (childResult.success === false) {
    return {
      reason: 'collection_failed',
      detail: childResult.error || '详情采集任务失败。'
    };
  }

  if (pageSnapshot.edge_fallback_used && edgeSource && edgeSource.error) {
    return {
      reason: 'edge_capture_failed',
      detail: edgeSource.error
    };
  }

  if (pageSnapshot.api_replay_used && apiSource && apiSource.error && !roomPriceVisible) {
    return {
      reason: 'api_replay_failed',
      detail: apiSource.error
    };
  }

  if (roomCandidateCount > 0 && !roomPriceVisible) {
    return {
      reason: 'missing_price',
      detail: sourceErrors[0] || '已识别房型，但没有采到可见价格。'
    };
  }

  if (roomPriceVisible && roomCandidateCount > 0) {
    return {
      reason: 'no_eligible_rooms',
      detail: '已采到有价格房型，但没有房型满足当前模板和写入规则。'
    };
  }

  if (rawRoomCandidateCount > 0) {
    return {
      reason: 'no_persistable_room_candidates',
      detail: '采到原始房型候选，但没有可写入的标准化房型。'
    };
  }

  return {
    reason: 'no_room_candidates',
    detail: sourceErrors[0] || '详情页没有解析到房型候选。'
  };
}

function buildUncollectedHotelPerfRecord({ index, hotelInput = {}, childResult = {}, durationMs }) {
  const eligibleCount = Number(childResult.eligibleCount || 0);
  if (eligibleCount > 0) {
    return null;
  }

  const pageSnapshot = childResult.pageSnapshot || {};
  const reason = deriveUncollectedHotelReason(childResult);
  const sources = summarizeSnapshotSources(pageSnapshot);

  return {
    index,
    hotelId: childResult.hotelId || hotelInput.hotelId || '',
    hotelName: childResult.hotelName || '',
    url: childResult.resolvedUrl || hotelInput.url || '',
    requested_url: childResult.requestedUrl || hotelInput.requestedUrl || hotelInput.url || '',
    output_path: childResult.outputPath || '',
    duration_ms: Number(durationMs || 0),
    eligible_count: eligibleCount,
    total_price: childResult.totalPrice ?? null,
    selected_room_type: childResult.roomType || '',
    selected_room_source: pageSnapshot.selected_room_source || '',
    selected_room_price_locked: Boolean(pageSnapshot.selected_room_price_locked),
    room_price_visible: Boolean(pageSnapshot.room_price_visible),
    room_candidates_count: pageSnapshot.room_candidates_count ?? 0,
    raw_room_candidates_count: pageSnapshot.raw_room_candidates_count ?? 0,
    eligible_room_count: pageSnapshot.eligible_room_count ?? eligibleCount,
    tracked_url_count: pageSnapshot.tracked_url_count ?? 0,
    edge_fallback_used: Boolean(pageSnapshot.edge_fallback_used),
    api_replay_used: Boolean(pageSnapshot.api_replay_used),
    capture_method: pageSnapshot.capture_method || '',
    wait_reason: pageSnapshot.wait_reason || '',
    capture_strategy: pageSnapshot.capture_strategy || '',
    uncollected_reason: reason.reason,
    uncollected_reason_detail: reason.detail,
    source_errors: sources
      .filter((source) => source.error)
      .map((source) => ({
        source: source.source,
        error: source.error
      })),
    source_summary: sources.map((source) => ({
      source: source.source,
      room_candidates_count: source.room_candidates_count,
      room_price_visible: source.room_price_visible,
      tracked_url_count: source.tracked_url_count,
      error: source.error
    })),
    warnings: Array.isArray(childResult.warnings) ? childResult.warnings : []
  };
}

function buildBatchItems(childResults = [], failedItems = []) {
  const items = [
    ...childResults.map((result, index) => ({
      index: result.inputIndex || index + 1,
      success: result.success === true,
      url: result.resolvedUrl || result.requestedUrl || '',
      requestedUrl: result.requestedUrl || '',
      resolvedUrl: result.resolvedUrl || '',
      source: result.inputSource || '',
      hotelId: result.hotelId || '',
      hotelName: result.hotelName || '',
      eligibleCount: result.eligibleCount || 0,
      eligibleRoomTypes: Array.isArray(result.eligibleRoomTypes) ? result.eligibleRoomTypes : [],
      totalPrice: result.totalPrice ?? null,
      roomPrices: Array.isArray(result.roomPrices) ? result.roomPrices : [],
      pageSnapshot: result.pageSnapshot || null,
      outputPath: result.outputPath || '',
      writeResult: result.writeResult || null,
      error: result.error || ''
    })),
    ...failedItems.map((item, index) => ({
      index: item.index || childResults.length + index + 1,
      success: false,
      url: item.url || '',
      requestedUrl: item.url || '',
      resolvedUrl: '',
      source: item.source || '',
      hotelId: item.hotelId || '',
      hotelName: '',
      eligibleCount: 0,
      eligibleRoomTypes: [],
      totalPrice: null,
      roomPrices: [],
      pageSnapshot: null,
      outputPath: '',
      writeResult: null,
      error: item.error || ''
    }))
  ];

  return items.sort((left, right) => left.index - right.index);
}

function buildBatchOutputPayload({
  args,
  template,
  matchedTemplate,
  effectiveTemplate,
  compareAppSettings,
  expandedInputs,
  resultPayloads,
  childResults,
  failedItems,
  allHotels,
  writeResult,
  performance,
  reportLevel = 'normal',
  listResultsSummary
}) {
  const firstPayload = resultPayloads[0] || {};
  const firstHotel = allHotels[0] || firstPayload.hotel || null;
  const batchStats = {
    ...(expandedInputs.summary || {}),
    succeededCount: childResults.length,
    failedCount: failedItems.length,
    eligibleHotelRecordCount: allHotels.length,
    performance: performance || null
  };

  const isFullReport = reportLevel === 'full';

  const payload = {
    hotels: isFullReport ? allHotels : allHotels.slice(0, 5),
    hotel: firstHotel,
    compare_app_store: getCompareAppStorePath(),
    matched_template: matchedTemplate,
    effective_template: effectiveTemplate,
    compare_app_settings: compareAppSettings,
    batchMode: true,
    reportLevel,
    items: buildBatchItems(childResults, failedItems),
    batchStats,
    batch: {
      inputMode: expandedInputs.inputMode,
      requestedUrls: expandedInputs.requestedUrls,
      expandedHotelUrls: expandedInputs.hotelInputs.map((item) => item.url),
      summary: expandedInputs.summary,
      listResultsSummary: listResultsSummary || undefined,
      listResults: isFullReport ? expandedInputs.listResults : undefined,
      skippedUrls: expandedInputs.skippedUrls,
      succeededCount: childResults.length,
      failedCount: failedItems.length,
      stats: batchStats,
      failedItems
    },
    scrape_debug: {
      requested_url: template.ctrip_url,
      requested_urls: expandedInputs.requestedUrls,
      resolved_urls: expandedInputs.hotelInputs.map((item) => item.url),
      batch_results: isFullReport ? childResults : undefined,
      failed_items: failedItems,
      write_result: writeResult || null,
      list_prefilter: {
        summary: expandedInputs.summary,
        resultsSummary: listResultsSummary || undefined,
        results: isFullReport ? expandedInputs.listResults : undefined
      },
      source_args: {
        targetCount: args.targetCount ?? args['target-count'] ?? null
      },
      performance: performance || null
    }
  };

  if (isFullReport) {
    payload.scrape_debug.item_debug = resultPayloads
      .map((payload) => payload.scrape_debug)
      .filter(Boolean);
  } else {
    payload.scrape_debug.item_debug_count = resultPayloads.length;
  }

  return sanitizeSensitiveData(payload);
}

function buildBatchResult({
  startedAt,
  outputPath,
  effectiveTemplate,
  matchedTemplate,
  expandedInputs,
  allHotels,
  childResults,
  failedItems,
  compareAppSettings,
  writeResult,
  cleanupResult,
  performance,
  reportLevel = 'normal'
}) {
  const firstHotel = allHotels[0] || {};
  const firstResult = childResults[0] || {};
  const firstRoom = Array.isArray(firstResult.eligibleRoomTypes)
    ? firstResult.eligibleRoomTypes[0] || {}
    : {};
  const finishedAt = new Date().toISOString();
  const batchSummary = {
    ...(expandedInputs.summary || {}),
    succeededCount: childResults.length,
    failedCount: failedItems.length,
    eligibleHotelRecordCount: allHotels.length,
    performance: performance || null
  };

  return {
    success: true,
    batchMode: true,
    startedAt,
    finishedAt,
    outputPath,
    compareAppStorePath: getCompareAppStorePath(),
    templateName: effectiveTemplate.template_name,
    templateId: firstHotel.template_id ?? effectiveTemplate.template_id ?? null,
    requestedUrl: (expandedInputs.requestedUrls || [])[0] || '',
    requestedUrls: expandedInputs.requestedUrls || [],
    resolvedUrl:
      (expandedInputs.hotelInputs &&
        expandedInputs.hotelInputs[0] &&
        expandedInputs.hotelInputs[0].url) ||
      '',
    resolvedUrls: expandedInputs.hotelInputs.map((item) => item.url),
    inputMode: expandedInputs.inputMode,
    batchSummary,
    batchStats: batchSummary,
    items: buildBatchItems(childResults, failedItems),
    templateSnapshot: {
      matchedTemplate: buildTemplateSnapshot(
        matchedTemplate,
        matchedTemplate ? 'store.templates' : ''
      ),
      effectiveTemplate: buildTemplateSnapshot(effectiveTemplate, 'effective-template')
    },
    hotelName: firstHotel.name || firstResult.hotelName || '',
    eligibleCount: allHotels.length,
    eligibleHotels: allHotels,
    eligibleRoomTypes: childResults.flatMap((result) =>
      Array.isArray(result.eligibleRoomTypes) ? result.eligibleRoomTypes : []
    ),
    roomType: firstHotel.room_type || firstResult.roomType || firstRoom.roomType || '',
    roomOccupancy: firstHotel.room_count ?? firstResult.roomOccupancy ?? null,
    roomPrices: firstResult.roomPrices || [],
    totalPrice: firstHotel.total_price ?? firstResult.totalPrice ?? null,
    ctripScore: firstHotel.ctrip_score ?? firstResult.ctripScore ?? null,
    distance: firstHotel.distance ?? firstResult.distance ?? '',
    subwayDistance: firstHotel.subway_distance ?? firstResult.subwayDistance ?? '',
    transportTime: firstHotel.transport_time ?? firstResult.transportTime ?? '',
    busRoute: firstHotel.bus_route ?? firstResult.busRoute ?? '',
    pageSnapshot: firstResult.pageSnapshot || null,
    compareAppSettings: sanitizeSensitiveData(compareAppSettings),
    writeResult,
    cleanupResult,
    reportLevel,
    performance,
    failedItems
  };
}

module.exports = {
  buildBatchItems,
  buildBatchOutputPayload,
  buildBatchResult,
  buildUncollectedHotelPerfRecord,
  deriveUncollectedHotelReason,
  summarizeSnapshotSources
};
