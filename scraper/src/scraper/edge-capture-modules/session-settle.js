const {
  evaluateInSession,
  createCdpAbortError = (method) => {
    const error = new Error(`CDP ${method} aborted`);
    error.name = 'AbortError';
    error.code = 'CDP_ABORTED';
    return error;
  }
} = require('../cdp-utils');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SETTLE_HELPERS = `
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitForDomIdle = async (idleMs = 220, timeoutMs = 1000) => {
  const root = document.body || document.documentElement;
  if (!root || typeof MutationObserver !== 'function') {
    await sleep(idleMs);
    return;
  }
  try {
    await new Promise((resolve) => {
      let settled = false;
      let idleTimer = null;
      let timeoutTimer = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (idleTimer) clearTimeout(idleTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        observer.disconnect();
        resolve();
      };
      const observer = new MutationObserver(() => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(finish, idleMs);
      });
      observer.observe(root, { childList: true, subtree: true, attributes: true });
      idleTimer = setTimeout(finish, idleMs);
      timeoutTimer = setTimeout(finish, timeoutMs);
    });
  } catch (_error) {
    await sleep(idleMs);
  }
};
const getDocumentHeight = () => Math.max(
  document.body ? document.body.scrollHeight : 0,
  document.documentElement ? document.documentElement.scrollHeight : 0,
  window.innerHeight || 0
);
const readBodyText = () => (document.body && document.body.innerText) ? document.body.innerText : '';
const collectStats = () => {
  const bodyText = readBodyText();
  const roomKeywordMatches = bodyText.match(/房型|房间|大床房|双床房|家庭房|三人间|套房|登录看低价|每晚|¥/g);
  return {
    documentHeight: getDocumentHeight(),
    bodyTextLength: bodyText.length,
    roomKeywordCount: roomKeywordMatches ? roomKeywordMatches.length : 0
  };
};
const MAX_GENERIC_EXPAND_CLICKS = 6;
const getSettleClickState = () => {
  if (!window.__ctripSettleClickedElements) {
    window.__ctripSettleClickedElements = new WeakSet();
  }
  if (!window.__ctripSettleClickedGenericKeys) {
    window.__ctripSettleClickedGenericKeys = new Set();
  }
  return {
    clickedElements: window.__ctripSettleClickedElements,
    clickedGenericKeys: window.__ctripSettleClickedGenericKeys
  };
};
const buildGenericClickKey = (element, text, rect) => {
  const className = typeof element.className === 'string' ? element.className : '';
  return [
    element.tagName || '',
    element.getAttribute('role') || '',
    text.slice(0, 80),
    Math.round(rect.width),
    Math.round(rect.height),
    className.slice(0, 40)
  ].join('|');
};
const EXPLICIT_EXPAND_SCAN_SELECTORS = [
  'button',
  'a',
  'li',
  'label',
  '[role="button"]',
  '[role="link"]',
  '[aria-expanded]',
  '[data-testid]',
  '[data-click]'
];
const FALLBACK_EXPAND_SCAN_SELECTORS = [
  ...EXPLICIT_EXPAND_SCAN_SELECTORS,
  'div',
  'span'
];
const getExpandScanElements = (includeGenericText = true) => Array.from(document.querySelectorAll(
  (includeGenericText ? FALLBACK_EXPAND_SCAN_SELECTORS : EXPLICIT_EXPAND_SCAN_SELECTORS).join(', ')
));
const isActionableExplicitExpandElement = (element, text, rect) => {
  const tagName = element.tagName || '';
  const role = element.getAttribute('role') || '';
  const isActionableTag = ['BUTTON', 'A', 'LI'].includes(tagName);
  const isActionableRole = /button|link|tab/i.test(role);
  const hasClickHint = Boolean(
    element.onclick ||
      element.getAttribute('aria-expanded') ||
      element.getAttribute('data-testid') ||
      element.getAttribute('data-click')
  );
  const compactEnough = text.length <= 80 && rect.height <= 120 && rect.width <= window.innerWidth * 0.98;
  return isActionableTag || isActionableRole || hasClickHint || compactEnough;
};
const isActionableGenericRoomElement = (element, text, rect) => {
  const tagName = element.tagName || '';
  const role = element.getAttribute('role') || '';
  const isActionableTag = ['BUTTON', 'A', 'LI'].includes(tagName);
  const isActionableRole = /button|link|tab/i.test(role);
  const hasClickHint = Boolean(
    element.onclick ||
      element.getAttribute('aria-expanded') ||
      element.getAttribute('data-testid') ||
      element.getAttribute('data-click')
  );
  const compactEnough = text.length <= 40 && rect.height <= 90 && rect.width <= window.innerWidth * 0.95;
  return (
    (isActionableTag || isActionableRole || hasClickHint) &&
    compactEnough &&
    rect.top > window.innerHeight * 0.25
  );
};
const finishStats = (before, extra = {}) => {
  const after = collectStats();
  return {
    clickedCount: extra.clickedCount || 0,
    earlyStopCount: extra.earlyStopCount || 0,
    emptyCloseFastPathCount: extra.emptyCloseFastPathCount || 0,
    initialExpandFastPathCount: extra.initialExpandFastPathCount || 0,
    scanCandidateCount: extra.scanCandidateCount || 0,
    explicitCandidateCount: extra.explicitCandidateCount || 0,
    genericCandidateCount: extra.genericCandidateCount || 0,
    clickScanElapsedMs: Math.round(extra.clickScanElapsedMs || 0),
    explicitScanCandidateCount: extra.explicitScanCandidateCount || 0,
    fallbackScanCandidateCount: extra.fallbackScanCandidateCount || 0,
    genericFallbackScanCount: extra.genericFallbackScanCount || 0,
    genericFallbackSuppressedCount: extra.genericFallbackSuppressedCount || 0,
    skippedDuplicateClickCount: extra.skippedDuplicateClickCount || 0,
    genericClickCount: extra.genericClickCount || 0,
    scrollCount: extra.scrollCount || 0,
    containerCount: extra.containerCount || 0,
    likelyContainerCount: extra.likelyContainerCount || 0,
    fallbackContainerCount: extra.fallbackContainerCount || 0,
    skippedBottomExpandCount: extra.skippedBottomExpandCount || 0,
    documentHeightBefore: before.documentHeight,
    documentHeightAfter: after.documentHeight,
    bodyTextLength: after.bodyTextLength,
    roomKeywordCount: after.roomKeywordCount
  };
};
const dispatchClick = (element, rect) => {
  try { element.click(); } catch(_e) {}
  try {
    ['mousedown', 'mouseup', 'click'].forEach((eventType) => {
      const event = new MouseEvent(eventType, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2
      });
      element.dispatchEvent(event);
    });
  } catch(_e) {}
};
const closeReviewPanels = () => {
  let clicked = 0;
  try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch(_e) {}

  const closeSelectors = [
    '[class*="close"]', '[class*="Close"]',
    '[class*="modal"] [class*="close"]', '[class*="Modal"] [class*="Close"]',
    '[class*="overlay"]', '[class*="Overlay"]',
    '[class*="dialog"] [class*="close"]', '[class*="Dialog"] [class*="Close"]',
    '[class*="review-panel"] [class*="close"]',
    '[class*="comment-panel"] [class*="close"]',
    '[aria-label="关闭"]', '[aria-label="Close"]',
  ];
  for (const sel of closeSelectors) {
    try {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0) {
          dispatchClick(el, rect);
          clicked += 1;
        }
      }
    } catch(_e) {}
  }

  window.scrollTo({ top: 0, behavior: 'instant' });
  return clicked;
};
const scanExpandElements = (elements, options = {}) => {
  const allowGeneric = options.allowGeneric !== false;
  const processedElements = options.processedElements || new Set();
  const expandTexts = ['展示额外', '更多房型价格', '展开全部房型',
                       '查看全部房型', '全部房型'];
  const genericTexts = ['房型'];
  let clicked = 0;
  let skippedDuplicateClickCount = 0;
  let genericClickCount = 0;
  let explicitCandidateCount = 0;
  let genericCandidateCount = 0;
  let scanCandidateCount = 0;
  const { clickedElements, clickedGenericKeys } = getSettleClickState();
  for (const element of elements) {
    if (processedElements.has(element)) continue;
    processedElements.add(element);
    scanCandidateCount += 1;
    const text = (element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim();
    if (!text) continue;
    if (isCollapseOnlyRoomToggle(text)) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const isExpand =
      expandTexts.some((item) => text.includes(item)) &&
      isActionableExplicitExpandElement(element, text, rect);
    const isGeneric = allowGeneric && !isExpand && genericTexts.some((item) => text.includes(item))
                      && isActionableGenericRoomElement(element, text, rect);
    if (!isExpand && !isGeneric) continue;
    if (isExpand) explicitCandidateCount += 1;
    if (isGeneric) genericCandidateCount += 1;
    if (clickedElements.has(element)) {
      skippedDuplicateClickCount += 1;
      continue;
    }
    if (isGeneric) {
      if (genericClickCount >= MAX_GENERIC_EXPAND_CLICKS) {
        continue;
      }
      const genericKey = buildGenericClickKey(element, text, rect);
      if (clickedGenericKeys.has(genericKey)) {
        skippedDuplicateClickCount += 1;
        continue;
      }
      clickedGenericKeys.add(genericKey);
      genericClickCount += 1;
    }
    clickedElements.add(element);
    dispatchClick(element, rect);
    clicked += 1;
  }
  return {
    clickedCount: clicked,
    skippedDuplicateClickCount,
    genericClickCount,
    scanCandidateCount,
    explicitCandidateCount,
    genericCandidateCount
  };
};
const mergeClickStats = (target, next) => {
  target.clickedCount += next.clickedCount || 0;
  target.skippedDuplicateClickCount += next.skippedDuplicateClickCount || 0;
  target.genericClickCount += next.genericClickCount || 0;
  target.scanCandidateCount += next.scanCandidateCount || 0;
  target.explicitCandidateCount += next.explicitCandidateCount || 0;
  target.genericCandidateCount += next.genericCandidateCount || 0;
};
const clickExpandButtons = (options = {}) => {
  const allowGenericFallback = options.allowGenericFallback !== false;
  const scanStartedAt = performance.now();
  const processedElements = new Set();
  const result = {
    clickedCount: 0,
    skippedDuplicateClickCount: 0,
    genericClickCount: 0,
    scanCandidateCount: 0,
    explicitCandidateCount: 0,
    genericCandidateCount: 0,
    clickScanElapsedMs: 0,
    explicitScanCandidateCount: 0,
    fallbackScanCandidateCount: 0,
    genericFallbackScanCount: 0,
    genericFallbackSuppressedCount: 0
  };
  const explicitStats = scanExpandElements(getExpandScanElements(false), {
    allowGeneric: false,
    processedElements
  });
  mergeClickStats(result, explicitStats);
  result.explicitScanCandidateCount = explicitStats.scanCandidateCount;

  if (explicitStats.clickedCount === 0 && allowGenericFallback) {
    result.genericFallbackScanCount = 1;
    const fallbackStats = scanExpandElements(getExpandScanElements(true), {
      allowGeneric: true,
      processedElements
    });
    mergeClickStats(result, fallbackStats);
    result.fallbackScanCandidateCount = fallbackStats.scanCandidateCount;
  } else if (explicitStats.clickedCount === 0 && !allowGenericFallback) {
    result.genericFallbackSuppressedCount = 1;
  }

  result.clickScanElapsedMs = performance.now() - scanStartedAt;
  return result;
};
const isCollapseOnlyRoomToggle = (text) => (
  /隐藏房型|收起房型|收起全部|折叠房型/.test(text) &&
  !/展示额外|更多房型价格|展开全部房型|查看全部房型|全部房型/.test(text)
);
const getScrollableContainers = () => Array.from(document.querySelectorAll('*')).filter(el => {
  const style = window.getComputedStyle(el);
  return (style.overflowY === 'auto' || style.overflowY === 'scroll')
         && el.scrollHeight > el.clientHeight + 50;
}).sort((left, right) => right.scrollHeight - left.scrollHeight);
const isLikelyRoomScrollContainer = (element) => {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }
  const text = (element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim();
  if (!text || text.length < 20) {
    return false;
  }
  const keywordMatches = text.match(/房型|房间|大床|双床|家庭房|亲子房|三人间|套房|每晚|¥|登录看低价|解锁优惠|免费取消/g);
  return Boolean(keywordMatches && keywordMatches.length >= 2);
};
const selectLikelyRoomScrollContainers = () => {
  const scrollableContainers = getScrollableContainers();
  const likelyContainers = scrollableContainers.filter(isLikelyRoomScrollContainer).slice(0, 3);
  if (likelyContainers.length > 0) {
    return {
      containers: likelyContainers,
      likelyContainerCount: likelyContainers.length,
      fallbackContainerCount: 0
    };
  }
  const fallbackContainers = scrollableContainers.slice(0, 3);
  return {
    containers: fallbackContainers,
    likelyContainerCount: 0,
    fallbackContainerCount: fallbackContainers.length
  };
};
const scrollAllContainers = async () => {
  const containerSelection = selectLikelyRoomScrollContainers();
  const scrollableContainers = containerSelection.containers;
  let clickedCount = 0;
  let skippedDuplicateClickCount = 0;
  let genericClickCount = 0;
  let scanCandidateCount = 0;
  let explicitCandidateCount = 0;
  let genericCandidateCount = 0;
  let clickScanElapsedMs = 0;
  let explicitScanCandidateCount = 0;
  let fallbackScanCandidateCount = 0;
  let genericFallbackScanCount = 0;
  let genericFallbackSuppressedCount = 0;
  let scrollCount = 0;
  for (const container of scrollableContainers) {
    for (const ratio of [0, 0.5, 1]) {
      const maxScrollTop = Math.max(container.scrollHeight - container.clientHeight, 0);
      container.scrollTop = Math.round(maxScrollTop * ratio);
      scrollCount += 1;
      await sleep(140);
      const clicked = clickExpandButtons();
      clickedCount += clicked.clickedCount;
      skippedDuplicateClickCount += clicked.skippedDuplicateClickCount;
      genericClickCount += clicked.genericClickCount;
      scanCandidateCount += clicked.scanCandidateCount;
      explicitCandidateCount += clicked.explicitCandidateCount;
      genericCandidateCount += clicked.genericCandidateCount;
      clickScanElapsedMs += clicked.clickScanElapsedMs;
      explicitScanCandidateCount += clicked.explicitScanCandidateCount;
      fallbackScanCandidateCount += clicked.fallbackScanCandidateCount;
      genericFallbackScanCount += clicked.genericFallbackScanCount;
      genericFallbackSuppressedCount += clicked.genericFallbackSuppressedCount;
      if (clicked.clickedCount > 0) {
        await waitForDomIdle(180, 700);
      } else {
        await sleep(60);
      }
    }
    container.scrollTop = 0;
  }
  return {
    clickedCount,
    skippedDuplicateClickCount,
    genericClickCount,
    scanCandidateCount,
    explicitCandidateCount,
    genericCandidateCount,
    clickScanElapsedMs,
    explicitScanCandidateCount,
    fallbackScanCandidateCount,
    genericFallbackScanCount,
    genericFallbackSuppressedCount,
    scrollCount,
    containerCount: scrollableContainers.length,
    likelyContainerCount: containerSelection.likelyContainerCount,
    fallbackContainerCount: containerSelection.fallbackContainerCount
  };
};
`;

