const { mergeRoomCandidates } = require('../room-logic');
const {
  findRoomBlocksFromStructuredText,
  findRoomBlocksFromHtml,
  safeJsonParse
} = require('../html-parser');
const { evaluateInSession } = require('../cdp-utils');
const {
  buildEdgeDomExtractExpression,
  buildLightweightEdgeDomExtractExpression
} = require('./dom-extract-script');
const { writeEdgeDebugArtifact } = require('./debug');
const { isAbortLikeError } = require('./edge-retry-policy');

const EDGE_DOM_EXTRACT_TIMEOUT_MS = 6000;
const EDGE_DOM_EXTRACT_FAST_TIMEOUT_MS = 1800;
const EDGE_DOM_EXTRACT_API_COMPLETE_TIMEOUT_MS = 900;

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

function getEdgeDomExtractTimeoutMs(roomBlocks, options = {}) {
  if (options && options.apiCaptureComplete) {
    return EDGE_DOM_EXTRACT_API_COMPLETE_TIMEOUT_MS;
  }
  const hasPricedRoom =
    Array.isArray(roomBlocks) &&
    roomBlocks.some(
      (room) =>
        room &&
        room.price !== null &&
        room.price !== undefined &&
        !room.price_locked
    );
  return hasPricedRoom ? EDGE_DOM_EXTRACT_FAST_TIMEOUT_MS : EDGE_DOM_EXTRACT_TIMEOUT_MS;
}

function isEdgeDomExtractTimeoutError(error) {
  const message = error && error.message ? String(error.message) : String(error || '');
  return /Runtime\.evaluate timed out|timed out after \d+ms/i.test(message);
}

async function extractEdgeDomRoomCandidates({
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
  apiCaptureComplete = false,
  enableDomSupplement = false
}) {
  const safePerf = perf || createNoopPerf();
  const candidateList = Array.isArray(roomBlocks) ? roomBlocks : [];
  const timeoutMs = getEdgeDomExtractTimeoutMs(candidateList, { apiCaptureComplete });
  const beforeDomCount = candidateList.length;
  const trackedUrlCount = trackedUrls && trackedUrls.size ? trackedUrls.size : 0;
  const domExtractMode = apiCaptureComplete
    ? 'api_complete_lightweight'
    : beforeDomCount > 0
      ? 'api_partial_full'
      : 'dom_full';
  const domPhase = safePerf.phase('edge_dom_extract', {
    url,
    captureMethod,
    targetMode,
    trackedUrlCount,
    dom_extract_mode: domExtractMode,
    dom_extract_api_complete: Boolean(apiCaptureComplete),
    dom_extract_timeout_ms: timeoutMs,
    room_candidates_before: beforeDomCount
  });

  if (!apiCaptureComplete) {
    domPhase.end('skipped', {
      roomCandidatesCount: 0,
      dom_extract_mode: domExtractMode,
      dom_extract_api_complete: false,
      dom_extract_skipped: true,
      dom_extract_skip_reason: 'api_capture_incomplete',
      dom_extract_timeout_ms: timeoutMs,
      room_candidates_before: beforeDomCount,
      room_candidates_after: beforeDomCount,
      dom_extract_timed_out: false
    });
    return {
      roomCandidatesCount: 0,
      roomCandidatesBefore: beforeDomCount,
      roomCandidatesAfter: beforeDomCount,
      timeoutMs,
      timedOut: false,
      skipped: true,
      skipReason: 'api_capture_incomplete'
    };
  }

  if (!enableDomSupplement) {
    domPhase.end('skipped', {
      roomCandidatesCount: 0,
      dom_extract_mode: domExtractMode,
      dom_extract_api_complete: true,
      dom_extract_skipped: true,
      dom_extract_skip_reason: 'dom_supplement_disabled',
      dom_extract_timeout_ms: timeoutMs,
      room_candidates_before: beforeDomCount,
      room_candidates_after: beforeDomCount,
      dom_extract_timed_out: false
    });
    return {
      roomCandidatesCount: 0,
      roomCandidatesBefore: beforeDomCount,
      roomCandidatesAfter: beforeDomCount,
      timeoutMs,
      timedOut: false,
      skipped: true,
      skipReason: 'dom_supplement_disabled'
    };
  }

  try {
    const domPayloadResult = await evaluateInSession(
      connection,
      sessionId,
      apiCaptureComplete
        ? buildLightweightEdgeDomExtractExpression()
        : buildEdgeDomExtractExpression(),
      {
        timeoutMs,
        signal
      }
    );
    const domPayload =
      typeof domPayloadResult === 'string' ? safeJsonParse(domPayloadResult) : domPayloadResult;
    writeEdgeDebugArtifact(`${debugHotelId}-dom-payload.json`, domPayload);
    const candidates = apiCaptureComplete ? collectRoomCandidatesFromDomPayload(domPayload) : [];
    candidateList.push(...candidates);
    domPhase.end('success', {
      roomCandidatesCount: candidateList.length - beforeDomCount,
      dom_extract_mode: domExtractMode,
      dom_extract_api_complete: Boolean(apiCaptureComplete),
      dom_extract_candidates_suppressed: !apiCaptureComplete,
      dom_extract_timeout_ms: timeoutMs,
      room_candidates_before: beforeDomCount,
      room_candidates_after: candidateList.length,
      dom_extract_timed_out: false
    });
    return {
      roomCandidatesCount: candidateList.length - beforeDomCount,
      roomCandidatesBefore: beforeDomCount,
      roomCandidatesAfter: candidateList.length,
      timeoutMs,
      timedOut: false
    };
  } catch (error) {
    const timedOut = isEdgeDomExtractTimeoutError(error);
    domPhase.error(error, {
      dom_extract_mode: domExtractMode,
      dom_extract_api_complete: Boolean(apiCaptureComplete),
      dom_extract_timeout_ms: timeoutMs,
      room_candidates_before: beforeDomCount,
      room_candidates_after: candidateList.length,
      dom_extract_timed_out: timedOut
    });
    if (isAbortLikeError(error)) {
      throw error;
    }
    writeEdgeDebugArtifact(`${debugHotelId}-dom-error.json`, {
      message: error && error.message ? error.message : String(error || ''),
      stack: error && error.stack ? error.stack : '',
      timeoutMs,
      timedOut
    });
    return {
      roomCandidatesCount: 0,
      roomCandidatesBefore: beforeDomCount,
      roomCandidatesAfter: candidateList.length,
      timeoutMs,
      timedOut,
      error: error && error.message ? error.message : String(error || '')
    };
  }
}

module.exports = {
  collectRoomCandidatesFromDomPayload,
  createNoopPerf,
  extractEdgeDomRoomCandidates,
  getEdgeDomExtractTimeoutMs
};
