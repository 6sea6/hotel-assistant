import { state } from './state.js';
import { $, escapeHtml, getChecked, getValue, setChecked, setText, setValue } from './dom-helpers.js';
import { showNotification } from './notification.js';
import { actions } from './actions.js';
import {
  extractCtripUrl,
  formatAiTemplateLabel,
  getCollectToolResult,
  hasWriteResult,
  renderAiTaskConsole,
  updateAiInputCount as updateTaskInputCount
} from './ai-task-console.js';

const DEFAULT_AI_TEMPERATURE = 0.2;

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
    reply: ''
  };
}

function renderTaskConsole() {
  renderAiTaskConsole(state);
  updateTaskInputCount();
}

function renderProviderOptions() {
  const select = $('aiProviderSelect');
  if (!select || !state.aiProviderPresets.length) return;

  select.innerHTML = state.aiProviderPresets.map((preset) => `
    <option value="${escapeHtml(preset.id)}">${escapeHtml(preset.name)}</option>
  `).join('');
}

function renderAiTemplateOptions() {
  const select = $('aiTemplateSelect');
  if (!select) return;

  const currentValue = select.value;
  select.innerHTML = '<option value="">请选择模板</option>'
    + (state.templates || []).map((template) => {
      const id = template.id ?? '';
      return `<option value="${escapeHtml(String(id))}">${escapeHtml(formatAiTemplateLabel(template))}</option>`;
    }).join('');

  if (currentValue && Array.from(select.options).some((option) => option.value === currentValue)) {
    select.value = currentValue;
  }
}

function findSelectedAiTemplate() {
  const templateId = getValue('aiTemplateSelect');
  if (!templateId) {
    return null;
  }

  return (state.templates || []).find((template) => String(template.id) === String(templateId)) || null;
}

function applyAiConfigToForm(config) {
  const normalized = config || {};
  setChecked('aiEnabledInput', Boolean(normalized.enabled));
  setValue('aiProviderSelect', normalized.provider || 'deepseek');
  setValue('aiBaseUrlInput', normalized.baseUrl || '');
  setValue('aiModelInput', normalized.model || '');
  renderModelOptions(normalized.provider || 'deepseek');
  setValue('aiApiKeyInput', '');
  setText('aiApiKeyHint', normalized.hasApiKey ? '已保存 API Key；留空保存会继续使用旧 Key' : '尚未保存 API Key');
}

function getPresetById(providerId) {
  return state.aiProviderPresets.find((preset) => preset.id === providerId) || null;
}

function renderModelOptions(providerId) {
  const datalist = $('aiModelOptions');
  const preset = getPresetById(providerId);
  if (!datalist || !preset) return;

  datalist.innerHTML = (preset.modelOptions || [preset.model]).map((model) => `
    <option value="${escapeHtml(model)}"></option>
  `).join('');
}

function readAiConfigForm() {
  return {
    enabled: getChecked('aiEnabledInput'),
    provider: getValue('aiProviderSelect'),
    baseUrl: getValue('aiBaseUrlInput'),
    model: getValue('aiModelInput'),
    apiKey: getValue('aiApiKeyInput'),
    temperature: DEFAULT_AI_TEMPERATURE
  };
}

function getSubmittedUrl() {
  return extractCtripUrl(getValue('aiHotelUrlInput'));
}

function resetAiReviewState() {
  state.aiReview = {
    isOpen: false,
    inProgress: false,
    applyInProgress: false,
    result: null,
    reviewId: '',
    userConcern: '',
    error: ''
  };
}

