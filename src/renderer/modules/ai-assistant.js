import {
  state,
  setAiTaskInProgress,
  setAiAssistantInitialized,
  setAiTaskEvents,
  pushAiTaskEvent,
  setAiTaskConsole,
  resetAiTaskConsole,
  pushAiTaskQueueItem,
  removeAiTaskQueueItem,
  setAiSelectedQueueTaskId,
  setAiQueueSelectionPinned,
  resetAiTaskQueueState
} from './state.js';
import { $, setValue } from './dom-helpers.js';
import { dismissNotification, showNotification } from './notification.js';
import { actions } from './actions.js';
import {
  formatAiTemplateLabel,
  getCollectToolResult,
  hasWriteResult,
  renderAiTaskConsole
} from './ai-task-console.js';
import {
  buildTaskPayload,
  getSubmittedUrl,
  handleAiTaskInputChange,
  readCollectBrowser,
  readCollectBatchConcurrency,
  readCtripUrlFilterSettings,
  readListFilterForm,
  syncAiCtripListUrlFromSettings,
  syncCtripListUrlSettingsFromInput,
  updateAiInputCount as updatePayloadInputCount
} from './ai-task-payload.js';
import {
  createEmptyTaskConsole,
  createQueueTask,
  findQueueTaskByBackendTaskId,
  getRunningQueueTask,
  getSelectedQueueTask
} from './ai-task-queue.js';
import {
  findSelectedAiTemplate,
  renderAiTemplateOptions,
  setupAiTemplatePicker
} from './ai-template-picker.js';
import { createRafRenderScheduler } from './ai-task-events.js';

export {
  handleAiTaskInputChange,
  readCtripUrlFilterSettings,
  renderAiTemplateOptions,
  syncAiCtripListUrlFromSettings,
  syncCtripListUrlSettingsFromInput
};

/**
 * @typedef {import('../../shared/contracts').TemplateRecord} TemplateRecord
 * @typedef {import('../../shared/contracts').AiTaskKind} AiTaskKind
 * @typedef {import('../../shared/contracts').AiTaskEvent} AiTaskEvent
 * @typedef {import('../../shared/contracts').AiTaskConsoleState} AiTaskConsoleState
 * @typedef {import('../../shared/contracts').AiTaskQueueItem} AiTaskQueueItem
 * @typedef {import('../../shared/contracts').AiTaskBackendResult} AiTaskBackendResult
 * @typedef {import('../../shared/contracts').AiListFilters} AiListFilters
 * @typedef {import('../../shared/contracts').AiListUrlFilters} AiListUrlFilters
 */

const BACKEND_BUSY_RETRY_DELAY_MS = 1200;
let activeCollectTaskId = '';
let backendIdleRetryTimer = 0;
let queueStartCheckInProgress = false;
/** @type {null|(() => void)} */
let disposeAiTaskEventListener = null;
const activeLoginNotifications = new Map();
const CTRIP_LOGIN_NOTIFICATION_MESSAGE =
  '需要登录携程，请在弹出的采集浏览器中完成登录后关闭窗口';

function setPageVisible(id, visible) {
  const el = $(id);
  if (el) {
    el.style.display = visible ? '' : 'none';
  }
}

function renderTaskConsole() {
  renderAiTaskConsole(state);
  updatePayloadInputCount();
}

const scheduleTaskConsoleRender = createRafRenderScheduler(renderTaskConsole);

/**
 * @param {AiTaskQueueItem|null} task
 * @returns {void}
 */
function markAiTaskInProgress(task) {
  activeCollectTaskId = task && task.id ? String(task.id) : '';
  setAiTaskInProgress(true);
}

/**
 * @param {AiTaskQueueItem|null} task
 * @returns {void}
 */
function clearAiTaskInProgressForTask(task) {
  const taskId = task && task.id ? String(task.id) : '';
  if (!activeCollectTaskId || activeCollectTaskId === taskId) {
    activeCollectTaskId = '';
    setAiTaskInProgress(false);
  }
}

function releaseStaleAiTaskInProgress() {
  if (getRunningQueueTask()) return;
  if (!state.aiTaskInProgress) return;

  activeCollectTaskId = '';
  setAiTaskInProgress(false);
}

