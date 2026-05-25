import {
  formatAiTemplateLabel,
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

/**
 * @typedef {import('../../shared/contracts').AiTaskConsoleState} AiTaskConsoleState
 * @typedef {import('../../shared/contracts').AiTaskEvent} AiTaskEvent
 * @typedef {import('../../shared/contracts').AiTaskKind} AiTaskKind
 * @typedef {import('./ai-task-progress.js').AiProgressStats} AiProgressStats
 *
 * @typedef {object} AiTaskStepViewModel
 * @property {string} key
 * @property {string} time
 * @property {string} title
 * @property {string} detail
 * @property {string} toolName
 * @property {string} status
 *
 * @typedef {object} AiTaskInfoViewModel
 * @property {string} taskId
 * @property {string} templateName
 * @property {string} hotelUrl
 * @property {string} startTime
 * @property {string} endTime
 *
 * @typedef {Record<string, unknown> & {
 *   hasMatchedRoom?: boolean,
 *   hotelName?: string,
 *   actualResultText?: string,
 *   isBatchResult?: boolean,
 *   eligibleCount?: number,
 *   priceText?: string,
 *   matchedRooms?: Array<Record<string, unknown>>,
 *   reasons?: unknown[],
 *   writeBackStatus?: string,
 *   summary?: string,
 *   raw?: Record<string, unknown>
 * }} AiTaskResultViewModel
 *
 * @typedef {object} AiTaskErrorViewModel
 * @property {string} message
 * @property {string} reason
 * @property {string[]} suggestions
 *
 * @typedef {object} AiTaskNormalizedState
 * @property {string} status
 * @property {AiTaskInfoViewModel} taskInfo
 * @property {AiTaskStepViewModel[]} steps
 * @property {AiProgressStats|null} progressStats
 * @property {AiTaskResultViewModel} result
 * @property {AiTaskErrorViewModel} error
 */
export function buildTaskSteps(task, events, status) {
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

export function getTimeValue(value) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

export function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function getElapsedText(taskInfo = {}, status = 'idle', now = Date.now()) {
  const start = getTimeValue(taskInfo.startTime);
  if (!start) return '00:00:00';
  const end = status === 'running' ? now : getTimeValue(taskInfo.endTime) || now;
  return formatDuration(end - start);
}

export function getTaskCollectResult(task = {}) {
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
export function buildTaskResult(task = {}) {
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
export function buildTaskError(task = {}, events = []) {
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
