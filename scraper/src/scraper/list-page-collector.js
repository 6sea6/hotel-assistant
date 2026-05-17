const fs = require('fs');
const { buildListPageUrl } = require('../ctrip-url');
const { DESKTOP_HEADERS, fetchHtml } = require('./html-parser');
const {
  filterListPageCandidates,
  normalizeListPageFilterOptions,
  parseListPageCandidatesFromHtml
} = require('./list-page-parser');
const {
  connectToDebugger,
  evaluateInSession,
  launchManagedEdgeSession,
  normalizeEdgeSessionOptions,
  waitForDebuggerEndpoint,
  waitForSessionCondition
} = require('./cdp-utils');
const {
  findEdgeExecutable,
  killProcessTree
} = require('./process-utils');

function shouldAttemptEdgeListFallback(options = {}) {
  const edgeSession = options.edgeSession && typeof options.edgeSession === 'object'
    ? options.edgeSession
    : {};

  return Boolean(
    options.autoEdge
    || edgeSession.debuggerUrl
    || edgeSession.debuggingPort
    || edgeSession.userDataDir
  );
}

function getEdgeWebSocket() {
  if (typeof globalThis.WebSocket === 'function') {
    return globalThis.WebSocket;
  }

  try {
    return require('ws');
  } catch (_error) {
    return null;
  }
}

function buildListPageUrls(listUrl, maxPages) {
  const pageCount = Math.max(1, Math.trunc(Number(maxPages) || 1));
  return Array.from({ length: pageCount }, (_, index) => buildListPageUrl(listUrl, index + 1));
}

function durationSince(startedAt) {
  return Math.max(0, Date.now() - startedAt);
}