function createNoopPerf() {
  return {
    phase() {
      return {
        end() {},
        error() {}
      };
    }
  };
}

function parseStepResult(result) {
  if (!result) {
    return {};
  }
  if (typeof result === 'string') {
    try {
      return JSON.parse(result);
    } catch (_error) {
      return {};
    }
  }
  return typeof result === 'object' ? result : {};
}

function normalizeStepStats(stats = {}) {
  return {
    clickedCount: Number(stats.clickedCount || 0),
    earlyStopCount: Number(stats.earlyStopCount || 0),
    emptyCloseFastPathCount: Number(stats.emptyCloseFastPathCount || 0),
    initialExpandFastPathCount: Number(stats.initialExpandFastPathCount || 0),
    scanCandidateCount: Number(stats.scanCandidateCount || 0),
    explicitCandidateCount: Number(stats.explicitCandidateCount || 0),
    genericCandidateCount: Number(stats.genericCandidateCount || 0),
    clickScanElapsedMs: Number(stats.clickScanElapsedMs || 0),
    explicitScanCandidateCount: Number(stats.explicitScanCandidateCount || 0),
    fallbackScanCandidateCount: Number(stats.fallbackScanCandidateCount || 0),
    genericFallbackScanCount: Number(stats.genericFallbackScanCount || 0),
    genericFallbackSuppressedCount: Number(stats.genericFallbackSuppressedCount || 0),
    skippedDuplicateClickCount: Number(stats.skippedDuplicateClickCount || 0),
    genericClickCount: Number(stats.genericClickCount || 0),
    scrollCount: Number(stats.scrollCount || 0),
    containerCount: Number(stats.containerCount || 0),
    likelyContainerCount: Number(stats.likelyContainerCount || 0),
    fallbackContainerCount: Number(stats.fallbackContainerCount || 0),
    skippedBottomExpandCount: Number(stats.skippedBottomExpandCount || 0),
    documentHeightBefore: Number(stats.documentHeightBefore || 0),
    documentHeightAfter: Number(stats.documentHeightAfter || 0),
    bodyTextLength: Number(stats.bodyTextLength || 0),
    roomKeywordCount: Number(stats.roomKeywordCount || 0)
  };
}