async function isBackendTaskRunning() {
  if (!window.electronAPI?.ai?.getTaskStatus) {
    return false;
  }

  try {
    const status = await window.electronAPI.ai.getTaskStatus();
    return Boolean(status && status.running);
  } catch (error) {
    console.warn('读取 AI 采集任务状态失败:', error);
    return false;
  }
}

function scheduleRunNextQueueTask(delayMs = 0) {
  if (delayMs > 0) {
    if (backendIdleRetryTimer) return;
    backendIdleRetryTimer = /** @type {number} */ (
      /** @type {unknown} */ (
        globalThis.setTimeout(() => {
          backendIdleRetryTimer = 0;
          void runNextQueueTask();
        }, delayMs)
      )
    );
    return;
  }

  setTimeout(() => {
    void runNextQueueTask();
  }, 0);
}

/**
 * @param {AiTaskQueueItem|null} task
 * @returns {void}
 */
function syncDisplayedTask(task) {
  if (!task) return;
  setAiSelectedQueueTaskId(task.id || '');
  setAiTaskConsole(task.console || createEmptyTaskConsole());
  setAiTaskEvents(task.events || []);
}

function shouldAutoDisplayStartedTask(task) {
  const selectedTask = getSelectedQueueTask();
  return (
    !state.aiQueueSelectionPinned ||
    !selectedTask ||
    String(state.aiSelectedQueueTaskId) === String(task.id)
  );
}

/**
 * @param {TemplateRecord|null} template
 * @param {string} url
 * @param {AiTaskQueueItem|null} [queueTask]
 * @returns {void}
 */
function startTaskConsole(template, url, queueTask = null) {
  const startedAt = new Date().toISOString();
  const events = [];
  const taskKind = queueTask && queueTask.taskKind ? queueTask.taskKind : 'collect';
  const consoleState = {
    ...createEmptyTaskConsole(),
    submitted: true,
    template,
    templateLabel:
      taskKind === 'refresh-data' ? '更新已有宾馆数据' : formatAiTemplateLabel(template),
    hotelUrl: url,
    startedAt,
    taskKind
  };
  if (queueTask) {
    queueTask.status = 'running';
    queueTask.startedAt = startedAt;
    queueTask.finishedAt = '';
    queueTask.errorMessage = '';
    queueTask.resultSummary = '';
    queueTask.cancelNoticeShown = false;
    queueTask.loginNoticeShown = false;
    queueTask.events = events;
    queueTask.console = consoleState;
    if (shouldAutoDisplayStartedTask(queueTask)) {
      setAiQueueSelectionPinned(false);
      syncDisplayedTask(queueTask);
    }
  } else {
    setAiTaskEvents(events);
    setAiTaskConsole(consoleState);
  }
  renderTaskConsole();
}

/**
 * @param {AiTaskBackendResult} result
 * @param {string} reply
 * @param {AiTaskQueueItem|null} [queueTask]
 * @returns {void}
 */
function finishTaskConsole(result, reply, queueTask = null) {
  const collectToolResult = getCollectToolResult(result);
  const taskStatus = result && result.taskStatus ? result.taskStatus : {};
  const baseConsole = queueTask && queueTask.console ? queueTask.console : state.aiTaskConsole;
  const collectResult = /** @type {AiTaskConsoleState['collectResult']} */ (
    result.collectResult || (collectToolResult ? collectToolResult.result : null)
  );
  /** @type {AiTaskConsoleState} */
  const consoleState = {
    ...baseConsole,
    taskId: taskStatus.id || baseConsole.taskId || '',
    endedAt: taskStatus.finishedAt || new Date().toISOString(),
    result,
    collectResult,
    error: null,
    reply
  };
  if (queueTask) {
    closeCtripLoginNotification(
      { taskId: consoleState.taskId || queueTask.backendTaskId || '' },
      queueTask
    );
    queueTask.backendTaskId = consoleState.taskId || queueTask.backendTaskId || '';
    queueTask.finishedAt = consoleState.endedAt;
    queueTask.status = 'completed';
    queueTask.resultSummary = result.message || reply || '采集任务完成';
    queueTask.console = consoleState;
    if (String(state.aiSelectedQueueTaskId) === String(queueTask.id)) {
      setAiTaskConsole(consoleState);
      setAiTaskEvents(queueTask.events || []);
    }
  } else {
    closeCtripLoginNotification({ taskId: consoleState.taskId || '' });
    setAiTaskConsole(consoleState);
  }
}

