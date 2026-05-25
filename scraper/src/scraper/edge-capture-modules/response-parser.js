const { mergeRoomCandidates, selectBestRoom, selectMatchingRooms } = require('../room-logic');
const { findRoomBlocksFromStructuredText, safeJsonParse } = require('../html-parser');
const { collectRoomCandidatesFromPayload } = require('../structured-extractor');
const { extractSpiderErrorCode } = require('../api-replay');
const { writeEdgeDebugArtifact } = require('./debug');
const {
  buildEdgeResponseReadPlan,
  getPrioritizedEdgeResponseEntries,
  isRoomListNetworkResponse,
  shouldSkipEdgeResponseAfterRoomSuccess
} = require('./network-response-classifier');
const { readEdgeResponseBodyWithRetry } = require('./response-body-reader');
const { assertEdgeNotAborted, isAbortLikeError } = require('./edge-retry-policy');

const EDGE_RESPONSE_PARSE_MAX_MS = 12000;
const EDGE_NON_ROOM_RESPONSE_TIMEOUT_BUDGET = 8;

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
module.exports = {
  EDGE_RESPONSE_PARSE_MAX_MS,
  EDGE_NON_ROOM_RESPONSE_TIMEOUT_BUDGET,
  shouldUseEdgeRawTextFallback,
  isEdgeRoomFastPathComplete,
  buildResponseEntryDiagnostics,
  parseEdgeNetworkResponses
};
