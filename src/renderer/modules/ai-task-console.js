import { $, escapeHtml, setText } from './dom-helpers.js';

const TOOL_LABELS = {
  get_task_status: '获取任务状态',
  list_templates: '读取模板列表',
  get_settings: '读取比较助手设置',
  collect_and_write_ctrip_hotel: '采集携程酒店页面',
  refresh_existing_ctrip_hotels: '更新已有宾馆数据',
  open_visible_edge_login: '打开 Edge 登录准备窗口',
  prepare_edge: '准备 Edge 登录态',
  calculate_traffic: '计算交通与地铁信息',
  write_result: '回写采集结果'
};

const BASE_STEP_DEFINITIONS = [
  { key: 'received', title: '已接收任务', doneTitle: '任务创建' },
  { key: 'template', title: '正在读取模板与比较助手设置', doneTitle: '模板解析' },
  { key: 'edge', title: '正在准备 Edge 登录态', doneTitle: '准备 Edge 登录态' },
  { key: 'scrape', title: '正在采集携程酒店页面', doneTitle: '房型采集与筛选' },
  { key: 'transit', title: '正在计算交通与地铁信息', doneTitle: '交通与地铁计算' },
  { key: 'write', title: '等待回写采集结果', doneTitle: '结果汇总' }
];

const REFRESH_STEP_DEFINITIONS = [
  { key: 'received', title: '已接收更新任务', doneTitle: '任务创建' },
  { key: 'load-data', title: '正在读取当前宾馆数据', doneTitle: '读取当前宾馆数据' },
  { key: 'edge', title: '正在准备 Edge 登录态', doneTitle: '准备 Edge 登录态' },
  { key: 'refresh', title: '正在更新房型与价格', doneTitle: '房型与价格更新' },
  { key: 'write', title: '等待写入更新结果', doneTitle: '结果汇总' }
];

const LOGIN_STEP_DEFINITION = {
  key: 'login',
  title: '等待携程登录确认',
  doneTitle: '携程登录态已确认'
};

const CANCEL_STEP_DEFINITION = {
  key: 'cancel',
  title: '任务已取消',
  doneTitle: '任务已取消'
};

const TRAILING_URL_PUNCTUATION = /[)\]}>，。；;、！？!?.,]+$/;
const INLINE_URL_TEXT_SEPARATOR = /[,，。；;、！？!?](?=[\u4e00-\u9fff])/;

let elapsedTimer = null;

export function formatAiTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

export function formatAiTemplateLabel(template = {}) {
  const id = template.id ?? '';
  const labelParts = [
    template.name || `模板 ${id}`,
    template.destination,
    template.check_in_date && template.check_out_date
      ? `${template.check_in_date} 至 ${template.check_out_date}`
      : '',
    template.room_count ? `${template.room_count}人` : ''
  ].filter(Boolean);
  return labelParts.join(' · ');
}

export function extractCtripUrl(text) {
  return extractCtripUrls(text)[0] || '';
}