function toPerfFields(stats, trackedUrlCountBefore, trackedUrlCountAfter) {
  return {
    clicked_count: stats.clickedCount,
    early_stop_count: stats.earlyStopCount,
    empty_close_fast_path_count: stats.emptyCloseFastPathCount,
    initial_expand_fast_path_count: stats.initialExpandFastPathCount,
    scan_candidate_count: stats.scanCandidateCount,
    explicit_candidate_count: stats.explicitCandidateCount,
    generic_candidate_count: stats.genericCandidateCount,
    click_scan_elapsed_ms: stats.clickScanElapsedMs,
    explicit_scan_candidate_count: stats.explicitScanCandidateCount,
    fallback_scan_candidate_count: stats.fallbackScanCandidateCount,
    generic_fallback_scan_count: stats.genericFallbackScanCount,
    generic_fallback_suppressed_count: stats.genericFallbackSuppressedCount,
    skipped_duplicate_click_count: stats.skippedDuplicateClickCount,
    generic_click_count: stats.genericClickCount,
    scroll_count: stats.scrollCount,
    container_count: stats.containerCount,
    likely_container_count: stats.likelyContainerCount,
    fallback_container_count: stats.fallbackContainerCount,
    skipped_bottom_expand_count: stats.skippedBottomExpandCount,
    document_height_before: stats.documentHeightBefore,
    document_height_after: stats.documentHeightAfter,
    body_text_length: stats.bodyTextLength,
    room_keyword_count: stats.roomKeywordCount,
    tracked_url_count_before: trackedUrlCountBefore,
    tracked_url_count_after: trackedUrlCountAfter
  };
}