/**
 * @param {Error|string|unknown} error
 * @param {AiTaskQueueItem|null} [queueTask]
 * @returns {void}
 */
function failTaskConsole(error, queueTask = null) {
  const errorLike = /** @type {{message?: string}|null} */ (
    error && typeof error === 'object' ? error : null
  );
  const errorMessage =
    errorLike && errorLike.message ? errorLike.message : String(error || '任务执行失败');
  const baseConsole = queueTask && queueTask.console ? queueTask.console : state.aiTaskConsole;
  const consoleState = {
    ...baseConsole,
    submitted: true,
    endedAt: new Date().toISOString(),
    error: errorMessage
  };
  if (queueTask) {
    closeCtripLoginNotification(
      { taskId: baseConsole.taskId || queueTask.backendTaskId || '' },
      queueTask
    );
    queueTask.status = 'failed';
    queueTask.finishedAt = consoleState.endedAt;
    queueTask.errorMessage = errorMessage;
    queueTask.resultSummary = errorMessage;
    queueTask.console = consoleState;
    if (String(state.aiSelectedQueueTaskId) === String(queueTask.id)) {
      setAiTaskConsole(consoleState);
      setAiTaskEvents(queueTask.events || []);
    }
  } else {
    closeCtripLoginNotification({ taskId: baseConsole.taskId || '' });
    setAiTaskConsole(consoleState);
  }
}

function isTaskCancellationError(error) {
  const message = error && error.message ? error.message : String(error || '');
  return (
    /任务已取消|采集任务已取消|operation was aborted|aborted/i.test(message) ||
    (error && error.name === 'AbortError')
  );
}

function isBackendBusyError(error) {
  const message = error && error.message ? error.message : String(error || '');
  return /已有 AI 采集任务正在运行|正在运行，请等待完成后再开始新任务/.test(message);
}

function assertSuccessfulAiTaskResult(result) {
  if (result && result.success !== false) {
    return;
  }
  throw new Error((result && (result.error || result.message)) || '采集任务执行失败');
}

function deferTaskUntilBackendIdle(queueTask = null) {
  if (!queueTask) return;

  queueTask.status = 'waiting';
  queueTask.startedAt = '';
  queueTask.finishedAt = '';
  queueTask.backendTaskId = '';
  queueTask.errorMessage = '';
  queueTask.resultSummary = '等待上一个采集进程关闭';
  queueTask.currentStep = '等待上一个采集进程关闭';
  queueTask.events = [];
  queueTask.console = createEmptyTaskConsole();
  if (String(state.aiSelectedQueueTaskId) === String(queueTask.id)) {
    syncDisplayedTask(queueTask);
  }
  scheduleRunNextQueueTask(BACKEND_BUSY_RETRY_DELAY_MS);
}

function showTaskCancellationNotificationOnce(queueTask = null) {
  if (queueTask) {
    if (queueTask.cancelNoticeShown) return;
    queueTask.cancelNoticeShown = true;
  }
  showNotification('采集任务已取消', 'warning');
}

/**
 * @param {AiTaskEvent} event
 * @param {AiTaskQueueItem|null} [queueTask]
 * @returns {void}
 */
export function showCtripLoginNotificationOnce(event, queueTask = null) {
  if (!isActionableCtripLoginRequiredEvent(event)) return;
  const key = getCtripLoginNotificationKey(event, queueTask);
  if (activeLoginNotifications.has(key)) return;
  if (queueTask) {
    queueTask.loginNoticeShown = true;
  }
  const notification = showNotification(CTRIP_LOGIN_NOTIFICATION_MESSAGE, 'warning', {
    persistent: true
  });
  activeLoginNotifications.set(key, notification);
}

function isActionableCtripLoginRequiredEvent(event = {}) {
  if (!event || event.type !== 'edge:login-required') return false;
  const details = event.details && typeof event.details === 'object' ? event.details : {};
  const detailText = [details.reason, details.instruction, event.message].filter(Boolean).join(' ');
  return (
    Boolean(details.instruction) ||
    /需要.*登录|首次采集需要登录|重新登录|登录携程后继续|登录弹窗/.test(detailText)
  );
}

