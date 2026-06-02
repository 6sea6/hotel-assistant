const fs = require('fs');
const {
  connectToDebugger,
  evaluateInSession,
  launchManagedEdgeSession,
  normalizeEdgeSessionOptions,
  waitForDebuggerEndpoint,
  waitForSessionCondition
} = require('./cdp-utils');
const { findEdgeExecutable, killProcessTree } = require('./process-utils');
const { normalizeEdgePageDecision } = require('./list-page-prefilter-strategy');

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

function durationSince(startedAt) {
  return Math.max(0, Date.now() - startedAt);
}

async function waitForPromiseOrTimeout(promise, timeoutMs) {
  let timeoutId = null;
  try {
    await Promise.race([
      promise,
      new Promise((resolve) => {
        timeoutId = setTimeout(resolve, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function isCtripListNetworkResponse(url) {
  return /\/restapi\/soa2\/34951\/fetchHotelList/i.test(String(url || ''));
}

function hasHotelListPayload(value) {
  return /"hotelList"|"hotelInfo"|"hotelId"|"masterHotelId"/i.test(String(value || ''));
}

async function drainListNetworkResponses(
  connection,
  sessionId,
  responses = [],
  processed = new Set()
) {
  const scripts = [];

  for (const response of responses) {
    if (!response || !response.requestId || processed.has(response.requestId)) {
      continue;
    }
    processed.add(response.requestId);

    let bodyResult;
    try {
      bodyResult = await connection.send(
        'Network.getResponseBody',
        { requestId: response.requestId },
        sessionId
      );
    } catch (_error) {
      continue;
    }

    if (!bodyResult || bodyResult.base64Encoded) {
      continue;
    }
    const body = String(bodyResult.body || '').trim();
    if (!body || !hasHotelListPayload(body)) {
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (_error) {
      continue;
    }

    scripts.push(
      `<script type="application/json" data-source="edge-network-fetchHotelList">${JSON.stringify(parsed).replace(/<\/script/gi, '<\\/script')}</script>`
    );
  }

  return {
    html: scripts.join('\n'),
    count: scripts.length
  };
}

async function fetchListApiPagesInEdgeSession(connection, sessionId, options = {}) {
  const desiredCount = Math.max(0, Number(options.desiredHotelCount) || 0);
  if (!desiredCount) {
    return {
      count: 0,
      html: '',
      pageIndexes: [],
      error: ''
    };
  }

  const maxReplayPages = Math.min(
    8,
    Math.max(1, Number(options.maxListApiReplayPages) || Math.ceil(desiredCount / 8) + 1)
  );
  const expression = `(async () => {
    const targetCount = ${JSON.stringify(desiredCount)};
    const maxReplayPages = ${JSON.stringify(maxReplayPages)};
    const endpoint = 'https://m.ctrip.com/restapi/soa2/34951/fetchHotelList';
    const result = { responses: [], pageIndexes: [], error: '' };
    const chunks = Array.isArray(self.__next_f)
      ? self.__next_f.map((item) => Array.isArray(item) && typeof item[1] === 'string' ? item[1] : '').join('')
      : '';
    const extractObjectAfter = (source, marker) => {
      const markerIndex = String(source || '').indexOf(marker);
      if (markerIndex < 0) return null;
      const start = source.indexOf('{', markerIndex + marker.length);
      if (start < 0) return null;
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let index = start; index < source.length; index += 1) {
        const char = source[index];
        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (char === '\\\\') {
            escaped = true;
          } else if (char === '"') {
            inString = false;
          }
          continue;
        }
        if (char === '"') {
          inString = true;
          continue;
        }
        if (char === '{') {
          depth += 1;
          continue;
        }
        if (char === '}') {
          depth -= 1;
          if (depth === 0) {
            return JSON.parse(source.slice(start, index + 1));
          }
        }
      }
      return null;
    };
    const readHotelIds = (value, output = []) => {
      if (!value || typeof value !== 'object' || output.length > 300) return output;
      if (Array.isArray(value)) {
        value.forEach((item) => readHotelIds(item, output));
        return output;
      }
      for (const key of ['hotelId', 'masterHotelId', 'hotelid', 'masterhotelid']) {
        const text = String(value[key] || '').trim();
        if (/^\\d{3,}$/.test(text)) {
          output.push(text);
        }
      }
      Object.values(value).forEach((item) => readHotelIds(item, output));
      return output;
    };
    const request = extractObjectAfter(chunks, '"initListRequest"');
    const initData = extractObjectAfter(chunks, '"initListData"');
    if (!request) {
      result.error = 'missing_init_list_request';
      return JSON.stringify(result);
    }
    const seenIds = new Set(readHotelIds(initData && initData.hotelList));
    const basePageIndex = Number(
      (request.paging && request.paging.pageIndex) ||
      (initData && initData.pagingInfo && initData.pagingInfo.pageIndex) ||
      1
    ) || 1;
    const pageSize = Number(
      (request.paging && request.paging.pageSize) ||
      (initData && initData.pagingInfo && initData.pagingInfo.pageSize) ||
      10
    ) || 10;

    for (
      let pageIndex = basePageIndex + 1;
      pageIndex <= basePageIndex + maxReplayPages && seenIds.size < targetCount;
      pageIndex += 1
    ) {
      const body = JSON.parse(JSON.stringify(request));
      body.paging = { ...(body.paging || {}), pageIndex, pageSize };
      body.hotelIdFilter = {
        ...(body.hotelIdFilter || {}),
        hotelAldyShown: Array.from(seenIds)
      };
      body.head = { ...(body.head || {}), isSSR: false };
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json, text/plain, */*',
          'content-type': 'application/json;charset=UTF-8'
        },
        body: JSON.stringify(body)
      });
      const data = await response.json().catch(() => null);
      const ids = readHotelIds(data);
      ids.forEach((id) => seenIds.add(id));
      result.responses.push({ pageIndex, status: response.status, data });
      result.pageIndexes.push(pageIndex);
      if (!ids.length) {
        break;
      }
    }
    return JSON.stringify(result);
  })()`;

  try {
    const rawResult = await evaluateInSession(connection, sessionId, expression);
    const parsed = JSON.parse(String(rawResult || '{}'));
    const responses = Array.isArray(parsed.responses) ? parsed.responses : [];
    const html = responses
      .filter((response) => response && response.data)
      .map(
        (response) =>
          `<script type="application/json" data-source="edge-list-api-replay" data-page-index="${Number(response.pageIndex) || ''}">${JSON.stringify(response.data).replace(/<\/script/gi, '<\\/script')}</script>`
      )
      .join('\n');
    return {
      count: responses.filter((response) => response && response.data).length,
      html,
      pageIndexes: Array.isArray(parsed.pageIndexes) ? parsed.pageIndexes : [],
      error: parsed.error || ''
    };
  } catch (error) {
    return {
      count: 0,
      html: '',
      pageIndexes: [],
      error: error && error.message ? error.message : String(error)
    };
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function dispatchCdpWheelScroll(connection, sessionId) {
  for (let index = 0; index < 3; index += 1) {
    await connection
      .send(
        'Input.dispatchMouseEvent',
        {
          type: 'mouseWheel',
          x: 600,
          y: 400,
          deltaY: 1200,
          deltaX: 0
        },
        sessionId
      )
      .catch(() => undefined);
    await delay(250);
  }
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
  let stopNetworkListener = null;

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
    const maxScrollRounds = options.maxScrollRounds || 20;
    const stableRoundLimit = options.stableRoundLimit || 3;

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
          ? 2500
          : Math.max(0, Number(options.initialSettleMs) || 0);
      if (initialSettleMs > 0) {
        await delay(initialSettleMs);
      }
      let pendingListApiSnapshot =
        options.enableListApiReplay === false
          ? { count: 0, html: '', pageIndexes: [], error: '' }
          : await fetchListApiPagesInEdgeSession(connection, sessionId, {
              desiredHotelCount: options.desiredHotelCount,
              maxListApiReplayPages: options.maxListApiReplayPages
            });

      let previousHeight = 0;
      let previousCount = -1;
      let previousProgressCount = 0;
      let stableRounds = 0;

      for (let round = 0; round < maxScrollRounds; round += 1) {
        const roundStartedAt = Date.now();
        const edgeHtmlExpression =
          options.includeFullEdgeHtml === true
            ? "document.documentElement ? document.documentElement.outerHTML : ''"
            : 'collectCandidateHtml()';
        const scrollResult = await evaluateInSession(
          connection,
          sessionId,
          `(async () => {
          const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          const getHeight = () => Math.max(
            document.body ? document.body.scrollHeight : 0,
            document.documentElement ? document.documentElement.scrollHeight : 0,
            window.innerHeight || 0
          );
          const getBodyText = () => document.body && document.body.innerText ? document.body.innerText : '';
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
          const collectCandidateHtml = () => {
            const selector = [
              'a[href*="/hotels/"]',
              'a[href*="hotelId="]',
              '[data-hotelid]',
              '[data-hotel-id]',
              '[data-offline-hotelid]',
              '[data-offline-hotelId]',
              '[class*="hotel"]',
              '[class*="Hotel"]'
            ].join(',');
            const fragments = [];
            const seen = new Set();
            let totalBytes = 0;
            const addFragment = (element) => {
              if (!element || seen.has(element)) return;
              seen.add(element);
              const html = String(element.outerHTML || '').trim();
              if (!html) return;
              fragments.push(html.slice(0, 12000));
              totalBytes += html.length;
            };
            for (const element of Array.from(document.querySelectorAll(selector))) {
              let candidate = element;
              for (let depth = 0; depth < 3; depth += 1) {
                const parent = candidate && candidate.parentElement;
                if (!parent || parent === document.body || parent === document.documentElement) {
                  break;
                }
                const text = parent.innerText || '';
                if (text.length > 30 && text.length <= 1800) {
                  candidate = parent;
                }
              }
              addFragment(candidate);
              if (fragments.length >= 120 || totalBytes >= 240000) {
                break;
              }
            }
            return fragments.join('\n');
          };
          const isVisible = (element) => {
            if (!element || element === document.body || element === document.documentElement) {
              return true;
            }
            const rect = element.getBoundingClientRect();
            if (!rect || rect.width < 120 || rect.height < 120) {
              return false;
            }
            const style = window.getComputedStyle(element);
            return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || 1) > 0;
          };
          const collectScrollableContainers = () => {
            const selector = [
              'main',
              '[role="main"]',
              '[class*="list"]',
              '[class*="List"]',
              '[class*="hotel"]',
              '[class*="Hotel"]',
              '[class*="search"]',
              '[class*="Search"]',
              '[class*="content"]',
              '[class*="Content"]',
              'section',
              'div'
            ].join(',');
            const scored = [];
            const seen = new Set();
            for (const element of Array.from(document.querySelectorAll(selector))) {
              if (seen.has(element) || !isVisible(element)) {
                continue;
              }
              seen.add(element);
              const clientHeight = element.clientHeight || 0;
              const scrollHeight = element.scrollHeight || 0;
              if (scrollHeight <= clientHeight + 80) {
                continue;
              }
              const rect = element.getBoundingClientRect();
              const text = element.innerText || '';
              const keywordBonus = /(酒店|宾馆|评分|点评|价格|携程)/.test(text) ? 100000 : 0;
              const classBonus = /(list|hotel|search|content|result)/i.test(element.className || '') ? 50000 : 0;
              scored.push({
                element,
                score: keywordBonus + classBonus + scrollHeight + rect.height
              });
            }
            return scored
              .sort((left, right) => right.score - left.score)
              .slice(0, 8)
              .map((item) => item.element);
          };
          const dispatchWheel = (target, deltaY) => {
            try {
              target.dispatchEvent(new WheelEvent('wheel', {
                bubbles: true,
                cancelable: true,
                deltaY
              }));
            } catch (_error) {
              // Some browser contexts can reject synthetic wheel events.
            }
          };
          const height = getHeight();
          const scrollYBefore = window.scrollY || window.pageYOffset || 0;
          const bodyScrollTopBefore = document.body ? document.body.scrollTop || 0 : 0;
          const documentScrollTopBefore = document.documentElement ? document.documentElement.scrollTop || 0 : 0;
          const bodyTextLength = getBodyText().length;
          const containers = [
            document.body,
            document.documentElement,
            ...collectScrollableContainers()
          ].filter(Boolean);
          let scrollActions = 0;
          for (let step = 0; step < 3; step += 1) {
            const pageDelta = Math.max(Math.floor((window.innerHeight || 900) * 0.85), 700);
            window.scrollBy(0, pageDelta);
            dispatchWheel(document.scrollingElement || document.documentElement || document.body, pageDelta);
            scrollActions += 1;
            for (const container of containers) {
              const before = container.scrollTop || 0;
              const delta = Math.max(Math.floor((container.clientHeight || 600) * 0.9), 500);
              container.scrollTop = Math.min(before + delta, container.scrollHeight || before + delta);
              dispatchWheel(container, delta);
              if ((container.scrollTop || 0) !== before) {
                scrollActions += 1;
              }
            }
            await sleep(180);
          }
          await sleep(250);
          const nextHeight = getHeight();
          const nextCount = getCandidateCount();
          const candidateHtml = collectCandidateHtml();
          const html = ${edgeHtmlExpression};
          return JSON.stringify({
            scrollHeight: nextHeight,
            candidateCount: nextCount,
            html,
            candidateHtml,
            fullHtmlIncluded: ${options.includeFullEdgeHtml === true ? 'true' : 'false'},
            scrollContainerCount: containers.length,
            scrollActions,
            documentHeightBefore: height,
            documentHeightAfter: nextHeight,
            bodyTextLength,
            scrollYBefore,
            scrollYAfter: window.scrollY || window.pageYOffset || 0,
            bodyScrollTopBefore,
            bodyScrollTopAfter: document.body ? document.body.scrollTop || 0 : 0,
            documentScrollTopBefore,
            documentScrollTopAfter: document.documentElement ? document.documentElement.scrollTop || 0 : 0
          });
        })()`
        );

        let parsed;
        try {
          parsed = JSON.parse(String(scrollResult || '{}'));
        } catch (_error) {
          parsed = { scrollHeight: 0, candidateCount: 0, html: '' };
        }
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
          currentCount > 0
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
    if (stopNetworkListener) {
      stopNetworkListener();
    }
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

module.exports = {
  captureListHtmlPagesWithEdge
};
