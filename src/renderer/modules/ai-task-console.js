import { $, escapeHtml, setText } from './dom-helpers.js';
import {
  formatAiTemplateLabel,
  formatAiTime,
  formatCurrency,
  getReadableToolLabel
} from './ai-task-formatters.js';
import {
  findRefreshStepEvent,
  findStepEvent,
  getEventDetailText,
  getLastTaskError,
  getStepDefinitions,
  isRecord,
  normalizeEvent
} from './ai-task-events.js';
import {
  buildProgressStats,
  getBatchWriteStats,
  getCollectToolResult,
  getRefreshCurrentStepKey,
  hasWriteResult
} from './ai-task-progress.js';

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

/**
 * @typedef {import('../../shared/contracts').AiTaskConsoleState} AiTaskConsoleState
 * @typedef {import('../../shared/contracts').AiTaskEvent} AiTaskEvent
 * @typedef {import('../../shared/contracts').AiTaskQueueItem} AiTaskQueueItem
 */

let elapsedTimer = null;
function buildTaskSteps(task, events, status) {
  const taskKind = task.taskKind || 'collect';
  const normalizedEvents = (events || [])
    .map((event) => normalizeEvent(event, taskKind))
    .filter((event) => event.title);
  const stepDefinitions = getStepDefinitions(normalizedEvents, taskKind);
  const lastProgressEvent = normalizedEvents
    .slice()
    .reverse()
    .find(
      (event) =>
        event.key && event.key !== 'done' && event.key !== 'error' && event.key !== 'cancel'
    );

  let currentKey = '';
  if (status === 'running') {
    if (taskKind === 'refresh-data') {
      currentKey = getRefreshCurrentStepKey(events);
    } else {
      currentKey = lastProgressEvent ? lastProgressEvent.key : '';
    }
  }
  const currentIndex = stepDefinitions.findIndex((step) => step.key === currentKey);
  const errorKey = status === 'error' && lastProgressEvent ? lastProgressEvent.key : 'scrape';

  return stepDefinitions.map((definition, index) => {
    const matchedEvent =
      taskKind === 'refresh-data'
        ? findRefreshStepEvent(normalizedEvents, definition.key)
        : findStepEvent(normalizedEvents, definition.key);
    let stepStatus = 'pending';

    if (status === 'success') {
      stepStatus = 'success';
    } else if (status === 'error') {
      const errorIndex = stepDefinitions.findIndex((step) => step.key === errorKey);
      if (index < errorIndex) stepStatus = 'success';
      if (index === errorIndex) stepStatus = 'error';
    } else if (status === 'cancelled') {
      const cancelIndex = stepDefinitions.findIndex((step) => step.key === 'cancel');
      if (cancelIndex >= 0) {
        if (index < cancelIndex) stepStatus = matchedEvent || index === 0 ? 'success' : 'pending';
        if (index === cancelIndex) stepStatus = 'cancelled';
      }
    } else if (status === 'running') {
      if (currentIndex < 0) {
        stepStatus = index === 0 ? 'running' : 'pending';
      } else if (index < currentIndex) {
        stepStatus = 'success';
      } else if (index === currentIndex) {
        stepStatus = 'running';
      }
    }

    return {
      key: definition.key,
      time: matchedEvent ? matchedEvent.time : definition.key === 'received' ? task.startedAt : '',
      title:
        status === 'success'
          ? definition.doneTitle
          : matchedEvent
            ? matchedEvent.title
            : definition.title,
      detail:
        matchedEvent && matchedEvent.toolName
          ? getReadableToolLabel(matchedEvent.toolName)
          : getEventDetailText(matchedEvent),
      toolName: matchedEvent ? matchedEvent.toolName : '',
      status: stepStatus
    };
  });
}

function getTimeValue(value) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function getElapsedText(taskInfo = {}, status = 'idle', now = Date.now()) {
  const start = getTimeValue(taskInfo.startTime);
  if (!start) return '00:00:00';
  const end = status === 'running' ? now : getTimeValue(taskInfo.endTime) || now;
  return formatDuration(end - start);
}

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

