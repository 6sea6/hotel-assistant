const { evaluateInSession, waitForSessionCondition } = require('./cdp-utils');
const { normalizeEdgePageDecision } = require('./list-page-prefilter-strategy');
const {
  acquireListPageTarget,
  cleanupListEdgeSession,
  connectListEdgeSession,
  findEdgeExecutable,
  getEdgeWebSocket,
  normalizeEdgeSessionOptions
} = require('./list-page-cdp-session');
const {
  drainListNetworkResponses,
  fetchListApiPagesInEdgeSession,
  isCtripListNetworkResponse
} = require('./list-page-network-drain');
const {
  buildListPageScrollExpression,
  delay,
  dispatchCdpWheelScroll,
  parseListPageScrollResult,
  waitForPromiseOrTimeout
} = require('./list-page-scroll-policy');

function durationSince(startedAt) {
  return Math.max(0, Date.now() - startedAt);
}

function normalizePositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function getListEdgeCaptureDefaults(options = {}) {
  const desiredHotelCount = normalizePositiveNumber(options.desiredHotelCount, 0);
  const smallTarget = desiredHotelCount > 0 && desiredHotelCount <= 3;

  return {
    maxScrollRounds: smallTarget ? 6 : 20,
    stableRoundLimit: smallTarget ? 1 : 3,
    initialSettleMs: smallTarget ? 900 : 2500,
    scrollEvaluateTimeoutMs: smallTarget ? 3000 : 5000
  };
}

