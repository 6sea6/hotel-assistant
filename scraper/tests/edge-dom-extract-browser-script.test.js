const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createEdgeDomExtractBrowserHelpers
} = require('../src/scraper/edge-capture-modules/dom-extract-browser-script');

function createElement({
  tagName = 'DIV',
  text = '',
  rect = {},
  visible = true,
  className = ''
} = {}) {
  const top = Number(rect.top ?? 0);
  const height = Number(rect.height ?? 40);
  const width = Number(rect.width ?? 240);
  return {
    tagName: tagName.toUpperCase(),
    innerText: text,
    textContent: text,
    className,
    clickCount: 0,
    dispatchedEvents: [],
    getBoundingClientRect() {
      return {
        top,
        left: 0,
        bottom: top + height,
        width: visible ? width : 0,
        height: visible ? height : 0
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

function createFakeBrowser(elements, bodyText = '') {
  const queryLog = [];
  return {
    queryLog,
    document: {
      body: {
        innerText: bodyText,
        textContent: bodyText
      },
      dispatchEvent() {},
      querySelectorAll(selector) {
        queryLog.push(selector);
        const tags = selector.split(',').map((item) => item.trim().toUpperCase());
        return elements.filter((element) => tags.includes(element.tagName));
      }
    },
    window: {
      getComputedStyle() {
        return { display: '', visibility: '', opacity: '1' };
      }
    }
  };
}

async function withBrowserGlobals(browser, callback) {
  const previous = {
    document: global.document,
    window: global.window,
    Element: global.Element,
    MouseEvent: global.MouseEvent,
    KeyboardEvent: global.KeyboardEvent
  };
  global.document = browser.document;
  global.window = browser.window;
  global.Element = Object;
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
    return await callback(createEdgeDomExtractBrowserHelpers());
  } finally {
    global.document = previous.document;
    global.window = previous.window;
    global.Element = previous.Element;
    global.MouseEvent = previous.MouseEvent;
    global.KeyboardEvent = previous.KeyboardEvent;
  }
}

test('edge DOM browser helper extracts only the room section', () => {
  const helpers = createEdgeDomExtractBrowserHelpers();
  const text = [
    '酒店顶部介绍',
    '选择房间',
    '豪华大床房 2人入住 每晚 ¥388 免费取消',
    '高级双床房 2人入住 每晚 ¥428 预订',
    '酒店政策',
    '入住时间 14:00 后'
  ].join('\n');

  const section = helpers.extractRoomSection(text);

  assert.match(section, /豪华大床房/);
  assert.match(section, /高级双床房/);
  assert.doesNotMatch(section, /酒店政策/);
});

test('edge DOM browser helper collects full payload without keeping full page HTML', async () => {
  const trigger = createElement({ tagName: 'BUTTON', text: '更多房型' });
  const roomNode = createElement({
    tagName: 'DIV',
    text: '豪华大床房 2人入住 每晚 ¥388 免费取消 预订',
    rect: { top: 200, height: 80 }
  });
  const bodyText = [
    '选择房间',
    '豪华大床房 2人入住 每晚 ¥388 免费取消 预订',
    '酒店政策'
  ].join('\n');
  const browser = createFakeBrowser([trigger, roomNode], bodyText);

  await withBrowserGlobals(browser, async (helpers) => {
    const payload = await helpers.collectFullDomExtractPayload({ triggerWaitMs: 0 });

    assert.equal(trigger.clickCount, 1);
    assert.equal(payload.bodyHtml, '');
    assert.ok(payload.snippets.some((snippet) => snippet.includes('豪华大床房')));
    assert.equal(browser.queryLog.includes('button, a, div, span'), true);
    assert.equal(browser.queryLog.includes('div, li, section, article'), true);
  });
});

test('edge DOM browser helper collects lightweight title windows from room section', async () => {
  const bodyText = [
    '顶部内容',
    '选择房间',
    '行政大床房 2人入住 每晚 ¥588 免费取消',
    '商务双床房 2人入住 每晚 ¥688 预订',
    '附近的酒店',
    '附近酒店不应进入'
  ].join('\n');
  const browser = createFakeBrowser([], bodyText);

  await withBrowserGlobals(browser, async (helpers) => {
    const payload = helpers.collectLightweightDomExtractPayload();

    assert.match(payload.bodyText, /行政大床房/);
    assert.doesNotMatch(payload.bodyText, /附近酒店不应进入/);
    assert.deepEqual(
      payload.snippets.map((snippet) => /大床房|双床房/.exec(snippet)?.[0]).filter(Boolean),
      ['大床房', '双床房']
    );
  });
});