/**
 * @param {AiTaskConsoleState} [task]
 * @returns {Record<string, unknown>}
 */
function getTaskCollectResult(task = {}) {
  return /** @type {Record<string, unknown>} */ (
    task.collectResult ||
      (task.result && task.result.collectResult) ||
      (getCollectToolResult(task.result || {}) || {}).result ||
      {}
  );
}

/**
 * @param {AiTaskConsoleState} [task]
 * @returns {Record<string, unknown>}
 */
function buildTaskResult(task = {}) {
  const collectResult = getTaskCollectResult(task);
  const taskKind = task.taskKind || 'collect';
  const isRefresh = taskKind === 'refresh-data';

  // Refresh-data task result
  if (isRefresh && collectResult) {
    const totalHotelCount = Number(collectResult.totalHotelCount || 0);
    const updatedHotelCount = Number(collectResult.updatedHotelCount || 0);
    const updatedRoomTypeCount = Number(collectResult.updatedRoomTypeCount || 0);
    const deletedRoomTypeCount = Number(collectResult.deletedRoomTypeCount || 0);
    const skippedHotelCount = Number(collectResult.skippedHotelCount || 0);
    const wroteResult = hasWriteResult(collectResult.writeResult);

    let refreshResultText = '';
    if (totalHotelCount === 0) {
      refreshResultText = '当前没有找到带携程链接的宾馆，未执行更新。';
    } else if (updatedHotelCount === 0 && skippedHotelCount > 0) {
      refreshResultText = `本次没有成功更新的宾馆，已跳过 ${skippedHotelCount} 家。请检查携程登录态或稍后重试。`;
    } else {
      refreshResultText = `本次更新 ${updatedHotelCount} 家宾馆信息，更新 ${updatedRoomTypeCount} 种房型价格，删除 ${deletedRoomTypeCount} 种已下架房型，跳过 ${skippedHotelCount} 家。`;
    }

    return {
      hasMatchedRoom: updatedHotelCount > 0,
      hotelName: refreshResultText,
      actualResultText: refreshResultText,
      isBatchResult: false,
      eligibleCount: updatedRoomTypeCount,
      priceText: '',
      matchedRooms: [],
      reasons: [],
      writeBackStatus: wroteResult ? '已写入数据' : '未写入数据',
      summary: refreshResultText,
      raw: collectResult
    };
  }

  const eligibleCount = Number(collectResult.eligibleCount || 0);
  const matchedRooms = Array.isArray(collectResult.eligibleRoomTypes)
    ? collectResult.eligibleRoomTypes
    : [];
  const eligibleHotels = Array.isArray(collectResult.eligibleHotels)
    ? collectResult.eligibleHotels
    : [];
  const firstRoom = matchedRooms[0] || {};
  const firstHotel = eligibleHotels[0] || {};
  const totalPrice =
    collectResult.totalPrice ??
    firstRoom.totalPrice ??
    firstRoom.total_price ??
    firstHotel.total_price ??
    null;
  const dailyPrice =
    firstRoom.dailyPrice ?? firstRoom.daily_price ?? firstHotel.daily_price ?? null;
  const reasons = [collectResult.writeSkipReason, collectResult.error].filter(Boolean);
  const wroteResult = hasWriteResult(collectResult.writeResult);
  const batchSummary = collectResult.batchStats || collectResult.batchSummary || null;
  const batchCount = Number(
    isRecord(batchSummary) && batchSummary.expandedHotelCount
      ? batchSummary.expandedHotelCount
      : Array.isArray(collectResult.items)
        ? collectResult.items.length
        : 0
  );
  const isBatchResult = Boolean(collectResult.batchMode);
  const batchWriteStats = getBatchWriteStats(collectResult);
  const batchWriteText = `本次最终写入 ${batchWriteStats.hotelCount} 家宾馆，${batchWriteStats.roomTypeCount} 种房型`;
  const batchResultText =
    batchCount > 0 ? `批量 ${batchCount} 家，${batchWriteText}` : `批量采集完成，${batchWriteText}`;
  const singleResultText = `${collectResult.hotelName || '暂无'}，可用房型 ${Number.isFinite(eligibleCount) ? eligibleCount : 0} 个`;

  if (reasons.length === 0 && eligibleCount <= 0) {
    reasons.push('暂无详细原因，请查看采集详情。');
  }

  return {
    hasMatchedRoom: eligibleCount > 0 && !collectResult.writeSkipped,
    hotelName: isBatchResult ? batchResultText : collectResult.hotelName || '暂无',
    actualResultText: isBatchResult ? batchResultText : singleResultText,
    isBatchResult,
    eligibleCount: Number.isFinite(eligibleCount) ? eligibleCount : 0,
    priceText:
      [
        formatCurrency(dailyPrice) ? `${formatCurrency(dailyPrice)} / 晚` : '',
        formatCurrency(totalPrice) ? `${formatCurrency(totalPrice)} 总价` : ''
      ]
        .filter(Boolean)
        .join('，') || '暂无',
    matchedRooms: matchedRooms.length
      ? matchedRooms
      : eligibleHotels.map((hotel) => ({
          roomType: hotel.room_type || '',
          originalRoomType: hotel.original_room_type || '',
          dailyPrice: hotel.daily_price ?? null,
          totalPrice: hotel.total_price ?? null,
          occupancy: hotel.room_count ?? null,
          cancelPolicy: hotel.cancel_policy || '',
          windowStatus: hotel.window_status || ''
        })),
    reasons,
    writeBackStatus: wroteResult ? '已写入数据' : '未写入数据',
    summary: collectResult.writeSkipped
      ? '采集完成，但未写入宾馆数据。'
      : isBatchResult
        ? '批量采集完成，结果已汇总。'
        : '采集完成，结果已汇总。',
    raw: collectResult
  };
}

