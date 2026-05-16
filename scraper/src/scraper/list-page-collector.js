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

async function captureListHtmlPagesWithEdge(pageUrls = [], edgeSessionOptions = {}) {
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
        for (let index = 0; index < 4; index += 1) {
          window.scrollTo(0, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
          await sleep(350);
        }
        window.scrollTo(0, 0);
        await sleep(150);
        return document.documentElement ? document.documentElement.outerHTML : '';
      })()`);

      pages.push({
        url,
        html: String(html || ''),
        source: 'edge-cdp'
      });
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

function appendPageCandidates(target, pageCandidates = []) {
  const offset = target.length;
  for (let index = 0; index < pageCandidates.length; index += 1) {
    target.push({
      ...pageCandidates[index],
      sourceOrder: offset + index + 1
    });
  }
}

async function collectListPageCandidates(listUrl, template = {}, rawFilters = {}, options = {}) {
  const filters = normalizeListPageFilterOptions(rawFilters);
  const pageUrls = buildListPageUrls(listUrl, filters.maxPages);
  const pages = [];
  const errors = [];
  let candidates = [];
  let prefilter = filterListPageCandidates(candidates, filters);

  for (const pageUrl of pageUrls) {
    try {
      const page = await fetchHtml(pageUrl, DESKTOP_HEADERS);
      const pageCandidates = parseListPageCandidatesFromHtml(page.html, pageUrl, {
        template,
        filters,
        sourceOrderOffset: candidates.length
      });
      pages.push({
        url: pageUrl,
        source: 'html',
        candidateCount: pageCandidates.length
      });
      appendPageCandidates(candidates, pageCandidates);
      prefilter = filterListPageCandidates(candidates, filters);
      if (prefilter.selected.length >= filters.desiredHotelCount) {
        break;
      }
    } catch (error) {
      errors.push({
        url: pageUrl,
        source: 'html',
        error: error && error.message ? error.message : String(error)
      });
    }
  }

  let edgeCapture = null;
  if (prefilter.selected.length < filters.desiredHotelCount && shouldAttemptEdgeListFallback(options)) {
    edgeCapture = await captureListHtmlPagesWithEdge(pageUrls, options.edgeSession || {});
    if (edgeCapture.error) {
      errors.push({
        url: listUrl,
        source: 'edge-cdp',
        error: edgeCapture.error
      });
    }

    for (const edgePage of edgeCapture.pages || []) {
      const pageCandidates = parseListPageCandidatesFromHtml(edgePage.html, edgePage.url, {
        template,
        filters,
        sourceOrderOffset: candidates.length
      });
      pages.push({
        url: edgePage.url,
        source: edgePage.source || 'edge-cdp',
        candidateCount: pageCandidates.length
      });
      appendPageCandidates(candidates, pageCandidates);
    }
    prefilter = filterListPageCandidates(candidates, filters);
  }

  candidates = candidates.sort((left, right) => left.sourceOrder - right.sourceOrder);
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
    edgeFallbackUsed: Boolean(edgeCapture)
  };
}

module.exports = {
  buildListPageUrls,
  captureListHtmlPagesWithEdge,
  collectListPageCandidates,
  shouldAttemptEdgeListFallback
};
