import { $, escapeHtml, setText } from './dom-helpers.js';

const TOOL_LABELS = {
  get_task_status: '获取任务状态',
  list_templates: '读取模板列表',
  get_settings: '读取比较助手设置',
  collect_and_write_ctrip_hotel: '采集携程酒店页面',
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

const LOGIN_STEP_DEFINITION = {
  key: 'login',
  title: '等待携程登录确认',
  doneTitle: '携程登录态已确认'
};

const REVIEW_PHASES = [
  '正在读取复核数据包',
  '正在检查酒店基础信息',
  '正在分析房型候选',
  '正在核对价格与入住人数',
  '正在生成修正建议'
];

const REVIEW_SOURCE_LABELS = {
  finalHotels: '最终结果',
  eligibleRoomTypes: '合格房型',
  rejectedRoomTypes: '排除房型',
  rawRoomCandidates: '原始房型候选',
  normalizeLogs: '标准化记录',
  selectionLogs: '筛选记录',
  finalHotelFieldLogs: '最终字段来源',
  pageSnapshotSummary: '页面摘要'
};

const REVIEW_FIELD_LABELS = {
  room_area: '房型面积',
  roomArea: '房型面积',
  notes: '备注',
  roomName: '房型名称',
  normalizedRoomName: '标准化房型名称',
  rawRoomName: '原始房型名称',
  price: '价格',
  totalPrice: '总价',
  rawPriceText: '原始价格文本',
  cancelPolicy: '取消规则',
  cancelPolicyType: '取消规则类型',
  occupancy: '入住人数',
  bedText: '床型',
  area: '面积',
  windowStatus: '窗户信息',
  source: '来源',
  matchScore: '匹配分数',
  matchReason: '匹配原因',
  rejectReason: '排除原因',
  rejectReasonCode: '排除原因代码',
  rawCancelPolicyText: '原始取消规则',
  rawOccupancyText: '原始入住人数',
  rawBedText: '原始床型',
  rawAreaText: '原始面积',
  ratePlan: '价格计划',
  sourceField: '来源字段',
  compactRawText: '原始摘要',
  field: '字段',
  rawValue: '原始值',
  normalizedValue: '标准化值',
  matchedTemplate: '匹配模板',
  confidence: '置信度',
  method: '处理方式',
  action: '处理动作',
  score: '分数',
  reason: '原因',
  reasonCode: '原因代码',
  evidenceFields: '证据字段',
  roomCardCount: '页面房型卡片数量',
  apiRoomCount: '接口房型数量',
  rawCandidateCount: '原始候选数量',
  eligibleCount: '合格数量',
  rejectedCount: '排除数量',
  hasPriceArea: '是否存在价格区域',
  hasLockedPriceHint: '是否存在登录价提示',
  suspectedLoginPrice: '疑似登录价',
  expandedAllRooms: '是否展开全部房型',
  apiError: '接口异常',
  sourceSummary: '来源摘要'
};

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
    template.check_in_date && template.check_out_date ? `${template.check_in_date} 至 ${template.check_out_date}` : '',
    template.room_count ? `${template.room_count}人` : ''
  ].filter(Boolean);
  return labelParts.join(' · ');
}

