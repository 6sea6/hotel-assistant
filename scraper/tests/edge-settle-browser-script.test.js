const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSessionSettleStepExpression,
  createSessionSettleBrowserHelpers
} = require('../src/scraper/edge-capture-modules/session-settle-browser-script');

function createElement({
  tagName = 'DIV',
  text = '',
  className = '',
  attributes = {},
  rect = {},
  scrollHeight = 0,
  clientHeight = 0,
  overflowY = 'visible'
} = {}) {
  const top = Number(rect.top ?? 0);
  const height = Number(rect.height ?? 40);
  const width = Number(rect.width ?? 200);
  const left = Number(rect.left ?? 0);
  return {
    tagName: tagName.toUpperCase(),
    innerText: text,
    textContent: text,
    className,
    onclick: attributes.onclick || null,
    clickCount: 0,
    dispatchedEvents: [],
    scrollHeight,
    clientHeight,
    scrollTop: 0,
    overflowY,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null;
    },
    getBoundingClientRect() {
      return {
        top,
        bottom: top + height,
        left,
        width,
        height
      };
    },
    click() {
      this.clickCount += 1;
    },
    dispatchEvent(event) {
      this.dispatchedEvents.push(event.type);
    }
  };
}

function matchesSelector(element, selector) {
  const item = selector.trim();
  if (!item) return false;
  if (item === '*') return true;
  const tag = element.tagName.toLowerCase();
  if (/^[a-z]+$/i.test(item)) {
    return tag === item.toLowerCase();
  }
  const className = String(element.className || '');
  if (item.includes('[class*="close"]')) return className.includes('close');
  if (item.includes('[class*="Close"]')) return className.includes('Close');
  if (item.includes('[class*="overlay"]')) return className.includes('overlay');
  if (item.includes('[class*="Overlay"]')) return className.includes('Overlay');
  if (item.includes('[class*="room"]')) return className.includes('room');
  if (item.includes('[class*="Room"]')) return className.includes('Room');
  if (item.includes('[id*="room"]')) return String(element.getAttribute('id') || '').includes('room');
  if (item.includes('[id*="Room"]')) return String(element.getAttribute('id') || '').includes('Room');
  if (item === '[role="button"]') return element.getAttribute('role') === 'button';
  if (item === '[role="link"]') return element.getAttribute('role') === 'link';
  if (item === '[aria-expanded]') return element.getAttribute('aria-expanded') !== null;
  if (item === '[data-testid]') return element.getAttribute('data-testid') !== null;
  if (item === '[data-click]') return element.getAttribute('data-click') !== null;
  if (item === '[aria-label="关闭"]') return element.getAttribute('aria-label') === '关闭';
  if (item === '[aria-label="Close"]') return element.getAttribute('aria-label') === 'Close';
  return false;
}

function createFakeBrowser(elements, options = {}) {
  const queryLog = [];
  const bodyText = elements.map((element) => element.innerText || '').join('\n');
  const documentHeight = Number(options.documentHeight || 1600);
  const body = createElement({
    tagName: 'BODY',
    text: bodyText,
    rect: { top: 0, height: documentHeight, width: 1200 },
    scrollHeight: documentHeight,
    clientHeight: 800
  });
  const documentElement = createElement({
    tagName: 'HTML',
    text: bodyText,
    rect: { top: 0, height: documentHeight, width: 1200 },
    scrollHeight: documentHeight,
    clientHeight: 800
  });
  const dispatchedEvents = [];
  const scrollCalls = [];
  const document = {
    body,
    documentElement,
    queryLog,
    dispatchedEvents,
    querySelectorAll(selector) {
      queryLog.push(selector);
      const selectors = selector.split(',').map((item) => item.trim());
      return elements.filter((element) =>
        selectors.some((item) => matchesSelector(element, item))
      );
    },
    dispatchEvent(event) {
      dispatchedEvents.push(event);
    }
  };
  const window = {
    innerHeight: Number(options.innerHeight || 800),
    innerWidth: Number(options.innerWidth || 1200),
    scrollY: 0,
    pageYOffset: 0,
    scrollCalls,
    scrollTo(target) {
      const top = typeof target === 'object' ? Number(target.top || 0) : Number(target || 0);
      this.scrollY = top;
      this.pageYOffset = top;
      scrollCalls.push(target);
    },
    getComputedStyle(element) {
      return { overflowY: element.overflowY || 'visible' };
    }
  };
  return {
    document,
    window,
    queryLog,
    scrollCalls,
    dispatchedEvents
  };
}

