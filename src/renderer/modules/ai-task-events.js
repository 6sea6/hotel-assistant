import { getReadableToolLabel } from './ai-task-formatters.js';

/**
 * Pure event and step mapping helpers for the AI task console.
 *
 * @typedef {import('../../shared/contracts').AiTaskConsoleState} AiTaskConsoleState
 * @typedef {import('../../shared/contracts').AiTaskEvent} AiTaskEvent
 * @typedef {import('../../shared/contracts').AiTaskKind} AiTaskKind
 *
 * @typedef {object} AiStepDefinition
 * @property {string} key
 * @property {string} title
 * @property {string} doneTitle
 *
 * @typedef {object} AiNormalizedEvent
 * @property {string} key
 * @property {string} time
 * @property {string} title
 * @property {Record<string, unknown>|null} detail
 * @property {string} toolName
 * @property {AiTaskEvent} raw
 */

/** @type {AiStepDefinition[]} */
export const BASE_STEP_DEFINITIONS = [
  { key: 'received', title: '已接收任务', doneTitle: '任务创建' },
  { key: 'template', title: '正在读取模板与比较助手设置', doneTitle: '模板解析' },
  { key: 'edge', title: '正在准备 Edge 登录态', doneTitle: '准备 Edge 登录态' },
  { key: 'scrape', title: '正在采集携程酒店页面', doneTitle: '房型采集与筛选' },
  { key: 'transit', title: '正在计算交通与地铁信息', doneTitle: '交通与地铁计算' },
  { key: 'write', title: '等待回写采集结果', doneTitle: '结果汇总' }
];

/** @type {AiStepDefinition[]} */
export const REFRESH_STEP_DEFINITIONS = [
  { key: 'received', title: '已接收任务', doneTitle: '任务创建' },
  { key: 'load-data', title: '正在读取当前宾馆数据', doneTitle: '读取当前宾馆数据' },
  { key: 'edge', title: '正在准备 Edge 登录态', doneTitle: '准备 Edge 登录态' },
  { key: 'refresh', title: '正在更新房型与价格', doneTitle: '房型与价格更新' },
  { key: 'write', title: '等待写入更新结果', doneTitle: '结果汇总' }
];

/** @type {AiStepDefinition} */
export const LOGIN_STEP_DEFINITION = {
  key: 'login',
  title: '等待携程登录确认',
  doneTitle: '携程登录态已确认'
};

/** @type {AiStepDefinition} */
export const CANCEL_STEP_DEFINITION = {
  key: 'cancel',
  title: '任务已取消',
  doneTitle: '任务已取消'
};

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {AiTaskEvent} [event]
 * @returns {string}
 */
export function getToolName(event = {}) {
  if (event.toolName) return event.toolName;
  const message = String(event.message || '');
  const match = message.match(/工具[:：]\s*([a-zA-Z0-9_:-]+)/);
  return match ? match[1] : '';
}

/**
 * @param {AiTaskEvent} [event]
 * @param {AiTaskKind} [taskKind]
 * @returns {string}
 */