async function captureListHtmlPagesWithEdge(pageUrls = [], edgeSessionOptions = {}, options = {}) {
  if (process.platform !== 'win32' || typeof fetch !== 'function') {
    return {
      pages: [],
      error: 'edge-cdp list fallback unavailable: requires Windows and global fetch'
    };
  }

  const EdgeWebSocket = getEdgeWebSocket();
  if (!EdgeWebSocket) {
    return {
      pages: [],
      error: 'edge-cdp list fallback unavailable: WebSocket is not present and ws package not installed'
    };
  }

  const sessionOptions = normalizeEdgeSessionOptions(edgeSessionOptions);
  const edgeExecutable = findEdgeExecutable();
  if (!sessionOptions.debuggerUrl && !edgeExecutable) {
    return {
      pages: [],
      error: 'edge-cdp list fallback unavailable: msedge.exe not found'
    };
  }

  let browser = null;
  let connection = null;
  let userDataDir = '';
  let shouldCleanupUserDataDir = false;
  let targetId = '';
  let sessionId = '';
  let shouldCloseTarget = false;

  try {
    if (sessionOptions.debuggerUrl) {
      connection = await connectToDebugger(sessionOptions.debuggerUrl, EdgeWebSocket);
    } else if (sessionOptions.debuggingPort) {
      try {
        const debuggerUrl = await waitForDebuggerEndpoint(sessionOptions.debuggingPort, 3000);
        connection = await connectToDebugger(debuggerUrl, EdgeWebSocket);
      } catch (error) {
        if (!edgeExecutable) {
          throw error;
        }
        const launched = await launchManagedEdgeSession(edgeExecutable, sessionOptions, sessionOptions.debuggingPort);
        browser = launched.browser;
        userDataDir = launched.userDataDir;
        shouldCleanupUserDataDir = launched.shouldCleanupUserDataDir;
        connection = await connectToDebugger(launched.debuggerUrl, EdgeWebSocket);
      }
    } else {
      const launched = await launchManagedEdgeSession(edgeExecutable, sessionOptions);
      browser = launched.browser;
      userDataDir = launched.userDataDir;
      shouldCleanupUserDataDir = launched.shouldCleanupUserDataDir;
      connection = await connectToDebugger(launched.debuggerUrl, EdgeWebSocket);
    }

    try {
      const targetsResponse = await connection.send('Target.getTargets');
      const targets = (targetsResponse && targetsResponse.targetInfos) || [];
      const blankTarget = targets.find((target) => target.type === 'page' && (!target.url || target.url === 'about:blank'));
      if (blankTarget) {
        targetId = blankTarget.targetId;
      }
    } catch (_error) {
      // Listing targets is best effort; create a target below when needed.
    }

    if (!targetId) {
      const createdTarget = await connection.send('Target.createTarget', { url: 'about:blank' });
      targetId = createdTarget && createdTarget.targetId;
      shouldCloseTarget = true;
    }

    if (!targetId) {
      return {
        pages: [],
        error: 'edge-cdp list fallback failed: could not create a target tab'
      };
    }

    const attachedTarget = await connection.send('Target.attachToTarget', { targetId, flatten: true });
    sessionId = attachedTarget && attachedTarget.sessionId;
    if (!sessionId) {
      return {
        pages: [],
        error: 'edge-cdp list fallback failed: attachToTarget returned no sessionId'
      };
    }

    await connection.send('Page.enable', {}, sessionId);
    await connection.send('Runtime.enable', {}, sessionId);
    const pages = [];

    for (const url of pageUrls) {
      const pageStartedAt = Date.now();
      const loadEvent = new Promise((resolve) => {
        const stopListening = connection.addListener((message) => {
          if (message.sessionId === sessionId && message.method === 'Page.loadEventFired') {
            stopListening();
            resolve();
          }
        });
      });

      await connection.send('Page.navigate', { url }, sessionId);
      await Promise.race([
        loadEvent,
        new Promise((resolve) => setTimeout(resolve, 15000))
      ]);
      await waitForSessionCondition(connection, sessionId, `(() => {
        const bodyText = document.body && document.body.innerText ? document.body.innerText : '';
        return document.readyState === 'complete' && /(酒店|宾馆|评分|点评|价格|携程)/.test(bodyText);
      })()`, 5000, 250);

      const html = await evaluateInSession(connection, sessionId, `(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const getHeight = () => Math.max(
          document.body ? document.body.scrollHeight : 0,
          document.documentElement ? document.documentElement.scrollHeight : 0,
          window.innerHeight || 0
        );
        const getCandidateCount = () => {
          try {
            return document.querySelectorAll([
              'a[href*="/hotels/"]',
              'a[href*="hotelId="]',
              '[data-hotelid]',
              '[data-hotel-id]',
              '[data-offline-hotelid]',
              '[data-offline-hotelId]',
              '[class*="hotel"]',
              '[class*="Hotel"]'
            ].join(',')).length;
          } catch (_error) {
            return 0;
          }
        };
        let previousHeight = 0;
        let previousCount = -1;
        let stableRounds = 0;
        for (let index = 0; index < 8; index += 1) {
          const height = getHeight();
          const count = getCandidateCount();
          window.scrollTo(0, height);
          await sleep(index === 0 ? 300 : 220);
          const nextHeight = getHeight();
          const nextCount = getCandidateCount();
          if (Math.abs(nextHeight - previousHeight) <= 24 && nextCount === previousCount) {
            stableRounds += 1;
          } else {
            stableRounds = 0;
          }
          previousHeight = nextHeight;
          previousCount = nextCount || count;
          if (stableRounds >= 2 && nextCount > 0) {
            break;
          }
        }
        window.scrollTo(0, 0);
        await sleep(100);
        return document.documentElement ? document.documentElement.outerHTML : '';
      })()`);

      const pageRecord = {
        url,
        html: String(html || ''),
        source: 'edge-cdp',
        durationMs: durationSince(pageStartedAt)
      };
      pages.push(pageRecord);

      if (typeof options.onPage === 'function') {
        const shouldContinue = await options.onPage(pageRecord);
        if (shouldContinue === false || (shouldContinue && shouldContinue.stop)) {
          break;
        }
      }

      if (typeof options.shouldStop === 'function' && options.shouldStop()) {
        break;
      }
    }

    return {
      pages,
      error: ''
    };
  } catch (error) {
    return {
      pages: [],
      error: error && error.message ? error.message : 'edge-cdp list fallback failed with unknown error'
    };
  } finally {
    if (connection && sessionId) {
      await connection.send('Target.detachFromTarget', { sessionId }).catch(() => undefined);
    }
    if (connection && targetId && shouldCloseTarget) {
      await connection.send('Target.closeTarget', { targetId }).catch(() => undefined);
    }
    if (connection) {
      await connection.close().catch(() => undefined);
    }
    if (browser && browser.pid) {
      killProcessTree(browser.pid);
    }
    if (shouldCleanupUserDataDir && userDataDir) {
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      } catch (_error) {
        // Edge can keep profile files locked briefly; cleanup should not fail parsing.
      }
    }
  }
}

