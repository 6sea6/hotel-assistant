const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { buildCtripListUrl, parseCtripListUrl } = require('../shared/compare-app/ctrip-url-filters');

let taskConsoleModuleUrl = '';
let aiAssistantModuleUrl = '';
let aiAssistantStateModuleUrl = '';
let aiAssistantActionsModuleUrl = '';

function readRendererStyles() {
  const rendererDir = path.join(__dirname, '..', 'src', 'renderer');
  const visited = new Set();

  function readCss(relativePath) {
    const normalizedPath = relativePath.replace(/\\/g, '/');
    if (visited.has(normalizedPath)) return '';
    visited.add(normalizedPath);

    const css = fs.readFileSync(path.join(rendererDir, normalizedPath), 'utf8');
    return css.replace(/@import\s+url\('([^']+)'\);/g, (_statement, importPath) =>
      readCss(path.posix.normalize(path.posix.join(path.posix.dirname(normalizedPath), importPath)))
    );
  }

  return readCss('styles.css');
}

async function loadTaskConsoleModule() {
  if (!taskConsoleModuleUrl) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-ai-task-console-'));
    const sourceDir = path.join(__dirname, '..', 'src', 'renderer', 'modules');
    fs.writeFileSync(path.join(tempRoot, 'package.json'), '{"type":"module"}\n', 'utf-8');
    [
      'ai-task-console.js',
      'ai-task-events.js',
      'ai-task-formatters.js',
      'ai-task-progress.js',
      'ai-task-renderers.js',
      'ai-task-state.js',
      'dom-helpers.js'
    ].forEach((fileName) => {
      fs.copyFileSync(path.join(sourceDir, fileName), path.join(tempRoot, fileName));
    });
    taskConsoleModuleUrl = pathToFileURL(path.join(tempRoot, 'ai-task-console.js')).href;
    process.on('exit', () => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
  }

  return import(taskConsoleModuleUrl);
}

async function loadAiAssistantModules() {
  if (!aiAssistantModuleUrl) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-ai-assistant-'));
    const sourceDir = path.join(__dirname, '..', 'src', 'renderer', 'modules');
    fs.writeFileSync(path.join(tempRoot, 'package.json'), '{"type":"module"}\n', 'utf-8');
    [
      'actions.js',
      'ai-assistant.js',
      'ai-task-console.js',
      'ai-task-events.js',
      'ai-task-formatters.js',
      'ai-task-payload.js',
      'ai-task-progress.js',
      'ai-task-queue.js',
      'ai-task-renderers.js',
      'ai-task-state.js',
      'ai-template-picker.js',
      'custom-select.js',
      'dom-helpers.js',
      'notification.js',
      'state.js'
    ].forEach((fileName) => {
      fs.copyFileSync(path.join(sourceDir, fileName), path.join(tempRoot, fileName));
    });
    aiAssistantModuleUrl = pathToFileURL(path.join(tempRoot, 'ai-assistant.js')).href;
    aiAssistantStateModuleUrl = pathToFileURL(path.join(tempRoot, 'state.js')).href;
    aiAssistantActionsModuleUrl = pathToFileURL(path.join(tempRoot, 'actions.js')).href;
    process.on('exit', () => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
  }

  const [module, stateModule, actionsModule] = await Promise.all([
    import(aiAssistantModuleUrl),
    import(aiAssistantStateModuleUrl),
    import(aiAssistantActionsModuleUrl)
  ]);
  return {
    module,
    state: stateModule.state,
    actions: actionsModule.actions
  };
}

function createFakeElement(value = '', tagName = 'div') {
  let textContentValue = '';
  const element = {
    tagName: tagName.toUpperCase(),
    value,
    checked: false,
    maxLength: 4000,
    children: [],
    attributes: new Map(),
    className: '',
    get innerHTML() {
      return textContentValue
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    },
    set innerHTML(v) {
      textContentValue = v;
      element.children = [];
    },
    get textContent() {
      if (textContentValue) return textContentValue;
      return element.children.map((child) => child.textContent || '').join('');
    },
    set textContent(v) {
      textContentValue = String(v == null ? '' : v);
      element.children = [];
    },
    dataset: {},
    options: [],
    selectedOptions: [],
    classList: {
      add() {},
      remove() {},
      toggle() {}
    },
    setAttribute(name, v) {
      element.attributes.set(name, String(v));
    },
    getAttribute(name) {
      return element.attributes.get(name) || null;
    },
    appendChild(child) {
      element.children.push(child);
      child.parentNode = element;
      return child;
    },
    addEventListener() {},
    querySelector(selector) {
      if (selector.startsWith('.')) {
        const className = selector.slice(1);
        return (
          element.children.find((child) =>
            String(child.className || '')
              .split(/\s+/)
              .includes(className)
          ) || null
        );
      }
      return (
        element.children.find((child) => String(child.tagName || '').toLowerCase() === selector) ||
        null
      );
    },
    remove() {}
  };
  return element;
}

function installAiAssistantDom(inputUrl = '') {
  const elements = new Map();
  [
    'aiHotelUrlInput',
    'aiTemplateSelect',
    'amapApiKeyInput',
    'aiInputCount',
    'aiCtripPriceMin',
    'aiCtripPriceMax',
    'aiCtripSortMode',
    'aiCtripReviewCountMin',
    'aiCtripScoreMin',
    'aiCtripFreeCancel',
    'aiCurrentTaskPanel',
    'aiTaskQueuePanel',
    'aiStartTaskBtn'
  ].forEach((id) => {
    elements.set(id, createFakeElement(id === 'aiHotelUrlInput' ? inputUrl : ''));
  });

  const starButtons = [2, 3, 4, 5].map((level) => ({
    dataset: { starLevel: String(level) },
    classList: {
      toggle() {}
    },
    setAttribute() {}
  }));
  const setCalls = [];
  const notifications = [];

  global.document = {
    getElementById(id) {
      return elements.get(id) || null;
    },
    querySelectorAll(selector) {
      return selector === '[data-star-level]' ? starButtons : [];
    },
    createElement(tagName) {
      return createFakeElement('', tagName);
    },
    body: {
      appendChild(element) {
        notifications.push(element);
      }
    }
  };
  global.window = {
    setTimeout(callback) {
      queueMicrotask(callback);
      return 1;
    },
    clearTimeout() {},
    electronAPI: {
      setSetting: async (key, value) => {
        setCalls.push([key, value]);
        return { success: true };
      },
      ai: {
        getTaskStatus: async () => ({ running: false, status: 'idle', events: [] }),
        parseCtripListUrl: async (url) => parseCtripListUrl(url),
        buildCtripListUrl: async ({ baseUrl, settings }) => buildCtripListUrl(baseUrl, settings)
      }
    }
  };

  return {
    elements,
    setCalls,
    notifications
  };
}