function getCtripLoginNotificationKey(event = {}, queueTask = null) {
  if (queueTask && queueTask.id) return `queue:${queueTask.id}`;
  if (event.taskId) return `backend:${event.taskId}`;
  return `event:${event.at || event.message || 'ctrip-login-required'}`;
}

/**
 * @param {AiTaskEvent|Partial<AiTaskEvent>} event
 * @param {AiTaskQueueItem|null} [queueTask]
 * @returns {void}
 */
export function closeCtripLoginNotification(event = {}, queueTask = null) {
  const key = getCtripLoginNotificationKey(event, queueTask);
  const notification = activeLoginNotifications.get(key);
  if (notification) {
    dismissNotification(notification);
    activeLoginNotifications.delete(key);
  }
  if (queueTask) {
    queueTask.loginNoticeShown = false;
  }
}

/**
 * @param {AiTaskEvent} event
 * @param {AiTaskQueueItem|null} [queueTask]
 * @returns {void}
 */
export function handleCtripLoginNotificationEvent(event, queueTask = null) {
  if (!event) return;
  if (
    event.type === 'edge:login-done' ||
    event.type === 'task:done' ||
    event.type === 'task:error' ||
    event.type === 'task:cancel'
  ) {
    closeCtripLoginNotification(event, queueTask);
    return;
  }
  showCtripLoginNotificationOnce(event, queueTask);
}

/**
 * @param {AiTaskQueueItem|null} [queueTask]
 * @param {string} [message]
 * @returns {void}
 */
function cancelTaskConsole(queueTask = null, message = '任务已取消') {
  const baseConsole = queueTask && queueTask.console ? queueTask.console : state.aiTaskConsole;
  const endedAt = new Date().toISOString();
  const consoleState = {
    ...baseConsole,
    submitted: true,
    endedAt,
    error: message,
    cancelled: true
  };
  const cancelEvent = {
    type: 'task:cancel',
    message,
    taskId: queueTask
      ? queueTask.backendTaskId || consoleState.taskId || ''
      : consoleState.taskId || '',
    at: endedAt
  };

  if (queueTask) {
    closeCtripLoginNotification(cancelEvent, queueTask);
    queueTask.status = 'cancelled';
    queueTask.finishedAt = endedAt;
    queueTask.errorMessage = message;
    queueTask.resultSummary = message;
    queueTask.events = queueTask.events || [];
    if (!queueTask.events.some((event) => event.type === 'task:cancel')) {
      queueTask.events.push(cancelEvent);
    }
    queueTask.console = consoleState;
    if (String(state.aiSelectedQueueTaskId) === String(queueTask.id)) {
      setAiTaskConsole(consoleState);
      setAiTaskEvents(queueTask.events || []);
    }
  } else {
    closeCtripLoginNotification(cancelEvent);
    setAiTaskConsole(consoleState);
    setAiTaskEvents(state.aiTaskEvents || []);
    if (!state.aiTaskEvents.some((event) => event.type === 'task:cancel')) {
      pushAiTaskEvent(cancelEvent);
    }
  }
}

function getQueueResultWrote(result) {
  return (
    Boolean(result.collectResult && hasWriteResult(result.collectResult.writeResult)) ||
    (Array.isArray(result.toolResults) &&
      result.toolResults.some(
        (item) =>
          item.name === 'collect_and_write_ctrip_hotel' &&
          item.result &&
          hasWriteResult(item.result.writeResult)
      ))
  );
}

function isDuplicateActiveUrl(url) {
  const normalized = String(url || '').trim();
  return (state.aiTaskQueue || []).some(
    (task) =>
      ['waiting', 'running'].includes(task.status) && String(task.url || '').trim() === normalized
  );
}

/**
 * @param {TemplateRecord} template
 * @param {string} url
 * @param {AiListFilters} [listFilters]
 * @param {AiListUrlFilters} [listUrlFilters]
 * @returns {AiTaskQueueItem|null}
 */
