const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let logicModuleUrls = null;

async function loadAiTaskLogicModules() {
  if (!logicModuleUrls) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-ai-task-logic-'));
    const sourceDir = path.join(__dirname, '..', 'src', 'renderer', 'modules');
    fs.writeFileSync(path.join(tempRoot, 'package.json'), '{"type":"module"}\n', 'utf-8');
    [
      'ai-task-events.js',
      'ai-task-formatters.js',
      'ai-task-progress.js',
      'ai-task-renderers.js',
      'ai-task-state.js',
      'dom-helpers.js'
    ].forEach((fileName) => {
      fs.copyFileSync(path.join(sourceDir, fileName), path.join(tempRoot, fileName));
    });
    logicModuleUrls = {
      formatters: pathToFileURL(path.join(tempRoot, 'ai-task-formatters.js')).href,
      events: pathToFileURL(path.join(tempRoot, 'ai-task-events.js')).href,
      progress: pathToFileURL(path.join(tempRoot, 'ai-task-progress.js')).href,
      renderers: pathToFileURL(path.join(tempRoot, 'ai-task-renderers.js')).href,
      state: pathToFileURL(path.join(tempRoot, 'ai-task-state.js')).href
    };
    process.on('exit', () => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
  }

  const [formatters, events, progress, renderers, state] = await Promise.all([
    import(logicModuleUrls.formatters),
    import(logicModuleUrls.events),
    import(logicModuleUrls.progress),
    import(logicModuleUrls.renderers),
    import(logicModuleUrls.state)
  ]);
  return { formatters, events, progress, renderers, state };
}

function installEscapeHtmlDocument() {
  global.document = {
    createElement() {
      let value = '';
      return {
        set textContent(nextValue) {
          value = String(nextValue == null ? '' : nextValue);
        },
        get innerHTML() {
          return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
        }
      };
    }
  };
}

test('ai-task-formatters: extractCtripUrls trims Chinese punctuation and removes duplicates', async () => {
  const { formatters } = await loadAiTaskLogicModules();
  const text = `
    https://hotels.ctrip.com/hotels/detail/?hotelId=1001&checkIn=2026-06-01。
    https://hotels.ctrip.com/hotels/list?cityId=477&listFilters=29~1*29*1~3&locale=zh-CN,后面是中文说明
    https://hotels.ctrip.com/hotels/detail/?hotelId=1001&checkIn=2026-06-01！
  `;

  assert.deepEqual(formatters.extractCtripUrls(text), [
    'https://hotels.ctrip.com/hotels/detail/?hotelId=1001&checkIn=2026-06-01',
    'https://hotels.ctrip.com/hotels/list?cityId=477&listFilters=29~1*29*1~3&locale=zh-CN'
  ]);
});

test('ai-task-progress: hasWriteResult handles batchMode and skipped write results', async () => {
  const { progress } = await loadAiTaskLogicModules();

  assert.equal(progress.hasWriteResult({ batchMode: true, appliedCount: 0, items: [] }), false);
  assert.equal(progress.hasWriteResult({ batchMode: true, appliedCount: 1, items: [] }), true);
  assert.equal(progress.hasWriteResult([{ result: [{ operation: 'skipped' }] }]), false);
  assert.equal(progress.hasWriteResult([{ result: [{ operation: 'updated' }] }]), true);
});

test('ai-task-progress: buildProgressStats counts batch item progress', async () => {
  const { progress } = await loadAiTaskLogicModules();

  assert.deepEqual(
    progress.buildProgressStats([
      { type: 'batch:item-start', message: '第 1/3 家', details: { index: 1, total: 3 } },
      { type: 'batch:item-done', details: { index: 1, total: 3 } },
      { type: 'batch:item-start', details: { index: 2, total: 3 } }
    ]),
    {
      total: 3,
      completed: 1,
      running: 1,
      pending: 1
    }
  );
});

test('ai-task-progress: getRefreshCurrentStepKey stays on refresh until summary/write', async () => {
  const { progress } = await loadAiTaskLogicModules();

  assert.equal(
    progress.getRefreshCurrentStepKey([
      { type: 'task:start' },
      { type: 'refresh:load-data' },
      { type: 'refresh:item-start', details: { index: 1, total: 2 } }
    ]),
    'refresh'
  );
  assert.equal(
    progress.getRefreshCurrentStepKey([
      { type: 'task:start' },
      { type: 'refresh:item-start', details: { index: 1, total: 1 } },
      { type: 'refresh:item-done', details: { index: 1, total: 1 } },
      { type: 'refresh:summary', details: { totalHotelCount: 1 } }
    ]),
    'write'
  );
});