function getRunningQueueTask() {
  return (state.aiTaskQueue || []).find((task) => task.status === 'running') || null;
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

function createQueueTask(template, url) {
  state.aiTaskQueueCounter = Number(state.aiTaskQueueCounter || 0) + 1;
  const displayIndex = String(state.aiTaskQueueCounter).padStart(2, '0');
  const title = formatAiTemplateLabel(template);
  return {
    id: `queue-${Date.now()}-${state.aiTaskQueueCounter}`,
    displayIndex,
    url,
    templateId: String(template.id ?? ''),
    templateName: template.name || '',
    templateLabel: title,
    title,
    template,
    status: 'waiting',
    currentStep: '',
    createdAt: new Date().toISOString(),
    startedAt: '',
    finishedAt: '',
    backendTaskId: '',
    errorMessage: '',
    resultSummary: '',
    events: [],
    console: createEmptyTaskConsole()
  };
}

function syncDisplayedTask(task) {
  if (!task) return;
  state.aiSelectedQueueTaskId = task.id;
  state.aiTaskConsole = task.console || createEmptyTaskConsole();
  state.aiTaskEvents = task.events || [];
}

function startTaskConsole(template, url, queueTask = null) {
  const startedAt = new Date().toISOString();
  const events = [];
  const consoleState = {
    ...createEmptyTaskConsole(),
    submitted: true,
    template,
    templateLabel: formatAiTemplateLabel(template),
    hotelUrl: url,
    startedAt
  };
  if (queueTask) {
    queueTask.status = 'running';
    queueTask.startedAt = startedAt;
    queueTask.finishedAt = '';
    queueTask.errorMessage = '';
    queueTask.resultSummary = '';
    queueTask.events = events;
    queueTask.console = consoleState;
    syncDisplayedTask(queueTask);
  } else {
    state.aiTaskEvents = events;
    state.aiTaskConsole = consoleState;
  }
  resetAiReviewState();
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

function getQueueResultWrote(result) {
  return Boolean(result.collectResult && hasWriteResult(result.collectResult.writeResult))
    || (Array.isArray(result.toolResults)
      && result.toolResults.some((item) => item.name === 'collect_and_write_ctrip_hotel' && item.result && hasWriteResult(item.result.writeResult)));
}

function isDuplicateActiveUrl(url) {
  const normalized = String(url || '').trim();
  return (state.aiTaskQueue || []).some((task) => (
    ['waiting', 'running'].includes(task.status)
    && String(task.url || '').trim() === normalized
  ));
}

function addQueueTask(template, url) {
  if (isDuplicateActiveUrl(url)) {
    showNotification('该链接已在任务队列中', 'warning');
    return null;
  }
  const task = createQueueTask(template, url);
  state.aiTaskQueue.push(task);
  state.aiSelectedQueueTaskId = state.aiSelectedQueueTaskId || task.id;
  renderTaskConsole();
  return task;
}

async function executeCollectTask(task) {
  state.aiTaskInProgress = true;
  startTaskConsole(task.template, task.url, task);

  try {
    const result = await window.electronAPI.ai.startTask({
      templateId: task.templateId,
      templateName: task.templateName || '',
      url: task.url
    });
    const reply = result.message || '任务已处理。';
    finishTaskConsole(result, reply, task);

    if (getQueueResultWrote(result)) {
      await actions.reloadAllData({ includeSettings: true, invalidateCache: true, verbose: false });
      actions.updateTemplateFilter({ interactionFirst: true });
      actions.renderHotelList({ interactionFirst: true });
      showNotification('采集结果已写入，宾馆列表已刷新', 'success');
    }
  } catch (error) {
    console.error('采集任务执行失败:', error);
    failTaskConsole(error, task);
    showNotification(error.message || '采集任务执行失败', 'error');
  } finally {
    state.aiTaskInProgress = false;
    if (String(state.aiSelectedQueueTaskId) === String(task.id)) {
      syncDisplayedTask(task);
    }
    renderTaskConsole();
    setTimeout(() => {
      runNextQueueTask();
    }, 0);
  }
}

function runNextQueueTask() {
  if (state.aiTaskInProgress || getRunningQueueTask()) return;
  const nextTask = (state.aiTaskQueue || []).find((task) => task.status === 'waiting');
  if (!nextTask) {
    renderTaskConsole();
    return;
  }
  executeCollectTask(nextTask);
}

export function updateAiInputCount() {
  updateTaskInputCount();
}

export async function loadAiConfig() {
  if (!window.electronAPI?.ai) return null;

  const [presets, config] = await Promise.all([
    window.electronAPI.ai.getPresets(),
    window.electronAPI.ai.getConfig()
  ]);
  state.aiProviderPresets = presets || [];
  state.aiProviderConfig = config || null;
  renderProviderOptions();
  applyAiConfigToForm(state.aiProviderConfig);
  return state.aiProviderConfig;
}

export function onAiProviderChange() {
  const preset = getPresetById(getValue('aiProviderSelect'));
  if (!preset) return;

  setValue('aiBaseUrlInput', preset.baseUrl);
  setValue('aiModelInput', preset.model);
  renderModelOptions(preset.id);
  setValue('aiApiKeyInput', '');
  setText('aiApiKeyHint', '切换供应商后请填写对应 API Key');
}

export async function saveAiConfig() {
  try {
    const saved = await window.electronAPI.ai.saveConfig(readAiConfigForm());
    state.aiProviderConfig = saved;
    applyAiConfigToForm(saved);
    showNotification('AI 接口设置已保存', 'success');
  } catch (error) {
    console.error('保存 AI 设置失败:', error);
    showNotification(error.message || '保存 AI 设置失败', 'error');
  }
}

export async function testAiConnection() {
  const button = $('aiTestBtn');
  if (button) button.disabled = true;

  try {
    const result = await window.electronAPI.ai.testConnection(readAiConfigForm());
    showNotification(`AI 连接成功：${result.message || 'OK'}`, 'success');
  } catch (error) {
    console.error('AI 连接测试失败:', error);
    showNotification(error.message || 'AI 连接测试失败', 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

export async function openAiAssistant() {
  setPageVisible('hotelMain', false);
  setPageVisible('aiAssistantPage', true);
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
        task.events.push(event);
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

  await loadAiConfig();
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
  const url = getSubmittedUrl();
  if (!url) {
    showNotification('请粘贴完整携程酒店链接', 'warning');
    return;
  }

  const task = addQueueTask(template, url);
  if (!task) return;
  setValue('aiHotelUrlInput', '');
  updateAiInputCount();
  showNotification(state.aiTaskInProgress ? '已加入等待队列' : '已加入队列，准备开始采集', 'success');
  runNextQueueTask();
}

export async function cancelAiTask() {
  try {
    const result = await window.electronAPI.ai.cancelTask();
    if (result.success) {
      showNotification('已请求取消采集任务', 'success');
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
    syncDisplayedTask(runningTask);
    showNotification('当前任务仍在运行，已清空其余队列记录', 'warning');
  } else {
    state.aiTaskQueue = [];
    state.aiSelectedQueueTaskId = '';
    state.aiTaskEvents = [];
    state.aiTaskConsole = createEmptyTaskConsole();
  }
  resetAiReviewState();
  setValue('aiHotelUrlInput', '');
  renderTaskConsole();
}

export function clearAiTaskQueue() {
  const runningTask = getRunningQueueTask();
  state.aiTaskQueue = runningTask ? [runningTask] : [];
  if (runningTask) {
    syncDisplayedTask(runningTask);
  } else {
    state.aiSelectedQueueTaskId = '';
    state.aiTaskEvents = [];
    state.aiTaskConsole = createEmptyTaskConsole();
  }
  resetAiReviewState();
  renderTaskConsole();
}

export function selectAiQueueTask(taskId) {
  const task = (state.aiTaskQueue || []).find((item) => String(item.id) === String(taskId));
  if (!task) return;
  syncDisplayedTask(task);
  resetAiReviewState();
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
      syncDisplayedTask(fallback);
    } else {
      state.aiSelectedQueueTaskId = '';
      state.aiTaskConsole = createEmptyTaskConsole();
      state.aiTaskEvents = [];
    }
  }
  resetAiReviewState();
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
    resetAiReviewState();
    renderTaskConsole();
    showNotification('已移到队列末尾', 'success');
    runNextQueueTask();
    return;
  }
  const task = createQueueTask(sourceTask.template, sourceTask.url);
  state.aiTaskQueue.push(task);
  state.aiSelectedQueueTaskId = task.id;
  resetAiReviewState();
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

function getCurrentReviewTaskId() {
  return state.aiTaskConsole && state.aiTaskConsole.taskId ? state.aiTaskConsole.taskId : '';
}

function renderAiReviewResult() {
  renderTaskConsole();
}

export function openAiReviewPanel() {
  const collectResult = state.aiTaskConsole && state.aiTaskConsole.collectResult;
  if (!getCurrentReviewTaskId() || !collectResult || !collectResult.reviewInputAvailable) {
    showNotification('当前任务没有生成可复核的数据包。', 'warning');
    return;
  }

  state.aiReview = {
    isOpen: true,
    inProgress: false,
    applyInProgress: false,
    result: null,
    reviewId: '',
    userConcern: '',
    error: ''
  };
  renderAiReviewResult();
  setTimeout(() => {
    const input = $('aiReviewConcernInput');
    if (input) input.focus();
  }, 0);
}

export function closeAiReviewPanel() {
  state.aiReview = {
    ...state.aiReview,
    isOpen: false
  };
  renderTaskConsole();
}

export async function analyzeAiCollection() {
  if (state.aiReview.inProgress) return;
  const taskId = getCurrentReviewTaskId();
  const userConcern = getValue('aiReviewConcernInput');
  if (!taskId) {
    showNotification('缺少任务 ID，无法分析。', 'error');
    return;
  }
  if (!userConcern.trim()) {
    showNotification('请先简单说明你认为哪里不对。', 'warning');
    return;
  }

  state.aiReview.inProgress = true;
  state.aiReview.result = null;
  state.aiReview.reviewId = '';
  state.aiReview.userConcern = userConcern;
  state.aiReview.error = '';
  renderAiReviewResult();

  try {
    const result = await window.electronAPI.ai.analyzeCollection({
      taskId,
      userConcern
    });
    state.aiReview.result = result;
    state.aiReview.reviewId = result.reviewId || '';
    state.aiReview.userConcern = userConcern;
    state.aiReview.error = '';
    showNotification(result.canApply ? '已生成重填预览，请确认后写入' : '分析完成，但证据不足，不能覆盖写入', result.canApply ? 'success' : 'warning');
  } catch (error) {
    console.error('AI 分析重填失败:', error);
    state.aiReview.error = error.message || '分析失败，请稍后重试。';
    showNotification(state.aiReview.error, 'error');
  } finally {
    state.aiReview.inProgress = false;
    renderAiReviewResult();
  }
}

export async function applyAiCollectionReview() {
  if (state.aiReview.applyInProgress || !state.aiReview.reviewId) return;
  state.aiReview.applyInProgress = true;
  state.aiReview.userConcern = getValue('aiReviewConcernInput', state.aiReview.userConcern || '');
  renderAiReviewResult();

  try {
    await window.electronAPI.ai.applyCollectionReview({
      reviewId: state.aiReview.reviewId
    });
    await actions.reloadAllData({ includeSettings: true, invalidateCache: true, verbose: false });
    actions.updateTemplateFilter({ interactionFirst: true });
    actions.renderHotelList({ interactionFirst: true });
    showNotification('AI 复核结果已覆盖写入，宾馆列表已刷新', 'success');
    closeAiReviewPanel();
  } catch (error) {
    console.error('AI 覆盖写入失败:', error);
    showNotification(error.message || 'AI 覆盖写入失败', 'error');
  } finally {
    state.aiReview.applyInProgress = false;
    renderAiReviewResult();
  }
}

export function showAiTaskDetails() {
  const collectResult = state.aiTaskConsole && state.aiTaskConsole.collectResult;
  if (!collectResult) {
    showNotification('当前没有更多采集详情。', 'info');
    return;
  }

  const detailParts = [
    collectResult.hotelName ? `酒店：${collectResult.hotelName}` : '',
    Number.isFinite(Number(collectResult.eligibleCount)) ? `可用房型：${collectResult.eligibleCount} 个` : '',
    collectResult.outputPath ? `结果文件：${collectResult.outputPath}` : ''
  ].filter(Boolean);
  showNotification(detailParts.join('\n') || '采集详情已显示在结果分析中。', 'info');
}

export function focusAiTaskStartBar() {
  const input = $('aiHotelUrlInput');
  if (input && !input.disabled) {
    input.focus();
    input.select();
  }
}