function addQueueTask(template, url, listFilters = {}, listUrlFilters = {}) {
  if (isDuplicateActiveUrl(url)) {
    showNotification('该链接已在任务队列中', 'warning');
    return null;
  }
  const task = createQueueTask(template, url, listFilters, listUrlFilters);
  pushAiTaskQueueItem(task);
  if (!state.aiSelectedQueueTaskId) {
    setAiSelectedQueueTaskId(task.id || '');
    setAiQueueSelectionPinned(false);
  }
  renderTaskConsole();
  return task;
}

/**
 * @param {AiTaskQueueItem} task
 * @returns {Promise<void>}
 */
async function executeCollectTask(task) {
  markAiTaskInProgress(task);
  startTaskConsole(task.template, task.url, task);
  let shouldRunNextImmediately = true;
  const isRefresh = task.taskKind === 'refresh-data';

  try {
    let result;
    if (isRefresh) {
      result = await window.electronAPI.ai.refreshHotelData({
        amapKey: String(state.settings.amapApiKey || '').trim() || undefined,
        collectBrowser: readCollectBrowser(),
        batchConcurrency: readCollectBatchConcurrency()
      });
    } else {
      result = await window.electronAPI.ai.startTask(buildTaskPayload(task));
    }
    assertSuccessfulAiTaskResult(result);
    const reply = result.message || '任务已处理。';
    finishTaskConsole(result, reply, task);

    if (isRefresh || getQueueResultWrote(result)) {
      await actions.reloadAllData({ includeSettings: true, invalidateCache: true, verbose: false });
      actions.updateTemplateFilter({ interactionFirst: true });
      actions.renderHotelList({ interactionFirst: true });
      showNotification(
        isRefresh ? '更新数据完成，宾馆列表已刷新' : '采集结果已写入，宾馆列表已刷新',
        'success'
      );
    }
  } catch (error) {
    if (isTaskCancellationError(error)) {
      cancelTaskConsole(task, '任务已取消');
      showTaskCancellationNotificationOnce(task);
    } else if (isBackendBusyError(error)) {
      deferTaskUntilBackendIdle(task);
      shouldRunNextImmediately = false;
    } else {
      console.error('采集任务执行失败:', error);
      failTaskConsole(error, task);
      showNotification(error.message || '采集任务执行失败', 'error');
    }
  } finally {
    clearAiTaskInProgressForTask(task);
    if (String(state.aiSelectedQueueTaskId) === String(task.id)) {
      syncDisplayedTask(task);
    }
    renderTaskConsole();
    if (shouldRunNextImmediately) {
      scheduleRunNextQueueTask();
    }
  }
}

/**
 * @returns {Promise<void>}
 */
async function runNextQueueTask() {
  if (queueStartCheckInProgress) return;
  if (getRunningQueueTask()) return;
  queueStartCheckInProgress = true;
  try {
    releaseStaleAiTaskInProgress();
    const nextTask = (state.aiTaskQueue || []).find((task) => task.status === 'waiting');
    if (!nextTask) {
      renderTaskConsole();
      return;
    }
    if (await isBackendTaskRunning()) {
      nextTask.resultSummary = '等待上一个采集进程关闭';
      nextTask.currentStep = '等待上一个采集进程关闭';
      renderTaskConsole();
      scheduleRunNextQueueTask(BACKEND_BUSY_RETRY_DELAY_MS);
      return;
    }
    executeCollectTask(nextTask);
  } finally {
    queueStartCheckInProgress = false;
  }
}

export function updateAiInputCount() {
  updatePayloadInputCount();
}

export async function openAiAssistant() {
  setPageVisible('hotelMain', false);
  setPageVisible('aiAssistantPage', true);
  setupAiTemplatePicker();
  await initializeAiAssistant();
}

export function closeAiAssistant() {
  setPageVisible('aiAssistantPage', false);
  setPageVisible('hotelMain', true);
}

