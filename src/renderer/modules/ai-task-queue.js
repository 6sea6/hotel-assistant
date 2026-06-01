import { bumpAiTaskQueueCounter, state } from './state.js';
import { formatAiTemplateLabel } from './ai-task-console.js';

/**
 * @typedef {import('../../shared/contracts').TemplateRecord} TemplateRecord
 * @typedef {import('../../shared/contracts').AiTaskKind} AiTaskKind
 * @typedef {import('../../shared/contracts').AiTaskConsoleState} AiTaskConsoleState
 * @typedef {import('../../shared/contracts').AiTaskQueueItem} AiTaskQueueItem
 * @typedef {import('../../shared/contracts').AiListFilters} AiListFilters
 * @typedef {import('../../shared/contracts').AiListUrlFilters} AiListUrlFilters
 */

/**
 * @returns {AiTaskConsoleState}
 */
export function createEmptyTaskConsole() {
  return {
    submitted: false,
    template: null,
    templateLabel: '',
    hotelUrl: '',
    taskId: '',
    startedAt: '',
    endedAt: '',
    result: null,
    collectResult: null,
    error: null,
    reply: '',
    taskKind: 'collect'
  };
}

/**
 * @returns {AiTaskQueueItem|null}
 */
export function getRunningQueueTask() {
  return (state.aiTaskQueue || []).find((task) => task.status === 'running') || null;
}

/**
 * @returns {AiTaskQueueItem|null}
 */
export function getSelectedQueueTask() {
  const selectedId = String(state.aiSelectedQueueTaskId || '');
  return (state.aiTaskQueue || []).find((task) => String(task.id) === selectedId) || null;
}

/**
 * @param {string|undefined|null} taskId
 * @returns {AiTaskQueueItem|null}
 */
export function findQueueTaskByBackendTaskId(taskId) {
  const id = String(taskId || '');
  if (!id) return null;
  return (state.aiTaskQueue || []).find((task) => String(task.backendTaskId || '') === id) || null;
}

/**
 * @param {TemplateRecord|null} template
 * @param {string} url
 * @param {AiListFilters} [listFilters]
 * @param {AiListUrlFilters} [listUrlFilters]
 * @param {AiTaskKind} [taskKind]
 * @returns {AiTaskQueueItem}
 */
export function createQueueTask(
  template,
  url,
  listFilters = {},
  listUrlFilters = {},
  taskKind = 'collect'
) {
  const queueIndex = bumpAiTaskQueueCounter();
  const displayIndex = String(queueIndex).padStart(2, '0');
  const isRefresh = taskKind === 'refresh-data';
  const title = isRefresh ? '更新整个程序目前的宾馆数据' : formatAiTemplateLabel(template);
  return {
    id: `queue-${Date.now()}-${queueIndex}`,
    displayIndex,
    url,
    templateId: isRefresh ? '' : String(template.id ?? ''),
    templateName: isRefresh ? '' : template.name || '',
    templateLabel: title,
    title,
    template,
    listFilters,
    listUrlFilters,
    taskKind,
    status: 'waiting',
    currentStep: '',
    createdAt: new Date().toISOString(),
    startedAt: '',
    finishedAt: '',
    backendTaskId: '',
    errorMessage: '',
    resultSummary: '',
    events: [],
    console: createEmptyTaskConsole(),
    cancelNoticeShown: false
  };
}