test('extractCtripUrls reads multiple detail and list URLs from pasted text', async () => {
  const { extractCtripUrls, extractCtripUrl } = await loadTaskConsoleModule();
  const urls = extractCtripUrls(`
    第一家 https://hotels.ctrip.com/hotels/detail/?hotelId=1001&checkIn=2026-06-01。
    列表页：https://hotels.ctrip.com/hotels/list?city=2&keyword=test；
    重复 https://hotels.ctrip.com/hotels/detail/?hotelId=1001&checkIn=2026-06-01
    非法 https://ctrip.com.evil.example/hotels/list?city=2
  `);

  assert.equal(urls.length, 2);
  assert.match(urls[0], /hotelId=1001/);
  assert.match(urls[1], /hotels\/list/);
  assert.equal(extractCtripUrl(urls.join('\n')), urls[0]);
});

test('extractCtripUrls trims prose after a pasted list URL', async () => {
  const { extractCtripUrls, extractCtripUrl } = await loadTaskConsoleModule();
  const text =
    'https://hotels.ctrip.com/hotels/list?cityId=477&checkin=2026-06-01&checkout=2026-06-02&listFilters=29~1*29*1~3&locale=zh-CN,我将链接输入后显示解析错误';
  const urls = extractCtripUrls(text);

  assert.equal(urls.length, 1);
  assert.equal(
    urls[0],
    'https://hotels.ctrip.com/hotels/list?cityId=477&checkin=2026-06-01&checkout=2026-06-02&listFilters=29~1*29*1~3&locale=zh-CN'
  );
  assert.equal(extractCtripUrl(text), urls[0]);
});