/**
 * @param {AiTaskConsoleState} [task]
 * @param {AiTaskEvent[]} [events]
 * @returns {{message: string, reason: string, suggestions: string[]}}
 */
function buildTaskError(task = {}, events = []) {
  const message = getLastTaskError(events, task) || '系统在采集携程酒店页面时发生异常。';
  const cancelled =
    /任务已取消|采集任务已取消/.test(message) ||
    events.some((event) => event.type === 'task:cancel');
  return {
    message,
    reason: message,
    suggestions: cancelled
      ? ['当前采集已中止，本次取消会撤销已经写回的数据。']
      : [
          '检查链接是否为携程酒店详情页或列表页。',
          '确认携程登录态可用，必要时重新登录。',
          '稍后重新执行任务。'
        ]
  };
}

/**
 * @param {{task?: AiTaskConsoleState, events?: AiTaskEvent[], inProgress?: boolean}} [options]
 * @returns {{
 *   status: string,
 *   taskInfo: {taskId: string, templateName: string, hotelUrl: string, startTime: string, endTime: string},
 *   steps: Array<Record<string, unknown>>,
 *   progressStats: {total: number, completed: number, running: number, pending: number}|null,
 *   result: Record<string, unknown>,
 *   error: {message: string, reason: string, suggestions: string[]}
 * }}
 */
export function normalizeTaskState({ task = {}, events = [], inProgress = false } = {}) {
  const submitted = Boolean(
    task.submitted || task.hotelUrl || task.result || task.error || events.length
  );
  let status = 'idle';
  const hasCancelEvent = events.some((event) => event.type === 'task:cancel');
  const cancellationError = /任务已取消|采集任务已取消/.test(String(task.error || ''));

  if (task.cancelled || task.status === 'cancelled' || hasCancelEvent || cancellationError) {
    status = 'cancelled';
  } else if (task.error) {
    status = 'error';
  } else if (inProgress) {
    status = 'running';
  } else if (submitted && task.result) {
    status = 'success';
  } else if (submitted && events.some((event) => event.type === 'task:error')) {
    status = 'error';
  }

  const steps = buildTaskSteps(task, events, status);
  const _collectResult = getTaskCollectResult(task);
  const taskKind = task.taskKind || 'collect';
  const taskStatus = isRecord(task.result?.taskStatus) ? task.result.taskStatus : {};
  const taskInfo = {
    taskId: task.taskId || (taskStatus.id ? String(taskStatus.id) : ''),
    templateName: task.templateLabel || formatAiTemplateLabel(task.template || {}) || '暂无',
    hotelUrl: task.hotelUrl || '',
    startTime: task.startedAt || '',
    endTime: task.endedAt || ''
  };

  return {
    status,
    taskInfo,
    steps,
    progressStats: buildProgressStats(events, taskKind),
    result: buildTaskResult(task),
    error: buildTaskError(task, events)
  };
}

