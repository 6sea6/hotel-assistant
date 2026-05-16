const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let taskConsoleModuleUrl = '';

async function loadTaskConsoleModule() {
  if (!taskConsoleModuleUrl) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-ai-task-console-'));
    const sourceDir = path.join(__dirname, '..', 'src', 'renderer', 'modules');
    fs.writeFileSync(path.join(tempRoot, 'package.json'), '{"type":"module"}\n', 'utf-8');
    fs.copyFileSync(path.join(sourceDir, 'dom-helpers.js'), path.join(tempRoot, 'dom-helpers.js'));
    fs.copyFileSync(path.join(sourceDir, 'ai-task-console.js'), path.join(tempRoot, 'ai-task-console.js'));
    taskConsoleModuleUrl = pathToFileURL(path.join(tempRoot, 'ai-task-console.js')).href;
    process.on('exit', () => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
  }

  return import(taskConsoleModuleUrl);
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
  const text = 'https://hotels.ctrip.com/hotels/list?cityId=477&checkin=2026-06-01&checkout=2026-06-02&listFilters=29~1*29*1~3&locale=zh-CN,我将链接输入后显示解析错误';
  const urls = extractCtripUrls(text);

  assert.equal(urls.length, 1);
  assert.equal(urls[0], 'https://hotels.ctrip.com/hotels/list?cityId=477&checkin=2026-06-01&checkout=2026-06-02&listFilters=29~1*29*1~3&locale=zh-CN');
  assert.equal(extractCtripUrl(text), urls[0]);
});

test('hasWriteResult understands batch apply summaries', async () => {
  const { hasWriteResult } = await loadTaskConsoleModule();

  assert.equal(hasWriteResult({
    batchMode: true,
    appliedCount: 0,
    skippedCount: 2,
    items: []
  }), false);
  assert.equal(hasWriteResult({
    batchMode: true,
    appliedCount: 1,
    skippedCount: 1,
    items: []
  }), true);
  assert.equal(hasWriteResult({
    batchMode: true,
    appliedCount: 0,
    items: [{
      writeResult: {
        operation: 'inserted'
      }
    }]
  }), true);
  assert.equal(hasWriteResult([{
    itemIndex: 1,
    result: [{ operation: 'skipped' }]
  }]), false);
  assert.equal(hasWriteResult([{
    itemIndex: 1,
    result: [{ operation: 'updated' }]
  }]), true);
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
        eligibleRoomTypes: [{
          roomType: '家庭房',
          dailyPrice: 300,
          totalPrice: 900
        }],
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
  assert.equal(taskState.result.hotelName, '批量 3 家');
  assert.equal(taskState.result.actualResultText, '批量 3 家');
  assert.equal(taskState.result.isBatchResult, true);
  assert.equal(taskState.canReview, false);
  assert.doesNotMatch(taskState.result.actualResultText, /第一家酒店/);
  assert.doesNotMatch(taskState.result.actualResultText, /可用房型/);
  assert.doesNotMatch(taskState.result.actualResultText, /价格/);
  assert.equal(taskState.result.eligibleCount, 4);
  assert.equal(taskState.result.writeBackStatus, '已写入数据');
});

test('normalizeTaskState keeps AI review available for single hotel results only', async () => {
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
        eligibleRoomTypes: [{
          roomType: '家庭房',
          dailyPrice: 300,
          totalPrice: 300
        }],
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

  assert.equal(singleTaskState.canReview, true);
  assert.equal(batchTaskState.canReview, false);
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
  const moduleSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'modules', 'ai-task-console.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');

  assert.match(moduleSource, /<svg class="task-progress-stat-icon task-progress-stat-icon-hotel"/);
  assert.match(moduleSource, /<svg class="task-progress-stat-icon task-progress-stat-icon-done"/);
  assert.match(moduleSource, /<svg class="task-progress-stat-icon task-progress-stat-icon-running loading-icon"/);
  assert.match(moduleSource, /<svg class="task-progress-stat-icon task-progress-stat-icon-pending"/);
  assert.match(css, /\.loading-icon\s*\{[\s\S]*animation:\s*spin 1s linear infinite/);
  assert.match(css, /\.task-progress-stat-icon\s*\{[\s\S]*width:\s*22px;[\s\S]*height:\s*22px;/);
});

test('list prefilter controls live in settings instead of the task start bar', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const startBarMatch = html.match(/<section class="task-start-card"[\s\S]*?<\/section>/);
  const settingsMatch = html.match(/<div id="settingsModal"[\s\S]*?<div id="personalizationModal"/);
  const startBarHtml = startBarMatch ? startBarMatch[0] : '';
  const settingsHtml = settingsMatch ? settingsMatch[0] : '';

  assert.doesNotMatch(startBarHtml, /列表页前筛/);
  assert.doesNotMatch(startBarHtml, /aiListDesiredHotelCount/);
  assert.match(settingsHtml, /列表页前筛/);
  assert.match(settingsHtml, /aiListDesiredHotelCount/);
  assert.match(settingsHtml, /aiListMinScore/);
  assert.match(settingsHtml, /aiListExcludeKeywords/);
  assert.match(settingsHtml, /aiListExcludeHotelTypes/);
  assert.match(settingsHtml, /aiListMaxPages/);
  assert.match(settingsHtml, /最多扫描页数/);
  assert.doesNotMatch(startBarHtml, /可一次粘贴多个/);
});
