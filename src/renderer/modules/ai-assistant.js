import { state } from './state.js';
import { $, escapeHtml, getValue, setChecked, setValue } from './dom-helpers.js';
import { showNotification } from './notification.js';
import { actions } from './actions.js';
import {
  extractCtripUrls,
  formatAiTemplateLabel,
  getCollectToolResult,
  hasWriteResult,
  renderAiTaskConsole,
  updateAiInputCount as updateTaskInputCount
} from './ai-task-console.js';
import {
  enhanceCustomSelect,
  refreshCustomSelect,
  destroyCustomSelect,
  getCustomSelectInstance
} from './custom-select.js';

const BACKEND_BUSY_RETRY_DELAY_MS = 1200;
let activeCollectTaskId = '';
let backendIdleRetryTimer = 0;
let queueStartCheckInProgress = false;

function setPageVisible(id, visible) {
  const el = $(id);
  if (el) {
    el.style.display = visible ? '' : 'none';
  }
}

function createEmptyTaskConsole() {
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

function renderTaskConsole() {
  renderAiTaskConsole(state);
  updateTaskInputCount();
}

function renderAiTemplateOptions() {
  const select = /** @type {HTMLSelectElement|null} */ ($('aiTemplateSelect'));
  if (!select) return;

  const currentValue = select.value;
  select.innerHTML =
    '<option value="">请选择模板</option>' +
    (state.templates || [])
      .map((template) => {
        const id = template.id ?? '';
        return `<option value="${escapeHtml(String(id))}">${escapeHtml(formatAiTemplateLabel(template))}</option>`;
      })
      .join('');

  if (currentValue && Array.from(select.options).some((option) => option.value === currentValue)) {
    select.value = currentValue;
  }
  refreshCustomSelect(select);
}

function setupAiTemplatePicker() {
  if (state.aiTemplatePickerBound) return;

  const select = /** @type {HTMLSelectElement|null} */ ($('aiTemplateSelect'));
  if (!select) return;

  // 保护：如果 select 已被默认 auto 增强抢先，先销毁再用 existingElements 重新增强
  const expectedWrapper = $('aiTemplatePicker');
  const existingCtx = getCustomSelectInstance(select);
  if (existingCtx && existingCtx.wrapper !== expectedWrapper) {
    destroyCustomSelect(select);
  }

  const ctx = enhanceCustomSelect(select, {
    wrapperClass: 'ai-template-picker custom-select',
    buttonClass: 'input ai-template-picker-button custom-select-button',
    textClass: 'ai-template-picker-text custom-select-text',
    caretClass: 'ai-template-picker-caret custom-select-caret',
    menuClass: 'ai-template-picker-menu custom-select-menu',
    optionClass: 'ai-template-picker-option custom-select-option',
    existingElements: {
      wrapper: expectedWrapper,
      button: $('aiTemplatePickerButton'),
      textSpan: $('aiTemplatePickerText'),
      menu: $('aiTemplatePickerMenu')
    }
  });

  if (ctx) {
    state.aiTemplatePickerBound = true;
  }
}

function findSelectedAiTemplate() {
  const templateId = getValue('aiTemplateSelect');
  if (!templateId) {
    return null;
  }

  return (
    (state.templates || []).find((template) => String(template.id) === String(templateId)) || null
  );
}

function getSubmittedUrls() {
  return extractCtripUrls(getValue('aiHotelUrlInput'));
}

function getSubmittedUrl() {
  return getSubmittedUrls()[0] || '';
}

function isCtripListUrl(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    return (
      /(^|\.)ctrip\.com$/i.test(parsed.hostname) &&
      /hotel|hotels/i.test(parsed.href) &&
      /list|hotelsearch|search|query|keyword|city|location|zone/i.test(parsed.href) &&
      !/[?&]hotel[Ii]d=\d+/.test(parsed.search) &&
      !/\/hotels\/\d+\.html/i.test(parsed.pathname)
    );
  } catch (_error) {
    return false;
  }
}