test('ai-task-events: getReadableEventTitle maps collect and refresh events', async () => {
  const { events } = await loadAiTaskLogicModules();

  assert.equal(events.getReadableEventTitle({ type: 'task:done' }, 'collect'), '采集任务完成');
  assert.equal(events.getReadableEventTitle({ type: 'task:done' }, 'refresh-data'), '更新任务完成');
  assert.equal(
    events.getReadableEventTitle({ type: 'refresh:load-data' }, 'refresh-data'),
    '正在读取当前宾馆数据'
  );
});

test('ai-task-state: normalizeTaskState derives idle, running, success, error, and cancelled states', async () => {
  const { state } = await loadAiTaskLogicModules();

  assert.equal(state.normalizeTaskState({}).status, 'idle');
  assert.equal(
    state.normalizeTaskState({
      task: { submitted: true, startedAt: '2026-05-25T00:00:00.000Z' },
      events: [{ type: 'task:start', at: '2026-05-25T00:00:00.000Z' }],
      inProgress: true
    }).status,
    'running'
  );
  assert.equal(
    state.normalizeTaskState({
      task: { submitted: true, result: { message: 'ok' } }
    }).status,
    'success'
  );
  assert.equal(
    state.normalizeTaskState({
      task: { submitted: true, error: '任务执行失败' }
    }).status,
    'error'
  );
  assert.equal(
    state.normalizeTaskState({
      task: { submitted: true },
      events: [{ type: 'task:cancel', message: '任务已取消' }]
    }).status,
    'cancelled'
  );
});

test('ai-task-state: getElapsedText handles running and finished tasks', async () => {
  const { state } = await loadAiTaskLogicModules();
  const startTime = '2026-05-25T00:00:00.000Z';
  const endTime = '2026-05-25T00:00:03.000Z';

  assert.equal(
    state.getElapsedText({ startTime }, 'running', new Date('2026-05-25T00:00:05.000Z').getTime()),
    '00:00:05'
  );
  assert.equal(state.getElapsedText({ startTime, endTime }, 'success'), '00:00:03');
});

test('ai-task-renderers: renderTaskQueue groups tasks and marks the selected task', async () => {
  installEscapeHtmlDocument();
  const { renderers } = await loadAiTaskLogicModules();
  const html = renderers.renderTaskQueue(
    [
      { id: 'running-1', status: 'running', title: '运行任务' },
      { id: 'waiting-1', status: 'waiting', title: '等待任务' },
      { id: 'done-1', status: 'completed', title: '完成任务' },
      { id: 'failed-1', status: 'failed', title: '失败任务' }
    ],
    { selectedId: 'waiting-1' }
  );

  assert.match(html, /运行中/);
  assert.match(html, /等待中/);
  assert.match(html, /已完成/);
  assert.match(html, /失败/);
  assert.match(html, /task-queue-item is-selected task-queue-status-waiting/);
});

test('ai-task-renderers: task views keep critical data-action hooks', async () => {
  installEscapeHtmlDocument();
  const { state, renderers } = await loadAiTaskLogicModules();
  const runningState = state.normalizeTaskState({
    task: { submitted: true, startedAt: '2026-05-25T00:00:00.000Z' },
    events: [{ type: 'task:start', at: '2026-05-25T00:00:00.000Z' }],
    inProgress: true
  });
  const successState = state.normalizeTaskState({
    task: { submitted: true, result: { message: 'ok' }, endedAt: '2026-05-25T00:00:03.000Z' }
  });
  const errorState = state.normalizeTaskState({
    task: { submitted: true, error: '任务执行失败' }
  });
  const cancelledState = state.normalizeTaskState({
    task: { submitted: true, cancelled: true, error: '任务已取消' }
  });

  assert.match(renderers.renderRunningView(runningState), /data-action="cancel-ai-task"/);
  assert.match(renderers.renderSuccessView(successState), /data-action="rerun-current-ai-task"/);
  assert.match(renderers.renderErrorView(errorState), /data-action="focus-ai-task-start-bar"/);
  assert.match(
    renderers.renderCancelledView(cancelledState),
    /data-action="rerun-current-ai-task"/
  );
});
