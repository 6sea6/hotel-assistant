function shouldAttemptEdgeListFallback(options = {}) {
  const edgeSession =
    options.edgeSession && typeof options.edgeSession === 'object' ? options.edgeSession : {};

  return Boolean(
    options.autoEdge ||
    edgeSession.debuggerUrl ||
    edgeSession.debuggingPort ||
    edgeSession.userDataDir
  );
}

function normalizeEdgePageDecision(value) {
  if (value === false) {
    return { stop: true };
  }

  if (!value || typeof value !== 'object') {
    return { stop: false };
  }

  const progressValue =
    value.uniqueCandidateCount ??
    value.totalCandidateCount ??
    value.selectedCount ??
    value.candidateCount;
  const progressCount = Number(progressValue);

  return {
    stop: Boolean(value.stop) || value.continue === false,
    progressCount: Number.isFinite(progressCount) ? progressCount : null
  };
}

function appendPageCandidates(target, pageCandidates = [], sourceOrderOffset = target.length) {
  for (let index = 0; index < pageCandidates.length; index += 1) {
    target.push({
      ...pageCandidates[index],
      sourceOrder: sourceOrderOffset + index + 1
    });
  }
}

function pickEdgeFallbackPageUrls(
  pageUrls = [],
  htmlPageResults = new Map(),
  prefilter = null,
  options = {}
) {
  if (options.preferFirstPage) {
    return pageUrls.slice(0, 1);
  }

  const fallbackUrls = [];

  for (const pageUrl of pageUrls) {
    const result = htmlPageResults.get(pageUrl);
    if (!result || result.failed || Number(result.candidateCount || 0) === 0) {
      fallbackUrls.push(pageUrl);
    }
  }

  if (fallbackUrls.length > 0) {
    return fallbackUrls;
  }

  const filters = prefilter && prefilter.filters ? prefilter.filters : {};
  const selectedCount =
    prefilter && Array.isArray(prefilter.selected) ? prefilter.selected.length : 0;
  const desiredCount = Number(filters.desiredHotelCount || filters.targetCount || 0);
  if (htmlPageResults.size > 0 && desiredCount > 0 && selectedCount < desiredCount) {
    return pageUrls.slice(0, 1);
  }

  return htmlPageResults.size === 0 ? pageUrls : [];
}

module.exports = {
  appendPageCandidates,
  normalizeEdgePageDecision,
  pickEdgeFallbackPageUrls,
  shouldAttemptEdgeListFallback
};
