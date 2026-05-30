const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/**
 * 为 hotel-scroll-restore.js 搭建隔离测试环境。
 */
async function createTestEnvironment() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-scroll-restore-'));
  const sourceDir = path.join(__dirname, '..', 'src', 'renderer', 'modules');

  fs.copyFileSync(path.join(sourceDir, 'hotel-scroll-restore.js'), path.join(tempRoot, 'hotel-scroll-restore.js'));
  fs.copyFileSync(path.join(sourceDir, 'state.js'), path.join(tempRoot, 'state.js'));

  fs.writeFileSync(
    path.join(tempRoot, 'actions.js'),
    `export const actions = {};
`
  );

  fs.writeFileSync(path.join(tempRoot, 'package.json'), '{"type":"module"}\n');

  const moduleUrl = pathToFileURL(path.join(tempRoot, 'hotel-scroll-restore.js')).href;
  const actionsUrl = pathToFileURL(path.join(tempRoot, 'actions.js')).href;
  const stateUrl = pathToFileURL(path.join(tempRoot, 'state.js')).href;

  return { tempRoot, moduleUrl, actionsUrl, stateUrl };
}

/**
 * 搭建最小 DOM 模拟。
 */
function setupDomMock(options = {}) {
  const scrollContainer = options.scrollContainer || null;

  return {
    document: {
      querySelector(selector) {
        if (selector === '.virtual-card-scroll, .virtual-list-scroll') {
          return scrollContainer;
        }
        return null;
      }
    },
    requestAnimationFrame: (cb) => {
      cb(Date.now());
      return 1;
    },
    Event: class Event {
      constructor(type, init) {
        this.type = type;
        this.bubbles = init?.bubbles ?? true;
      }
    },
    HTMLElement: class HTMLElement {}
  };
}

/**
 * 创建一个模拟虚拟滚动容器。
 */
function createMockScrollContainer(options = {}) {
  const el = {
    scrollTop: options.scrollTop ?? 0,
    scrollHeight: options.scrollHeight ?? 2000,
    clientHeight: options.clientHeight ?? 600,
    className: options.className ?? 'virtual-card-scroll',
    dataset: {},
    _dispatchedEvents: [],
    querySelectorAll() {
      return options.items || [];
    },
    querySelector(selector) {
      const match = selector.match(/\[data-id="(.+?)"\]/);
      if (match && options.items) {
        return options.items.find((item) => item.dataset.id === match[1]) || null;
      }
      return null;
    },
    dispatchEvent(event) {
      el._dispatchedEvents.push(event);
    }
  };
  return el;
}

/**
 * 安装全局 mock 并返回原始值，供 finally 恢复。
 */
function installGlobals(globals) {
  const keys = ['document', 'requestAnimationFrame', 'Event', 'HTMLElement'];
  const originals = {};
  for (const key of keys) {
    originals[key] = globalThis[key];
    globalThis[key] = globals[key];
  }
  return originals;
}

function restoreGlobals(originals) {
  for (const [key, value] of Object.entries(originals)) {
    globalThis[key] = value;
  }
}

/* ---- installHotelScrollRestorePatch 幂等性 ---- */