function renderStatusBadge(status, label) {
  return `<span class="task-status-badge task-status-${escapeHtml(status)}">${escapeHtml(label)}</span>`;
}

function getQueueStatusLabel(task = {}) {
  if (task.status === 'running') return '运行中';
  if (task.status === 'waiting') return '等待中';
  if (task.status === 'completed') return '已完成';
  if (task.status === 'cancelled') return '已取消';
  if (task.status === 'failed') return '失败';
  return '等待中';
}

function getQueueTaskTitle(task = {}) {
  return task.title || task.templateName || task.templateLabel || '未命名任务';
}

/**
 * @param {AiTaskQueueItem} [task]
 * @param {number} [fallbackIndex]
 * @returns {string}
 */
function renderQueueTaskItem(task = {}, fallbackIndex = 0) {
  const displayIndex = task.displayIndex || String(fallbackIndex + 1).padStart(2, '0');
  const statusLabel = getQueueStatusLabel(task);
  const isSelected = String(task.id || '') === String(task.selectedId || '');
  const statusClass = `task-queue-status-${escapeHtml(task.status || 'waiting')}`;
  const canShowMenu = task.status !== 'running';
  return `
    <div class="task-queue-item${isSelected ? ' is-selected' : ''} ${statusClass}">
      <button class="task-queue-main" type="button" data-action="select-ai-queue-task" data-task-id="${escapeHtml(task.id || '')}">
        <span class="task-queue-index">${escapeHtml(displayIndex)}</span>
        <span class="task-queue-title">${escapeHtml(getQueueTaskTitle(task))}</span>
        <span class="task-queue-badge">${escapeHtml(statusLabel)}</span>
      </button>
      ${
        canShowMenu
          ? `
        <details class="task-queue-menu">
          <summary title="更多操作">⋯</summary>
          <div class="task-queue-menu-popover">
            <button type="button" data-action="retry-ai-queue-task" data-task-id="${escapeHtml(task.id || '')}">重新加入队列</button>
            <button type="button" class="is-danger" data-action="remove-ai-queue-task" data-task-id="${escapeHtml(task.id || '')}">删除记录</button>
          </div>
        </details>
      `
          : ''
      }
    </div>
  `;
}

/**
 * @param {string} label
 * @param {AiTaskQueueItem[]} tasks
 * @param {string} selectedId
 * @param {string} [emptyText]
 * @returns {string}
 */
function renderQueueGroup(label, tasks, selectedId, emptyText = '') {
  const rows = (tasks || [])
    .map((task, index) => renderQueueTaskItem({ ...task, selectedId }, index))
    .join('');
  return `
    <section class="task-queue-group">
      <div class="task-queue-group-title">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(String(tasks.length))}</strong>
      </div>
      <div class="task-queue-list">
        ${rows || (emptyText ? `<p class="task-queue-empty">${escapeHtml(emptyText)}</p>` : '')}
      </div>
    </section>
  `;
}

/**
 * @param {AiTaskQueueItem[]} [queue]
 * @param {{selectedId?: string}} [options]
 * @returns {string}
 */
function renderTaskQueue(queue = [], options = {}) {
  const selectedId = options.selectedId || '';
  const running = queue.filter((task) => task.status === 'running');
  const waiting = queue.filter((task) => task.status === 'waiting');
  const completed = queue.filter((task) => task.status === 'completed');
  const failed = queue.filter((task) => task.status === 'failed' || task.status === 'cancelled');

  return `
    <div class="task-queue-shell">
      <div class="task-card-header task-queue-header">
        <div>
          <h2>任务队列</h2>
        </div>
        <div class="task-queue-header-actions">
          <button class="task-secondary-button task-queue-clear" type="button" data-action="clear-ai-task-queue">清空队列</button>
        </div>
      </div>
      <div class="task-queue-body">
        ${renderQueueGroup('运行中', running, selectedId)}
        ${renderQueueGroup('等待中', waiting, selectedId, '暂无等待任务')}
        ${renderQueueGroup('已完成', completed, selectedId)}
        ${renderQueueGroup('失败', failed, selectedId)}
      </div>
    </div>
  `;
}

