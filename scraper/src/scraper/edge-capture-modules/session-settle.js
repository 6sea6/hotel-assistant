const { evaluateInSession } = require('../cdp-utils');

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
    skippedDuplicateClickCount: extra.skippedDuplicateClickCount || 0,
    genericClickCount: extra.genericClickCount || 0,
    scrollCount: extra.scrollCount || 0,
    containerCount: extra.containerCount || 0,
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

  const tabTexts = ['服务及设施', '政策', '地点', '酒店简介', '订房必读'];
  const allElements = Array.from(document.querySelectorAll(
    '[role="tab"], [class*="tab"], [class*="Tab"], nav a, .nav-item, [class*="nav"] [class*="item"]'
  ));
  for (const tabText of tabTexts) {
    for (const el of allElements) {
      const text = (el.innerText || el.textContent || '').trim();
      if (text === tabText || text.includes(tabText)) {
        const rect = el.getBoundingClientRect();
        dispatchClick(el, rect);
        clicked += 1;
        return clicked;
      }
    }
  }

  window.scrollTo({ top: 0, behavior: 'instant' });
  return clicked;
};
const clickExpandButtons = () => {
  const expandTexts = ['展示额外', '隐藏房型', '更多房型价格', '展开全部房型',
                       '查看全部房型', '全部房型'];
  const genericTexts = ['房型'];
  let clicked = 0;
  let skippedDuplicateClickCount = 0;
  let genericClickCount = 0;
  const elements = Array.from(document.querySelectorAll(
    'button, a, div, span, li, p, h1, h2, h3, h4, h5, h6, section, article, label'
  ));
  const { clickedElements, clickedGenericKeys } = getSettleClickState();
  for (const element of elements) {
    const text = (element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim();
    if (!text) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const isExpand = expandTexts.some((item) => text.includes(item));
    const isGeneric = !isExpand && genericTexts.some((item) => text.includes(item))
                      && isActionableGenericRoomElement(element, text, rect);
    if (!isExpand && !isGeneric) continue;
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
  return { clickedCount: clicked, skippedDuplicateClickCount, genericClickCount };
};
const scrollAllContainers = async () => {
  const scrollableContainers = Array.from(document.querySelectorAll('*')).filter(el => {
    const style = window.getComputedStyle(el);
    return (style.overflowY === 'auto' || style.overflowY === 'scroll')
           && el.scrollHeight > el.clientHeight + 50;
  }).sort((left, right) => right.scrollHeight - left.scrollHeight).slice(0, 3);
  let clickedCount = 0;
  let skippedDuplicateClickCount = 0;
  let genericClickCount = 0;
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
    scrollCount,
    containerCount: scrollableContainers.length
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
    skippedDuplicateClickCount: Number(stats.skippedDuplicateClickCount || 0),
    genericClickCount: Number(stats.genericClickCount || 0),
    scrollCount: Number(stats.scrollCount || 0),
    containerCount: Number(stats.containerCount || 0),
    documentHeightBefore: Number(stats.documentHeightBefore || 0),
    documentHeightAfter: Number(stats.documentHeightAfter || 0),
    bodyTextLength: Number(stats.bodyTextLength || 0),
    roomKeywordCount: Number(stats.roomKeywordCount || 0)
  };
}

function toPerfFields(stats, trackedUrlCountBefore, trackedUrlCountAfter) {
  return {
    clicked_count: stats.clickedCount,
    skipped_duplicate_click_count: stats.skippedDuplicateClickCount,
    generic_click_count: stats.genericClickCount,
    scroll_count: stats.scrollCount,
    container_count: stats.containerCount,
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
  aggregate.skippedDuplicateClickCount += stats.skippedDuplicateClickCount;
  aggregate.genericClickCount += stats.genericClickCount;
  aggregate.scrollCount += stats.scrollCount;
  aggregate.containerCount = Math.max(aggregate.containerCount, stats.containerCount);
  if (!aggregate.documentHeightBefore && stats.documentHeightBefore) {
    aggregate.documentHeightBefore = stats.documentHeightBefore;
  }
  aggregate.documentHeightAfter = stats.documentHeightAfter || aggregate.documentHeightAfter;
  aggregate.bodyTextLength = stats.bodyTextLength || aggregate.bodyTextLength;
  aggregate.roomKeywordCount = stats.roomKeywordCount || aggregate.roomKeywordCount;
}

async function runSettleStep({
  connection,
  sessionId,
  perf,
  phase,
  baseFields,
  getTrackedUrlCount,
  body
}) {
  const trackedUrlCountBefore = getTrackedUrlCount();
  const phaseTimer = perf.phase(phase, {
    ...baseFields,
    tracked_url_count_before: trackedUrlCountBefore
  });
  try {
    const result = await evaluateInSession(
      connection,
      sessionId,
      `(async () => {
        ${SETTLE_HELPERS}
        ${body}
      })()`
    );
    const stats = normalizeStepStats(parseStepResult(result));
    const trackedUrlCountAfter = getTrackedUrlCount();
    phaseTimer.end('success', toPerfFields(stats, trackedUrlCountBefore, trackedUrlCountAfter));
    return stats;
  } catch (error) {
    phaseTimer.error(error, {
      tracked_url_count_before: trackedUrlCountBefore,
      tracked_url_count_after: getTrackedUrlCount()
    });
    throw error;
  }
}

async function settleRoomListInEdgeSession(connection, sessionId, options = {}) {
  const perf = options.perf || createNoopPerf();
  const baseFields = options.fields || {};
  const getTrackedUrlCount =
    typeof options.getTrackedUrlCount === 'function' ? options.getTrackedUrlCount : () => 0;
  const startedAt = Date.now();
  const aggregate = {
    totalMs: 0,
    clickedCount: 0,
    skippedDuplicateClickCount: 0,
    genericClickCount: 0,
    scrollCount: 0,
    containerCount: 0,
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
        await waitForDomIdle(180, 700);
        window.scrollTo({ top: 0, behavior: 'instant' });
        await sleep(120);
        return JSON.stringify(finishStats(before, { clickedCount, scrollCount: 1 }));
      `
    },
    {
      phase: 'edge_settle_initial_expand',
      body: `
        const before = collectStats();
        window.scrollTo({ top: 0, behavior: 'instant' });
        await sleep(140);
        const clickStats = clickExpandButtons();
        if (clickStats.clickedCount > 0) {
          await waitForDomIdle(220, 900);
        } else {
          await sleep(180);
        }
        return JSON.stringify(finishStats(before, { ...clickStats, scrollCount: 1 }));
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
        let skippedDuplicateClickCount = 0;
        let genericClickCount = 0;
        let scrollCount = 0;
        for (let index = 0; index <= steps; index += 1) {
          const currentMaxScroll = getDocumentHeight();
          const y = Math.round((currentMaxScroll * index) / steps);
          window.scrollTo({ top: y, behavior: 'instant' });
          scrollCount += 1;
          await sleep(180);
          const clicked = clickExpandButtons();
          clickedCount += clicked.clickedCount;
          skippedDuplicateClickCount += clicked.skippedDuplicateClickCount;
          genericClickCount += clicked.genericClickCount;
          if (clicked.clickedCount > 0) {
            await waitForDomIdle(220, 900);
          } else {
            await sleep(70);
          }
          const currentHeight = getDocumentHeight();
          if (Math.abs(currentHeight - previousHeight) <= 24) {
            stableHeightRounds += 1;
          } else {
            stableHeightRounds = 0;
          }
          previousHeight = currentHeight;
          if (stableHeightRounds >= 2 && clicked.clickedCount === 0 && index >= Math.floor(steps / 2)) {
            break;
          }
        }
        return JSON.stringify(finishStats(before, { clickedCount, skippedDuplicateClickCount, genericClickCount, scrollCount }));
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
    const stats = await runSettleStep({
      connection,
      sessionId,
      perf,
      phase: step.phase,
      baseFields,
      getTrackedUrlCount,
      body: step.body
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