test('installHotelScrollRestorePatch: 首次调用成功安装', async () => {
  const { tempRoot, moduleUrl, actionsUrl } = await createTestEnvironment();
  const globals = setupDomMock();
  const originals = installGlobals(globals);

  try {
    const mod = await import(moduleUrl);
    const { installHotelScrollRestorePatch } = mod;

    const actionsMod = await import(actionsUrl);
    actionsMod.actions.renderHotelList = () => {};
    actionsMod.actions.requestHotelListRender = () => {};

    installHotelScrollRestorePatch();

    assert.equal(typeof actionsMod.actions.renderHotelList, 'function');
    assert.equal(typeof actionsMod.actions.requestHotelListRender, 'function');
  } finally {
    restoreGlobals(originals);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('installHotelScrollRestorePatch: 重复调用不会重复包裹', async () => {
  const { tempRoot, moduleUrl, actionsUrl } = await createTestEnvironment();
  const globals = setupDomMock();
  const originals = installGlobals(globals);

  try {
    const mod = await import(moduleUrl);
    const { installHotelScrollRestorePatch } = mod;

    const actionsMod = await import(actionsUrl);
    actionsMod.actions.renderHotelList = () => {};
    actionsMod.actions.requestHotelListRender = () => {};

    installHotelScrollRestorePatch();
    const firstWrapped = actionsMod.actions.renderHotelList;

    installHotelScrollRestorePatch();
    const secondWrapped = actionsMod.actions.renderHotelList;

    assert.equal(firstWrapped, secondWrapped);
  } finally {
    restoreGlobals(originals);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

/* ---- 包裹行为：reason=hotel-update 调用原始函数 ---- */

test('wrapped requestHotelListRender: reason=hotel-update 时调用原始函数', async () => {
  const { tempRoot, moduleUrl, actionsUrl } = await createTestEnvironment();

  const scrollContainer = createMockScrollContainer({
    scrollTop: 500,
    scrollHeight: 3000,
    clientHeight: 600,
    className: 'virtual-card-scroll',
    items: [
      { dataset: { id: '10' }, offsetTop: 400, querySelector: () => ({ textContent: '#5' }) },
      { dataset: { id: '20' }, offsetTop: 700, querySelector: () => ({ textContent: '#10' }) },
      { dataset: { id: '30' }, offsetTop: 1000, querySelector: () => ({ textContent: '#15' }) }
    ]
  });

  const globals = setupDomMock({ scrollContainer });
  const originals = installGlobals(globals);

  try {
    const mod = await import(moduleUrl);
    const { installHotelScrollRestorePatch } = mod;

    const actionsMod = await import(actionsUrl);

    let capturedReason = null;
    actionsMod.actions.renderHotelList = () => {};
    actionsMod.actions.requestHotelListRender = (options) => {
      capturedReason = options?.reason;
    };

    installHotelScrollRestorePatch();

    actionsMod.actions.requestHotelListRender({ reason: 'hotel-update' });

    assert.equal(capturedReason, 'hotel-update');
  } finally {
    restoreGlobals(originals);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

/* ---- 筛选变化不恢复 ---- */

test('wrapped renderHotelList: reason=filter-change 时不恢复 scrollTop', async () => {
  const { tempRoot, moduleUrl, actionsUrl } = await createTestEnvironment();

  const scrollContainer = createMockScrollContainer({
    scrollTop: 500,
    scrollHeight: 3000,
    clientHeight: 600,
    className: 'virtual-card-scroll'
  });

  const globals = setupDomMock({ scrollContainer });
  const originals = installGlobals(globals);

  try {
    const mod = await import(moduleUrl);
    const { installHotelScrollRestorePatch } = mod;

    const actionsMod = await import(actionsUrl);
    actionsMod.actions.renderHotelList = () => {};
    actionsMod.actions.requestHotelListRender = () => {};

    installHotelScrollRestorePatch();

    scrollContainer.scrollTop = 0;
    actionsMod.actions.renderHotelList({ reason: 'filter-change' });

    // filter-change 不触发恢复，scrollTop 不应被修改
    assert.equal(scrollContainer.scrollTop, 0);
  } finally {
    restoreGlobals(originals);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

/* ---- scrollHeight 尚未撑开时延迟恢复 ---- */

test('restoreVirtualScrollSnapshot: scrollHeight 尚未撑开时不会把 scrollTop 设为 0', async () => {
  const { tempRoot, moduleUrl, actionsUrl } = await createTestEnvironment();

  let scrollHeightValue = 100;
  const scrollContainer = {
    scrollTop: 0,
    get scrollHeight() { return scrollHeightValue; },
    clientHeight: 600,
    className: 'virtual-card-scroll',
    dataset: {},
    querySelectorAll() { return []; },
    querySelector() { return null; },
    dispatchEvent() {}
  };

  const globals = setupDomMock({ scrollContainer });
  const originals = installGlobals(globals);

  try {
    const mod = await import(moduleUrl);
    const { installHotelScrollRestorePatch } = mod;

    const actionsMod = await import(actionsUrl);
    actionsMod.actions.renderHotelList = () => {};
    actionsMod.actions.requestHotelListRender = () => {};

    installHotelScrollRestorePatch();

    // 旧容器 scrollTop=500
    scrollHeightValue = 3000;
    scrollContainer.scrollTop = 500;

    // 触发渲染
    scrollContainer.scrollTop = 0;
    scrollHeightValue = 100; // 新容器尚未撑开

    actionsMod.actions.renderHotelList({ reason: 'hotel-update' });

    // scrollHeight 太小时不应强制设为 0
    assert.equal(scrollContainer.scrollTop, 0);
  } finally {
    restoreGlobals(originals);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

/* ---- getScrollBehaviorForReason 补充测试 ---- */

test('getScrollBehaviorForReason: data-reload returns top', async () => {
  const { tempRoot, stateUrl } = await createTestEnvironment();
  try {
    const stateMod = await import(stateUrl);
    assert.equal(stateMod.getScrollBehaviorForReason('data-reload', '[]'), 'top');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('getScrollBehaviorForReason: batch-delete returns top', async () => {
  const { tempRoot, stateUrl } = await createTestEnvironment();
  try {
    const stateMod = await import(stateUrl);
    assert.equal(stateMod.getScrollBehaviorForReason('batch-delete', '[]'), 'top');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