function appendPageCandidates(target, pageCandidates = [], sourceOrderOffset = target.length) {
  for (let index = 0; index < pageCandidates.length; index += 1) {
    target.push({
      ...pageCandidates[index],
      sourceOrder: sourceOrderOffset + index + 1
    });
  }
}

function pickEdgeFallbackPageUrls(pageUrls = [], htmlPageResults = new Map()) {
  const fallbackUrls = [];

  for (const pageUrl of pageUrls) {
    const result = htmlPageResults.get(pageUrl);
    if (!result || result.failed || Number(result.candidateCount || 0) === 0) {
      fallbackUrls.push(pageUrl);
    }
  }

  return fallbackUrls.length > 0 ? fallbackUrls : (htmlPageResults.size === 0 ? pageUrls : []);
}

async function collectListPageCandidates(listUrl, template = {}, rawFilters = {}, options = {}) {
  const totalStartedAt = Date.now();
  const filters = normalizeListPageFilterOptions(rawFilters);
  const pageUrls = buildListPageUrls(listUrl, filters.maxPages);
  const pages = [];
  const errors = [];
  const htmlPageResults = new Map();
  const fetchPageHtml = typeof options.fetchHtml === 'function' ? options.fetchHtml : fetchHtml;
  const capturePagesWithEdge = typeof options.captureListHtmlPagesWithEdge === 'function'
    ? options.captureListHtmlPagesWithEdge
    : captureListHtmlPagesWithEdge;
  const performance = {
    htmlFetchMs: 0,
    edgeFallbackMs: 0,
    totalMs: 0,
    htmlPages: [],
    edgePages: []
  };
  let candidates = [];
  let prefilter = filterListPageCandidates(candidates, filters);

  for (let pageIndex = 0; pageIndex < pageUrls.length; pageIndex += 1) {
    const pageUrl = pageUrls[pageIndex];
    const pageStartedAt = Date.now();
    try {
      const page = await fetchPageHtml(pageUrl, DESKTOP_HEADERS);
      const pageCandidates = parseListPageCandidatesFromHtml(page.html, pageUrl, {
        template,
        filters,
        sourceOrderOffset: pageIndex * filters.maxCandidatesPerPage
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
      appendPageCandidates(candidates, pageCandidates, pageIndex * filters.maxCandidatesPerPage);
      prefilter = filterListPageCandidates(candidates, filters);
      if (prefilter.selected.length >= filters.desiredHotelCount) {
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
  if (prefilter.selected.length < filters.desiredHotelCount && shouldAttemptEdgeListFallback(options)) {
    const edgePageUrls = pickEdgeFallbackPageUrls(pageUrls, htmlPageResults);
    const edgeStartedAt = Date.now();
    const parsedEdgeUrls = new Set();
    const applyEdgePage = (edgePage) => {
      const pageIndex = Math.max(0, pageUrls.indexOf(edgePage.url));
      const pageCandidates = parseListPageCandidatesFromHtml(edgePage.html, edgePage.url, {
        template,
        filters,
        sourceOrderOffset: pageIndex * filters.maxCandidatesPerPage
      });
      const pageRecord = {
        url: edgePage.url,
        source: edgePage.source || 'edge-cdp',
        candidateCount: pageCandidates.length,
        durationMs: edgePage.durationMs
      };
      pages.push(pageRecord);
      performance.edgePages.push(pageRecord);
      appendPageCandidates(candidates, pageCandidates, pageIndex * filters.maxCandidatesPerPage);
      parsedEdgeUrls.add(edgePage.url);
      prefilter = filterListPageCandidates(candidates, filters);
    };
    edgeCapture = edgePageUrls.length > 0
      ? await capturePagesWithEdge(edgePageUrls, options.edgeSession || {}, {
        onPage: (edgePage) => {
          applyEdgePage(edgePage);
          return prefilter.selected.length < filters.desiredHotelCount;
        },
        shouldStop: () => prefilter.selected.length >= filters.desiredHotelCount
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
    for (const edgePage of edgeCapture.pages || []) {
      if (!parsedEdgeUrls.has(edgePage.url)) {
        applyEdgePage(edgePage);
        if (prefilter.selected.length >= filters.desiredHotelCount) {
          break;
        }
      }
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
    edgeFallbackUsed: Boolean(edgeCapture && ((edgeCapture.pages || []).length || edgeCapture.error)),
    performance
  };
}

module.exports = {
  buildListPageUrls,
  captureListHtmlPagesWithEdge,
  collectListPageCandidates,
  shouldAttemptEdgeListFallback
};