function mergeStepStats(aggregate, stats) {
  aggregate.clickedCount += stats.clickedCount;
  aggregate.earlyStopCount += stats.earlyStopCount;
  aggregate.emptyCloseFastPathCount += stats.emptyCloseFastPathCount;
  aggregate.initialExpandFastPathCount += stats.initialExpandFastPathCount;
  aggregate.scanCandidateCount += stats.scanCandidateCount;
  aggregate.explicitCandidateCount += stats.explicitCandidateCount;
  aggregate.genericCandidateCount += stats.genericCandidateCount;
  aggregate.clickScanElapsedMs += stats.clickScanElapsedMs;
  aggregate.explicitScanCandidateCount += stats.explicitScanCandidateCount;
  aggregate.fallbackScanCandidateCount += stats.fallbackScanCandidateCount;
  aggregate.genericFallbackScanCount += stats.genericFallbackScanCount;
  aggregate.genericFallbackSuppressedCount += stats.genericFallbackSuppressedCount;
  aggregate.skippedDuplicateClickCount += stats.skippedDuplicateClickCount;
  aggregate.genericClickCount += stats.genericClickCount;
  aggregate.scrollCount += stats.scrollCount;
  aggregate.containerCount = Math.max(aggregate.containerCount, stats.containerCount);
  aggregate.likelyContainerCount += stats.likelyContainerCount;
  aggregate.fallbackContainerCount += stats.fallbackContainerCount;
  aggregate.skippedBottomExpandCount += stats.skippedBottomExpandCount;
  if (!aggregate.documentHeightBefore && stats.documentHeightBefore) {
    aggregate.documentHeightBefore = stats.documentHeightBefore;
  }
  aggregate.documentHeightAfter = stats.documentHeightAfter || aggregate.documentHeightAfter;
  aggregate.bodyTextLength = stats.bodyTextLength || aggregate.bodyTextLength;
  aggregate.roomKeywordCount = stats.roomKeywordCount || aggregate.roomKeywordCount;
}

