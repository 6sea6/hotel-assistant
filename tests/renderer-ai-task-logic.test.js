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
    ['ai-task-formatters.js', 'ai-task-events.js', 'ai-task-progress.js'].forEach((fileName) => {
      fs.copyFileSync(path.join(sourceDir, fileName), path.join(tempRoot, fileName));
    });
    logicModuleUrls = {
      formatters: pathToFileURL(path.join(tempRoot, 'ai-task-formatters.js')).href,
      events: pathToFileURL(path.join(tempRoot, 'ai-task-events.js')).href,
      progress: pathToFileURL(path.join(tempRoot, 'ai-task-progress.js')).href
    };
    process.on('exit', () => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
  }

  const [formatters, events, progress] = await Promise.all([
    import(logicModuleUrls.formatters),
    import(logicModuleUrls.events),
    import(logicModuleUrls.progress)
  ]);
  return { formatters, events, progress };
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