export function extractCtripUrls(text) {
  const seen = new Set();
  const matches = String(text || '').match(/https?:\/\/[^\s"'<>]+/gi) || [];
  return matches
    .map((match) => {
      let cleaned = match.replace(/&amp;/g, '&').trim();
      const inlineTextIndex = cleaned.search(INLINE_URL_TEXT_SEPARATOR);
      if (inlineTextIndex > 0) {
        cleaned = cleaned.slice(0, inlineTextIndex);
      }
      while (TRAILING_URL_PUNCTUATION.test(cleaned)) {
        cleaned = cleaned.replace(TRAILING_URL_PUNCTUATION, '');
      }
      return cleaned;
    })
    .filter((url) => {
      if (!url || seen.has(url)) return false;
      try {
        const parsed = new URL(url);
        const hostAllowed = /(^|\.)ctrip\.com$/i.test(parsed.hostname);
        const hotelPage = /hotel|hotels/i.test(parsed.href);
        if (!hostAllowed || !hotelPage) return false;
        seen.add(url);
        return true;
      } catch (_error) {
        return false;
      }
    });
}

export function getCollectToolResult(result = {}) {
  if (!Array.isArray(result.toolResults)) return null;
  return (
    result.toolResults.find((item) => item && (item.name === 'collect_and_write_ctrip_hotel' || item.name === 'refresh_existing_ctrip_hotels')) || null
  );
}

export function hasWriteResult(writeResult) {
  if (Array.isArray(writeResult)) {
    return writeResult.some((item) => {
      if (!item) return false;
      if (item.operation) return item.operation !== 'skipped';
      return hasWriteResult(
        item.result ||
          item.writeResult ||
          (item.latestApplyResult && item.latestApplyResult.writeResult)
      );
    });
  }
  if (writeResult && writeResult.batchMode) {
    if (Number(writeResult.appliedCount || 0) > 0) {
      return true;
    }
    return (Array.isArray(writeResult.items) ? writeResult.items : []).some(
      (item) =>
        item &&
        hasWriteResult(
          item.writeResult || (item.latestApplyResult && item.latestApplyResult.writeResult)
        )
    );
  }
  return Boolean(writeResult && writeResult.operation !== 'skipped');
}

function countWriteOperations(writeResult) {
  if (Array.isArray(writeResult)) {
    return writeResult.reduce((sum, item) => {
      if (!item) return sum;
      if (item.operation) return item.operation === 'skipped' ? sum : sum + 1;
      return (
        sum +
        countWriteOperations(
          item.result ||
            item.writeResult ||
            (item.latestApplyResult && item.latestApplyResult.writeResult)
        )
      );
    }, 0);
  }

  if (writeResult && writeResult.batchMode) {
    return (Array.isArray(writeResult.items) ? writeResult.items : []).reduce((sum, item) => {
      if (!item || item.skipped) return sum;
      return (
        sum +
        countWriteOperations(
          item.writeResult || (item.latestApplyResult && item.latestApplyResult.writeResult)
        )
      );
    }, 0);
  }

  return writeResult && writeResult.operation && writeResult.operation !== 'skipped' ? 1 : 0;
}

function countEligibleHotels(value = {}) {
  if (Array.isArray(value.eligibleHotels)) return value.eligibleHotels.length;
  if (Number.isFinite(Number(value.eligibleCount))) return Math.max(0, Number(value.eligibleCount));
  if (Array.isArray(value.eligibleRoomTypes)) return value.eligibleRoomTypes.length;
  return 0;
}

function getBatchWriteStats(collectResult = {}) {
  const writeResult = collectResult.writeResult;
  if (!hasWriteResult(writeResult)) {
    return {
      hotelCount: 0,
      roomTypeCount: 0
    };
  }

  if (writeResult && writeResult.batchMode) {
    const appliedItems = Array.isArray(writeResult.items)
      ? writeResult.items.filter(
          (item) =>
            item &&
            !item.skipped &&
            hasWriteResult(
              item.writeResult || (item.latestApplyResult && item.latestApplyResult.writeResult)
            )
        )
      : [];
    const hotelCount = Number.isFinite(Number(writeResult.appliedCount))
      ? Math.max(0, Number(writeResult.appliedCount))
      : appliedItems.length;
    const roomTypeCount = appliedItems.reduce((sum, item) => {
      const latest = item.latestApplyResult || {};
      const itemResult = item.item || {};
      const fromItem = countEligibleHotels(itemResult);
      if (fromItem > 0) return sum + fromItem;
      const fromLatest = countEligibleHotels(latest);
      if (fromLatest > 0) return sum + fromLatest;
      return sum + countWriteOperations(item.writeResult);
    }, 0);

    return {
      hotelCount,
      roomTypeCount: roomTypeCount || (hotelCount > 0 ? countEligibleHotels(collectResult) : 0)
    };
  }

  if (Array.isArray(writeResult)) {
    const appliedItems = writeResult.filter(
      (item) => item && hasWriteResult(item.result || item.writeResult || item)
    );
    return {
      hotelCount: appliedItems.length,
      roomTypeCount: countWriteOperations(writeResult)
    };
  }

  return {
    hotelCount: 1,
    roomTypeCount: countEligibleHotels(collectResult) || countWriteOperations(writeResult)
  };
}

function formatCurrency(value) {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return `¥${number.toFixed(number % 1 === 0 ? 0 : 2)}`;
}

function getToolName(event = {}) {
  if (event.toolName) return event.toolName;
  const message = String(event.message || '');
  const match = message.match(/工具[:：]\s*([a-zA-Z0-9_:-]+)/);
  return match ? match[1] : '';
}

export function getReadableToolLabel(toolName) {
  if (!toolName) return '';
  return TOOL_LABELS[toolName] || `正在执行：${toolName}`;
}

function getEventStepKey(event = {}, taskKind = 'collect') {
  const type = String(event.type || '');
  const toolName = getToolName(event);
  const isRefresh = taskKind === 'refresh-data';

  if (type === 'task:start') return 'received';
  if (type === 'task:done') return 'done';
  if (type === 'task:error') return 'error';
  if (type === 'task:cancel') return 'cancel';
  if (isRefresh) {
    if (type === 'refresh:load-data') return 'load-data';
    if (type.startsWith('refresh:')) return 'refresh';
    if (type === 'edge:login-required' || type === 'edge:login-window' || type === 'edge:login-done')
      return 'login';
    if (toolName === 'open_visible_edge_login' || type.startsWith('edge:')) return 'edge';
    if (type.startsWith('write:') || type.startsWith('apply:')) return 'write';
    if (toolName === 'refresh_existing_ctrip_hotels' && type === 'tool:start') return 'received';
    if (toolName === 'refresh_existing_ctrip_hotels') return 'refresh';
    if (toolName === 'get_task_status') return 'received';
    return '';
  }
  if (toolName === 'list_templates' || toolName === 'get_settings') return 'template';
  if (type === 'edge:login-required' || type === 'edge:login-window' || type === 'edge:login-done')
    return 'login';
  if (toolName === 'open_visible_edge_login' || type.startsWith('edge:')) return 'edge';
  if (toolName === 'collect_and_write_ctrip_hotel' && type === 'tool:start') return 'received';
  if (type === 'scrape:retry') return 'scrape';
  if (type.startsWith('batch:') || type.startsWith('list:')) return 'scrape';
  if (toolName === 'collect_and_write_ctrip_hotel' || type.startsWith('scrape:')) return 'scrape';
  if (type.startsWith('template:')) return 'template';
  if (type.startsWith('transit:')) return 'transit';
  if (type.startsWith('write:') || type.startsWith('apply:')) return 'write';
  if (toolName === 'get_task_status') return 'received';
  return '';
}

function getReadableEventTitle(event = {}) {
  const type = String(event.type || '');
  const toolName = getToolName(event);

  if (type === 'task:start') return '已接收任务';
  if (type === 'task:done') return '采集任务完成';
  if (type === 'task:error') return '任务执行失败';
  if (type === 'task:cancel') return '任务已取消';
  if (type === 'refresh:load-data') return '正在读取当前宾馆数据';
  if (type === 'refresh:item-start') return event.message || '正在更新房型与价格';
  if (type === 'refresh:item-done') return event.message || '房型与价格更新完成';
  if (type === 'refresh:item-skipped') return event.message || '跳过该宾馆';
  if (type === 'refresh:write') return '等待写入更新结果';
  if (type === 'refresh:summary') return '结果汇总';
  if (type === 'edge:login-required') return event.message || '需要登录携程后继续采集';
  if (type === 'edge:login-window') return event.message || '已打开 Edge 登录窗口，等待你完成登录';
  if (type === 'edge:login-done') return event.message || '携程登录窗口已关闭，继续采集';
  if (type === 'scrape:retry') return event.message || '正在使用新的携程登录态重新采集酒店页面';
  if (type.startsWith('batch:') || type.startsWith('list:'))
    return event.message || '正在处理批量采集任务';
  if (toolName) {
    const label = getReadableToolLabel(toolName);
    if (toolName === 'collect_and_write_ctrip_hotel' && type === 'tool:start')
      return '已接收采集任务';
    if (toolName === 'collect_and_write_ctrip_hotel') return '正在采集携程酒店页面';
    if (toolName === 'refresh_existing_ctrip_hotels' && type === 'tool:start')
      return '已接收更新任务';
    if (toolName === 'refresh_existing_ctrip_hotels') return '正在更新已有宾馆数据';
    if (toolName === 'list_templates' || toolName === 'get_settings')
      return '正在读取模板与比较助手设置';
    return label.startsWith('正在') ? label : `正在${label}`;
  }

  return String(event.message || event.type || '正在执行任务')
    .replace(/^AI\s*正在调用工具[:：]\s*/, '正在执行：')
    .replace(/^AI\s*采集任务/, '采集任务');
}

function normalizeEvent(event = {}, taskKind = 'collect') {
  return {
    key: getEventStepKey(event, taskKind),
    time: event.at || '',
    title: getReadableEventTitle(event),
    detail: event.details && typeof event.details === 'object' ? event.details : null,
    toolName: getToolName(event),
    raw: event
  };
}

function getEventDetailText(event = {}) {
  const detail = event && event.detail;
  if (!detail || typeof detail !== 'object') return '';
  return String(detail.instruction || detail.reason || detail.action || '').trim();
}

function getLastTaskError(events = [], task = {}) {
  if (task.error) return task.error;
  const errorEvent = events
    .slice()
    .reverse()
    .find((event) => event.type === 'task:error' || event.type === 'task:cancel');
  return errorEvent ? errorEvent.message || errorEvent.type : '';
}

function findStepEvent(normalizedEvents, key) {
  return (
    normalizedEvents
      .slice()
      .reverse()
      .find((event) => event.key === key) || null
  );
}

function parseBatchProgressEvent(event = {}) {
  const type = String(event.type || '');
  const detail = event.details && typeof event.details === 'object' ? event.details : {};
  const message = String(event.message || '');
  const summary = String(detail.summary || '');
  const parsed = {
    type,
    index: Number(detail.index || detail.itemIndex || detail.currentIndex || 0),
    total: Number(detail.total || detail.totalCount || detail.itemCount || detail.hotelCount || 0)
  };

  const startMatch = message.match(/第\s*(\d+)\s*\/\s*(\d+)/);
  if (startMatch) {
    parsed.index = Number(startMatch[1]);
    parsed.total = Number(startMatch[2]);
  }

  const doneMatch = message.match(/第\s*(\d+)\s*家酒店采集(?:完成|失败)/);
  if (!parsed.index && doneMatch) {
    parsed.index = Number(doneMatch[1]);
  }

  if (!parsed.total) {
    const summaryMatch = summary.match(/展开酒店\s*=\s*(\d+)/);
    if (summaryMatch) {
      parsed.total = Number(summaryMatch[1]);
    }
  }

  return parsed;
}

function buildProgressStats(events = []) {
  const itemStatus = new Map();
  let total = 0;

  for (const event of events || []) {
    const parsed = parseBatchProgressEvent(event);
    if (!parsed.type.startsWith('batch:')) {
      continue;
    }
    if (Number.isFinite(parsed.total) && parsed.total > total) {
      total = parsed.total;
    }
    if (!Number.isFinite(parsed.index) || parsed.index <= 0) {
      continue;
    }
    if (parsed.type === 'batch:item-start') {
      itemStatus.set(parsed.index, 'running');
    } else if (parsed.type === 'batch:item-done' || parsed.type === 'batch:item-error') {
      itemStatus.set(parsed.index, 'completed');
    }
  }

  if (total <= 0) {
    return null;
  }

  const completed = [...itemStatus.values()].filter((status) => status === 'completed').length;
  const running = [...itemStatus.values()].filter((status) => status === 'running').length;
  const pending = Math.max(0, total - completed - running);

  return {
    total,
    completed,
    running,
    pending
  };
}

function getStepDefinitions(normalizedEvents = [], taskKind = 'collect') {
  if (taskKind === 'refresh-data') {
    const hasLoginStep = normalizedEvents.some((event) => event.key === 'login');
    const hasCancelStep = normalizedEvents.some((event) => event.key === 'cancel');
    if (!hasLoginStep && !hasCancelStep) return REFRESH_STEP_DEFINITIONS;

    const definitions = [...REFRESH_STEP_DEFINITIONS];
    if (hasLoginStep) {
      const edgeIndex = definitions.findIndex((step) => step.key === 'edge');
      definitions.splice(edgeIndex < 0 ? 2 : edgeIndex, 0, LOGIN_STEP_DEFINITION);
    }
    if (hasCancelStep) {
      definitions.push(CANCEL_STEP_DEFINITION);
    }
    return definitions;
  }

  const hasLoginStep = normalizedEvents.some((event) => event.key === 'login');
  const hasCancelStep = normalizedEvents.some((event) => event.key === 'cancel');
  if (!hasLoginStep && !hasCancelStep) return BASE_STEP_DEFINITIONS;

  const definitions = [...BASE_STEP_DEFINITIONS];
  if (hasLoginStep) {
    const scrapeIndex = definitions.findIndex((step) => step.key === 'scrape');
    definitions.splice(scrapeIndex < 0 ? 3 : scrapeIndex, 0, LOGIN_STEP_DEFINITION);
  }
  if (hasCancelStep) {
    definitions.push(CANCEL_STEP_DEFINITION);
  }
  return definitions;
}

function buildTaskSteps(task, events, status) {
  const taskKind = task.taskKind || 'collect';
  const normalizedEvents = (events || []).map((event) => normalizeEvent(event, taskKind)).filter((event) => event.title);
  const stepDefinitions = getStepDefinitions(normalizedEvents, taskKind);
  const lastProgressEvent = normalizedEvents
    .slice()
    .reverse()
    .find(
      (event) =>
        event.key && event.key !== 'done' && event.key !== 'error' && event.key !== 'cancel'
    );
  const currentKey = status === 'running' && lastProgressEvent ? lastProgressEvent.key : '';
  const currentIndex = stepDefinitions.findIndex((step) => step.key === currentKey);
  const errorKey = status === 'error' && lastProgressEvent ? lastProgressEvent.key : 'scrape';

  return stepDefinitions.map((definition, index) => {
    const matchedEvent = findStepEvent(normalizedEvents, definition.key);
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

function getTaskCollectResult(task = {}) {
  return (
    task.collectResult ||
    (task.result && task.result.collectResult) ||
    (getCollectToolResult(task.result || {}) || {}).result ||
    {}
  );
}

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
    batchSummary && batchSummary.expandedHotelCount
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

export function normalizeTaskState({
  task = {},
  events = [],
  inProgress = false
} = {}) {
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
  const collectResult = getTaskCollectResult(task);
  const taskInfo = {
    taskId:
      task.taskId || (task.result && task.result.taskStatus && task.result.taskStatus.id) || '',
    templateName: task.templateLabel || formatAiTemplateLabel(task.template || {}) || '暂无',
    hotelUrl: task.hotelUrl || '',
    startTime: task.startedAt || '',
    endTime: task.endedAt || ''
  };

  return {
    status,
    taskInfo,
    steps,
    progressStats: buildProgressStats(events),
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
    <div class="task-progress-stats" aria-label="批量采集进度统计">
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
  const button = $('aiStartTaskBtn');
  const templateSelect = $('aiTemplateSelect');
  const input = $('aiHotelUrlInput');

  if (templateSelect) templateSelect.disabled = false;
  if (input) input.disabled = false;
  if (!button) return;

  button.disabled = false;
  button.classList.remove('is-loading');
  button.innerHTML = '加入队列';
}

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
  const input = $('aiHotelUrlInput');
  const count = input ? input.value.length : 0;
  const maxLength = input && Number(input.maxLength) > 0 ? Number(input.maxLength) : 4000;
  setText('aiInputCount', `${count} / ${maxLength}`);
}
