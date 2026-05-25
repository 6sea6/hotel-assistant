import { escapeHtml } from './dom-helpers.js';
import { formatAiTime } from './ai-task-formatters.js';
import { getElapsedText } from './ai-task-state.js';

/**
 * @typedef {import('../../shared/contracts').AiTaskQueueItem} AiTaskQueueItem
 * @typedef {import('./ai-task-state.js').AiTaskNormalizedState} AiTaskNormalizedState
 * @typedef {import('./ai-task-state.js').AiTaskStepViewModel} AiTaskStepViewModel
 */
export function renderStatusBadge(status, label) {
  return `<span class="task-status-badge task-status-${escapeHtml(status)}">${escapeHtml(label)}</span>`;
}

export function getQueueStatusLabel(task = {}) {
  if (task.status === 'running') return '运行中';
  if (task.status === 'waiting') return '等待中';
  if (task.status === 'completed') return '已完成';
  if (task.status === 'cancelled') return '已取消';
  if (task.status === 'failed') return '失败';
  return '等待中';
}

export function getQueueTaskTitle(task = {}) {
  return task.title || task.templateName || task.templateLabel || '未命名任务';
}

/**
 * @param {AiTaskQueueItem} [task]
 * @param {number} [fallbackIndex]
 * @returns {string}
 */
export function renderQueueTaskItem(task = {}, fallbackIndex = 0) {
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
export function renderQueueGroup(label, tasks, selectedId, emptyText = '') {
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
export function renderTaskQueue(queue = [], options = {}) {
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

export function renderTaskMeta(taskState) {
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

export function renderTaskTimeline(steps, options = {}) {
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

export function renderProgressIcon(type) {
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

export function renderProgressStats(stats, taskKind = 'collect') {
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

export function renderIdleView() {
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

export function renderRunningView(taskState, taskKind = 'collect') {
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

export function renderSummaryCards(taskState, variant, taskKind = 'collect') {
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

export function renderSuccessView(taskState, taskKind = 'collect') {
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

export function renderErrorView(taskState, taskKind = 'collect') {
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

export function renderCancelledView(taskState, taskKind = 'collect') {
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