test('AI task event render scheduler batches console renders with requestAnimationFrame', async (t) => {
  const { createRafRenderScheduler } = await loadTaskConsoleModule();
  const originalRequestAnimationFrame = global.requestAnimationFrame;
  const originalCancelAnimationFrame = global.cancelAnimationFrame;
  const callbacks = [];
  let renderCount = 0;

  global.requestAnimationFrame = (callback) => {
    callbacks.push(callback);
    return callbacks.length;
  };
  global.cancelAnimationFrame = () => {};
  t.after(() => {
    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  const scheduleRender = createRafRenderScheduler(() => {
    renderCount += 1;
  });

  scheduleRender();
  scheduleRender();
  scheduleRender();
  assert.equal(callbacks.length, 1);
  assert.equal(renderCount, 0);

  callbacks.shift()(123);
  assert.equal(renderCount, 1);
});

test('hasWriteResult understands batch apply summaries', async () => {
  const { hasWriteResult } = await loadTaskConsoleModule();

  assert.equal(
    hasWriteResult({
      batchMode: true,
      appliedCount: 0,
      skippedCount: 2,
      items: []
    }),
    false
  );
  assert.equal(
    hasWriteResult({
      batchMode: true,
      appliedCount: 1,
      skippedCount: 1,
      items: []
    }),
    true
  );
  assert.equal(
    hasWriteResult({
      batchMode: true,
      appliedCount: 0,
      items: [
        {
          writeResult: {
            operation: 'inserted'
          }
        }
      ]
    }),
    true
  );
  assert.equal(
    hasWriteResult([
      {
        itemIndex: 1,
        result: [{ operation: 'skipped' }]
      }
    ]),
    false
  );
  assert.equal(
    hasWriteResult([
      {
        itemIndex: 1,
        result: [{ operation: 'updated' }]
      }
    ]),
    true
  );
});

test('normalizeTaskState keeps batch result display compatible with old fields', async () => {
  const { normalizeTaskState } = await loadTaskConsoleModule();
  const taskState = normalizeTaskState({
    task: {
      submitted: true,
      taskId: 'batch-task-1',
      templateLabel: '武汉模板',
      hotelUrl: 'https://hotels.ctrip.com/hotels/list?city=2',
      result: {
        success: true
      },
      collectResult: {
        success: true,
        batchMode: true,
        batchStats: {
          expandedHotelCount: 3
        },
        hotelName: '第一家酒店',
        eligibleCount: 4,
        eligibleRoomTypes: [
          {
            roomType: '家庭房',
            dailyPrice: 300,
            totalPrice: 900
          }
        ],
        writeResult: {
          batchMode: true,
          appliedCount: 2,
          skippedCount: 1
        },
        reviewInputAvailable: true
      }
    },
    events: [],
    inProgress: false
  });

  assert.equal(taskState.status, 'success');
  assert.equal(taskState.result.hotelName, '批量 3 家，本次最终写入 2 家宾馆，4 种房型');
  assert.equal(taskState.result.actualResultText, '批量 3 家，本次最终写入 2 家宾馆，4 种房型');
  assert.equal(taskState.result.isBatchResult, true);
  assert.doesNotMatch(taskState.result.actualResultText, /第一家酒店/);
  assert.doesNotMatch(taskState.result.actualResultText, /可用房型/);
  assert.doesNotMatch(taskState.result.actualResultText, /价格/);
  assert.equal(taskState.result.eligibleCount, 4);
  assert.equal(taskState.result.writeBackStatus, '已写入数据');
});

test('normalizeTaskState counts full batch item room types before apply-output summaries', async () => {
  const { normalizeTaskState } = await loadTaskConsoleModule();
  const taskState = normalizeTaskState({
    task: {
      submitted: true,
      taskId: 'batch-task-room-count',
      collectResult: {
        success: true,
        batchMode: true,
        batchStats: {
          expandedHotelCount: 3
        },
        items: [
          {
            index: 1,
            success: true,
            eligibleCount: 2,
            eligibleRoomTypes: [{ roomType: 'A' }, { roomType: 'B' }]
          },
          {
            index: 2,
            success: true,
            eligibleCount: 3,
            eligibleRoomTypes: [{ roomType: 'C' }, { roomType: 'D' }, { roomType: 'E' }]
          },
          {
            index: 3,
            success: true,
            eligibleCount: 4,
            eligibleRoomTypes: [
              { roomType: 'F' },
              { roomType: 'G' },
              { roomType: 'H' },
              { roomType: 'I' }
            ]
          }
        ],
        writeResult: {
          batchMode: true,
          appliedCount: 2,
          skippedCount: 1,
          items: [
            {
              item: {
                index: 1,
                eligibleCount: 2,
                eligibleRoomTypes: [{ roomType: 'A' }, { roomType: 'B' }]
              },
              skipped: false,
              latestApplyResult: {
                eligibleCount: 1,
                eligibleRoomTypes: [{ roomType: 'A' }],
                writeResult: [{ operation: 'inserted' }]
              }
            },
            {
              item: {
                index: 2,
                eligibleCount: 3,
                eligibleRoomTypes: [{ roomType: 'C' }, { roomType: 'D' }, { roomType: 'E' }]
              },
              skipped: false,
              latestApplyResult: {
                eligibleCount: 1,
                eligibleRoomTypes: [{ roomType: 'C' }],
                writeResult: [{ operation: 'inserted' }]
              }
            },
            {
              item: {
                index: 3,
                eligibleCount: 4,
                eligibleRoomTypes: [
                  { roomType: 'F' },
                  { roomType: 'G' },
                  { roomType: 'H' },
                  { roomType: 'I' }
                ]
              },
              skipped: true,
              reason: '未写入'
            }
          ]
        }
      }
    },
    events: [],
    inProgress: false
  });

  assert.equal(taskState.result.actualResultText, '批量 3 家，本次最终写入 2 家宾馆，5 种房型');
});

test('normalizeTaskState exposes skipped batch hotel reasons', async () => {
  const { normalizeTaskState } = await loadTaskConsoleModule();
  const taskState = normalizeTaskState({
    task: {
      submitted: true,
      taskId: 'batch-task-skipped-reasons',
      templateLabel: '武汉模板',
      collectResult: {
        success: true,
        batchMode: true,
        batchStats: {
          expandedHotelCount: 2
        },
        eligibleCount: 3,
        writeResult: {
          batchMode: true,
          appliedCount: 1,
          skippedCount: 1,
          items: [
            {
              item: {
                hotelName: '酒店A',
                eligibleCount: 3
              },
              skipped: false,
              latestApplyResult: {
                writeResult: [{ operation: 'inserted' }]
              }
            },
            {
              item: {
                hotelName: '酒店B'
              },
              skipped: true,
              reason: '所有候选房型都不可取消'
            }
          ]
        }
      }
    },
    events: [],
    inProgress: false
  });

  assert.equal(taskState.result.skipReasonText, '酒店B：所有候选房型都不可取消');
});

test('renderSummaryCards replaces write status row with skipped hotel reasons only when needed', async () => {
  const { normalizeTaskState, renderSummaryCards } = await loadTaskConsoleModule();
  const originalDocument = global.document;
  global.document = {
    createElement(tagName) {
      return createFakeElement('', tagName);
    }
  };
  try {
    const baseTask = {
      submitted: true,
      taskId: 'batch-task-render-skips',
      templateLabel: '武汉模板',
      collectResult: {
        success: true,
        batchMode: true,
        batchStats: {
          expandedHotelCount: 1
        },
        eligibleCount: 2,
        writeResult: {
          batchMode: true,
          appliedCount: 1,
          skippedCount: 0,
          items: [
            {
              item: {
                hotelName: '酒店A',
                eligibleCount: 2
              },
              skipped: false,
              latestApplyResult: {
                writeResult: [{ operation: 'inserted' }]
              }
            }
          ]
        }
      }
    };
    const noSkipState = normalizeTaskState({
      task: baseTask,
      events: [],
      inProgress: false
    });
    const noSkipHtml = renderSummaryCards(noSkipState, 'success', 'collect');

    assert.doesNotMatch(noSkipHtml, /写入状态/);
    assert.doesNotMatch(noSkipHtml, /跳过原因/);

    const skippedState = normalizeTaskState({
      task: {
        ...baseTask,
        collectResult: {
          ...baseTask.collectResult,
          batchStats: {
            expandedHotelCount: 2
          },
          writeResult: {
            batchMode: true,
            appliedCount: 1,
            skippedCount: 1,
            items: [
              ...baseTask.collectResult.writeResult.items,
              {
                item: {
                  hotelName: '酒店B'
                },
                skipped: true,
                reason: '不符合模板规则'
              },
            ]
          }
        }
      },
      events: [],
      inProgress: false
    });
    const skippedHtml = renderSummaryCards(skippedState, 'success', 'collect');

    assert.doesNotMatch(skippedHtml, /写入状态/);
    assert.match(skippedHtml, /跳过原因/);
    assert.match(skippedHtml, /酒店B：不符合模板规则/);
  } finally {
    global.document = originalDocument;
  }
});

test('normalizeTaskState does not expose AI review for collection results', async () => {
  const { normalizeTaskState } = await loadTaskConsoleModule();

  const singleTaskState = normalizeTaskState({
    task: {
      submitted: true,
      taskId: 'single-task-1',
      collectResult: {
        success: true,
        batchMode: false,
        reviewInputAvailable: true,
        hotelName: '测试酒店',
        eligibleCount: 1,
        eligibleRoomTypes: [
          {
            roomType: '家庭房',
            dailyPrice: 300,
            totalPrice: 300
          }
        ],
        writeResult: {
          operation: 'inserted'
        }
      }
    },
    events: [],
    inProgress: false
  });

  const batchTaskState = normalizeTaskState({
    task: {
      submitted: true,
      taskId: 'batch-task-2',
      collectResult: {
        success: true,
        batchMode: true,
        reviewInputAvailable: true,
        batchStats: {
          expandedHotelCount: 2
        },
        writeResult: {
          batchMode: true,
          appliedCount: 2
        }
      }
    },
    events: [],
    inProgress: false
  });

  assert.equal('canReview' in singleTaskState, false);
  assert.equal('review' in singleTaskState, false);
  assert.equal(singleTaskState.result.actualResultText, '测试酒店，可用房型 1 个');
  assert.doesNotMatch(singleTaskState.result.actualResultText, /价格|总价|¥|300/);
  assert.equal('canReview' in batchTaskState, false);
});

test('normalizeTaskState renders cancelled tasks as cancelled instead of failed', async () => {
  const { normalizeTaskState } = await loadTaskConsoleModule();
  const taskState = normalizeTaskState({
    task: {
      submitted: true,
      taskId: 'cancel-task-1',
      templateLabel: '武汉模板',
      startedAt: '2026-06-01T10:00:00.000Z',
      endedAt: '2026-06-01T10:00:05.000Z',
      cancelled: true,
      error: '任务已取消'
    },
    events: [
      {
        type: 'task:cancel',
        message: '任务已取消',
        at: '2026-06-01T10:00:05.000Z'
      }
    ],
    inProgress: false
  });

  assert.equal(taskState.status, 'cancelled');
  assert.equal(taskState.error.message, '任务已取消');
  assert.deepEqual(taskState.error.suggestions, ['当前采集已中止，本次取消会撤销已经写回的数据。']);
  assert.ok(taskState.steps.some((step) => step.key === 'cancel' && step.title === '任务已取消'));
});

test('normalizeTaskState derives running batch progress stats from events', async () => {
  const { normalizeTaskState } = await loadTaskConsoleModule();
  const events = [
    {
      type: 'batch:start',
      message: '正在批量采集携程酒店页面',
      details: {
        summary: '模式=list，输入URL=1，展开酒店=32'
      }
    },
    ...Array.from({ length: 8 }, (_, index) => ({
      type: 'batch:item-done',
      message: `第 ${index + 1} 家酒店采集完成`,
      details: {}
    })),
    {
      type: 'batch:item-start',
      message: '正在采集第 9/32 家酒店',
      details: {}
    }
  ];

  const taskState = normalizeTaskState({
    task: {
      submitted: true,
      templateLabel: '实验 · 武汉 · 2026-06-01 至 2026-06-02 · 3人',
      hotelUrl: 'https://hotels.ctrip.com/hotels/list?city=477',
      startedAt: '2026-05-16T11:56:34.000Z'
    },
    events,
    inProgress: true
  });

  assert.deepEqual(taskState.progressStats, {
    total: 32,
    completed: 8,
    running: 1,
    pending: 23
  });
});

test('batch progress stat icons use svg and animate the running icon', () => {
  const moduleSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'modules', 'ai-task-renderers.js'),
    'utf8'
  );
  const css = readRendererStyles();

  assert.match(moduleSource, /<svg class="task-progress-stat-icon task-progress-stat-icon-hotel"/);
  assert.match(moduleSource, /<svg class="task-progress-stat-icon task-progress-stat-icon-done"/);
  assert.match(
    moduleSource,
    /<svg class="task-progress-stat-icon task-progress-stat-icon-running loading-icon"/
  );
  assert.match(
    moduleSource,
    /<svg class="task-progress-stat-icon task-progress-stat-icon-pending"/
  );
  assert.match(css, /\.loading-icon\s*\{[\s\S]*animation:\s*spin 1s linear infinite/);
  assert.match(css, /\.task-progress-stat-icon\s*\{[\s\S]*width:\s*22px;[\s\S]*height:\s*22px;/);
});

test('Ctrip list URL reverse sync does not clear saved filters for unknown native listFilters', async () => {
  const inputUrl =
    'https://hotels.ctrip.com/hotels/list?cityId=477&listFilters=29~1*29*1~3*2&locale=zh-CN';
  const { elements, setCalls } = installAiAssistantDom(inputUrl);
  const { module, state } = await loadAiAssistantModules();
  state.settings = {
    aiCtripPriceMin: 50,
    aiCtripPriceMax: 200,
    aiCtripStarLevels: [4],
    aiCtripSortMode: '',
    aiCtripFreeCancel: false,
    aiCtripReviewCountMin: '',
    aiCtripScoreMin: '',
    aiListDesiredHotelCount: 10,
    aiListExcludeHotelTypes: '民宿,客栈,青年旅舍,公寓'
  };

  await module.syncCtripListUrlSettingsFromInput();

  assert.equal(state.settings.aiCtripPriceMin, 50);
  assert.equal(state.settings.aiCtripPriceMax, 200);
  assert.deepEqual(state.settings.aiCtripStarLevels, [4]);
  assert.deepEqual(setCalls, []);
  assert.equal(elements.get('aiCtripPriceMin').value, 50);
});

test('Ctrip list URL reverse sync does not overwrite saved filters with pasted URL filters', async () => {
  const inputUrl =
    'https://hotels.ctrip.com/hotels/list?cityId=477&listFilters=15~Range*15*900~max,16~5*16*5&locale=zh-CN';
  const { elements, setCalls } = installAiAssistantDom(inputUrl);
  const { module, state } = await loadAiAssistantModules();
  state.settings = {
    aiCtripPriceMin: 600,
    aiCtripPriceMax: 'max',
    aiCtripStarLevels: [4],
    aiCtripSortMode: '',
    aiCtripFreeCancel: false,
    aiCtripReviewCountMin: '',
    aiCtripScoreMin: '',
    aiListDesiredHotelCount: 20,
    aiListExcludeHotelTypes: '民宿,客栈,青年旅舍,公寓'
  };

  await module.syncCtripListUrlSettingsFromInput();

  assert.equal(state.settings.aiCtripPriceMin, 600);
  assert.equal(state.settings.aiCtripPriceMax, 'max');
  assert.deepEqual(state.settings.aiCtripStarLevels, [4]);
  assert.deepEqual(setCalls, []);
  assert.equal(elements.get('aiCtripPriceMin').value, 600);
  assert.equal(elements.get('aiCtripPriceMax').value, 'max');
});

test('active Ctrip URL filters are merged into list URL without dropping unknown filters', async () => {
  const inputUrl =
    'https://hotels.ctrip.com/hotels/list?cityId=477&listFilters=29~1*29*1~3*2&locale=zh-CN';
  const { elements } = installAiAssistantDom(inputUrl);
  const { module, state } = await loadAiAssistantModules();
  state.settings = {
    aiCtripPriceMin: 50,
    aiCtripPriceMax: 200,
    aiCtripStarLevels: [4],
    aiCtripSortMode: '',
    aiCtripFreeCancel: false,
    aiCtripReviewCountMin: '',
    aiCtripScoreMin: '',
    aiListDesiredHotelCount: 10,
    aiListExcludeHotelTypes: '民宿,客栈,青年旅舍,公寓'
  };

  const activeFilters = module.readCtripUrlFilterSettings({ activeOnly: true });
  await module.syncAiCtripListUrlFromSettings({ activeOnly: true });
  const parsed = parseCtripListUrl(elements.get('aiHotelUrlInput').value);

  assert.deepEqual(activeFilters, {
    priceMin: 50,
    priceMax: 200,
    starLevels: [4]
  });
  assert.ok(parsed.listFilterParts.includes('29~1*29*1~3*2'));
  assert.ok(parsed.listFilterParts.includes('15~Range*15*50~200'));
  assert.ok(parsed.listFilterParts.includes('16~4*16*4'));
});

test('active-only Ctrip URL sync preserves pasted known filters when app settings are empty', async () => {
  const inputUrl =
    'https://hotels.ctrip.com/hotels/list?cityId=477&listFilters=29~1*29*1~3*2,17~6*17*6&locale=zh-CN';
  const { elements } = installAiAssistantDom(inputUrl);
  const { module, state } = await loadAiAssistantModules();
  state.settings = {
    aiCtripPriceMin: '',
    aiCtripPriceMax: '',
    aiCtripStarLevels: [],
    aiCtripSortMode: '',
    aiCtripFreeCancel: false,
    aiCtripReviewCountMin: '',
    aiCtripScoreMin: '',
    aiListDesiredHotelCount: 10,
    aiListExcludeHotelTypes: '民宿,客栈,青年旅舍,公寓'
  };

  await module.syncAiCtripListUrlFromSettings({ activeOnly: true });
  const parsed = parseCtripListUrl(elements.get('aiHotelUrlInput').value);

  assert.deepEqual(module.readCtripUrlFilterSettings({ activeOnly: true }), {});
  assert.ok(parsed.listFilterParts.includes('29~1*29*1~3*2'));
  assert.ok(parsed.listFilterParts.includes('17~6*17*6'));
});

test('cancelled collection only shows one cancellation notification', async () => {
  const inputUrl = 'https://hotels.ctrip.com/hotels/detail/?hotelId=1001&checkIn=2026-06-01';
  const { elements, notifications } = installAiAssistantDom(inputUrl);
  const { module, state } = await loadAiAssistantModules();
  let rejectStartTask = null;

  state.templates = [{ id: 'tpl-1', name: '武汉模板' }];
  state.settings = {};
  state.aiTaskQueue = [];
  state.aiTaskQueueCounter = 0;
  state.aiSelectedQueueTaskId = '';
  state.aiQueueSelectionPinned = false;
  state.aiTaskInProgress = false;
  state.aiTaskEvents = [];
  state.aiTaskConsole = {
    submitted: false,
    template: null,
    templateLabel: '',
    hotelUrl: '',
    startedAt: '',
    endedAt: '',
    result: null,
    collectResult: null,
    error: null,
    reply: ''
  };
  elements.get('aiTemplateSelect').value = 'tpl-1';
  global.window.electronAPI.ai.startTask = async () =>
    new Promise((_resolve, reject) => {
      rejectStartTask = reject;
    });
  global.window.electronAPI.ai.cancelTask = async () => ({ success: true });

  await module.enqueueAiCollectTask();
  await module.cancelAiTask();
  rejectStartTask(new Error('任务已取消'));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const getNotificationMessage = (item) =>
    item.querySelector?.('.notification-message')?.textContent || item.textContent;
  const cancelNotifications = notifications.filter(
    (item) => getNotificationMessage(item) === '采集任务已取消'
  );
  assert.equal(cancelNotifications.length, 1);
  assert.equal(state.aiTaskQueue[0].status, 'cancelled');
});

test('clearing records after cancellation leaves the console idle without restarting task', async () => {
  const inputUrl = 'https://hotels.ctrip.com/hotels/detail/?hotelId=1001&checkIn=2026-06-01';
  const { elements } = installAiAssistantDom(inputUrl);
  const { module, state } = await loadAiAssistantModules();
  let startTaskCallCount = 0;

  state.templates = [{ id: 'tpl-1', name: '武汉模板' }];
  state.settings = {};
  state.aiTaskQueue = [];
  state.aiTaskQueueCounter = 0;
  state.aiSelectedQueueTaskId = '';
  state.aiQueueSelectionPinned = false;
  state.aiTaskInProgress = false;
  state.aiTaskEvents = [];
  state.aiTaskConsole = {
    submitted: false,
    template: null,
    templateLabel: '',
    hotelUrl: '',
    startedAt: '',
    endedAt: '',
    result: null,
    collectResult: null,
    error: null,
    reply: ''
  };
  elements.get('aiTemplateSelect').value = 'tpl-1';
  global.window.electronAPI.ai.startTask = async () => {
    startTaskCallCount += 1;
    return new Promise(() => {});
  };
  global.window.electronAPI.ai.cancelTask = async () => ({ success: true });

  await module.enqueueAiCollectTask();
  await module.cancelAiTask();
  module.clearAiTaskRecords();

  assert.equal(startTaskCallCount, 1);
  assert.equal(state.aiTaskQueue.length, 0);
  assert.equal(state.aiSelectedQueueTaskId, '');
  assert.match(elements.get('aiCurrentTaskPanel').innerHTML, /等待开始任务/);
  assert.doesNotMatch(elements.get('aiCurrentTaskPanel').innerHTML, /正在采集/);
});

test('new task waits during backend shutdown and starts after cancelled task settles', async () => {
  const inputUrl = 'https://hotels.ctrip.com/hotels/detail/?hotelId=1001&checkIn=2026-06-01';
  const nextUrl = 'https://hotels.ctrip.com/hotels/detail/?hotelId=2002&checkIn=2026-06-01';
  const { elements, notifications } = installAiAssistantDom(inputUrl);
  const { module, state } = await loadAiAssistantModules();
  let startTaskCallCount = 0;
  let rejectFirstTask = null;
  let backendClosed = false;

  state.templates = [{ id: 'tpl-1', name: '武汉模板' }];
  state.settings = {};
  state.aiTaskQueue = [];
  state.aiTaskQueueCounter = 0;
  state.aiSelectedQueueTaskId = '';
  state.aiQueueSelectionPinned = false;
  state.aiTaskInProgress = false;
  state.aiTaskEvents = [];
  state.aiTaskConsole = {
    submitted: false,
    template: null,
    templateLabel: '',
    hotelUrl: '',
    startedAt: '',
    endedAt: '',
    result: null,
    collectResult: null,
    error: null,
    reply: ''
  };
  elements.get('aiTemplateSelect').value = 'tpl-1';
  global.window.electronAPI.ai.startTask = async () => {
    startTaskCallCount += 1;
    if (startTaskCallCount === 1) {
      return new Promise((_resolve, reject) => {
        rejectFirstTask = reject;
      });
    }
    if (!backendClosed) {
      throw new Error('已有 AI 采集任务正在运行，请等待完成后再开始新任务。');
    }
    return new Promise(() => {});
  };
  global.window.electronAPI.ai.cancelTask = async () => ({ success: true });

  await module.enqueueAiCollectTask();
  await module.cancelAiTask();
  module.clearAiTaskRecords();
  elements.get('aiHotelUrlInput').value = nextUrl;
  await module.enqueueAiCollectTask();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(state.aiTaskQueue.length, 1);
  assert.equal(state.aiTaskQueue[0].url, nextUrl);
  assert.equal(state.aiTaskQueue[0].status, 'waiting');
  assert.equal(
    notifications.some((item) => /已有 AI 采集任务正在运行/.test(item.textContent || '')),
    false
  );
  assert.doesNotMatch(elements.get('aiCurrentTaskPanel').innerHTML, /任务执行失败/);

  backendClosed = true;
  rejectFirstTask(new Error('任务已取消'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.ok(startTaskCallCount >= 3);
  assert.equal(state.aiTaskQueue[0].status, 'running');
  assert.match(elements.get('aiCurrentTaskPanel').innerHTML, /正在采集/);
});

test('waiting task does not flash running view while backend reports previous task running', async () => {
  const inputUrl = 'https://hotels.ctrip.com/hotels/detail/?hotelId=1001&checkIn=2026-06-01';
  const nextUrl = 'https://hotels.ctrip.com/hotels/detail/?hotelId=2002&checkIn=2026-06-01';
  const { elements } = installAiAssistantDom(inputUrl);
  const { module, state } = await loadAiAssistantModules();
  let startTaskCallCount = 0;
  let rejectFirstTask = null;
  let backendRunning = false;
  let sawRunningViewDuringBackendBusyAttempt = false;

  state.templates = [{ id: 'tpl-1', name: '武汉模板' }];
  state.settings = {};
  state.aiTaskQueue = [];
  state.aiTaskQueueCounter = 0;
  state.aiSelectedQueueTaskId = '';
  state.aiQueueSelectionPinned = false;
  state.aiTaskInProgress = false;
  state.aiTaskEvents = [];
  state.aiTaskConsole = {
    submitted: false,
    template: null,
    templateLabel: '',
    hotelUrl: '',
    startedAt: '',
    endedAt: '',
    result: null,
    collectResult: null,
    error: null,
    reply: ''
  };
  elements.get('aiTemplateSelect').value = 'tpl-1';
  global.window.electronAPI.ai.getTaskStatus = async () => ({
    running: backendRunning,
    status: backendRunning ? 'running' : 'idle',
    events: []
  });
  global.window.electronAPI.ai.startTask = async () => {
    startTaskCallCount += 1;
    if (startTaskCallCount > 1) {
      sawRunningViewDuringBackendBusyAttempt =
        sawRunningViewDuringBackendBusyAttempt ||
        /正在采集/.test(elements.get('aiCurrentTaskPanel').innerHTML);
    }
    return new Promise((_resolve, reject) => {
      if (!rejectFirstTask) rejectFirstTask = reject;
    });
  };
  global.window.electronAPI.ai.cancelTask = async () => ({ success: true });

  await module.enqueueAiCollectTask();
  backendRunning = true;
  await module.cancelAiTask();
  module.clearAiTaskRecords();
  elements.get('aiHotelUrlInput').value = nextUrl;
  await module.enqueueAiCollectTask();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(startTaskCallCount, 1);
  assert.equal(state.aiTaskQueue.length, 1);
  assert.equal(state.aiTaskQueue[0].status, 'waiting');
  assert.equal(sawRunningViewDuringBackendBusyAttempt, false);
  assert.doesNotMatch(elements.get('aiCurrentTaskPanel').innerHTML, /正在采集/);

  backendRunning = false;
  rejectFirstTask(new Error('任务已取消'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(startTaskCallCount, 2);
  assert.equal(state.aiTaskQueue[0].status, 'running');
  assert.match(elements.get('aiCurrentTaskPanel').innerHTML, /正在采集/);
});

test('AI collect task payload includes saved AMap API key', async () => {
  const inputUrl = 'https://hotels.ctrip.com/hotels/detail/?hotelId=1001&checkIn=2026-06-01';
  const { elements } = installAiAssistantDom(inputUrl);
  const { module, state } = await loadAiAssistantModules();
  let capturedPayload = null;

  state.templates = [{ id: 'tpl-1', name: '武汉模板' }];
  state.settings = {
    amapApiKey: 'amap-custom-key'
  };
  state.aiTaskQueue = [];
  state.aiTaskQueueCounter = 0;
  state.aiSelectedQueueTaskId = '';
  state.aiQueueSelectionPinned = false;
  state.aiTaskInProgress = false;
  state.aiTaskEvents = [];
  state.aiTaskConsole = {
    submitted: false,
    template: null,
    templateLabel: '',
    hotelUrl: '',
    startedAt: '',
    endedAt: '',
    result: null,
    collectResult: null,
    error: null,
    reply: ''
  };
  elements.get('aiTemplateSelect').value = 'tpl-1';
  global.window.electronAPI.ai.startTask = async (payload) => {
    capturedPayload = payload;
    return {
      message: '采集任务完成',
      collectResult: {
        success: true,
        hotelName: '测试酒店',
        eligibleCount: 0,
        writeResult: null
      },
      taskStatus: {}
    };
  };

  await module.enqueueAiCollectTask();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(capturedPayload.amapKey, 'amap-custom-key');
});

test('AI collect task treats success:false IPC result as failed queue item', async (t) => {
  const inputUrl = 'https://hotels.ctrip.com/hotels/detail/?hotelId=1001&checkIn=2026-06-01';
  const { elements } = installAiAssistantDom(inputUrl);
  const { module, state } = await loadAiAssistantModules();
  const originalConsoleError = console.error;
  console.error = () => {};
  t.after(() => {
    console.error = originalConsoleError;
  });

  state.templates = [{ id: 'tpl-1', name: '武汉模板' }];
  state.settings = {};
  state.aiTaskQueue = [];
  state.aiTaskQueueCounter = 0;
  state.aiSelectedQueueTaskId = '';
  state.aiQueueSelectionPinned = false;
  state.aiTaskInProgress = false;
  state.aiTaskEvents = [];
  state.aiTaskConsole = {
    submitted: false,
    template: null,
    templateLabel: '',
    hotelUrl: '',
    startedAt: '',
    endedAt: '',
    result: null,
    collectResult: null,
    error: null,
    reply: ''
  };
  elements.get('aiTemplateSelect').value = 'tpl-1';
  global.window.electronAPI.ai.startTask = async () => ({
    success: false,
    error: 'EPERM: operation not permitted, copyfile CrashpadMetrics.pma'
  });

  await module.enqueueAiCollectTask();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(state.aiTaskQueue[0].status, 'failed');
  assert.match(state.aiTaskQueue[0].errorMessage, /CrashpadMetrics\.pma/);
  assert.match(elements.get('aiCurrentTaskPanel').innerHTML, /任务执行失败/);
});

test('AI collect task payload includes saved batch concurrency setting', async () => {
  const inputUrl = 'https://hotels.ctrip.com/hotels/detail/?hotelId=1001&checkIn=2026-06-01';
  const { elements } = installAiAssistantDom(inputUrl);
  const { module, state } = await loadAiAssistantModules();
  let capturedPayload = null;

  state.templates = [{ id: 'tpl-1', name: '武汉模板' }];
  state.settings = {
    collectBrowser: '360',
    collectBatchConcurrency: 3
  };
  state.aiTaskQueue = [];
  state.aiTaskQueueCounter = 0;
  state.aiSelectedQueueTaskId = '';
  state.aiQueueSelectionPinned = false;
  state.aiTaskInProgress = false;
  state.aiTaskEvents = [];
  state.aiTaskConsole = {
    submitted: false,
    template: null,
    templateLabel: '',
    hotelUrl: '',
    startedAt: '',
    endedAt: '',
    result: null,
    collectResult: null,
    error: null,
    reply: ''
  };
  elements.get('aiTemplateSelect').value = 'tpl-1';
  global.window.electronAPI.ai.startTask = async (payload) => {
    capturedPayload = payload;
    return {
      message: '采集任务完成',
      collectResult: {
        success: true,
        hotelName: '测试酒店',
        eligibleCount: 0,
        writeResult: null
      },
      taskStatus: {}
    };
  };

  await module.enqueueAiCollectTask();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(capturedPayload.collectBrowser, '360');
  assert.equal(capturedPayload.batchConcurrency, 3);
});

test('AI refresh task payload includes saved batch concurrency setting', async () => {
  installAiAssistantDom('');
  const { module, state, actions } = await loadAiAssistantModules();
  let capturedPayload = null;

  state.settings = {
    collectBrowser: '360',
    collectBatchConcurrency: 3
  };
  state.aiTaskQueue = [];
  state.aiTaskQueueCounter = 0;
  state.aiSelectedQueueTaskId = '';
  state.aiQueueSelectionPinned = false;
  state.aiTaskInProgress = false;
  state.aiTaskEvents = [];
  state.aiTaskConsole = {
    submitted: false,
    template: null,
    templateLabel: '',
    hotelUrl: '',
    startedAt: '',
    endedAt: '',
    result: null,
    collectResult: null,
    error: null,
    reply: ''
  };
  actions.reloadAllData = async () => ({
    hotelsCount: 0,
    templatesCount: 0,
    settingsLoaded: true
  });
  actions.updateTemplateFilter = () => {};
  actions.requestHotelListRender = () => {};
  actions.renderHotelList = () => {};
  global.window.electronAPI.ai.refreshHotelData = async (payload) => {
    capturedPayload = payload;
    return {
      message: '更新完成',
      collectResult: {
        success: true,
        totalHotelCount: 0,
        updatedHotelCount: 0,
        updatedRoomTypeCount: 0,
        deletedRoomTypeCount: 0,
        skippedHotelCount: 0,
        writeResult: null
      },
      taskStatus: {}
    };
  };

  await module.enqueueRefreshHotelDataTask();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(capturedPayload.collectBrowser, '360');
  assert.equal(capturedPayload.batchConcurrency, 3);
});

test('AI collect enqueue uses saved list prefilter settings instead of stale list URL filters', async () => {
  const inputUrl =
    'https://hotels.ctrip.com/hotels/list?cityId=477&listFilters=16~5*16*5&locale=zh-CN';
  const { elements } = installAiAssistantDom(inputUrl);
  const { module, state } = await loadAiAssistantModules();
  let capturedPayload = null;

  state.templates = [{ id: 'tpl-1', name: '武汉模板' }];
  state.settings = {
    aiCtripPriceMin: '',
    aiCtripPriceMax: '',
    aiCtripStarLevels: [3],
    aiCtripSortMode: '',
    aiCtripFreeCancel: false,
    aiCtripReviewCountMin: '',
    aiCtripScoreMin: '',
    aiListDesiredHotelCount: 5,
    aiListExcludeHotelTypes: ''
  };
  state.aiTaskQueue = [];
  state.aiTaskQueueCounter = 0;
  state.aiSelectedQueueTaskId = '';
  state.aiQueueSelectionPinned = false;
  state.aiTaskInProgress = false;
  state.aiTaskEvents = [];
  state.aiTaskConsole = {
    submitted: false,
    template: null,
    templateLabel: '',
    hotelUrl: '',
    startedAt: '',
    endedAt: '',
    result: null,
    collectResult: null,
    error: null,
    reply: ''
  };
  elements.get('aiTemplateSelect').value = 'tpl-1';
  global.window.electronAPI.ai.startTask = async (payload) => {
    capturedPayload = payload;
    return {
      message: '采集任务完成',
      collectResult: {
        success: true,
        hotelName: '测试酒店',
        eligibleCount: 0,
        writeResult: null
      },
      taskStatus: {}
    };
  };

  await module.enqueueAiCollectTask();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(capturedPayload.listUrlFilters.starLevels, [3]);
  assert.equal(capturedPayload.desiredHotelCount, 5);
  const parsedUrl = parseCtripListUrl(capturedPayload.url);
  assert.ok(parsedUrl.listFilterParts.includes('16~3*16*3'));
  assert.equal(parsedUrl.listFilterParts.includes('16~5*16*5'), false);
});

test('list prefilter controls live in a dedicated assistant modal', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const startBarMatch = html.match(/<section class="task-start-card"[\s\S]*?<\/section>/);
  const settingsMatch = html.match(/<div id="settingsModal"[\s\S]*?<div id="personalizationModal"/);
  const prefilterMatch = html.match(/<div id="listPrefilterModal"[\s\S]*?<div id="settingsModal"/);
  const currentTaskHeaderMatch = html.match(
    /<section class="current-task-card"[\s\S]*?<div id="aiCurrentTaskPanel"/
  );
  const startBarHtml = startBarMatch ? startBarMatch[0] : '';
  const settingsHtml = settingsMatch ? settingsMatch[0] : '';
  const prefilterHtml = prefilterMatch ? prefilterMatch[0] : '';
  const currentTaskHeaderHtml = currentTaskHeaderMatch ? currentTaskHeaderMatch[0] : '';

  assert.doesNotMatch(startBarHtml, /列表页前筛/);
  assert.doesNotMatch(startBarHtml, /aiListDesiredHotelCount/);
  assert.doesNotMatch(settingsHtml, /列表页前筛/);
  assert.doesNotMatch(settingsHtml, /aiCtripPriceMin/);
  assert.match(settingsHtml, /amapApiKeyInput/);
  assert.match(settingsHtml, /高德 API Key/);
  assert.match(settingsHtml, /save-amap-api-key/);
  assert.match(settingsHtml, /collectBrowser/);
  assert.match(settingsHtml, /携程采集浏览器/);
  assert.match(settingsHtml, /collectBatchConcurrency/);
  assert.match(settingsHtml, /并发采集数/);
  assert.match(settingsHtml, /<option value="3">3 - 并发采集<\/option>/);
  assert.match(currentTaskHeaderHtml, /open-list-prefilter-settings/);
  assert.match(currentTaskHeaderHtml, /前筛设置/);
  assert.match(prefilterHtml, /列表页前筛/);
  assert.match(prefilterHtml, /携程前筛/);
  assert.match(prefilterHtml, /本地过滤/);
  assert.match(prefilterHtml, /aiCtripPriceMin/);
  assert.match(prefilterHtml, /aiCtripPriceMax/);
  assert.doesNotMatch(prefilterHtml, /<select id="aiCtripStarLevels"/);
  assert.match(prefilterHtml, /aiCtripStarLevelPills/);
  assert.match(prefilterHtml, /data-star-level="2"/);
  assert.match(prefilterHtml, /两星及以下/);
  assert.match(prefilterHtml, /三星/);
  assert.match(prefilterHtml, /四星/);
  assert.match(prefilterHtml, /五星/);
  assert.match(prefilterHtml, /aiCtripSortMode/);
  assert.match(prefilterHtml, /欢迎度排序/);
  assert.match(prefilterHtml, /aiCtripFreeCancel/);
  assert.match(prefilterHtml, /aiCtripReviewCountMin/);
  assert.match(prefilterHtml, /aiCtripScoreMin/);
  assert.match(prefilterHtml, /aiListDesiredHotelCount/);
  assert.doesNotMatch(prefilterHtml, /aiListMinScore/);
  assert.doesNotMatch(prefilterHtml, /aiListExcludeKeywords/);
  assert.doesNotMatch(prefilterHtml, /本地最低评分/);
  assert.doesNotMatch(prefilterHtml, /本地排除关键词/);
  assert.match(prefilterHtml, /aiListExcludeHotelTypes/);
  assert.doesNotMatch(prefilterHtml, /aiListMaxPages/);
  assert.doesNotMatch(prefilterHtml, /URL 预览/);
  assert.doesNotMatch(prefilterHtml, /复制 URL/);
  assert.doesNotMatch(startBarHtml, /可一次粘贴多个/);
});

test('list prefilter styles inherit global personalization theme variables', () => {
  const css = readRendererStyles();
  const taskButtonStart = css.indexOf('.task-prefilter-button {');
  const taskButtonEnd = css.indexOf('.task-prefilter-button svg');
  const modalStart = css.indexOf('.list-prefilter-modal-content');
  const modalEnd = css.indexOf('.ai-config-grid');
  const prefilterCss =
    css.slice(taskButtonStart, taskButtonEnd) + '\n' + css.slice(modalStart, modalEnd);

  assert.ok(taskButtonStart >= 0, 'task prefilter button styles should exist');
  assert.ok(taskButtonEnd > taskButtonStart, 'task prefilter button styles should be extracted');
  assert.ok(modalStart >= 0, 'list prefilter modal styles should exist');
  assert.ok(modalEnd > modalStart, 'list prefilter modal styles should be extracted');
  assert.match(prefilterCss, /var\(--primary-color\)/);
  assert.match(prefilterCss, /var\(--bg-primary\)/);
  assert.match(prefilterCss, /var\(--text-primary\)/);
  assert.doesNotMatch(
    prefilterCss,
    /#(?:2563eb|1d4ed8|eff6ff|93b4e8|f6f8fb|e5eaf2|d8e1ed|172033|1e293b|334155|64748b|475569|94a3b8|a7b3c3|0891b2|e6fffb|b7eef0|afc0d5|f8fafc)\b|rgba\((?:37,\s*99,\s*235|36,\s*49,\s*64|15,\s*23,\s*42)/
  );
});

test('task console section headings do not show English eyebrow labels', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const taskConsoleSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'modules', 'ai-task-renderers.js'),
    'utf8'
  );

  assert.doesNotMatch(html, /CURRENT TASK|TASK START BAR/);
  assert.doesNotMatch(taskConsoleSource, /TASK QUEUE/);
  assert.match(html, /当前任务/);
  assert.match(html, /任务启动栏/);
  assert.match(taskConsoleSource, /任务队列/);
});

test('settings modal does not expose AI interface config wiring', () => {
  const settingsUiSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'modules', 'settings-ui.js'),
    'utf8'
  );
  const appModuleSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'app.module.js'),
    'utf8'
  );

  assert.doesNotMatch(settingsUiSource, /setAiConfigLoader/);
  assert.doesNotMatch(settingsUiSource, /loadAiInterfaceSettings/);
  assert.doesNotMatch(appModuleSource, /setAiConfigLoader/);
  assert.doesNotMatch(appModuleSource, /save-ai-config/);
  assert.doesNotMatch(appModuleSource, /test-ai-connection/);
});

