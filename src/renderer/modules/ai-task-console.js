import { $, setText } from './dom-helpers.js';
import { getElapsedText, normalizeTaskState } from './ai-task-state.js';
import {
  renderCancelledView,
  renderErrorView,
  renderIdleView,
  renderRunningView,
  renderSuccessView,
  renderTaskQueue
} from './ai-task-renderers.js';

export {
  extractCtripUrl,
  extractCtripUrls,
  formatAiTemplateLabel,
  formatAiTime,
  formatCurrency,
  getReadableToolLabel,
  TOOL_LABELS,
  TRAILING_URL_PUNCTUATION,
  INLINE_URL_TEXT_SEPARATOR
} from './ai-task-formatters.js';
export {
  BASE_STEP_DEFINITIONS,
  CANCEL_STEP_DEFINITION,
  createRafRenderScheduler,
  findRefreshStepEvent,
  findStepEvent,
  getEventDetailText,
  getEventStepKey,
  getLastTaskError,
  getReadableEventTitle,
  getStepDefinitions,
  isRecord,
  LOGIN_STEP_DEFINITION,
  normalizeEvent,
  REFRESH_STEP_DEFINITIONS
} from './ai-task-events.js';
export {
  buildProgressStats,
  buildRefreshProgressStats,
  countEligibleHotels,
  countWriteOperations,
  getBatchWriteStats,
  getCollectToolResult,
  getLatestApplyResult,
  getNestedWriteResult,
  getRefreshCurrentStepKey,
  hasWriteResult,
  parseBatchProgressEvent
} from './ai-task-progress.js';
export {
  buildTaskError,
  buildTaskResult,
  buildTaskSteps,
  formatSkippedHotelReasons,
  formatDuration,
  getElapsedText,
  getTaskCollectResult,
  getTimeValue,
  normalizeTaskState
} from './ai-task-state.js';
export {
  getQueueStatusLabel,
  getQueueTaskTitle,
  renderCancelledView,
  renderErrorView,
  renderIdleView,
  renderProgressIcon,
  renderProgressStats,
  renderQueueGroup,
  renderQueueTaskItem,
  renderRunningView,
  renderStatusBadge,
  renderSuccessView,
  renderSummaryCards,
  renderTaskMeta,
  renderTaskQueue,
  renderTaskTimeline
} from './ai-task-renderers.js';

/**
 * @typedef {import('../../shared/contracts').AiTaskConsoleState} AiTaskConsoleState
 * @typedef {import('../../shared/contracts').AiTaskEvent} AiTaskEvent
 * @typedef {import('../../shared/contracts').AiTaskQueueItem} AiTaskQueueItem
 */

let elapsedTimer = null;

function updateElapsedTimerText() {
  const timer = $('aiTaskElapsedTime');
  if (!timer) return;

  timer.textContent = getElapsedText(
    {
      startTime: timer.dataset.startTime,
      endTime: timer.dataset.endTime
    },
    timer.dataset.status || 'idle'
  );
}

function syncElapsedTimer(status) {
  updateElapsedTimerText();
  if (status === 'running') {
    if (!elapsedTimer) elapsedTimer = globalThis.setInterval(updateElapsedTimerText, 1000);
    return;
  }

  if (elapsedTimer) {
    globalThis.clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
}

function updateStartBar() {
  const button = /** @type {HTMLButtonElement|null} */ ($('aiStartTaskBtn'));
  const templateSelect = /** @type {HTMLSelectElement|null} */ ($('aiTemplateSelect'));
  const input = /** @type {HTMLInputElement|HTMLTextAreaElement|null} */ ($('aiHotelUrlInput'));

  if (templateSelect) templateSelect.disabled = false;
  if (input) input.disabled = false;
  if (!button) return;

  button.disabled = false;
  button.classList.remove('is-loading');
  button.innerHTML = '加入队列';
}

/**
 * @param {{
 *   aiTaskQueue?: AiTaskQueueItem[],
 *   aiSelectedQueueTaskId?: string,
 *   aiTaskConsole?: AiTaskConsoleState,
 *   aiTaskInProgress?: boolean,
 *   aiTaskEvents?: AiTaskEvent[]
 * }} state
 * @returns {ReturnType<typeof normalizeTaskState>|null}
 */
export function renderAiTaskConsole(state) {
  const panel = $('aiCurrentTaskPanel');
  if (!panel) return null;
  const selectedQueueTask = (state.aiTaskQueue || []).find(
    (task) => String(task.id || '') === String(state.aiSelectedQueueTaskId || '')
  );
  const currentConsole = state.aiTaskConsole || {};
  const hasDisplayedRunningConsole = Boolean(
    currentConsole.submitted || currentConsole.hotelUrl || currentConsole.startedAt
  );
  const selectedTaskInProgress = selectedQueueTask
    ? selectedQueueTask.status === 'running'
    : Boolean(state.aiTaskInProgress && hasDisplayedRunningConsole);

  const taskState = normalizeTaskState({
    task: currentConsole,
    events: state.aiTaskEvents || [],
    inProgress: selectedTaskInProgress
  });

  const taskKind = currentConsole.taskKind || 'collect';
  const viewHtml = {
    idle: renderIdleView,
    running: () => renderRunningView(taskState, taskKind),
    success: () => renderSuccessView(taskState, taskKind),
    error: () => renderErrorView(taskState, taskKind),
    cancelled: () => renderCancelledView(taskState, taskKind)
  }[taskState.status](taskState);

  panel.innerHTML = viewHtml;
  const queuePanel = $('aiTaskQueuePanel');
  if (queuePanel) {
    queuePanel.innerHTML = renderTaskQueue(state.aiTaskQueue || [], {
      selectedId: state.aiSelectedQueueTaskId || ''
    });
  }
  updateStartBar();
  syncElapsedTimer(taskState.status);
  return taskState;
}

export function updateAiInputCount() {
  const input = /** @type {HTMLInputElement|HTMLTextAreaElement|null} */ ($('aiHotelUrlInput'));
  const count = input ? input.value.length : 0;
  const maxLength = input && Number(input.maxLength) > 0 ? Number(input.maxLength) : 4000;
  setText('aiInputCount', `${count} / ${maxLength}`);
}