function parseOptionalNumber(value, options = {}) {
  const text = String(value || '').trim();
  if (!text) return null;
  const number = Number(text);
  if (!Number.isFinite(number)) return null;
  if (options.integer) {
    return Math.max(options.min || 1, Math.trunc(number));
  }
  return number;
}

function parseKeywordInput(value) {
  return String(value || '')
    .split(/[,，;；\n\r|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseIntegerSetting(value, options = {}) {
  const number = parseOptionalNumber(value, {
    integer: true,
    min: options.min ?? 0
  });
  if (number === null) return null;
  if (options.allowed && !options.allowed.includes(number)) return null;
  return number;
}

function parseScoreSetting(value) {
  const number = parseOptionalNumber(value);
  return [4, 4.5, 4.7].includes(number) ? number : null;
}

function parsePriceMaxSetting(value) {
  const text = String(value || '')
    .trim()
    .toLowerCase();
  if (!text) return null;
  if (text === 'max') return 'max';
  return parseIntegerSetting(text, { min: 0 });
}

function compactActiveCtripUrlFilters(filters = {}) {
  const active = {};
  const hasPriceMin = filters.priceMin !== null && filters.priceMin !== undefined;
  const hasPriceMax = filters.priceMax !== null && filters.priceMax !== undefined;

  if (hasPriceMin) active.priceMin = filters.priceMin;
  if (hasPriceMax) active.priceMax = filters.priceMax;
  if (Array.isArray(filters.starLevels) && filters.starLevels.length)
    active.starLevels = filters.starLevels;
  if (filters.sortMode) active.sortMode = filters.sortMode;
  if (filters.freeCancel === true) active.freeCancel = true;
  if (filters.reviewCountMin !== null && filters.reviewCountMin !== undefined)
    active.reviewCountMin = filters.reviewCountMin;
  if (filters.ctripScoreMin !== null && filters.ctripScoreMin !== undefined)
    active.ctripScoreMin = filters.ctripScoreMin;

  return active;
}

function hasActiveCtripUrlFilterSettings() {
  return Object.keys(readCtripUrlFilterSettings({ activeOnly: true })).length > 0;
}

export function readCtripUrlFilterSettings(options = {}) {
  const settings = state.settings || {};
  const starLevels = Array.isArray(settings.aiCtripStarLevels)
    ? settings.aiCtripStarLevels
    : parseKeywordInput(settings.aiCtripStarLevels);

  const filters = {
    priceMin: parseIntegerSetting(settings.aiCtripPriceMin, { min: 0 }),
    priceMax: parsePriceMaxSetting(settings.aiCtripPriceMax),
    starLevels: starLevels
      .map((item) => Number(item))
      .filter((item) => [2, 3, 4, 5].includes(item)),
    sortMode: ['popularity', 'price_low', 'review_high'].includes(settings.aiCtripSortMode)
      ? settings.aiCtripSortMode
      : null,
    freeCancel: Boolean(settings.aiCtripFreeCancel),
    reviewCountMin: parseIntegerSetting(settings.aiCtripReviewCountMin, {
      allowed: [100, 200, 500]
    }),
    ctripScoreMin: parseScoreSetting(settings.aiCtripScoreMin)
  };

  return options.activeOnly ? compactActiveCtripUrlFilters(filters) : filters;
}

function applyCtripUrlFilterSettingsToDom() {
  const settings = state.settings || {};
  setValue('aiCtripPriceMin', settings.aiCtripPriceMin ?? '');
  setValue('aiCtripPriceMax', settings.aiCtripPriceMax ?? '');
  setValue('aiCtripSortMode', settings.aiCtripSortMode || '');
  setValue('aiCtripReviewCountMin', settings.aiCtripReviewCountMin ?? '');
  setValue('aiCtripScoreMin', settings.aiCtripScoreMin ?? '');
  setChecked('aiCtripFreeCancel', Boolean(settings.aiCtripFreeCancel));

  const selected = new Set(
    (Array.isArray(settings.aiCtripStarLevels) ? settings.aiCtripStarLevels : []).map((item) =>
      String(item)
    )
  );
  document.querySelectorAll('[data-star-level]').forEach((button) => {
    const starButton = /** @type {HTMLElement} */ (button);
    const isSelected = selected.has(String(starButton.dataset.starLevel));
    starButton.classList.toggle('is-selected', isSelected);
    starButton.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  });
}

async function persistCtripUrlFilterSettingsFromParsed(parsed) {
  const known = parsed && parsed.knownSettings ? parsed.knownSettings : {};
  const detected = new Set(
    Array.isArray(parsed && parsed.detectedKnownFilterKeys) ? parsed.detectedKnownFilterKeys : []
  );
  if (!detected.size) {
    applyCtripUrlFilterSettingsToDom();
    return;
  }
  if (hasActiveCtripUrlFilterSettings()) {
    applyCtripUrlFilterSettingsToDom();
    return;
  }

  const updates = {};
  if (detected.has('priceMin')) updates.aiCtripPriceMin = known.priceMin ?? '';
  if (detected.has('priceMax')) updates.aiCtripPriceMax = known.priceMax ?? '';
  if (detected.has('starLevels'))
    updates.aiCtripStarLevels = Array.isArray(known.starLevels) ? known.starLevels : [];
  if (detected.has('sortMode')) updates.aiCtripSortMode = known.sortMode || '';
  if (detected.has('freeCancel')) updates.aiCtripFreeCancel = Boolean(known.freeCancel);
  if (detected.has('reviewCountMin')) updates.aiCtripReviewCountMin = known.reviewCountMin ?? '';
  if (detected.has('ctripScoreMin')) updates.aiCtripScoreMin = known.ctripScoreMin ?? '';

  const entries = Object.entries(updates);
  const changed = entries.filter(
    ([key, value]) => JSON.stringify(state.settings[key] ?? '') !== JSON.stringify(value)
  );
  if (!changed.length) {
    applyCtripUrlFilterSettingsToDom();
    return;
  }

  await Promise.all(changed.map(([key, value]) => window.electronAPI.setSetting(key, value)));
  entries.forEach(([key, value]) => {
    state.settings[key] = value;
  });
  applyCtripUrlFilterSettingsToDom();
}

export async function syncCtripListUrlSettingsFromInput() {
  const url = getSubmittedUrl();
  if (!url || !isCtripListUrl(url) || !window.electronAPI?.ai?.parseCtripListUrl) {
    return null;
  }
  try {
    const parsedUrl = new URL(url);
    if (!parsedUrl.searchParams.has('listFilters')) {
      return null;
    }
  } catch (_error) {
    return null;
  }

  try {
    const parsed = await window.electronAPI.ai.parseCtripListUrl(url);
    await persistCtripUrlFilterSettingsFromParsed(parsed);
    return parsed;
  } catch (error) {
    console.warn('解析携程列表页 URL 前筛失败:', error);
    return null;
  }
}

export async function syncAiCtripListUrlFromSettings(options = {}) {
  const url = getSubmittedUrl();
  const inputText = getValue('aiHotelUrlInput');
  if (!url || !isCtripListUrl(url) || !window.electronAPI?.ai?.buildCtripListUrl) {
    return url;
  }

  try {
    const nextUrl = await window.electronAPI.ai.buildCtripListUrl({
      baseUrl: url,
      settings: readCtripUrlFilterSettings({
        activeOnly: options.activeOnly || options.mode === 'activeOnly'
      })
    });
    if (nextUrl && nextUrl !== url) {
      setValue(
        'aiHotelUrlInput',
        inputText.includes(url) ? inputText.replace(url, nextUrl) : nextUrl
      );
      updateTaskInputCount();
    }
    return nextUrl || url;
  } catch (error) {
    console.warn('生成携程列表页 URL 前筛失败:', error);
    return url;
  }
}

let ctripListUrlSyncTimer = null;

export function handleAiTaskInputChange() {
  updateTaskInputCount();
  if (ctripListUrlSyncTimer) {
    clearTimeout(ctripListUrlSyncTimer);
  }
  ctripListUrlSyncTimer = setTimeout(() => {
    void syncCtripListUrlSettingsFromInput();
  }, 350);
}

function readListFilterForm() {
  const settings = state.settings || {};
  const desiredHotelCount = parseOptionalNumber(settings.aiListDesiredHotelCount, {
    integer: true,
    min: 1
  });
  const excludeHotelTypes = parseKeywordInput(settings.aiListExcludeHotelTypes);
  const listFilters = {};

  if (desiredHotelCount !== null) listFilters.desiredHotelCount = desiredHotelCount;
  if (excludeHotelTypes.length) listFilters.excludeHotelTypes = excludeHotelTypes;

  return listFilters;
}

function buildTaskPayload(task) {
  const listFilters =
    task.listFilters && typeof task.listFilters === 'object' ? task.listFilters : {};
  return {
    templateId: task.templateId,
    templateName: task.templateName || '',
    url: task.url,
    listFilters,
    listUrlFilters: task.listUrlFilters || readCtripUrlFilterSettings({ activeOnly: true }),
    desiredHotelCount: listFilters.desiredHotelCount,
    excludeHotelTypes: listFilters.excludeHotelTypes,
    amapKey: String(state.settings.amapApiKey || '').trim() || undefined,
    priceMin: task.listUrlFilters ? task.listUrlFilters.priceMin : undefined,
    priceMax: task.listUrlFilters ? task.listUrlFilters.priceMax : undefined,
    starLevels: task.listUrlFilters ? task.listUrlFilters.starLevels : undefined,
    sortMode: task.listUrlFilters ? task.listUrlFilters.sortMode : undefined,
    freeCancel: task.listUrlFilters ? task.listUrlFilters.freeCancel : undefined,
    reviewCountMin: task.listUrlFilters ? task.listUrlFilters.reviewCountMin : undefined,
    ctripScoreMin: task.listUrlFilters ? task.listUrlFilters.ctripScoreMin : undefined,
    enableCollectPerfLog: Boolean(state.settings.enableCollectPerfLog)
  };
}

function getRunningQueueTask() {
  return (state.aiTaskQueue || []).find((task) => task.status === 'running') || null;
}

function markAiTaskInProgress(task) {
  activeCollectTaskId = task && task.id ? String(task.id) : '';
  state.aiTaskInProgress = true;
}

function clearAiTaskInProgressForTask(task) {
  const taskId = task && task.id ? String(task.id) : '';
  if (!activeCollectTaskId || activeCollectTaskId === taskId) {
    activeCollectTaskId = '';
    state.aiTaskInProgress = false;
  }
}

function releaseStaleAiTaskInProgress() {
  if (getRunningQueueTask()) return;
  if (!state.aiTaskInProgress) return;

  activeCollectTaskId = '';
  state.aiTaskInProgress = false;
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

function getSelectedQueueTask() {
  const selectedId = String(state.aiSelectedQueueTaskId || '');
  return (state.aiTaskQueue || []).find((task) => String(task.id) === selectedId) || null;
}

function findQueueTaskByBackendTaskId(taskId) {
  const id = String(taskId || '');
  if (!id) return null;
  return (state.aiTaskQueue || []).find((task) => String(task.backendTaskId || '') === id) || null;
}

function createQueueTask(
  template,
  url,
  listFilters = {},
  listUrlFilters = {},
  taskKind = 'collect'
) {
  state.aiTaskQueueCounter = Number(state.aiTaskQueueCounter || 0) + 1;
  const displayIndex = String(state.aiTaskQueueCounter).padStart(2, '0');
  const isRefresh = taskKind === 'refresh-data';
  const title = isRefresh ? '更新整个程序目前的宾馆数据' : formatAiTemplateLabel(template);
  return {
    id: `queue-${Date.now()}-${state.aiTaskQueueCounter}`,
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

function syncDisplayedTask(task) {
  if (!task) return;
  state.aiSelectedQueueTaskId = task.id;
  state.aiTaskConsole = task.console || createEmptyTaskConsole();
  state.aiTaskEvents = task.events || [];
}

function shouldAutoDisplayStartedTask(task) {
  const selectedTask = getSelectedQueueTask();
  return (
    !state.aiQueueSelectionPinned ||
    !selectedTask ||
    String(state.aiSelectedQueueTaskId) === String(task.id)
  );
}

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
    queueTask.events = events;
    queueTask.console = consoleState;
    if (shouldAutoDisplayStartedTask(queueTask)) {
      state.aiQueueSelectionPinned = false;
      syncDisplayedTask(queueTask);
    }
  } else {
    state.aiTaskEvents = events;
    state.aiTaskConsole = consoleState;
  }
  renderTaskConsole();
}

function finishTaskConsole(result, reply, queueTask = null) {
  const collectToolResult = getCollectToolResult(result);
  const taskStatus = result && result.taskStatus ? result.taskStatus : {};
  const baseConsole = queueTask && queueTask.console ? queueTask.console : state.aiTaskConsole;
  const consoleState = {
    ...baseConsole,
    taskId: taskStatus.id || baseConsole.taskId || '',
    endedAt: taskStatus.finishedAt || new Date().toISOString(),
    result,
    collectResult: result.collectResult || (collectToolResult ? collectToolResult.result : null),
    error: null,
    reply
  };
  if (queueTask) {
    queueTask.backendTaskId = consoleState.taskId || queueTask.backendTaskId || '';
    queueTask.finishedAt = consoleState.endedAt;
    queueTask.status = 'completed';
    queueTask.resultSummary = result.message || reply || '采集任务完成';
    queueTask.console = consoleState;
    if (String(state.aiSelectedQueueTaskId) === String(queueTask.id)) {
      state.aiTaskConsole = consoleState;
      state.aiTaskEvents = queueTask.events || [];
    }
  } else {
    state.aiTaskConsole = consoleState;
  }
}

function failTaskConsole(error, queueTask = null) {
  const errorMessage = error && error.message ? error.message : String(error || '任务执行失败');
  const baseConsole = queueTask && queueTask.console ? queueTask.console : state.aiTaskConsole;
  const consoleState = {
    ...baseConsole,
    submitted: true,
    endedAt: new Date().toISOString(),
    error: errorMessage
  };
  if (queueTask) {
    queueTask.status = 'failed';
    queueTask.finishedAt = consoleState.endedAt;
    queueTask.errorMessage = errorMessage;
    queueTask.resultSummary = errorMessage;
    queueTask.console = consoleState;
    if (String(state.aiSelectedQueueTaskId) === String(queueTask.id)) {
      state.aiTaskConsole = consoleState;
      state.aiTaskEvents = queueTask.events || [];
    }
  } else {
    state.aiTaskConsole = consoleState;
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
      state.aiTaskConsole = consoleState;
      state.aiTaskEvents = queueTask.events || [];
    }
  } else {
    state.aiTaskConsole = consoleState;
    state.aiTaskEvents = state.aiTaskEvents || [];
    if (!state.aiTaskEvents.some((event) => event.type === 'task:cancel')) {
      state.aiTaskEvents.push(cancelEvent);
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

function addQueueTask(template, url, listFilters = {}, listUrlFilters = {}) {
  if (isDuplicateActiveUrl(url)) {
    showNotification('该链接已在任务队列中', 'warning');
    return null;
  }
  const task = createQueueTask(template, url, listFilters, listUrlFilters);
  state.aiTaskQueue.push(task);
  if (!state.aiSelectedQueueTaskId) {
    state.aiSelectedQueueTaskId = task.id;
    state.aiQueueSelectionPinned = false;
  }
  renderTaskConsole();
  return task;
}

async function executeCollectTask(task) {
  markAiTaskInProgress(task);
  startTaskConsole(task.template, task.url, task);
  let shouldRunNextImmediately = true;
  const isRefresh = task.taskKind === 'refresh-data';

  try {
    let result;
    if (isRefresh) {
      result = await window.electronAPI.ai.refreshHotelData({
        amapKey: String(state.settings.amapApiKey || '').trim() || undefined
      });
    } else {
      result = await window.electronAPI.ai.startTask(buildTaskPayload(task));
    }
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
  updateTaskInputCount();
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
    state.aiTaskConsole = state.aiTaskConsole || createEmptyTaskConsole();
    window.electronAPI.ai.onTaskEvent((event) => {
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
          state.aiTaskEvents = task.events;
          state.aiTaskConsole = task.console;
        }
      } else {
        state.aiTaskEvents.push(event);
      }
      renderTaskConsole();
    });
    state.aiAssistantInitialized = true;
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

export function clearAiTaskRecords() {
  const runningTask = getRunningQueueTask();
  if (runningTask) {
    state.aiTaskQueue = [runningTask];
    state.aiQueueSelectionPinned = false;
    syncDisplayedTask(runningTask);
    showNotification('当前任务仍在运行，已清空其余队列记录', 'warning');
  } else {
    state.aiTaskQueue = [];
    state.aiSelectedQueueTaskId = '';
    state.aiQueueSelectionPinned = false;
    state.aiTaskEvents = [];
    state.aiTaskConsole = createEmptyTaskConsole();
  }
  setValue('aiHotelUrlInput', '');
  renderTaskConsole();
}

export function clearAiTaskQueue() {
  const runningTask = getRunningQueueTask();
  state.aiTaskQueue = runningTask ? [runningTask] : [];
  if (runningTask) {
    state.aiQueueSelectionPinned = false;
    syncDisplayedTask(runningTask);
  } else {
    state.aiSelectedQueueTaskId = '';
    state.aiQueueSelectionPinned = false;
    state.aiTaskEvents = [];
    state.aiTaskConsole = createEmptyTaskConsole();
  }
  renderTaskConsole();
}

export function selectAiQueueTask(taskId) {
  const task = (state.aiTaskQueue || []).find((item) => String(item.id) === String(taskId));
  if (!task) return;
  state.aiQueueSelectionPinned = true;
  syncDisplayedTask(task);
  renderTaskConsole();
}

export function removeAiQueueTask(taskId) {
  const task = (state.aiTaskQueue || []).find((item) => String(item.id) === String(taskId));
  if (!task || task.status === 'running') return;
  state.aiTaskQueue = state.aiTaskQueue.filter((item) => String(item.id) !== String(taskId));
  if (String(state.aiSelectedQueueTaskId) === String(taskId)) {
    const runningTask = getRunningQueueTask();
    const fallback = runningTask || state.aiTaskQueue[0] || null;
    if (fallback) {
      state.aiQueueSelectionPinned = false;
      syncDisplayedTask(fallback);
    } else {
      state.aiSelectedQueueTaskId = '';
      state.aiQueueSelectionPinned = false;
      state.aiTaskConsole = createEmptyTaskConsole();
      state.aiTaskEvents = [];
    }
  }
  renderTaskConsole();
}

export function retryAiQueueTask(taskId) {
  const sourceTask = (state.aiTaskQueue || []).find((item) => String(item.id) === String(taskId));
  if (!sourceTask) return;
  if (sourceTask.status === 'running') return;
  if (sourceTask.status === 'waiting') {
    state.aiTaskQueue = state.aiTaskQueue.filter((item) => String(item.id) !== String(taskId));
    state.aiTaskQueue.push(sourceTask);
    state.aiSelectedQueueTaskId = sourceTask.id;
    state.aiQueueSelectionPinned = false;
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
  state.aiTaskQueue.push(task);
  state.aiSelectedQueueTaskId = task.id;
  state.aiQueueSelectionPinned = false;
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

export async function enqueueRefreshHotelDataTask() {
  const runningTask = getRunningQueueTask();
  if (runningTask) {
    showNotification('当前有任务正在运行，请等待完成后再更新数据', 'warning');
    return;
  }

  const task = createQueueTask(null, '', {}, {}, 'refresh-data');
  state.aiTaskQueue.push(task);
  if (!state.aiSelectedQueueTaskId) {
    state.aiSelectedQueueTaskId = task.id;
    state.aiQueueSelectionPinned = false;
  }
  renderTaskConsole();
  showNotification('已创建更新数据任务，准备开始', 'success');
  await runNextQueueTask();
}
