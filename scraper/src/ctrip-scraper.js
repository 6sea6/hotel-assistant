/**
 * ctrip-scraper.js — Coordinator module
 *
 * Orchestrates a three-layer scraping strategy (HTML → API replay → Edge CDP)
 * to extract hotel room data from Ctrip.  All low-level logic lives in the
 * submodules under ./scraper/.
 */

const path = require('path');
const { normalizeText, pickFirst, slugify } = require('./utils');
const { buildDesktopUrl, buildMobileUrl, buildUrlOverridesFromTemplate, parseHotelIdFromUrl } = require('./ctrip-url');
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
const { mergeRoomCandidates, selectBestRoom, buildRoomSelectionDiagnostics, isPersistableRoomCandidate } = require('./scraper/room-logic');
const { captureRoomCandidatesDirect } = require('./scraper/api-replay');
const { shouldAttemptSupplementalCapture, shouldPreferEdgeCapture, captureRoomCandidatesWithEdge } = require('./scraper/edge-capture');

async function scrapeCtripHotel(url, template, options = {}) {
  const urlOverrides = buildUrlOverridesFromTemplate(template);
  const desktopUrl = buildDesktopUrl(url, urlOverrides) || normalizeText(url);
  const mobileUrl = buildMobileUrl(desktopUrl, urlOverrides);
  const sources = [];

  if (options.htmlPath) {
    sources.push({
      source: 'local-html',
      url: desktopUrl,
      html: loadHtmlFromFile(options.htmlPath),
      cookieHeader: ''
    });
  } else {
    const [desktopPage, mobilePage] = await Promise.all([
      fetchHtml(desktopUrl, DESKTOP_HEADERS),
      mobileUrl ? fetchHtml(mobileUrl, MOBILE_HEADERS) : Promise.resolve(null)
    ]);

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

  const parsedSources = sources.map((item) => ({
    ...item,
    meta: extractHotelMetaFromHtml(item.html, item.url),
    roomBlocks: findRoomBlocksFromHtml(item.html)
  }));

  const mergedRoomBlocks = [];
  const seen = new Set();
  for (const source of parsedSources) {
    for (const room of source.roomBlocks) {
      const key = `${room.title}-${room.occupancy || ''}-${room.price || ''}-${room.price_locked ? 'locked' : 'open'}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      mergedRoomBlocks.push({
        ...room,
        source: source.source
      });
    }
  }

  const normalizedRoomBlocks = mergeRoomCandidates(mergedRoomBlocks);
  let selectedRoom = selectBestRoom(normalizedRoomBlocks, template);
  let directReplay = null;
  let fallbackCapture = null;
  const preferEdgeCapture = shouldPreferEdgeCapture(options);

  const applyCaptureResult = (captureResult) => {
    if (!captureResult || !Array.isArray(captureResult.roomBlocks) || captureResult.roomBlocks.length === 0) {
      return false;
    }

    normalizedRoomBlocks.splice(0, normalizedRoomBlocks.length, ...captureResult.roomBlocks);
    selectedRoom = captureResult.selectedRoom || selectBestRoom(normalizedRoomBlocks, template);
    return true;
  };

  if (preferEdgeCapture) {
    if (shouldAttemptSupplementalCapture(normalizedRoomBlocks, selectedRoom, template, options)) {
      fallbackCapture = await captureRoomCandidatesWithEdge(desktopUrl, template, options.edgeSession || {});
      applyCaptureResult(fallbackCapture);
    }

    if ((!selectedRoom || selectedRoom.price === null)
      && shouldAttemptSupplementalCapture(normalizedRoomBlocks, selectedRoom, template, options)) {
      directReplay = await captureRoomCandidatesDirect(desktopUrl, template, parsedSources);
      applyCaptureResult(directReplay);
    }
  } else {
    if (shouldAttemptSupplementalCapture(normalizedRoomBlocks, selectedRoom, template, options)) {
      directReplay = await captureRoomCandidatesDirect(desktopUrl, template, parsedSources);
      applyCaptureResult(directReplay);
    }

    if (shouldAttemptSupplementalCapture(normalizedRoomBlocks, selectedRoom, template, options)) {
      fallbackCapture = await captureRoomCandidatesWithEdge(desktopUrl, template, options.edgeSession || {});
      applyCaptureResult(fallbackCapture);
    }
  }

  const primarySource = parsedSources.find((item) => item.meta.hotelName || item.meta.address) || parsedSources[0] || { meta: {} };
  const resolvedScore = pickFirst(
    ...parsedSources.map((item) => item.meta.score),
    ...parsedSources.map((item) => extractHotelScoreFromHtml(item.html))
  );
  const shouldSaveSnapshots = !options.htmlPath && (options.saveHtml || !selectedRoom || selectedRoom.price === null);
  const snapshotDir = shouldSaveSnapshots ? path.resolve(options.snapshotDir || path.join('output', 'raw-pages')) : null;
  const snapshotStem = slugify(primarySource.meta.hotelName || parseHotelIdFromUrl(desktopUrl) || 'hotel-page');
  const snapshotFiles = shouldSaveSnapshots
    ? parsedSources.map((item) => saveHtmlSnapshot(snapshotDir, snapshotStem, item.source, item.html)).filter(Boolean)
    : [];

  const persistedRoomBlocks = normalizedRoomBlocks.filter(isPersistableRoomCandidate);
  const selectionDiagnostics = buildRoomSelectionDiagnostics(normalizedRoomBlocks, template, options.matchingOptions || {});
  const eligibleRooms = selectionDiagnostics.eligibleRooms;

  return {
    hotel_name: primarySource.meta.hotelName,
    address: pickFirst(primarySource.meta.geoInfo && primarySource.meta.geoInfo.address, primarySource.meta.address),
    ctrip_score: resolvedScore,
    geo: primarySource.meta.geoInfo,
    room: selectedRoom,
    room_candidates: persistedRoomBlocks,
    raw_room_candidates: normalizedRoomBlocks,
    eligible_rooms: eligibleRooms,
    room_selection_diagnostics: selectionDiagnostics,
    page_snapshot: {
      source_url: desktopUrl,
      html_source: options.htmlPath || 'remote',
      room_candidates_count: persistedRoomBlocks.length,
      room_price_visible: Boolean(selectedRoom && selectedRoom.price !== null),
      selected_room_source: selectedRoom ? selectedRoom.source : '',
      sources: parsedSources.map((item) => ({
        source: item.source,
        url: item.url,
        room_candidates_count: item.roomBlocks.length,
        room_price_visible: item.roomBlocks.some((room) => room.price !== null),
        locked_price_detected: item.roomBlocks.some((room) => room.price_locked)
      })).concat(directReplay ? [{
        source: 'direct-room-list-replay',
        url: desktopUrl,
        room_candidates_count: directReplay.roomBlocks.length,
        room_price_visible: directReplay.roomBlocks.some((room) => room.price !== null),
        locked_price_detected: directReplay.roomBlocks.some((room) => room.price_locked),
        tracked_urls: directReplay.trackedUrls,
        spider_error_codes: directReplay.spiderErrorCodes || [],
        attempts: directReplay.attempts || [],
        error: directReplay.error || ''
      }] : []).concat(fallbackCapture ? [{
        source: 'edge-cdp',
        url: desktopUrl,
        room_candidates_count: fallbackCapture.roomBlocks.length,
        room_price_visible: fallbackCapture.roomBlocks.some((room) => room.price !== null),
        locked_price_detected: fallbackCapture.roomBlocks.some((room) => room.price_locked),
        tracked_urls: fallbackCapture.trackedUrls,
        spider_error_codes: fallbackCapture.spiderErrorCodes || [],
        error: fallbackCapture.error || ''
      }] : []),
      selected_room_price_locked: Boolean(selectedRoom && selectedRoom.price_locked),
      saved_html_files: snapshotFiles
    }
  };
}

module.exports = {
  scrapeCtripHotel
};
