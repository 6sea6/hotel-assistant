const {
  buildDesktopUrl,
  buildListPageUrl,
  buildUrlOverridesFromTemplate,
  classifyCtripHotelUrl,
  extractCtripUrlsFromInput,
  parseHotelIdFromUrl
} = require('./ctrip-url');
const {
  buildCtripListUrl,
  hasCtripUrlFilterSettings,
  normalizeCtripUrlFilterSettings
} = require('./ctrip-url-filters');
const { DESKTOP_HEADERS, fetchHtml } = require('./scraper/html-parser');
const { collectListPageCandidates } = require('./scraper/list-page-collector');
const { normalizeListPageFilterOptions } = require('./scraper/list-page-parser');
const {
  connectToDebugger,
  evaluateInSession,
  launchManagedEdgeSession,
  normalizeEdgeSessionOptions,
  waitForDebuggerEndpoint,
  waitForSessionCondition
} = require('./scraper/cdp-utils');
const { findEdgeExecutable, killProcessTree } = require('./scraper/process-utils');
const { normalizeText } = require('./utils');

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
      error:
        'edge-cdp list fallback unavailable: WebSocket is not present and ws package not installed'
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
        const launched = await launchManagedEdgeSession(
          edgeExecutable,
          sessionOptions,
          sessionOptions.debuggingPort
        );
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
      const blankTarget = targets.find(
        (target) => target.type === 'page' && (!target.url || target.url === 'about:blank')
      );
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

    const attachedTarget = await connection.send('Target.attachToTarget', {
      targetId,
      flatten: true
    });
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
      await Promise.race([loadEvent, new Promise((resolve) => setTimeout(resolve, 15000))]);
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

      const html = await evaluateInSession(
        connection,
        sessionId,
        `(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        for (let index = 0; index < 4; index += 1) {
          window.scrollTo(0, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
          await sleep(350);
        }
        window.scrollTo(0, 0);
        await sleep(150);
        return document.documentElement ? document.documentElement.outerHTML : '';
      })()`
      );

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
      error:
        error && error.message ? error.message : 'edge-cdp list fallback failed with unknown error'
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
        require('fs').rmSync(userDataDir, { recursive: true, force: true });
      } catch (_error) {
        // Edge can keep profile files locked briefly; cleanup should not fail parsing.
      }
    }
  }
}

function buildListPageUrls(listUrl, maxPages) {
  const pageCount = Math.max(1, Math.trunc(Number(maxPages) || 1));
  return Array.from({ length: pageCount }, (_, index) => buildListPageUrl(listUrl, index + 1));
}

function durationSince(startedAt) {
  return Math.max(0, Date.now() - startedAt);
}

async function collectHotelListCandidates(listUrl, template = {}, rawFilters = {}, options = {}) {
  if (typeof options.collectListPageCandidates === 'function') {
    return options.collectListPageCandidates(listUrl, template, rawFilters, options);
  }

  return collectListPageCandidates(listUrl, template, rawFilters, options);
}

function buildDetailInput(url, template = {}, source = 'detail-input', listCandidate = null) {
  const detailUrl = buildDesktopUrl(url, buildUrlOverridesFromTemplate(template));
  return {
    url: detailUrl,
    hotelId: parseHotelIdFromUrl(detailUrl),
    source,
    listCandidate
  };
}

function pickCtripUrlFilterSettings(rawInput = {}) {
  const nested =
    rawInput.listUrlFilters ||
    rawInput.ctripUrlFilters ||
    rawInput.ctripListFilters ||
    rawInput.urlFilters ||
    null;
  if (nested && typeof nested === 'object' && hasCtripUrlFilterSettings(nested)) {
    return normalizeCtripUrlFilterSettings(nested);
  }

  const topLevel = {};
  [
    'priceMin',
    'priceMax',
    'starLevels',
    'sortMode',
    'freeCancel',
    'reviewCountMin',
    'ctripScoreMin'
  ].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(rawInput, key)) {
      topLevel[key] = rawInput[key];
    }
  });

  return hasCtripUrlFilterSettings(topLevel) ? normalizeCtripUrlFilterSettings(topLevel) : null;
}

