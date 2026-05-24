const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let stateModuleUrl = '';

async function loadStateModule() {
  if (!stateModuleUrl) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-state-ai-'));
    const sourceDir = path.join(__dirname, '..', 'src', 'renderer', 'modules');
    fs.writeFileSync(path.join(tempRoot, 'package.json'), '{"type":"module"}\n', 'utf-8');
    fs.copyFileSync(path.join(sourceDir, 'state.js'), path.join(tempRoot, 'state.js'));
    stateModuleUrl = pathToFileURL(path.join(tempRoot, 'state.js')).href;
    process.on('exit', () => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
  }

  return import(stateModuleUrl);
}

test('AI state helpers manage queue selection, running-task clear, console reset, and events', async () => {
  const {
    state,
    pushAiTaskQueueItem,
    setAiSelectedQueueTaskId,
    setAiQueueSelectionPinned,
    resetAiTaskQueueState,
    resetAiTaskConsole,
    pushAiTaskEvent
  } = await loadStateModule();

  resetAiTaskQueueState();
  resetAiTaskConsole();

  const waitingTask = {
    id: 'task-waiting',
    status: 'waiting',
    events: [],
    console: { submitted: false, taskKind: 'collect' }
  };
  const runningTask = {
    id: 'task-running',
    status: 'running',
    events: [],
    console: { submitted: true, taskKind: 'collect' }
  };

  pushAiTaskQueueItem(waitingTask);
  pushAiTaskQueueItem(runningTask);
  setAiSelectedQueueTaskId(waitingTask.id);
  setAiQueueSelectionPinned(true);

  assert.equal(state.aiTaskQueue.length, 2);
  assert.equal(state.aiSelectedQueueTaskId, waitingTask.id);
  assert.equal(state.aiQueueSelectionPinned, true);

  resetAiTaskQueueState({ keepRunningTask: true });

  assert.deepEqual(
    state.aiTaskQueue.map((task) => task.id),
    [runningTask.id]
  );
  assert.equal(state.aiSelectedQueueTaskId, runningTask.id);
  assert.equal(state.aiQueueSelectionPinned, false);

  pushAiTaskEvent({ type: 'task:step', message: '准备采集' });
  assert.equal(state.aiTaskEvents.length, 1);
  assert.equal(state.aiTaskEvents[0].message, '准备采集');

  state.aiTaskConsole = {
    submitted: true,
    template: null,
    templateLabel: '旧任务',
    hotelUrl: 'https://example.com',
    taskId: 'backend-1',
    startedAt: '2026-05-24T00:00:00.000Z',
    endedAt: '',
    result: null,
    collectResult: null,
    error: null,
    reply: '',
    taskKind: 'collect'
  };

  resetAiTaskConsole();

  assert.equal(state.aiTaskConsole.submitted, false);
  assert.equal(state.aiTaskConsole.templateLabel, '');
  assert.equal(state.aiTaskConsole.taskId, '');
});