export function getEventStepKey(event = {}, taskKind = 'collect') {
  const type = String(event.type || '');
  const toolName = getToolName(event);
  const isRefresh = taskKind === 'refresh-data';

  if (type === 'task:start') return 'received';
  if (type === 'task:done') return 'done';
  if (type === 'task:error') return 'error';
  if (type === 'task:cancel') return 'cancel';
  if (isRefresh) {
    if (type === 'refresh:load-data') return 'load-data';
    if (type === 'refresh:scan-done') return 'load-data';
    if (
      type === 'refresh:item-start' ||
      type === 'refresh:item-write' ||
      type === 'refresh:item-done' ||
      type === 'refresh:item-skipped'
    )
      return 'refresh';
    if (type.startsWith('refresh:')) return 'refresh';
    if (type === 'refresh:write') return 'write';
    if (type === 'refresh:summary') return 'write';
    if (type.startsWith('edge:') || toolName === 'open_visible_edge_login') return 'edge';
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

/**
 * @param {AiTaskEvent} [event]
 * @param {AiTaskKind} [taskKind]
 * @returns {string}
 */
export function getReadableEventTitle(event = {}, taskKind = 'collect') {
  const type = String(event.type || '');
  const toolName = getToolName(event);
  const isRefresh = taskKind === 'refresh-data';

  if (type === 'task:start') return '已接收任务';
  if (type === 'task:done') return isRefresh ? '更新任务完成' : '采集任务完成';
  if (type === 'task:error') return '任务执行失败';
  if (type === 'task:cancel') return '任务已取消';
  if (type === 'refresh:load-data') return '正在读取当前宾馆数据';
  if (type === 'refresh:scan-done') return event.message || '已扫描当前宾馆数据';
  if (type === 'refresh:item-start') return event.message || '正在更新房型与价格';
  if (type === 'refresh:item-write') return event.message || '正在写入当前宾馆更新结果';
  if (type === 'refresh:item-done') return event.message || '房型与价格更新完成';
  if (type === 'refresh:item-skipped') return event.message || '跳过该宾馆';
  if (type === 'refresh:write') return '等待写入更新结果';
  if (type === 'refresh:summary') return '结果汇总';
  if (type === 'edge:login-required')
    return isRefresh ? '正在准备 Edge 登录态' : event.message || '需要登录携程后继续采集';
  if (type === 'edge:login-window') return event.message || '已打开 Edge 登录窗口，等待你完成登录';
  if (type === 'edge:login-done')
    return isRefresh ? 'Edge 登录态已准备完成' : event.message || '携程登录窗口已关闭，继续采集';
  if (type === 'scrape:retry') return event.message || '正在使用新的携程登录态重新采集酒店页面';
  if (type.startsWith('batch:') || type.startsWith('list:'))
    return event.message || '正在处理批量采集任务';
  if (toolName) {
    const label = getReadableToolLabel(toolName);
    if (toolName === 'collect_and_write_ctrip_hotel' && type === 'tool:start')
      return '已接收采集任务';
    if (toolName === 'collect_and_write_ctrip_hotel') return '正在采集携程酒店页面';
    if (toolName === 'refresh_existing_ctrip_hotels' && type === 'tool:start') return '已接收任务';
    if (toolName === 'refresh_existing_ctrip_hotels') return '正在更新已有宾馆数据';
    if (toolName === 'list_templates' || toolName === 'get_settings')
      return '正在读取模板与比较助手设置';
    return label.startsWith('正在') ? label : `正在${label}`;
  }

  return String(event.message || event.type || '正在执行任务')
    .replace(/^AI\s*正在调用工具[:：]\s*/, '正在执行：')
    .replace(/^AI\s*采集任务/, '采集任务');
}

/**
 * @param {AiTaskEvent} [event]
 * @param {AiTaskKind} [taskKind]
 * @returns {AiNormalizedEvent}
 */
export function normalizeEvent(event = {}, taskKind = 'collect') {
  return {
    key: getEventStepKey(event, taskKind),
    time: event.at || '',
    title: getReadableEventTitle(event, taskKind),
    detail: event.details && typeof event.details === 'object' ? event.details : null,
    toolName: getToolName(event),
    raw: event
  };
}

/**
 * @param {Partial<AiNormalizedEvent>|null|undefined} event
 * @returns {string}
 */
export function getEventDetailText(event = {}) {
  const detail = event && event.detail;
  if (!detail || typeof detail !== 'object') return '';
  return String(detail.instruction || detail.reason || detail.action || '').trim();
}

/**
 * @param {AiTaskEvent[]} [events]
 * @param {AiTaskConsoleState} [task]
 * @returns {string}
 */
export function getLastTaskError(events = [], task = {}) {
  if (task.error) return task.error;
  const errorEvent = events
    .slice()
    .reverse()
    .find((event) => event.type === 'task:error' || event.type === 'task:cancel');
  return errorEvent ? errorEvent.message || errorEvent.type : '';
}

/**
 * @param {AiNormalizedEvent[]} normalizedEvents
 * @param {string} key
 * @returns {AiNormalizedEvent|null}
 */
export function findRefreshStepEvent(normalizedEvents, key) {
  if (key !== 'refresh') {
    return findStepEvent(normalizedEvents, key);
  }

  const isIndexRunning = (index) => {
    if (index <= 0) return false;
    return !normalizedEvents.some((event) => {
      if (event.key !== 'refresh') return false;
      const eventType = event.raw && event.raw.type;
      if (eventType !== 'refresh:item-done' && eventType !== 'refresh:item-skipped') return false;
      const detail =
        event.raw.details && typeof event.raw.details === 'object' ? event.raw.details : {};
      return Number(detail.index || 0) === index;
    });
  };

  const runningItemWrite = normalizedEvents
    .slice()
    .reverse()
    .find((event) => {
      if (event.key !== 'refresh') return false;
      const rawType = event.raw && event.raw.type;
      if (rawType !== 'refresh:item-write') return false;
      const detail =
        event.raw.details && typeof event.raw.details === 'object' ? event.raw.details : {};
      const index = Number(detail.index || 0);
      return isIndexRunning(index);
    });

  if (runningItemWrite) return runningItemWrite;

  const runningItemStart = normalizedEvents
    .slice()
    .reverse()
    .find((event) => {
      if (event.key !== 'refresh') return false;
      const rawType = event.raw && event.raw.type;
      if (rawType !== 'refresh:item-start') return false;
      const detail =
        event.raw.details && typeof event.raw.details === 'object' ? event.raw.details : {};
      const index = Number(detail.index || 0);
      return isIndexRunning(index);
    });

  if (runningItemStart) return runningItemStart;

  return findStepEvent(normalizedEvents, key);
}

/**
 * @param {AiNormalizedEvent[]} normalizedEvents
 * @param {string} key
 * @returns {AiNormalizedEvent|null}
 */
export function findStepEvent(normalizedEvents, key) {
  return (
    normalizedEvents
      .slice()
      .reverse()
      .find((event) => event.key === key) || null
  );
}

/**
 * @param {AiNormalizedEvent[]} [normalizedEvents]
 * @param {AiTaskKind} [taskKind]
 * @returns {AiStepDefinition[]}
 */
export function getStepDefinitions(normalizedEvents = [], taskKind = 'collect') {
  if (taskKind === 'refresh-data') {
    const hasCancelStep = normalizedEvents.some((event) => event.key === 'cancel');
    if (!hasCancelStep) return REFRESH_STEP_DEFINITIONS;

    const definitions = [...REFRESH_STEP_DEFINITIONS];
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