async function expandCtripHotelInputs(rawInput = {}, template = {}, rawFilters = {}, options = {}) {
  const startedAt = Date.now();
  const inputUrls = extractCtripUrlsFromInput({
    ...rawInput,
    url: rawInput.url || rawInput.ctrip_url || rawInput['ctrip-url'] || template.ctrip_url
  });
  const urls = inputUrls.length ? inputUrls : template.ctrip_url ? [template.ctrip_url] : [];
  const details = [];
  const listResults = [];
  const skipped = [];
  const seenDetailUrls = new Set();
  const filters = normalizeListPageFilterOptions(rawFilters);
  const ctripUrlFilterSettings = pickCtripUrlFilterSettings(rawInput);
  const performance = {
    totalMs: 0,
    listCollectMs: 0,
    lists: []
  };
  let selectedFromLists = 0;

  const addDetail = (detail) => {
    if (!detail.url || seenDetailUrls.has(detail.url)) {
      return;
    }
    seenDetailUrls.add(detail.url);
    details.push(detail);
  };

  for (const url of urls) {
    const classification = classifyCtripHotelUrl(url);
    if (classification.type === 'detail') {
      addDetail(buildDetailInput(url, template, 'detail-input'));
      continue;
    }

    if (classification.type !== 'list') {
      skipped.push({
        url,
        reason: 'unsupported_ctrip_hotel_url'
      });
      continue;
    }

    const effectiveListUrl = ctripUrlFilterSettings
      ? buildCtripListUrl(url, ctripUrlFilterSettings)
      : url;
    const remainingTarget = Math.max(1, filters.desiredHotelCount - selectedFromLists);
    const listStartedAt = Date.now();
    const listResult = await collectHotelListCandidates(
      effectiveListUrl,
      template,
      {
        ...filters,
        desiredHotelCount: remainingTarget,
        targetCount: remainingTarget
      },
      options
    );
    const listDurationMs = durationSince(listStartedAt);
    performance.listCollectMs += listDurationMs;
    performance.lists.push({
      inputUrl: url,
      effectiveListUrl,
      durationMs: listDurationMs,
      selectedCount: Array.isArray(listResult.selected) ? listResult.selected.length : 0,
      totalCandidates: Number(listResult.totalCandidates || 0),
      edgeFallbackUsed: Boolean(listResult.edgeFallbackUsed),
      collector: listResult.performance || null
    });
    listResults.push(listResult);
    selectedFromLists += listResult.selected.length;

    for (const candidate of listResult.selected) {
      addDetail(
        buildDetailInput(
          candidate.detailUrl || candidate.url,
          template,
          'list-prefilter',
          candidate
        )
      );
    }
  }

  const listCount = listResults.length;
  const detailInputCount = details.filter((item) => item.source === 'detail-input').length;
  const inputMode =
    listCount > 0 && detailInputCount > 0
      ? 'mixed'
      : listCount > 0
        ? 'list'
        : details.length > 1
          ? 'multi-detail'
          : 'detail';
  performance.totalMs = durationSince(startedAt);

  return {
    inputMode,
    requestedUrls: urls,
    hotelInputs: details,
    listResults,
    performance,
    skippedUrls: skipped,
    summary: {
      inputMode,
      requestedUrlCount: urls.length,
      detailInputCount,
      listInputCount: listCount,
      expandedHotelCount: details.length,
      listSelectedCount: details.filter((item) => item.source === 'list-prefilter').length,
      skippedUrlCount: skipped.length,
      listCandidateCount: listResults.reduce(
        (sum, item) => sum + (Number(item.totalCandidates) || 0),
        0
      ),
      listRejectedCount: listResults.reduce(
        (sum, item) => sum + (Array.isArray(item.rejected) ? item.rejected.length : 0),
        0
      ),
      filters,
      performance
    }
  };
}

function normalizeListFiltersFromArgs(args = {}) {
  const listFilters =
    args.listFilters && typeof args.listFilters === 'object' ? args.listFilters : {};
  return normalizeListPageFilterOptions({
    ...listFilters,
    excludeHotelTypes:
      args.excludeHotelTypes ??
      args.excludeAccommodationKeywords ??
      args.excludeAccommodationTypes ??
      args.excludeTypeKeywords ??
      args['exclude-hotel-types'] ??
      args['exclude-accommodation-keywords'] ??
      args['exclude-type-keywords'] ??
      listFilters.excludeHotelTypes ??
      listFilters.excludeAccommodationKeywords,
    desiredHotelCount:
      args.desiredHotelCount ??
      args.targetCount ??
      args['desired-hotel-count'] ??
      args['target-count'] ??
      args.limit ??
      listFilters.desiredHotelCount ??
      listFilters.targetCount,
    maxPages: args.maxPages ?? args['max-pages'] ?? args.pageLimit ?? listFilters.maxPages,
    maxCandidatesPerPage:
      args.maxCandidatesPerPage ??
      args['max-candidates-per-page'] ??
      listFilters.maxCandidatesPerPage
  });
}

function hasMultipleHotelInputs(expandedInputs = {}) {
  return Array.isArray(expandedInputs.hotelInputs) && expandedInputs.hotelInputs.length > 1;
}

function describeExpandedInput(expandedInputs = {}) {
  const summary = expandedInputs.summary || {};
  const parts = [
    `模式=${summary.inputMode || expandedInputs.inputMode || ''}`,
    `输入URL=${summary.requestedUrlCount ?? 0}`,
    `展开酒店=${summary.expandedHotelCount ?? 0}`
  ];
  if (summary.listInputCount) {
    parts.push(`列表页=${summary.listInputCount}`);
    parts.push(`前筛候选=${summary.listCandidateCount ?? 0}`);
    parts.push(`前筛排除=${summary.listRejectedCount ?? 0}`);
  }
  return parts.map(normalizeText).filter(Boolean).join('，');
}

module.exports = {
  buildDetailInput,
  captureListHtmlPagesWithEdge,
  collectHotelListCandidates,
  describeExpandedInput,
  expandCtripHotelInputs,
  hasMultipleHotelInputs,
  normalizeListFiltersFromArgs
};