async function initializeAiAssistant() {
  if (!state.aiAssistantInitialized) {
    if (!state.aiTaskConsole) {
      setAiTaskConsole(createEmptyTaskConsole());
    }
    if (!disposeAiTaskEventListener) {
      const unsubscribe = window.electronAPI.ai.onTaskEvent((event) => {
        const task = findQueueTaskByBackendTaskId(event.taskId) || getRunningQueueTask();
        if (task) {
          if (event.taskId) {
            task.backendTaskId = event.taskId;
            task.console = {
              ...(task.console || createEmptyTaskConsole()),
              taskId: event.taskId
            };
          }
          task.events = task.events || [];
          const existingCancelEvent =
            event.type === 'task:cancel'
              ? task.events.find((item) => item.type === 'task:cancel')
              : null;
          if (existingCancelEvent) {
            existingCancelEvent.taskId = event.taskId || existingCancelEvent.taskId;
            existingCancelEvent.message = event.message || existingCancelEvent.message;
            existingCancelEvent.at = event.at || existingCancelEvent.at;
          } else {
            task.events.push(event);
          }
          task.currentStep = event.message || task.currentStep || '';
          if (String(state.aiSelectedQueueTaskId) === String(task.id)) {
            setAiTaskEvents(task.events);
            setAiTaskConsole(task.console || createEmptyTaskConsole());
          }
          handleCtripLoginNotificationEvent(event, task);
        } else {
          pushAiTaskEvent(event);
          handleCtripLoginNotificationEvent(event);
        }
        scheduleTaskConsoleRender();
      });
      disposeAiTaskEventListener = () => {
        unsubscribe?.();
        disposeAiTaskEventListener = null;
      };
    }
    setAiAssistantInitialized(true);
  }

  if (!state.templates || state.templates.length === 0) {
    try {
      state.templates = await window.electronAPI.getAllTemplates();
    } catch (error) {
      console.error('加载 AI 模板选项失败:', error);
    }
  }
  renderAiTemplateOptions();
  renderTaskConsole();
}

/**
 * @returns {Promise<void>}
 */
export async function enqueueAiCollectTask() {
  const template = findSelectedAiTemplate();
  if (!template) {
    showNotification('请先选择模板', 'warning');
    return;
  }
  await syncAiCtripListUrlFromSettings({ activeOnly: true });
  const url = getSubmittedUrl();
  if (!url) {
    showNotification('请粘贴携程酒店详情页或列表页链接', 'warning');
    return;
  }

  const listFilters = readListFilterForm();
  const listUrlFilters = readCtripUrlFilterSettings({ activeOnly: true });
  const task = addQueueTask(template, url, listFilters, listUrlFilters);
  if (!task) return;
  setValue('aiHotelUrlInput', '');
  updateAiInputCount();
  showNotification(
    getRunningQueueTask() ? '已加入等待任务' : '已加入任务，准备开始采集',
    'success'
  );
  await runNextQueueTask();
}

/**
 * @returns {Promise<void>}
 */
export async function cancelAiTask() {
  const runningTask = getRunningQueueTask();
  if (runningTask) {
    cancelTaskConsole(runningTask, '任务已取消');
    renderTaskConsole();
  }

  try {
    const result = await window.electronAPI.ai.cancelTask();
    if (result.success) {
      showTaskCancellationNotificationOnce(runningTask);
    } else {
      showNotification(result.error || '当前没有正在运行的任务', 'warning');
    }
  } catch (error) {
    showNotification(error.message || '取消 AI 任务失败', 'error');
  }
}

export function handleAiTaskInputKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    enqueueAiCollectTask();
  }
}

/**
 * @returns {void}
 */
export function clearAiTaskRecords() {
  const runningTask = getRunningQueueTask();
  if (runningTask) {
    resetAiTaskQueueState({ keepRunningTask: true });
    syncDisplayedTask(runningTask);
    showNotification('当前任务仍在运行，已清空其余队列记录', 'warning');
  } else {
    resetAiTaskQueueState();
    setAiTaskEvents([]);
    resetAiTaskConsole();
  }
  setValue('aiHotelUrlInput', '');
  renderTaskConsole();
}

/**
 * @returns {void}
 */
export function clearAiTaskQueue() {
  const runningTask = getRunningQueueTask();
  resetAiTaskQueueState({ keepRunningTask: Boolean(runningTask) });
  if (runningTask) {
    syncDisplayedTask(runningTask);
  } else {
    setAiTaskEvents([]);
    resetAiTaskConsole();
  }
  renderTaskConsole();
}

