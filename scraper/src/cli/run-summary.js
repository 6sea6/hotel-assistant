const path = require('path');
const { writeJsonFile } = require('../utils');

const DEFAULT_LATEST_RUN_PATH = path.resolve('output', 'latest-run.json');

function pickFirst(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') {
      return value;
    }
  }
  return null;
}

function getFirstEligibleHotel(payload) {
  return Array.isArray(payload.eligibleHotels) ? payload.eligibleHotels[0] || {} : {};
}

function getFirstEligibleRoom(payload) {
  return Array.isArray(payload.eligibleRoomTypes) ? payload.eligibleRoomTypes[0] || {} : {};
}

function buildPageSnapshotSummary(pageSnapshot) {
  if (!pageSnapshot || typeof pageSnapshot !== 'object') {
    return null;
  }

  const summarizeSource = (source) => {
    if (!source || typeof source !== 'object') {
      return null;
    }

    return {
      source: source.source || '',
      room_candidates_count: source.room_candidates_count ?? 0,
      room_price_visible: Boolean(source.room_price_visible),
      locked_price_detected: Boolean(source.locked_price_detected),
      tracked_url_count: Array.isArray(source.tracked_urls) ? source.tracked_urls.length : 0,
      attempt_count: Array.isArray(source.attempts) ? source.attempts.length : 0,
      spider_error_codes: Array.isArray(source.spider_error_codes) ? source.spider_error_codes : [],
      error: source.error || ''
    };
  };

  return {
    source_url: pageSnapshot.source_url || '',
    html_source: pageSnapshot.html_source || '',
    room_candidates_count: pageSnapshot.room_candidates_count ?? 0,
    room_price_visible: Boolean(pageSnapshot.room_price_visible),
    selected_room_source: pageSnapshot.selected_room_source || '',
    selected_room_price_locked: Boolean(pageSnapshot.selected_room_price_locked),
    eligible_room_count: pageSnapshot.eligible_room_count ?? 0,
    raw_room_candidates_count: pageSnapshot.raw_room_candidates_count ?? 0,
    spider_error_codes: Array.isArray(pageSnapshot.spider_error_codes)
      ? pageSnapshot.spider_error_codes
      : [],
    tracked_url_count: pageSnapshot.tracked_url_count ?? 0,
    edge_fallback_used: Boolean(pageSnapshot.edge_fallback_used),
    api_replay_used: Boolean(pageSnapshot.api_replay_used),
    html_room_count: pageSnapshot.html_room_count ?? 0,
    mobile_room_count: pageSnapshot.mobile_room_count ?? 0,
    desktop_room_count: pageSnapshot.desktop_room_count ?? 0,
    capture_method: pageSnapshot.capture_method || '',
    wait_reason: pageSnapshot.wait_reason || '',
    capture_strategy: pageSnapshot.capture_strategy || '',
    html_edge_parallel_used: Boolean(pageSnapshot.html_edge_parallel_used),
    edge_started_before_html_done: Boolean(pageSnapshot.edge_started_before_html_done),
    edge_waited_for_settle: Boolean(pageSnapshot.edge_waited_for_settle),
    settle_total_ms: pageSnapshot.settle_total_ms ?? 0,
    settle_clicked_count: pageSnapshot.settle_clicked_count ?? 0,
    settle_scroll_count: pageSnapshot.settle_scroll_count ?? 0,
    settle_container_count: pageSnapshot.settle_container_count ?? 0,
    saved_html_file_count: Array.isArray(pageSnapshot.saved_html_files)
      ? pageSnapshot.saved_html_files.length
      : 0,
    sources: Array.isArray(pageSnapshot.sources)
      ? pageSnapshot.sources.map(summarizeSource).filter(Boolean)
      : []
  };
}

function buildRunSummary(payload) {
  if (payload.reportLevel === 'off') {
    return {
      success: payload.success,
      startedAt: payload.startedAt,
      finishedAt: payload.finishedAt,
      hotelName: payload.hotelName || '',
      eligibleCount: payload.eligibleCount || 0,
      totalPrice: pickFirst(payload.totalPrice, null),
      batchMode: Boolean(payload.batchMode),
      batchSummary: payload.batchSummary
        ? {
            inputMode: payload.batchSummary.inputMode,
            requestedUrlCount: payload.batchSummary.requestedUrlCount,
            expandedHotelCount: payload.batchSummary.expandedHotelCount,
            succeededCount: payload.batchSummary.succeededCount,
            failedCount: payload.batchSummary.failedCount,
            eligibleHotelRecordCount: payload.batchSummary.eligibleHotelRecordCount
          }
        : null,
      outputPath: payload.outputPath || '',
      error: payload.error || null
    };
  }

  const firstHotel = getFirstEligibleHotel(payload);
  const firstRoom = getFirstEligibleRoom(payload);

  return {
    success: payload.success,
    startedAt: payload.startedAt,
    finishedAt: payload.finishedAt,
    outputPath: payload.outputPath || '',
    compareAppStorePath: payload.compareAppStorePath || '',
    templateName: payload.templateName || '',
    templateId: payload.templateId || null,
    templateSnapshot: payload.templateSnapshot ?? null,
    requestedUrl: payload.requestedUrl || '',
    requestedUrls: Array.isArray(payload.requestedUrls) ? payload.requestedUrls.slice(0, 5) : [],
    resolvedUrl: payload.resolvedUrl || '',
    resolvedUrls: Array.isArray(payload.resolvedUrls) ? payload.resolvedUrls.slice(0, 5) : [],
    inputMode: payload.inputMode || '',
    batchMode: Boolean(payload.batchMode),
    items: Array.isArray(payload.items) ? payload.items.slice(0, 20) : [],
    batchStats: payload.batchStats || null,
    batchSummary: payload.batchSummary || null,
    hotelName: payload.hotelName || '',
    eligibleCount: payload.eligibleCount || 0,
    eligibleRoomTypes: Array.isArray(payload.eligibleRoomTypes)
      ? payload.eligibleRoomTypes.slice(0, 5)
      : [],
    eligibleHotels: Array.isArray(payload.eligibleHotels) ? payload.eligibleHotels.slice(0, 3) : [],
    roomType: payload.roomType || '',
    roomOccupancy: payload.roomOccupancy ?? null,
    totalPrice: pickFirst(
      payload.totalPrice,
      firstRoom.totalPrice,
      firstRoom.total_price,
      firstHotel.total_price
    ),
    ctripScore: pickFirst(payload.ctripScore, firstHotel.ctrip_score),
    distance: pickFirst(payload.distance, firstHotel.distance, ''),
    subwayDistance: pickFirst(payload.subwayDistance, firstHotel.subway_distance, ''),
    transportTime: pickFirst(payload.transportTime, firstHotel.transport_time, ''),
    busRoute: pickFirst(payload.busRoute, firstHotel.bus_route, ''),
    pageSnapshot: buildPageSnapshotSummary(payload.pageSnapshot),
    writeResult: payload.writeResult ?? null,
    error: payload.error || null,
    reportLevel: payload.reportLevel || 'normal'
  };
}

function writeLatestRunFile(latestRunPath, summary) {
  writeJsonFile(latestRunPath, summary, { pretty: false, measure: true });
}

module.exports = {
  DEFAULT_LATEST_RUN_PATH,
  buildPageSnapshotSummary,
  buildRunSummary,
  writeLatestRunFile
};