function shouldSkipBottomExpandAfterStableSettle(aggregate) {
  const containerStats = aggregate.steps.edge_settle_scroll_containers;
  if (!containerStats) {
    return false;
  }

  const heightStable =
    containerStats.documentHeightBefore > 0 &&
    Math.abs(containerStats.documentHeightAfter - containerStats.documentHeightBefore) <= 24;
  const noNewExpansion =
    containerStats.clickedCount === 0 && containerStats.genericClickCount === 0;
  const roomContainerWasTargeted =
    containerStats.likelyContainerCount > 0 && containerStats.fallbackContainerCount === 0;

  return (
    heightStable &&
    noNewExpansion &&
    roomContainerWasTargeted &&
    containerStats.roomKeywordCount > 0
  );
}

function buildSkippedBottomExpandStats(aggregate) {
  const containerStats = aggregate.steps.edge_settle_scroll_containers || {};
  const documentHeight =
    containerStats.documentHeightAfter ||
    aggregate.documentHeightAfter ||
    containerStats.documentHeightBefore ||
    0;
  return normalizeStepStats({
    skippedBottomExpandCount: 1,
    documentHeightBefore: documentHeight,
    documentHeightAfter: documentHeight,
    bodyTextLength: containerStats.bodyTextLength || aggregate.bodyTextLength || 0,
    roomKeywordCount: containerStats.roomKeywordCount || aggregate.roomKeywordCount || 0
  });
}