function renderTaskMeta(taskState) {
  const { taskInfo } = taskState;
  return `
    <div class="task-info-grid">
      <div class="task-info-item">
        <span>模板</span>
        <strong>${escapeHtml(taskInfo.templateName || '暂无')}</strong>
      </div>
      <div class="task-info-item task-info-elapsed">
        <span>执行时间</span>
        <strong
          id="aiTaskElapsedTime"
          data-status="${escapeHtml(taskState.status)}"
          data-start-time="${escapeHtml(taskInfo.startTime || '')}"
          data-end-time="${escapeHtml(taskInfo.endTime || '')}"
        >${escapeHtml(getElapsedText(taskInfo, taskState.status))}</strong>
      </div>
    </div>
  `;
}

function renderTaskTimeline(steps, options = {}) {
  const compact = options.compact ? ' task-timeline-compact' : '';
  return `
    <div class="task-timeline${compact}">
      ${steps
        .map(
          (step) => `
        <div class="task-timeline-row task-step-${escapeHtml(step.status)}">
          <div class="task-step-time">${escapeHtml(formatAiTime(step.time) || '--:--:--')}</div>
          <div class="task-step-marker" aria-hidden="true"></div>
          <div class="task-step-body">
            <strong>${escapeHtml(step.title)}</strong>
            ${step.detail ? `<span>${escapeHtml(step.detail)}</span>` : ''}
          </div>
        </div>
      `
        )
        .join('')}
    </div>
  `;
}

function renderProgressIcon(type) {
  const icons = {
    hotel: `
      <svg class="task-progress-stat-icon task-progress-stat-icon-hotel" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M4 21h16"></path>
        <path d="M6 21V5.8c0-.9.6-1.6 1.5-1.8l6-1.2c1.3-.3 2.5.7 2.5 2V21"></path>
        <path d="M16 8h2.5c.8 0 1.5.7 1.5 1.5V21"></path>
        <path d="M9 8h.01"></path>
        <path d="M12 8h.01"></path>
        <path d="M9 12h.01"></path>
        <path d="M12 12h.01"></path>
        <path d="M9 16h.01"></path>
        <path d="M12 16h.01"></path>
      </svg>
    `,
    done: `
      <svg class="task-progress-stat-icon task-progress-stat-icon-done" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="10"></circle>
        <path d="m7.8 12.4 2.8 2.8 5.8-6.3"></path>
      </svg>
    `,
    running: `
      <svg class="task-progress-stat-icon task-progress-stat-icon-running loading-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M21 12a9 9 0 1 1-6.2-8.6"></path>
      </svg>
    `,
    pending: `
      <svg class="task-progress-stat-icon task-progress-stat-icon-pending" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="9"></circle>
        <path d="M12 7v5l3.2 2"></path>
      </svg>
    `
  };

  return icons[type] || '';
}

function renderProgressStats(stats, taskKind = 'collect') {
  if (!stats || !Number.isFinite(Number(stats.total)) || Number(stats.total) <= 0) {
    return '';
  }

  const isRefresh = taskKind === 'refresh-data';
  const cards = isRefresh
    ? [
        { type: 'hotel', label: '宾馆总数', value: stats.total },
        { type: 'done', label: '已更新', value: stats.completed },
        { type: 'running', label: '进行中', value: stats.running },
        { type: 'pending', label: '待处理', value: stats.pending }
      ]
    : [
        { type: 'hotel', label: '酒店总数', value: stats.total },
        { type: 'done', label: '已完成', value: stats.completed },
        { type: 'running', label: '进行中', value: stats.running },
        { type: 'pending', label: '待处理', value: stats.pending }
      ];

  return `
    <div class="task-progress-stats" aria-label="${isRefresh ? '更新数据进度统计' : '批量采集进度统计'}">
      ${cards
        .map(
          (card) => `
        <div class="task-progress-stat-card">
          ${renderProgressIcon(card.type)}
          <span>${escapeHtml(card.label)}</span>
          <strong>${escapeHtml(String(card.value))}</strong>
        </div>
      `
        )
        .join('')}
    </div>
  `;
}