export function extractCtripUrl(text) {
  const match = String(text || '').match(/https?:\/\/[^\s"'<>]+/i);
  return match ? match[0].trim() : '';
}

export function getCollectToolResult(result = {}) {
  if (!Array.isArray(result.toolResults)) return null;
  return result.toolResults.find((item) => item && item.name === 'collect_and_write_ctrip_hotel') || null;
}

export function hasWriteResult(writeResult) {
  if (Array.isArray(writeResult)) {
    return writeResult.some((item) => item && item.operation !== 'skipped');
  }
  return Boolean(writeResult && writeResult.operation !== 'skipped');
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

function localizeReviewText(value) {
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return '';
  [...Object.entries(REVIEW_SOURCE_LABELS), ...Object.entries(REVIEW_FIELD_LABELS)].forEach(([key, label]) => {
    text = text.replace(new RegExp(`\\b${key}\\b`, 'g'), label);
  });
  return text.replace(/\breview_input\b/g, '复核数据包');
}

function getReviewFieldLabel(field) {
  const text = String(field || '');
  return REVIEW_FIELD_LABELS[text] || localizeReviewText(text || '字段');
}

function getEventStepKey(event = {}) {
  const type = String(event.type || '');
  const toolName = getToolName(event);

  if (type === 'task:start') return 'received';
  if (type === 'task:done') return 'done';
  if (type === 'task:error' || type === 'task:cancel') return 'error';
  if (toolName === 'list_templates' || toolName === 'get_settings') return 'template';
  if (type === 'edge:login-required' || type === 'edge:login-window' || type === 'edge:login-done') return 'login';
  if (toolName === 'open_visible_edge_login' || type.startsWith('edge:')) return 'edge';
  if (toolName === 'collect_and_write_ctrip_hotel' && type === 'tool:start') return 'received';
  if (type === 'scrape:retry') return 'scrape';
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
  if (type === 'edge:login-required') return event.message || '需要登录携程后继续采集';
  if (type === 'edge:login-window') return event.message || '已打开 Edge 登录窗口，等待你完成登录';
  if (type === 'edge:login-done') return event.message || '携程登录窗口已关闭，继续采集';
  if (type === 'scrape:retry') return event.message || '正在使用新的携程登录态重新采集酒店页面';
  if (toolName) {
    const label = getReadableToolLabel(toolName);
    if (toolName === 'collect_and_write_ctrip_hotel' && type === 'tool:start') return '已接收采集任务';
    if (toolName === 'collect_and_write_ctrip_hotel') return '正在采集携程酒店页面';
    if (toolName === 'list_templates' || toolName === 'get_settings') return '正在读取模板与比较助手设置';
    return label.startsWith('正在') ? label : `正在${label}`;
  }

  return String(event.message || event.type || '正在执行任务')
    .replace(/^AI\s*正在调用工具[:：]\s*/, '正在执行：')
    .replace(/^AI\s*采集任务/, '采集任务');
}

function normalizeEvent(event = {}) {
  return {
    key: getEventStepKey(event),
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
  const errorEvent = events.slice().reverse().find((event) => event.type === 'task:error' || event.type === 'task:cancel');
  return errorEvent ? (errorEvent.message || errorEvent.type) : '';
}

function findStepEvent(normalizedEvents, key) {
  return normalizedEvents.slice().reverse().find((event) => event.key === key) || null;
}

function getStepDefinitions(normalizedEvents = []) {
  const hasLoginStep = normalizedEvents.some((event) => event.key === 'login');
  if (!hasLoginStep) return BASE_STEP_DEFINITIONS;

  const definitions = [...BASE_STEP_DEFINITIONS];
  const scrapeIndex = definitions.findIndex((step) => step.key === 'scrape');
  definitions.splice(scrapeIndex < 0 ? 3 : scrapeIndex, 0, LOGIN_STEP_DEFINITION);
  return definitions;
}

function buildTaskSteps(task, events, status) {
  const normalizedEvents = (events || []).map(normalizeEvent).filter((event) => event.title);
  const stepDefinitions = getStepDefinitions(normalizedEvents);
  const lastProgressEvent = normalizedEvents.slice().reverse()
    .find((event) => event.key && event.key !== 'done' && event.key !== 'error');
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
      time: matchedEvent ? matchedEvent.time : (definition.key === 'received' ? task.startedAt : ''),
      title: status === 'success' ? definition.doneTitle : (matchedEvent ? matchedEvent.title : definition.title),
      detail: matchedEvent && matchedEvent.toolName ? getReadableToolLabel(matchedEvent.toolName) : getEventDetailText(matchedEvent),
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
  const end = status === 'running' ? now : (getTimeValue(taskInfo.endTime) || now);
  return formatDuration(end - start);
}

function updateElapsedTimerText() {
  const timer = $('aiTaskElapsedTime');
  if (!timer) return;

  timer.textContent = getElapsedText({
    startTime: timer.dataset.startTime,
    endTime: timer.dataset.endTime
  }, timer.dataset.status || 'idle');
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

function buildTaskResult(task = {}) {
  const collectResult = task.collectResult || (getCollectToolResult(task.result || {}) || {}).result || {};
  const eligibleCount = Number(collectResult.eligibleCount || 0);
  const matchedRooms = Array.isArray(collectResult.eligibleRoomTypes) ? collectResult.eligibleRoomTypes : [];
  const eligibleHotels = Array.isArray(collectResult.eligibleHotels) ? collectResult.eligibleHotels : [];
  const firstRoom = matchedRooms[0] || {};
  const firstHotel = eligibleHotels[0] || {};
  const totalPrice = collectResult.totalPrice ?? firstRoom.totalPrice ?? firstRoom.total_price ?? firstHotel.total_price ?? null;
  const dailyPrice = firstRoom.dailyPrice ?? firstRoom.daily_price ?? firstHotel.daily_price ?? null;
  const reasons = [
    collectResult.writeSkipReason,
    collectResult.error
  ].filter(Boolean);
  const wroteResult = hasWriteResult(collectResult.writeResult);

  if (reasons.length === 0 && eligibleCount <= 0) {
    reasons.push('暂无详细原因，请查看采集详情。');
  }

  return {
    hasMatchedRoom: eligibleCount > 0 && !collectResult.writeSkipped,
    hotelName: collectResult.hotelName || '暂无',
    eligibleCount: Number.isFinite(eligibleCount) ? eligibleCount : 0,
    priceText: [formatCurrency(dailyPrice) ? `${formatCurrency(dailyPrice)} / 晚` : '', formatCurrency(totalPrice) ? `${formatCurrency(totalPrice)} 总价` : '']
      .filter(Boolean)
      .join('，') || '暂无',
    matchedRooms: matchedRooms.length ? matchedRooms : eligibleHotels.map((hotel) => ({
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
      : '采集完成，结果已汇总。',
    raw: collectResult
  };
}

function buildTaskError(task = {}, events = []) {
  const message = getLastTaskError(events, task) || '系统在采集携程酒店页面时发生异常。';
  return {
    message,
    reason: message,
    suggestions: [
      '检查链接是否为携程酒店详情页。',
      '确认携程登录态可用，必要时重新登录。',
      '稍后重新执行任务。'
    ]
  };
}

export function normalizeTaskState({ task = {}, events = [], inProgress = false, review = {} } = {}) {
  const submitted = Boolean(task.submitted || task.hotelUrl || task.result || task.error || events.length);
  let status = 'idle';

  if (task.error) {
    status = 'error';
  } else if (inProgress) {
    status = 'running';
  } else if (submitted && task.result) {
    status = 'success';
  } else if (submitted && events.some((event) => event.type === 'task:error' || event.type === 'task:cancel')) {
    status = 'error';
  }

  const steps = buildTaskSteps(task, events, status);
  const taskInfo = {
    taskId: task.taskId || (task.result && task.result.taskStatus && task.result.taskStatus.id) || '',
    templateName: task.templateLabel || formatAiTemplateLabel(task.template || {}) || '暂无',
    hotelUrl: task.hotelUrl || '',
    startTime: task.startedAt || '',
    endTime: task.endedAt || ''
  };

  return {
    status,
    taskInfo,
    steps,
    result: buildTaskResult(task),
    error: buildTaskError(task, events),
    review,
    canReview: Boolean(
      taskInfo.taskId
      && (
        task.collectResult && task.collectResult.reviewInputAvailable
        || task.result && task.result.taskStatus && task.result.taskStatus.reviewInputAvailable
      )
    )
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
  if (task.status === 'failed') return task.errorMessage ? '解析错误' : '失败';
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
      <button class="task-queue-main" type="button" onclick="selectAiQueueTask('${escapeHtml(task.id || '')}')">
        <span class="task-queue-index">${escapeHtml(displayIndex)}</span>
        <span class="task-queue-title">${escapeHtml(getQueueTaskTitle(task))}</span>
        <span class="task-queue-badge">${escapeHtml(statusLabel)}</span>
      </button>
      ${canShowMenu ? `
        <details class="task-queue-menu">
          <summary title="更多操作">⋯</summary>
          <div class="task-queue-menu-popover">
            <button type="button" onclick="retryAiQueueTask('${escapeHtml(task.id || '')}')">重新加入队列</button>
            <button type="button" class="is-danger" onclick="removeAiQueueTask('${escapeHtml(task.id || '')}')">删除记录</button>
          </div>
        </details>
      ` : ''}
    </div>
  `;
}

function renderQueueGroup(label, tasks, selectedId, emptyText = '') {
  const rows = (tasks || []).map((task, index) => renderQueueTaskItem({ ...task, selectedId }, index)).join('');
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
          <span class="task-card-eyebrow">TASK QUEUE</span>
          <h2>任务队列</h2>
        </div>
        <div class="task-queue-header-actions">
          <button class="task-secondary-button task-queue-clear" type="button" onclick="clearAiTaskQueue()">清空队列</button>
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
      ${steps.map((step) => `
        <div class="task-timeline-row task-step-${escapeHtml(step.status)}">
          <div class="task-step-time">${escapeHtml(formatAiTime(step.time) || '--:--:--')}</div>
          <div class="task-step-marker" aria-hidden="true"></div>
          <div class="task-step-body">
            <strong>${escapeHtml(step.title)}</strong>
            ${step.detail ? `<span>${escapeHtml(step.detail)}</span>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderReviewList(items = [], emptyText = '暂无') {
  const values = (Array.isArray(items) ? items : []).filter(Boolean);
  if (!values.length) {
    return `<p class="ai-review-muted">${escapeHtml(emptyText)}</p>`;
  }
  return `
    <ul class="ai-review-list">
      ${values.map((item) => `<li>${escapeHtml(localizeReviewText(item))}</li>`).join('')}
    </ul>
  `;
}

function renderReviewDiffs(diffs = []) {
  const rows = (Array.isArray(diffs) ? diffs : []).filter(Boolean);
  if (!rows.length) {
    return '<p class="ai-review-muted">暂无差异。</p>';
  }
  return `
    <div class="ai-review-diff-list">
      ${rows.map((diff) => `
        <div class="ai-review-diff-item">
          <strong>${escapeHtml(getReviewFieldLabel(diff.field || '字段'))}</strong>
          <span>${escapeHtml(localizeReviewText(String(diff.before ?? '')))} → ${escapeHtml(localizeReviewText(String(diff.after ?? '')))}</span>
          ${diff.reason ? `<small>${escapeHtml(localizeReviewText(diff.reason))}</small>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

function renderReviewLoading() {
  return `
    <div class="ai-review-loading">
      <div class="review-loading-main">
        <strong>
          正在复核本次采集证据
          <span class="thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span>
        </strong>
        <div class="review-stage-rotator" aria-live="polite">
          ${REVIEW_PHASES.map((phase, index) => `<span class="review-stage-${index + 1}">${escapeHtml(phase)}</span>`).join('')}
        </div>
      </div>
    </div>
  `;
}

function renderReviewFailed(errorMessage) {
  return `
    <div class="ai-review-failed-state result-fade-in">
      <strong>分析失败</strong>
      <span>${escapeHtml(localizeReviewText(errorMessage || '复核请求没有完成，请检查接口配置或稍后重试。'))}</span>
      <ul class="ai-review-list">
        <li>确认接口配置可用。</li>
        <li>保留当前任务结果后重新点击开始分析。</li>
        <li>如果多次失败，请查看设置中的接口状态。</li>
      </ul>
    </div>
  `;
}

function renderReviewOutput(review = {}) {
  if (review.inProgress) {
    return renderReviewLoading();
  }

  if (review.error) {
    return renderReviewFailed(review.error);
  }

  const result = review.result;
  if (!result) {
    return `
      <div class="ai-review-empty-output">
        <strong>等待分析</strong>
        <span>在下方说明你认为脚本哪里采错了，例如“漏掉三人房”“价格不对”“过滤掉了可住房型”。</span>
      </div>
    `;
  }

  return `
    <div class="ai-review-status-row result-fade-in">
      <strong>${escapeHtml(result.canApply ? '可预览差异后覆盖写入' : '证据不足，不能自动覆盖写入')}</strong>
      <span>${escapeHtml(localizeReviewText(result.summary || ''))}</span>
    </div>
    <div class="ai-review-section result-fade-in result-fade-delay-1">
      <h3>发现的问题</h3>
      ${renderReviewList(result.issues, '未发现明确问题。')}
    </div>
    <div class="ai-review-section result-fade-in result-fade-delay-2">
      <h3>差异预览</h3>
      ${renderReviewDiffs(result.diffs)}
    </div>
    ${result.canApply ? '' : `
      <div class="ai-review-section result-fade-in result-fade-delay-4">
        <h3>缺少证据</h3>
        ${renderReviewList(result.missingEvidence, '暂无。')}
      </div>
    `}
  `;
}

function renderReviewReplaceView(taskState) {
  const review = taskState.review || {};
  const resultClass = review.inProgress
    ? ' analyzing-card'
    : review.error
      ? ' ai-review-failed'
      : review.result
    ? (review.result.canApply ? ' ai-review-can-apply' : ' ai-review-cannot-apply')
    : '';
  const applyDisabled = !review.result || !review.result.canApply || !review.reviewId || review.applyInProgress;
  return `
    <section class="task-review-console task-review-replace-view" aria-label="AI分析重填">
      <div class="task-review-header">
        <div>
          <span class="task-card-eyebrow">AI REVIEW</span>
          <h3>AI分析重填</h3>
        </div>
        <button class="task-secondary-button" type="button" onclick="closeAiReviewPanel()">返回结果</button>
      </div>
      <div class="task-review-context">
        <span>模板：${escapeHtml(taskState.taskInfo.templateName || '暂无')}</span>
        <span>状态：${escapeHtml(taskState.status === 'error' ? '任务失败后复核' : '采集完成后复核')}</span>
      </div>
      <div id="aiReviewResult" class="ai-review-result${resultClass}">
        ${renderReviewOutput(review)}
      </div>
      <div class="task-review-input-area">
        <label class="task-review-concern-field" for="aiReviewConcernInput">
          <span>哪里不对</span>
          <textarea id="aiReviewConcernInput" class="input" rows="2" placeholder="例如：脚本选错房型、漏掉三人房、价格不对、过滤原因不合理">${escapeHtml(review.userConcern || '')}</textarea>
        </label>
        <div class="task-review-actions">
          <button id="aiReviewAnalyzeBtn" class="task-primary-inline-button review-analyze-button${review.inProgress ? ' is-loading' : ''}" type="button" onclick="analyzeAiCollection()" ${review.inProgress ? 'disabled' : ''}>
            ${review.inProgress ? '<span class="task-button-spinner" aria-hidden="true"></span>正在分析' : '开始分析'}
          </button>
          <button id="aiReviewApplyBtn" class="task-secondary-button review-apply-button${!applyDisabled ? ' is-review-ready' : ''}" type="button" onclick="applyAiCollectionReview()" ${applyDisabled ? 'disabled' : ''}>
            ${review.applyInProgress ? '正在覆盖写入...' : '确认覆盖写入'}
          </button>
        </div>
      </div>
    </section>
  `;
}

function renderIdleView() {
  return `
    <div class="task-empty-state">
      <div class="task-empty-icon" aria-hidden="true">⌁</div>
      <h3>等待开始任务</h3>
      <p>请选择模板，并粘贴携程酒店链接，系统将自动采集酒店房型、价格、交通和比较信息。</p>
      <div class="task-empty-tips">
        <span>支持携程酒店详情页链接</span>
        <span>自动采集房型、价格、交通等信息</span>
        <span>结果可导出，便于对比与分析</span>
      </div>
      <div class="task-empty-dropzone">任务执行过程与结果将显示在此处</div>
    </div>
  `;
}

function renderRunningView(taskState) {
  return `
    <div class="task-running-view">
      <div class="task-result-hero task-result-hero-running">
        <span aria-hidden="true">…</span>
        <div>
          <h3>正在采集</h3>
          <p>正在采集房型与价格信息……</p>
        </div>
      </div>
      ${renderTaskMeta(taskState)}
      <section class="task-panel-section">
        <div class="task-section-heading">
          <h3>执行进度</h3>
          ${renderStatusBadge('running', '执行中')}
        </div>
        ${renderTaskTimeline(taskState.steps)}
      </section>
      <div class="task-panel-actions">
        <button class="task-secondary-button" type="button" onclick="cancelAiTask()">取消当前任务</button>
      </div>
    </div>
  `;
}

function renderSummaryCards(taskState, variant) {
  const { taskInfo, result, error } = taskState;
  const isError = variant === 'error';
  const reasonItems = isError
    ? [error.reason || error.message, ...error.suggestions].filter(Boolean)
    : result.reasons;
  const reasonList = reasonItems.length
    ? `<ul class="task-reason-list">
        ${reasonItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
      </ul>`
    : '';

  return `
    <div class="task-result-grid">
      <section class="task-result-card">
        <h3>任务摘要</h3>
        <dl>
          <div><dt>模板</dt><dd>${escapeHtml(taskInfo.templateName || '暂无')}</dd></div>
          <div><dt>开始时间</dt><dd>${escapeHtml(formatAiTime(taskInfo.startTime) || '暂无')}</dd></div>
          <div><dt>${isError ? '失败时间' : '完成时间'}</dt><dd>${escapeHtml(formatAiTime(taskInfo.endTime) || '暂无')}</dd></div>
          <div><dt>执行状态</dt><dd>${escapeHtml(isError ? '执行失败' : '已完成')}</dd></div>
        </dl>
      </section>

      <section class="task-result-card">
        <h3>执行记录</h3>
        ${renderTaskTimeline(taskState.steps, { compact: true })}
      </section>

      <section class="task-result-card">
        <h3>${isError ? '错误详情' : '结果分析'}</h3>
        ${isError ? `
          <dl>
            <div><dt>错误原因</dt><dd>${escapeHtml(error.message || '暂无详细原因')}</dd></div>
            <div><dt>建议操作</dt><dd>检查链接、刷新登录态、重新执行任务。</dd></div>
          </dl>
        ` : `
          <dl>
            <div><dt>模板规则</dt><dd>${escapeHtml(taskInfo.templateName || '暂无')}</dd></div>
            <div><dt>实际采集结果</dt><dd>${escapeHtml(result.hotelName)}，可用房型 ${escapeHtml(String(result.eligibleCount))} 个，价格 ${escapeHtml(result.priceText)}</dd></div>
            <div><dt>写入状态</dt><dd>${escapeHtml(result.writeBackStatus)}</dd></div>
          </dl>
        `}
        ${reasonList}
      </section>
    </div>
  `;
}

function renderSuccessView(taskState) {
  const title = taskState.result.hasMatchedRoom
    ? '采集完成，已找到符合条件的房型'
    : '采集完成，但没有符合条件的房型';

  return `
    <div class="task-finished-view">
      <div class="task-result-hero task-result-hero-success">
        <span aria-hidden="true">✓</span>
        <div>
          <h3>采集完成</h3>
          <p>${escapeHtml(title)}</p>
        </div>
      </div>
      ${renderSummaryCards(taskState, 'success')}
      <div class="task-panel-actions">
        ${taskState.canReview ? '<button class="task-secondary-button" type="button" onclick="openAiReviewPanel()">AI分析重填</button>' : ''}
        <button class="task-primary-inline-button" type="button" onclick="rerunCurrentAiTask()">重新采集</button>
      </div>
    </div>
  `;
}

function renderErrorView(taskState) {
  return `
    <div class="task-finished-view">
      <div class="task-result-hero task-result-hero-error">
        <span aria-hidden="true">!</span>
        <div>
          <h3>任务执行失败</h3>
          <p>系统在采集携程酒店页面时发生异常，请检查链接或稍后重试。</p>
        </div>
      </div>
      ${renderSummaryCards(taskState, 'error')}
      <div class="task-panel-actions">
        ${taskState.canReview ? '<button class="task-secondary-button" type="button" onclick="openAiReviewPanel()">AI分析重填</button>' : ''}
        <button class="task-primary-inline-button" type="button" onclick="rerunCurrentAiTask()">重新尝试</button>
        <button class="task-secondary-button" type="button" onclick="focusAiTaskStartBar()">返回编辑</button>
      </div>
    </div>
  `;
}

function updateStartBar(taskState) {
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

  const taskState = normalizeTaskState({
    task: state.aiTaskConsole || {},
    events: state.aiTaskEvents || [],
    inProgress: state.aiTaskInProgress,
    review: state.aiReview || {}
  });

  const shouldShowReview = taskState.canReview && taskState.review && taskState.review.isOpen;
  const viewHtml = shouldShowReview
    ? renderReviewReplaceView(taskState)
    : {
        idle: renderIdleView,
        running: renderRunningView,
        success: renderSuccessView,
        error: renderErrorView
      }[taskState.status](taskState);

  panel.innerHTML = viewHtml;
  const queuePanel = $('aiTaskQueuePanel');
  if (queuePanel) {
    queuePanel.innerHTML = renderTaskQueue(state.aiTaskQueue || [], {
      selectedId: state.aiSelectedQueueTaskId || ''
    });
  }
  updateStartBar(taskState);
  syncElapsedTimer(taskState.status);
  return taskState;
}

export function updateAiInputCount() {
  const input = $('aiHotelUrlInput');
  const count = input ? input.value.length : 0;
  setText('aiInputCount', `${count} / 2000`);
}