function buildListApiReplayPageRecord(url, snapshot = {}, durationMs = 0, networkSnapshot = {}) {
  return {
    url,
    html: [networkSnapshot.html, snapshot.html].filter(Boolean).join('\n'),
    source: 'edge-list-api-replay',
    durationMs,
    scrollRound: 0,
    scrollHeight: 0,
    candidateDomCount: 0,
    scrollContainerCount: 0,
    scrollActions: 0,
    documentHeightBefore: 0,
    documentHeightAfter: 0,
    bodyTextLength: 0,
    scrollYBefore: 0,
    scrollYAfter: 0,
    bodyScrollTopBefore: 0,
    bodyScrollTopAfter: 0,
    documentScrollTopBefore: 0,
    documentScrollTopAfter: 0,
    networkResponseCount: Number(networkSnapshot.count) || 0,
    listApiResponseCount: Number(snapshot.count) || 0,
    listApiPageIndexes: Array.isArray(snapshot.pageIndexes) ? snapshot.pageIndexes : [],
    listApiError: snapshot.error || '',
    fullHtmlIncluded: false
  };
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
      error:
        'edge-cdp list fallback unavailable: WebSocket is not present and ws package not installed'
    };
  }

  const sessionOptions = normalizeEdgeSessionOptions(edgeSessionOptions);
  const edgeExecutable = findEdgeExecutable({
    browserPreference: sessionOptions.browserPreference
  });
  if (!sessionOptions.debuggerUrl && !edgeExecutable) {
    return {
      pages: [],
      error: 'edge-cdp list fallback unavailable: Edge or 360 browser not found'
    };
  }

  let browser = null;
  let browserExecutable = '';
  let browserPort = 0;
  let connection = null;
  let userDataDir = '';
  let shouldCleanupUserDataDir = false;
  let targetId = '';
  let sessionId = '';
  let shouldCloseTarget = false;
  let stopNetworkListener = null;

  try {
    const connectedSession = await connectListEdgeSession(
      edgeSessionOptions,
      EdgeWebSocket,
      edgeExecutable
    );
    browser = connectedSession.browser;
    browserExecutable = connectedSession.browserExecutable || edgeExecutable;
    browserPort = connectedSession.browserPort || sessionOptions.debuggingPort || 0;
    connection = connectedSession.connection;
    userDataDir = connectedSession.userDataDir;
    shouldCleanupUserDataDir = connectedSession.shouldCleanupUserDataDir;

    const targetSession = await acquireListPageTarget(connection);
    targetId = targetSession.targetId;
    sessionId = targetSession.sessionId;
    shouldCloseTarget = targetSession.shouldCloseTarget;
    if (targetSession.error) {
      return {
        pages: [],
        error: targetSession.error
      };
    }

    await connection.send('Page.enable', {}, sessionId);
    await connection.send('Runtime.enable', {}, sessionId);
    const listNetworkResponses = [];
    const processedListNetworkResponses = new Set();
    stopNetworkListener = connection.addListener((message) => {
      if (
        !message ||
        message.sessionId !== sessionId ||
        message.method !== 'Network.responseReceived'
      ) {
        return;
      }
      const params = message.params || {};
      const response = params.response || {};
      if (!isCtripListNetworkResponse(response.url)) {
        return;
      }
      listNetworkResponses.push({
        requestId: params.requestId,
        url: response.url,
        status: response.status,
        mimeType: response.mimeType || ''
      });
    });
    await connection
      .send(
        'Network.enable',
        {
          maxResourceBufferSize: 50 * 1024 * 1024,
          maxTotalBufferSize: 100 * 1024 * 1024
        },
        sessionId
      )
      .catch(() => undefined);
    const pages = [];
    const captureDefaults = getListEdgeCaptureDefaults(options);
    const maxScrollRounds = options.maxScrollRounds || captureDefaults.maxScrollRounds;
    const stableRoundLimit = options.stableRoundLimit || captureDefaults.stableRoundLimit;
    const scrollEvaluateTimeoutMs =
      options.scrollEvaluateTimeoutMs || captureDefaults.scrollEvaluateTimeoutMs;

    for (const url of pageUrls) {
      if (typeof options.shouldStop === 'function' && options.shouldStop()) {
        break;
      }

      const loadEvent = new Promise((resolve) => {
        const stopListening = connection.addListener((message) => {
          if (message.sessionId === sessionId && message.method === 'Page.loadEventFired') {
            stopListening();
            resolve();
          }
        });
      });

      await connection.send('Page.navigate', { url }, sessionId);
      await waitForPromiseOrTimeout(loadEvent, 15000);
      await waitForSessionCondition(
        connection,
        sessionId,
        `(() => {
        const bodyText = document.body && document.body.innerText ? document.body.innerText : '';
        return document.readyState === 'complete' && /(酒店|宾馆|评分|点评|价格|携程)/.test(bodyText);
      })()`,
        5000,
        250
      );
      const initialSettleMs =
        options.initialSettleMs === undefined
          ? captureDefaults.initialSettleMs
          : Math.max(0, Number(options.initialSettleMs) || 0);
      if (initialSettleMs > 0) {
        await delay(initialSettleMs);
      }
      let listApiReplayDurationMs = 0;
      let pendingListApiSnapshot = { count: 0, html: '', pageIndexes: [], error: '' };
      if (options.enableListApiReplay !== false) {
        const listApiReplayStartedAt = Date.now();
        pendingListApiSnapshot = await fetchListApiPagesInEdgeSession(connection, sessionId, {
          desiredHotelCount: options.desiredHotelCount,
          maxListApiReplayPages: options.maxListApiReplayPages
        });
        listApiReplayDurationMs = durationSince(listApiReplayStartedAt);
      }

      if (
        (pendingListApiSnapshot.html || listNetworkResponses.length > 0) &&
        typeof options.onPage === 'function'
      ) {
        const fastSnapshotStartedAt = Date.now();
        const networkSnapshot = await drainListNetworkResponses(
          connection,
          sessionId,
          listNetworkResponses,
          processedListNetworkResponses
        );
        const replayRecord = buildListApiReplayPageRecord(
          url,
          pendingListApiSnapshot,
          listApiReplayDurationMs + durationSince(fastSnapshotStartedAt),
          networkSnapshot
        );
        if (replayRecord.html) {
          pendingListApiSnapshot = { count: 0, html: '', pageIndexes: [], error: '' };
          pages.push(replayRecord);
          const edgePageDecision = normalizeEdgePageDecision(await options.onPage(replayRecord));
          if (
            edgePageDecision.stop ||
            (typeof options.shouldStop === 'function' && options.shouldStop())
          ) {
            continue;
          }
        }
      }

      let previousHeight = 0;
      let previousCount = -1;
      let previousProgressCount = 0;
      let stableRounds = 0;

      for (let round = 0; round < maxScrollRounds; round += 1) {
        const roundStartedAt = Date.now();
        const scrollResult = await evaluateInSession(
          connection,
          sessionId,
          buildListPageScrollExpression({
            includeFullEdgeHtml: options.includeFullEdgeHtml === true
          }),
          {
            timeoutMs: scrollEvaluateTimeoutMs
          }
        );
        const parsed = parseListPageScrollResult(scrollResult);
        await dispatchCdpWheelScroll(connection, sessionId);
        await delay(350);
        const networkSnapshot = await drainListNetworkResponses(
          connection,
          sessionId,
          listNetworkResponses,
          processedListNetworkResponses
        );
        const listApiSnapshot = pendingListApiSnapshot;
        pendingListApiSnapshot = { count: 0, html: '', pageIndexes: [], error: '' };
        const domHtml = String(parsed.html || parsed.candidateHtml || '');

        const pageRecord = {
          url,
          html: [domHtml, networkSnapshot.html, listApiSnapshot.html].filter(Boolean).join('\n'),
          source: 'edge-cdp',
          durationMs: durationSince(roundStartedAt),
          scrollRound: round + 1,
          scrollHeight: Number(parsed.scrollHeight) || 0,
          candidateDomCount: Number(parsed.candidateCount) || 0,
          scrollContainerCount: Number(parsed.scrollContainerCount) || 0,
          scrollActions: Number(parsed.scrollActions) || 0,
          documentHeightBefore: Number(parsed.documentHeightBefore) || 0,
          documentHeightAfter: Number(parsed.documentHeightAfter) || 0,
          bodyTextLength: Number(parsed.bodyTextLength) || 0,
          scrollYBefore: Number(parsed.scrollYBefore) || 0,
          scrollYAfter: Number(parsed.scrollYAfter) || 0,
          bodyScrollTopBefore: Number(parsed.bodyScrollTopBefore) || 0,
          bodyScrollTopAfter: Number(parsed.bodyScrollTopAfter) || 0,
          documentScrollTopBefore: Number(parsed.documentScrollTopBefore) || 0,
          documentScrollTopAfter: Number(parsed.documentScrollTopAfter) || 0,
          networkResponseCount: networkSnapshot.count,
          listApiResponseCount: Number(listApiSnapshot.count) || 0,
          listApiPageIndexes: Array.isArray(listApiSnapshot.pageIndexes)
            ? listApiSnapshot.pageIndexes
            : [],
          listApiError: listApiSnapshot.error || '',
          fullHtmlIncluded: Boolean(parsed.fullHtmlIncluded)
        };
        pages.push(pageRecord);

        let edgePageDecision = { stop: false, progressCount: null };
        if (typeof options.onPage === 'function') {
          const shouldContinue = await options.onPage(pageRecord);
          edgePageDecision = normalizeEdgePageDecision(shouldContinue);
          if (edgePageDecision.stop) {
            break;
          }
        }

        if (typeof options.shouldStop === 'function' && options.shouldStop()) {
          break;
        }

        const currentHeight = Number(parsed.scrollHeight) || 0;
        const currentCount = Number(parsed.candidateCount) || 0;
        const currentProgress =
          edgePageDecision.progressCount === null
            ? previousProgressCount
            : edgePageDecision.progressCount;
        const progressChanged = currentProgress > previousProgressCount;
        if (
          !progressChanged &&
          Math.abs(currentHeight - previousHeight) <= 24 &&
          currentCount === previousCount &&
          previousCount >= 0
        ) {
          stableRounds += 1;
        } else {
          stableRounds = 0;
        }
        previousHeight = currentHeight;
        previousCount = currentCount;
        previousProgressCount = Math.max(previousProgressCount, currentProgress);
        if (stableRounds >= stableRoundLimit) {
          break;
        }
      }
    }

    return {
      pages,
      error: ''
    };
  } catch (error) {
    return {
      pages: [],
      error:
        error && error.message ? error.message : 'edge-cdp list fallback failed with unknown error'
    };
  } finally {
    await cleanupListEdgeSession({
      stopNetworkListener,
      connection,
      sessionId,
      targetId,
      shouldCloseTarget,
      browser,
      browserExecutable,
      browserPort,
      shouldCleanupUserDataDir,
      userDataDir
    });
  }
}

module.exports = {
  captureListHtmlPagesWithEdge
};