function renderIdleView() {
  return `
    <div class="task-empty-state">
      <div class="task-empty-icon" aria-hidden="true">⌁</div>
      <h3>等待开始任务</h3>
      <p>请选择模板，并粘贴携程酒店详情页或列表页链接，系统将自动采集酒店房型、价格、交通和比较信息。</p>
      <div class="task-empty-tips">
        <span>支持详情页和列表页</span>
        <span>自动采集房型、价格、交通等信息</span>
        <span>结果可导出，便于对比与分析</span>
      </div>
      <div class="task-empty-dropzone">任务执行过程与结果将显示在此处</div>
    </div>
  `;
}

function renderRunningView(taskState, taskKind = 'collect') {
  const isRefresh = taskKind === 'refresh-data';
  return `
    <div class="task-running-view">
      <div class="task-result-hero task-result-hero-running">
        <span aria-hidden="true">…</span>
        <div>
          <h3>${isRefresh ? '正在更新数据' : '正在采集'}</h3>
          <p>${isRefresh ? '正在更新已有宾馆的房型与价格信息……' : '正在采集房型与价格信息……'}</p>
        </div>
      </div>
      ${renderTaskMeta(taskState)}
      <section class="task-panel-section">
        <div class="task-section-heading">
          <h3>执行进度</h3>
          ${renderStatusBadge('running', '执行中')}
        </div>
        ${renderProgressStats(taskState.progressStats, taskKind)}
        ${renderTaskTimeline(taskState.steps)}
      </section>
      <div class="task-panel-actions">
        <button class="task-secondary-button" type="button" data-action="cancel-ai-task">${isRefresh ? '取消更新任务' : '取消当前任务'}</button>
      </div>
    </div>
  `;
}

function renderSummaryCards(taskState, variant, taskKind = 'collect') {
  const { taskInfo, result, error } = taskState;
  const elapsedText = getElapsedText(taskInfo, taskState.status);
  const isError = variant === 'error';
  const isCancelled = variant === 'cancelled';
  const isRefresh = taskKind === 'refresh-data';
  const reasonItems =
    isError || isCancelled
      ? [error.reason || error.message, ...error.suggestions].filter(Boolean)
      : result.reasons;
  const reasonList = reasonItems.length
    ? `<ul class="task-reason-list">
        ${reasonItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
      </ul>`
    : '';

  const resultAnalysisContent = isRefresh
    ? `
      <dl>
        <div><dt>更新结果</dt><dd>${escapeHtml(result.actualResultText || result.hotelName)}</dd></div>
        <div><dt>写入状态</dt><dd>${escapeHtml(result.writeBackStatus)}</dd></div>
      </dl>
    `
    : isError || isCancelled
      ? `
        <dl>
          <div><dt>${isCancelled ? '取消原因' : '错误原因'}</dt><dd>${escapeHtml(error.message || (isCancelled ? '任务已取消' : '暂无详细原因'))}</dd></div>
          <div><dt>建议操作</dt><dd>${escapeHtml(isCancelled ? '如需继续，请重新采集。' : '检查链接、刷新登录态、重新执行任务。')}</dd></div>
        </dl>
      `
      : `
        <dl>
          <div><dt>模板规则</dt><dd>${escapeHtml(taskInfo.templateName || '暂无')}</dd></div>
          <div><dt>实际采集结果</dt><dd>${escapeHtml(result.actualResultText || result.hotelName)}</dd></div>
          <div><dt>写入状态</dt><dd>${escapeHtml(result.writeBackStatus)}</dd></div>
        </dl>
      `;

  return `
    <div class="task-result-grid">
      <section class="task-result-card">
        <h3>任务摘要</h3>
        <dl>
          <div><dt>${isRefresh ? '任务类型' : '模板'}</dt><dd>${isRefresh ? '更新已有宾馆数据' : escapeHtml(taskInfo.templateName || '暂无')}</dd></div>
          <div><dt>开始时间</dt><dd>${escapeHtml(formatAiTime(taskInfo.startTime) || '暂无')}</dd></div>
          <div><dt>${isCancelled ? '取消时间' : isError ? '失败时间' : '完成时间'}</dt><dd>${escapeHtml(formatAiTime(taskInfo.endTime) || '暂无')}</dd></div>
          <div><dt>执行时间</dt><dd>${escapeHtml(elapsedText)}</dd></div>
          <div><dt>执行状态</dt><dd>${escapeHtml(isCancelled ? '已取消' : isError ? '执行失败' : '已完成')}</dd></div>
        </dl>
      </section>

      <section class="task-result-card">
        <h3>执行记录</h3>
        ${renderTaskTimeline(taskState.steps, { compact: true })}
      </section>

      <section class="task-result-card">
        <h3>${isCancelled ? '取消详情' : isError ? '错误详情' : '结果分析'}</h3>
        ${resultAnalysisContent}
        ${reasonList}
      </section>
    </div>
  `;
}