/**
 * @param {string} taskId
 * @returns {void}
 */
export function selectAiQueueTask(taskId) {
  const task = (state.aiTaskQueue || []).find((item) => String(item.id) === String(taskId));
  if (!task) return;
  setAiQueueSelectionPinned(true);
  syncDisplayedTask(task);
  renderTaskConsole();
}

/**
 * @param {string} taskId
 * @returns {void}
 */
export function removeAiQueueTask(taskId) {
  const task = (state.aiTaskQueue || []).find((item) => String(item.id) === String(taskId));
  if (!task || task.status === 'running') return;
  removeAiTaskQueueItem(String(taskId));
  if (String(state.aiSelectedQueueTaskId) === String(taskId)) {
    const runningTask = getRunningQueueTask();
    const fallback = runningTask || state.aiTaskQueue[0] || null;
    if (fallback) {
      setAiQueueSelectionPinned(false);
      syncDisplayedTask(fallback);
    } else {
      setAiSelectedQueueTaskId('');
      setAiQueueSelectionPinned(false);
      resetAiTaskConsole();
      setAiTaskEvents([]);
    }
  }
  renderTaskConsole();
}

/**
 * @param {string} taskId
 * @returns {void}
 */
export function retryAiQueueTask(taskId) {
  const sourceTask = (state.aiTaskQueue || []).find((item) => String(item.id) === String(taskId));
  if (!sourceTask) return;
  if (sourceTask.status === 'running') return;
  if (sourceTask.status === 'waiting') {
    removeAiTaskQueueItem(String(taskId));
    pushAiTaskQueueItem(sourceTask);
    setAiSelectedQueueTaskId(sourceTask.id || '');
    setAiQueueSelectionPinned(false);
    renderTaskConsole();
    showNotification('已移到队列末尾', 'success');
    runNextQueueTask();
    return;
  }
  const task = createQueueTask(
    sourceTask.template,
    sourceTask.url,
    sourceTask.listFilters || {},
    sourceTask.listUrlFilters || {}
  );
  pushAiTaskQueueItem(task);
  setAiSelectedQueueTaskId(task.id || '');
  setAiQueueSelectionPinned(false);
  renderTaskConsole();
  showNotification('已重新加入队列', 'success');
  runNextQueueTask();
}

export function rerunCurrentAiTask() {
  const selectedTask = getSelectedQueueTask();
  if (selectedTask && selectedTask.template && selectedTask.url) {
    retryAiQueueTask(selectedTask.id);
    return;
  }
  focusAiTaskStartBar();
}

export function showAiTaskDetails() {
  const collectResult = state.aiTaskConsole && state.aiTaskConsole.collectResult;
  if (!collectResult) {
    showNotification('当前没有更多采集详情。', 'info');
    return;
  }

  const detailParts = [
    collectResult.hotelName ? `酒店：${collectResult.hotelName}` : '',
    Number.isFinite(Number(collectResult.eligibleCount))
      ? `可用房型：${collectResult.eligibleCount} 个`
      : '',
    collectResult.outputPath ? `结果文件：${collectResult.outputPath}` : ''
  ].filter(Boolean);
  showNotification(detailParts.join('\n') || '采集详情已显示在结果分析中。', 'info');
}

export function focusAiTaskStartBar() {
  const input = /** @type {HTMLInputElement|null} */ ($('aiHotelUrlInput'));
  if (input && !input.disabled) {
    input.focus();
    input.select();
  }
}

/**
 * @returns {Promise<void>}
 */
export async function enqueueRefreshHotelDataTask() {
  const runningTask = getRunningQueueTask();
  if (runningTask) {
    showNotification('当前有任务正在运行，请等待完成后再更新数据', 'warning');
    return;
  }

  const task = createQueueTask(null, '', {}, {}, 'refresh-data');
  pushAiTaskQueueItem(task);
  if (!state.aiSelectedQueueTaskId) {
    setAiSelectedQueueTaskId(task.id || '');
    setAiQueueSelectionPinned(false);
  }
  renderTaskConsole();
  showNotification('已创建更新数据任务，准备开始', 'success');
  await runNextQueueTask();
}

actions.renderAiTemplateOptions = renderAiTemplateOptions;