function withBrowserGlobals(browser, callback) {
  const previous = {
    document: global.document,
    window: global.window,
    MutationObserver: global.MutationObserver,
    performance: global.performance,
    MouseEvent: global.MouseEvent,
    KeyboardEvent: global.KeyboardEvent
  };
  global.document = browser.document;
  global.window = browser.window;
  global.MutationObserver = undefined;
  let now = 0;
  global.performance = {
    now: () => {
      now += 3;
      return now;
    }
  };
  global.MouseEvent = class MouseEvent {
    constructor(type, init = {}) {
      this.type = type;
      Object.assign(this, init);
    }
  };
  global.KeyboardEvent = class KeyboardEvent {
    constructor(type, init = {}) {
      this.type = type;
      Object.assign(this, init);
    }
  };
  try {
    return callback(createSessionSettleBrowserHelpers());
  } finally {
    global.document = previous.document;
    global.window = previous.window;
    global.MutationObserver = previous.MutationObserver;
    global.performance = previous.performance;
    global.MouseEvent = previous.MouseEvent;
    global.KeyboardEvent = previous.KeyboardEvent;
  }
}

test('session settle builder keeps browser helpers outside session orchestrator', () => {
  const expression = buildSessionSettleStepExpression('return JSON.stringify({ clickedCount: 1 });');

  assert.ok(expression.includes('createSessionSettleBrowserHelpers'));
  assert.ok(expression.includes('return JSON.stringify({ clickedCount: 1 });'));
});

test('browser helper locates room section bounds before review content', () => {
  const browser = createFakeBrowser([
    createElement({
      text: '酒店顶部导航',
      rect: { top: 20, height: 40 }
    }),
    createElement({
      className: 'room-card',
      text: '房型 豪华大床房 免费取消 每晚 ¥398 预订',
      rect: { top: 420, height: 120 }
    }),
    createElement({
      className: 'room-card',
      text: '房间 高级双床房 登录看低价 每晚 ¥458 预订',
      rect: { top: 590, height: 120 }
    }),
    createElement({
      text: '住客点评 用户点评',
      rect: { top: 910, height: 80 }
    }),
    createElement({
      text: '附近的酒店 推荐酒店',
      rect: { top: 1160, height: 120 }
    })
  ]);

  withBrowserGlobals(browser, (helpers) => {
    const bounds = helpers.getRoomSectionBounds();
    const stats = helpers.collectStats();

    assert.equal(bounds.detected, true);
    assert.equal(bounds.roomCardCount, 2);
    assert.equal(bounds.nonRoomSectionReachedCount, 1);
    assert.equal(Math.round(bounds.startY), 240);
    assert.equal(Math.round(bounds.endY), 990);
    assert.equal(stats.roomSectionDetectedCount, 1);
    assert.equal(stats.roomCardCount, 2);
  });
});

test('browser helper scans expand buttons only inside the detected room section', () => {
  const insideExpand = createElement({
    tagName: 'BUTTON',
    text: '更多房型价格',
    rect: { top: 500, height: 36, width: 140 }
  });
  const outsideExpand = createElement({
    tagName: 'BUTTON',
    text: '展开全部房型',
    rect: { top: 1180, height: 36, width: 140 }
  });
  const browser = createFakeBrowser([
    createElement({
      className: 'room-card',
      text: '房型 豪华大床房 免费取消 每晚 ¥398 预订',
      rect: { top: 430, height: 100 }
    }),
    insideExpand,
    createElement({
      text: '住客点评 用户点评',
      rect: { top: 860, height: 80 }
    }),
    outsideExpand
  ]);

  withBrowserGlobals(browser, (helpers) => {
    const before = helpers.collectStats();
    const stats = helpers.clickExpandButtons();
    const finalStats = helpers.finishStats(before, stats);

    assert.equal(stats.clickedCount, 1);
    assert.equal(stats.explicitCandidateCount, 1);
    assert.equal(stats.fallbackScanCandidateCount, 0);
    assert.equal(stats.genericFallbackScanCount, 0);
    assert.equal(insideExpand.clickCount, 1);
    assert.equal(outsideExpand.clickCount, 0);
    assert.equal(
      browser.queryLog.slice(1).some((selector) => selector.includes('section, article')),
      false
    );
    assert.equal(finalStats.selectorScanCount, 2);
    assert.equal(finalStats.selectorScanElapsedMs, 6);
    assert.equal(finalStats.slowestSelectorScanLabel, 'room_section_bounds');
    assert.equal(finalStats.slowestSelectorScanCandidateCount, 2);
  });
});

test('browser helper closes visible panels and records the empty path separately', () => {
  const visibleClose = createElement({
    tagName: 'BUTTON',
    attributes: { 'aria-label': 'Close' },
    text: '关闭',
    rect: { top: 100, height: 24, width: 24 }
  });
  const hiddenClose = createElement({
    tagName: 'BUTTON',
    attributes: { 'aria-label': 'Close' },
    text: '关闭',
    rect: { top: 120, height: 24, width: 0 }
  });
  const browser = createFakeBrowser([visibleClose, hiddenClose]);

  withBrowserGlobals(browser, (helpers) => {
    const clicked = helpers.closeReviewPanels();

    assert.equal(clicked, 1);
    assert.equal(visibleClose.clickCount, 1);
    assert.equal(hiddenClose.clickCount, 0);
    assert.equal(browser.dispatchedEvents[0].key, 'Escape');
    assert.deepEqual(browser.scrollCalls[0], { top: 0, behavior: 'instant' });
  });
});