function getTransientSettleRetryReason(error) {
  const message = error && error.message ? String(error.message) : String(error || '');
  if (/Execution context was destroyed|Cannot find context with specified id/i.test(message)) {
    return 'execution_context_destroyed';
  }
  return '';
}

async function runSettleStep({
  connection,
  sessionId,
  perf,
  phase,
  baseFields,
  getTrackedUrlCount,
  body,
  signal,
  evaluateTimeoutMs
}) {
  const trackedUrlCountBefore = getTrackedUrlCount();
  const phaseTimer = perf.phase(phase, {
    ...baseFields,
    tracked_url_count_before: trackedUrlCountBefore
  });
  let retryCount = 0;
  let retryReason = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await evaluateInSession(
        connection,
        sessionId,
        `(async () => {
          ${SETTLE_HELPERS}
          ${body}
        })()`,
        {
          timeoutMs:
            Number.isFinite(evaluateTimeoutMs) && evaluateTimeoutMs > 0 ? evaluateTimeoutMs : 6000,
          signal: signal || null
        }
      );
      const stats = normalizeStepStats(parseStepResult(result));
      const trackedUrlCountAfter = getTrackedUrlCount();
      phaseTimer.end('success', {
        ...toPerfFields(stats, trackedUrlCountBefore, trackedUrlCountAfter),
        retry_count: retryCount,
        retry_reason: retryReason
      });
      return stats;
    } catch (error) {
      retryReason = getTransientSettleRetryReason(error);
      if (retryReason && attempt === 0 && !(signal && signal.aborted)) {
        retryCount += 1;
        if (perf && typeof perf.event === 'function') {
          perf.event('edge_settle_step_retry', {
            ...baseFields,
            phase,
            retry_count: retryCount,
            retry_reason: retryReason
          });
        }
        await sleep(120);
        continue;
      }
      phaseTimer.error(error, {
        tracked_url_count_before: trackedUrlCountBefore,
        tracked_url_count_after: getTrackedUrlCount(),
        retry_count: retryCount,
        retry_reason: retryReason
      });
      throw error;
    }
  }

  throw new Error(`Failed to run settle step ${phase}`);
}