function renderSuccessView(taskState, taskKind = 'collect') {
  const isRefresh = taskKind === 'refresh-data';
  const title = isRefresh
    ? '更新完成'
    : taskState.result.hasMatchedRoom
      ? '采集完成，已找到符合条件的房型'
      : '采集完成，但没有符合条件的房型';

  return `
    <div class="task-finished-view">
      <div class="task-result-hero task-result-hero-success">
        <span aria-hidden="true">✓</span>
        <div>
          <h3>${isRefresh ? '更新完成' : '采集完成'}</h3>
          <p>${escapeHtml(title)}</p>
        </div>
      </div>
      ${renderSummaryCards(taskState, 'success', taskKind)}
      <div class="task-panel-actions">
        <button class="task-primary-inline-button" type="button" data-action="rerun-current-ai-task">${isRefresh ? '再次更新' : '重新采集'}</button>
      </div>
    </div>
  `;
}

function renderErrorView(taskState, taskKind = 'collect') {
  const isRefresh = taskKind === 'refresh-data';
  return `
    <div class="task-finished-view">
      <div class="task-result-hero task-result-hero-error">
        <span aria-hidden="true">!</span>
        <div>
          <h3>任务执行失败</h3>
          <p>${isRefresh ? '更新数据时发生异常，请检查携程登录态或稍后重试。' : '系统在采集携程酒店页面时发生异常，请检查链接或稍后重试。'}</p>
        </div>
      </div>
      ${renderSummaryCards(taskState, 'error', taskKind)}
      <div class="task-panel-actions">
        <button class="task-primary-inline-button" type="button" data-action="rerun-current-ai-task">${isRefresh ? '再次尝试更新' : '重新尝试'}</button>
        <button class="task-secondary-button" type="button" data-action="focus-ai-task-start-bar">返回编辑</button>
      </div>
    </div>
  `;
}

function renderCancelledView(taskState, taskKind = 'collect') {
  const isRefresh = taskKind === 'refresh-data';
  return `
    <div class="task-finished-view">
      <div class="task-result-hero task-result-hero-cancelled">
        <span aria-hidden="true">×</span>
        <div>
          <h3>任务已取消</h3>
          <p>${isRefresh ? '更新任务已取消，本次取消会撤销已经写回的数据。' : '采集任务已中止，本次取消会撤销已经写回的数据。'}</p>
        </div>
      </div>
      ${renderSummaryCards(taskState, 'cancelled', taskKind)}
      <div class="task-panel-actions">
        <button class="task-primary-inline-button" type="button" data-action="rerun-current-ai-task">${isRefresh ? '再次更新' : '重新采集'}</button>
        <button class="task-secondary-button" type="button" data-action="focus-ai-task-start-bar">返回编辑</button>
      </div>
    </div>
  `;
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