test('completed task summary card shows execution elapsed time between end time and status', async () => {
  installAiAssistantDom();
  const { renderAiTaskConsole } = await loadTaskConsoleModule();

  const state = {
    aiTaskQueue: [],
    aiTaskQueueCounter: 0,
    aiSelectedQueueTaskId: '',
    aiQueueSelectionPinned: false,
    aiTaskInProgress: false,
    aiTaskEvents: [],
    aiTaskConsole: {
      submitted: true,
      template: { id: 'tpl-1' },
      templateLabel: '武汉模板',
      hotelUrl: 'https://hotels.ctrip.com/hotels/detail/?hotelId=1001',
      startedAt: '2026-06-01T01:24:39.000+08:00',
      endedAt: '2026-06-01T01:25:39.000+08:00',
      result: {
        success: true,
        hotelName: '测试酒店',
        eligibleCount: 1,
        eligibleRoomTypes: [{ roomType: '大床房', dailyPrice: 300, totalPrice: 300 }],
        writeResult: { operation: 'inserted' }
      },
      error: null,
      reply: ''
    }
  };

  const taskState = renderAiTaskConsole(state);
  assert.equal(taskState.status, 'success');

  const panel = global.document.getElementById('aiCurrentTaskPanel');
  const html = panel.innerHTML;

  assert.ok(html.includes('执行时间'), 'should contain elapsed time label');
  assert.ok(html.includes('00:01:00'), 'should show 1 minute elapsed');

  const endTimeIndex = html.indexOf('完成时间');
  const elapsedIndex = html.indexOf('执行时间');
  const statusIndex = html.indexOf('执行状态');
  assert.ok(endTimeIndex > 0, 'should have end time label');
  assert.ok(elapsedIndex > endTimeIndex, 'elapsed time should appear after end time');
  assert.ok(statusIndex > elapsedIndex, 'execution status should appear after elapsed time');
});
