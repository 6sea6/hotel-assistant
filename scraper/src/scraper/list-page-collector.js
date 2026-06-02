const { DESKTOP_HEADERS, fetchHtml } = require('./html-parser');
const {
  filterListPageCandidates,
  normalizeListPageFilterOptions,
  parseListPageCandidatesFromHtml
} = require('./list-page-parser');
const { captureListHtmlPagesWithEdge } = require('./list-page-edge-capture');
const { buildListPageUrls } = require('./list-page-url-builder');
const {
  appendPageCandidates,
  pickEdgeFallbackPageUrls,
  shouldAttemptEdgeListFallback
} = require('./list-page-prefilter-strategy');

function durationSince(startedAt) {
  return Math.max(0, Date.now() - startedAt);
}

async function collectListPageCandidates(listUrl, template = {}, rawFilters = {}, options = {}) {
  const totalStartedAt = Date.now();
  const filters = normalizeListPageFilterOptions(rawFilters);
  const pageUrls = buildListPageUrls(listUrl);
  const pages = [];
  const errors = [];
  const htmlPageResults = new Map();
  const fetchPageHtml = typeof options.fetchHtml === 'function' ? options.fetchHtml : fetchHtml;
  const capturePagesWithEdge =
    typeof options.captureListHtmlPagesWithEdge === 'function'
      ? options.captureListHtmlPagesWithEdge
      : captureListHtmlPagesWithEdge;
  const performance = {
    htmlFetchMs: 0,
    edgeFallbackMs: 0,
    totalMs: 0,
    htmlStoppedReason: '',
    htmlPages: [],
    edgePages: []
  };
  let candidates = [];
  let prefilter = filterListPageCandidates(candidates, filters);
  let previousSelectedCount = 0;
  let staleSelectedRounds = 0;

  for (const pageUrl of pageUrls) {
    const pageStartedAt = Date.now();
    try {
      const page = await fetchPageHtml(pageUrl, DESKTOP_HEADERS);
      const pageCandidates = parseListPageCandidatesFromHtml(page.html, pageUrl, {
        template,
        filters,
        sourceOrderOffset: candidates.length
      });
      const pageRecord = {
        url: pageUrl,
        source: 'html',
        candidateCount: pageCandidates.length,
        durationMs: durationSince(pageStartedAt)
      };
      pages.push(pageRecord);
      htmlPageResults.set(pageUrl, pageRecord);
      performance.htmlPages.push(pageRecord);
      performance.htmlFetchMs += pageRecord.durationMs;
      appendPageCandidates(candidates, pageCandidates, candidates.length);
      prefilter = filterListPageCandidates(candidates, filters);
      if (prefilter.selected.length >= filters.desiredHotelCount) {
        break;
      }
      if (prefilter.selected.length === previousSelectedCount && prefilter.selected.length > 0) {
        staleSelectedRounds += 1;
      } else {
        staleSelectedRounds = 0;
      }
      previousSelectedCount = prefilter.selected.length;
      if (staleSelectedRounds >= 2 && shouldAttemptEdgeListFallback(options)) {
        performance.htmlStoppedReason = 'stalled_unique_candidates';
        break;
      }
    } catch (error) {
      const pageRecord = {
        url: pageUrl,
        source: 'html',
        candidateCount: 0,
        failed: true,
        durationMs: durationSince(pageStartedAt)
      };
      htmlPageResults.set(pageUrl, pageRecord);
      performance.htmlPages.push(pageRecord);
      performance.htmlFetchMs += pageRecord.durationMs;
      errors.push({
        url: pageUrl,
        source: 'html',
        error: error && error.message ? error.message : String(error)
      });
    }
  }

  let edgeCapture = null;
  if (
    prefilter.selected.length < filters.desiredHotelCount &&
    shouldAttemptEdgeListFallback(options)
  ) {
    const edgePageUrls = pickEdgeFallbackPageUrls(pageUrls, htmlPageResults, prefilter, {
      preferFirstPage: performance.htmlStoppedReason === 'stalled_unique_candidates'
    });
    const edgeStartedAt = Date.now();
    const applyEdgePage = (edgePage) => {
      const pageCandidates = parseListPageCandidatesFromHtml(edgePage.html, edgePage.url, {
        template,
        filters,
        sourceOrderOffset: candidates.length
      });
      const pageRecord = {
        url: edgePage.url,
        source: edgePage.source || 'edge-cdp',
        candidateCount: pageCandidates.length,
        durationMs: edgePage.durationMs,
        scrollRound: edgePage.scrollRound,
        scrollContainerCount: Number(edgePage.scrollContainerCount) || 0,
        scrollActions: Number(edgePage.scrollActions) || 0,
        documentHeightBefore: Number(edgePage.documentHeightBefore) || 0,
        documentHeightAfter: Number(edgePage.documentHeightAfter) || 0,
        candidateDomCount: Number(edgePage.candidateDomCount) || 0,
        bodyTextLength: Number(edgePage.bodyTextLength) || 0,
        bodyScrollTopBefore: Number(edgePage.bodyScrollTopBefore) || 0,
        bodyScrollTopAfter: Number(edgePage.bodyScrollTopAfter) || 0,
        documentScrollTopBefore: Number(edgePage.documentScrollTopBefore) || 0,
        documentScrollTopAfter: Number(edgePage.documentScrollTopAfter) || 0,
        networkResponseCount: Number(edgePage.networkResponseCount) || 0,
        listApiResponseCount: Number(edgePage.listApiResponseCount) || 0,
        listApiPageIndexes: Array.isArray(edgePage.listApiPageIndexes)
          ? edgePage.listApiPageIndexes
          : [],
        listApiError: edgePage.listApiError || '',
        fullHtmlIncluded: Boolean(edgePage.fullHtmlIncluded)
      };
      pages.push(pageRecord);
      performance.edgePages.push(pageRecord);
      appendPageCandidates(candidates, pageCandidates, candidates.length);
      prefilter = filterListPageCandidates(candidates, filters);
      return pageRecord;
    };
    edgeCapture =
      edgePageUrls.length > 0
        ? await capturePagesWithEdge(edgePageUrls, options.edgeSession || {}, {
            onPage: (edgePage) => {
              applyEdgePage(edgePage);
              return {
                continue: prefilter.selected.length < filters.desiredHotelCount,
                selectedCount: prefilter.selected.length,
                uniqueCandidateCount: prefilter.totalCandidates
              };
            },
            shouldStop: () => prefilter.selected.length >= filters.desiredHotelCount,
            desiredHotelCount: filters.desiredHotelCount
          })
        : {
            pages: [],
            error: ''
          };
    performance.edgeFallbackMs = durationSince(edgeStartedAt);
    if (edgeCapture.error) {
      errors.push({
        url: listUrl,
        source: 'edge-cdp',
        error: edgeCapture.error
      });
    }
    prefilter = filterListPageCandidates(candidates, filters);
  }

  candidates = candidates.sort((left, right) => left.sourceOrder - right.sourceOrder);
  performance.totalMs = durationSince(totalStartedAt);
  return {
    inputUrl: listUrl,
    pageUrls,
    pages,
    filters: prefilter.filters,
    candidates,
    totalCandidates: prefilter.totalCandidates,
    selected: prefilter.selected,
    rejected: prefilter.rejected,
    detailUrls: prefilter.detailUrls,
    errors,
    edgeFallbackUsed: Boolean(
      edgeCapture && ((edgeCapture.pages || []).length || edgeCapture.error)
    ),
    performance
  };
}

module.exports = {
  buildListPageUrls,
  captureListHtmlPagesWithEdge,
  collectListPageCandidates,
  shouldAttemptEdgeListFallback
};