async function settleRoomListInEdgeSession(connection, sessionId, options = {}) {
  const perf = options.perf || createNoopPerf();
  const baseFields = options.fields || {};
  const getTrackedUrlCount =
    typeof options.getTrackedUrlCount === 'function' ? options.getTrackedUrlCount : () => 0;
  const assertNotAborted = () => {
    if (options.signal && options.signal.aborted) {
      throw createCdpAbortError('settleRoomListInEdgeSession');
    }
  };
  const startedAt = Date.now();
  const aggregate = {
    totalMs: 0,
    clickedCount: 0,
    earlyStopCount: 0,
    emptyCloseFastPathCount: 0,
    initialExpandFastPathCount: 0,
    scanCandidateCount: 0,
    explicitCandidateCount: 0,
    genericCandidateCount: 0,
    clickScanElapsedMs: 0,
    explicitScanCandidateCount: 0,
    fallbackScanCandidateCount: 0,
    genericFallbackScanCount: 0,
    genericFallbackSuppressedCount: 0,
    skippedDuplicateClickCount: 0,
    genericClickCount: 0,
    scrollCount: 0,
    containerCount: 0,
    likelyContainerCount: 0,
    fallbackContainerCount: 0,
    skippedBottomExpandCount: 0,
    documentHeightBefore: 0,
    documentHeightAfter: 0,
    bodyTextLength: 0,
    roomKeywordCount: 0,
    steps: {}
  };

  const steps = [
    {
      phase: 'edge_settle_close_panels',
      body: `
        const before = collectStats();
        const clickedCount = closeReviewPanels();
        let emptyCloseFastPathCount = 0;
        if (clickedCount > 0) {
          await waitForDomIdle(180, 700);
        } else {
          emptyCloseFastPathCount = 1;
          await sleep(35);
        }
        window.scrollTo({ top: 0, behavior: 'instant' });
        await sleep(clickedCount > 0 ? 120 : 35);
        return JSON.stringify(finishStats(before, { clickedCount, emptyCloseFastPathCount, scrollCount: 1 }));
      `
    },
    {
      phase: 'edge_settle_initial_expand',
      body: `
        const before = collectStats();
        window.scrollTo({ top: 0, behavior: 'instant' });
        await sleep(90);
        const clickStats = clickExpandButtons();
        let initialExpandFastPathCount = 0;
        if (clickStats.clickedCount > 0) {
          await waitForDomIdle(200, 800);
        } else {
          initialExpandFastPathCount = 1;
          await sleep(55);
        }
        return JSON.stringify(finishStats(before, { ...clickStats, initialExpandFastPathCount, scrollCount: 1 }));
      `
    },
    {
      phase: 'edge_settle_main_scroll',
      body: `
        const before = collectStats();
        const maxScroll = getDocumentHeight();
        const steps = 6;
        let previousHeight = maxScroll;
        let stableHeightRounds = 0;
        let clickedCount = 0;
        let earlyStopCount = 0;
        let skippedDuplicateClickCount = 0;
        let genericClickCount = 0;
        let scanCandidateCount = 0;
        let explicitCandidateCount = 0;
        let genericCandidateCount = 0;
        let clickScanElapsedMs = 0;
        let explicitScanCandidateCount = 0;
        let fallbackScanCandidateCount = 0;
        let genericFallbackScanCount = 0;
        let genericFallbackSuppressedCount = 0;
        let scrollCount = 0;
        let previousRoomKeywordCount = before.roomKeywordCount;
        let stableRoomSignalRounds = 0;
        for (let index = 0; index <= steps; index += 1) {
          const currentMaxScroll = getDocumentHeight();
          const y = Math.round((currentMaxScroll * index) / steps);
          window.scrollTo({ top: y, behavior: 'instant' });
          scrollCount += 1;
          await sleep(150);
          const preClickStats = collectStats();
          const roomSignalStableBeforeClick =
            preClickStats.roomKeywordCount >= 4 &&
            Math.abs(preClickStats.roomKeywordCount - previousRoomKeywordCount) <= 2;
          const allowGenericFallback = index >= 2 && roomSignalStableBeforeClick;
          const clicked = clickExpandButtons({ allowGenericFallback });
          clickedCount += clicked.clickedCount;
          skippedDuplicateClickCount += clicked.skippedDuplicateClickCount;
          genericClickCount += clicked.genericClickCount;
          scanCandidateCount += clicked.scanCandidateCount;
          explicitCandidateCount += clicked.explicitCandidateCount;
          genericCandidateCount += clicked.genericCandidateCount;
          clickScanElapsedMs += clicked.clickScanElapsedMs;
          explicitScanCandidateCount += clicked.explicitScanCandidateCount;
          fallbackScanCandidateCount += clicked.fallbackScanCandidateCount;
          genericFallbackScanCount += clicked.genericFallbackScanCount;
          genericFallbackSuppressedCount += clicked.genericFallbackSuppressedCount;
          if (clicked.clickedCount > 0) {
            await waitForDomIdle(180, 750);
          } else {
            await sleep(45);
          }
          const currentStats = collectStats();
          const currentHeight = currentStats.documentHeight;
          if (Math.abs(currentHeight - previousHeight) <= 24) {
            stableHeightRounds += 1;
          } else {
            stableHeightRounds = 0;
          }
          previousHeight = currentHeight;
          if (
            currentStats.roomKeywordCount >= 4 &&
            Math.abs(currentStats.roomKeywordCount - previousRoomKeywordCount) <= 2
          ) {
            stableRoomSignalRounds += 1;
          } else {
            stableRoomSignalRounds = 0;
          }
          previousRoomKeywordCount = currentStats.roomKeywordCount;
          const noNewExpansion = clicked.clickedCount === 0 && clicked.genericClickCount === 0;
          if (
            stableHeightRounds >= 1 &&
            stableRoomSignalRounds >= 1 &&
            noNewExpansion &&
            index >= 2
          ) {
            earlyStopCount = 1;
            break;
          }
          if (stableHeightRounds >= 2 && noNewExpansion && index >= Math.floor(steps / 2)) {
            earlyStopCount = 1;
            break;
          }
        }
        return JSON.stringify(finishStats(before, {
          clickedCount,
          earlyStopCount,
          skippedDuplicateClickCount,
          genericClickCount,
          scanCandidateCount,
          explicitCandidateCount,
          genericCandidateCount,
          clickScanElapsedMs,
          explicitScanCandidateCount,
          fallbackScanCandidateCount,
          genericFallbackScanCount,
          genericFallbackSuppressedCount,
          scrollCount
        }));
      `
    },
    {
      phase: 'edge_settle_scroll_containers',
      body: `
        const before = collectStats();
        const stats = await scrollAllContainers();
        return JSON.stringify(finishStats(before, stats));
      `
    },
    {
      phase: 'edge_settle_bottom_expand',
      body: `
        const before = collectStats();
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });
        await sleep(260);
        const clickStats = clickExpandButtons();
        if (clickStats.clickedCount > 0) {
          await waitForDomIdle(320, 1100);
        } else {
          await sleep(320);
        }
        return JSON.stringify(finishStats(before, { ...clickStats, scrollCount: 1 }));
      `
    },
    {
      phase: 'edge_settle_return_top',
      body: `
        const before = collectStats();
        window.scrollTo({ top: 0, behavior: 'instant' });
        await sleep(100);
        return JSON.stringify(finishStats(before, { scrollCount: 1 }));
      `
    }
  ];

  for (const step of steps) {
    assertNotAborted();
    if (
      step.phase === 'edge_settle_bottom_expand' &&
      shouldSkipBottomExpandAfterStableSettle(aggregate)
    ) {
      const trackedUrlCount = getTrackedUrlCount();
      const phaseTimer = perf.phase(step.phase, {
        ...baseFields,
        tracked_url_count_before: trackedUrlCount
      });
      const stats = buildSkippedBottomExpandStats(aggregate);
      aggregate.steps[step.phase] = stats;
      mergeStepStats(aggregate, stats);
      phaseTimer.end('skipped', {
        ...toPerfFields(stats, trackedUrlCount, trackedUrlCount),
        skip_reason: 'stable_after_room_container_scroll'
      });
      continue;
    }

    const stats = await runSettleStep({
      connection,
      sessionId,
      perf,
      phase: step.phase,
      baseFields,
      getTrackedUrlCount,
      body: step.body,
      signal: options.signal || null,
      evaluateTimeoutMs: options.evaluateTimeoutMs
    });
    aggregate.steps[step.phase] = stats;
    mergeStepStats(aggregate, stats);
  }

  aggregate.totalMs = Date.now() - startedAt;
  return aggregate;
}

module.exports = {
  settleRoomListInEdgeSession
};
