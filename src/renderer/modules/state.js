/**
 * 中央状态管理 —— 所有渲染进程的共享可变状态集中于此。
 *
 * 其他模块通过 import { state } from './state.js' 获取同一引用，
 * 直接读写 state.xxx 即可，无需事件或回调。
 */

/**
 * @typedef {import('../../shared/contracts').NormalizedHotelRecord} NormalizedHotelRecord
 * @typedef {import('../../shared/contracts').NormalizedTemplateRecord} NormalizedTemplateRecord
 * @typedef {import('../../shared/contracts').AppSettings} AppSettings
 * @typedef {import('../../shared/contracts').AiTaskEvent} AiTaskEvent
 * @typedef {import('../../shared/contracts').AiTaskConsoleState} AiTaskConsoleState
 * @typedef {import('../../shared/contracts').AiTaskQueueItem} AiTaskQueueItem
 * @typedef {import('../../shared/contracts').EntityId} EntityId
 * @typedef {'card'|'list'} ViewMode
 * @typedef {Record<string, string|number|boolean|null|undefined>} CurrentFilters
 * @typedef {object} ResetAiTaskQueueStateOptions
 * @property {boolean} [keepRunningTask]
 * @property {boolean} [resetCounter]
 */

/**
 * @typedef {object} RendererState
 * @property {NormalizedHotelRecord[]} hotels
 * @property {NormalizedTemplateRecord[]} templates
 * @property {AppSettings} settings
 * @property {CurrentFilters} currentFilters
 * @property {string} rankingMode
 * @property {boolean} isInitialized
 * @property {boolean} renderScheduled
 * @property {ViewMode} viewMode
 * @property {Set<EntityId>} selectedHotels
 * @property {boolean} batchDeleteInProgress
 * @property {boolean} manualRefreshInProgress
 * @property {boolean} staticFormEventsBound
 * @property {boolean} globalActionEventsBound
 * @property {boolean} globalKeyEventsBound
 * @property {boolean} hotelListEventsBound
 * @property {boolean} templateListEventsBound
 * @property {boolean} hotelDetailsEventsBound
 * @property {number} hotelListRenderVersion
 * @property {number} hotelTemplateSelectRenderVersion
 * @property {number} templateFilterRenderVersion
 * @property {string|null} hotelNameFilterOptionSignature
 * @property {number} hotelRenderResumeTimer
 * @property {number} hotelRenderDelayTimer
 * @property {FrameRequestCallback|null} pendingHotelRenderResume
 * @property {boolean} pendingRenderInteractionFirst
 * @property {'total'|'daily'|null} lastEditedPriceField
 * @property {AiTaskEvent[]} aiTaskEvents
 * @property {AiTaskConsoleState} aiTaskConsole
 * @property {Array<Record<string, unknown>>} aiProviderPresets
 * @property {Record<string, unknown>|null} aiProviderConfig
 * @property {boolean} aiAssistantInitialized
 * @property {boolean} aiTaskInProgress
 * @property {AiTaskQueueItem[]} aiTaskQueue
 * @property {number} aiTaskQueueCounter
 * @property {string} aiSelectedQueueTaskId
 * @property {boolean} aiQueueSelectionPinned
 * @property {boolean} aiReviewInputSyncBound
 * @property {number} hotelsVersion
 * @property {Record<string, unknown>} aiReview
 * @property {boolean} [aiTemplatePickerBound]
 */

/**
 * @returns {AiTaskConsoleState}
 */
function createDefaultAiTaskConsole() {
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

/** @type {RendererState} */
export const state = {
  hotels: [],
  templates: [],
  settings: {},
  currentFilters: {},
  rankingMode: 'auto',
  isInitialized: false,
  renderScheduled: false,
  viewMode: 'card', // 'card' | 'list'
  selectedHotels: new Set(),
  batchDeleteInProgress: false,
  manualRefreshInProgress: false,
  staticFormEventsBound: false,
  globalActionEventsBound: false,
  globalKeyEventsBound: false,
  hotelListEventsBound: false,
  templateListEventsBound: false,
  hotelDetailsEventsBound: false,
  hotelListRenderVersion: 0,
  hotelTemplateSelectRenderVersion: 0,
  templateFilterRenderVersion: 0,
  hotelNameFilterOptionSignature: null,
  hotelRenderResumeTimer: 0,
  hotelRenderDelayTimer: 0,
  pendingHotelRenderResume: null,
  pendingRenderInteractionFirst: false,
  lastEditedPriceField: null,

  // 采集助手
  aiTaskEvents: [],
  aiTaskConsole: createDefaultAiTaskConsole(),
  aiProviderPresets: [],
  aiProviderConfig: null,
  aiAssistantInitialized: false,
  aiTaskInProgress: false,
  aiTaskQueue: [],
  aiTaskQueueCounter: 0,
  aiSelectedQueueTaskId: '',
  aiQueueSelectionPinned: false,
  aiReviewInputSyncBound: false,
  hotelsVersion: 0,
  aiReview: {
    isOpen: false,
    inProgress: false,
    applyInProgress: false,
    result: null,
    reviewId: '',
    userConcern: '',
    error: '',
    startedAt: '',
    endedAt: ''
  }
};

/**
 * @param {NormalizedHotelRecord[]} hotels
 * @returns {void}
 */
export function setHotels(hotels) {
  state.hotels = hotels;
  bumpHotelsVersion();
  markVisibleHotelsCacheDirty();
}

/**
 * @param {NormalizedTemplateRecord[]} templates
 * @returns {void}
 */
export function setTemplates(templates) {
  state.templates = templates;
}

/**
 * @param {AppSettings} settings
 * @returns {void}
 */
export function setSettings(settings) {
  state.settings = settings;
}

/**
 * @param {boolean} value
 * @returns {void}
 */
export function setInitialized(value) {
  state.isInitialized = value;
}

/**
 * @param {CurrentFilters} patch
 * @returns {void}
 */
export function updateCurrentFilters(patch) {
  state.currentFilters = {
    ...state.currentFilters,
    ...patch
  };
}

/**
 * @param {CurrentFilters} filters
 * @returns {void}
 */
export function replaceCurrentFilters(filters) {
  state.currentFilters = filters;
}

/**
 * @returns {void}
 */
export function clearCurrentFilters() {
  state.currentFilters = {};
}

/**
 * @param {Iterable<EntityId>} ids
 * @returns {void}
 */
export function setSelectedHotels(ids) {
  state.selectedHotels.clear();
  for (const id of ids) {
    state.selectedHotels.add(id);
  }
}

/**
 * @returns {void}
 */
export function clearSelectedHotels() {
  state.selectedHotels.clear();
}

/**
 * @param {ViewMode} viewMode
 * @returns {void}
 */
export function setViewMode(viewMode) {
  state.viewMode = viewMode;
}

/**
 * @returns {number}
 */
export function bumpHotelListRenderVersion() {
  state.hotelListRenderVersion += 1;
  return state.hotelListRenderVersion;
}

/**
 * @param {boolean} value
 * @returns {void}
 */
export function setRenderScheduled(value) {
  state.renderScheduled = value;
}

/**
 * @param {boolean} value
 * @returns {void}
 */
export function setPendingRenderInteractionFirst(value) {
  state.pendingRenderInteractionFirst = value;
}

/**
 * @param {string|null} signature
 * @returns {void}
 */
export function setHotelNameFilterOptionSignature(signature) {
  state.hotelNameFilterOptionSignature = signature;
}

/**
 * @param {boolean} value
 * @returns {void}
 */
export function setAiTaskInProgress(value) {
  state.aiTaskInProgress = value;
}

/**
 * @param {boolean} value
 * @returns {void}
 */
export function setAiAssistantInitialized(value) {
  state.aiAssistantInitialized = value;
}

/**
 * @param {AiTaskEvent[]} events
 * @returns {void}
 */
export function setAiTaskEvents(events) {
  state.aiTaskEvents = events;
}

/**
 * @param {AiTaskEvent} event
 * @returns {number}
 */
export function pushAiTaskEvent(event) {
  return state.aiTaskEvents.push(event);
}

/**
 * @param {AiTaskConsoleState} consoleState
 * @returns {void}
 */
export function setAiTaskConsole(consoleState) {
  state.aiTaskConsole = consoleState;
}

/**
 * @returns {AiTaskConsoleState}
 */
export function resetAiTaskConsole() {
  state.aiTaskConsole = createDefaultAiTaskConsole();
  return state.aiTaskConsole;
}

/**
 * @param {AiTaskQueueItem[]} queue
 * @returns {void}
 */
export function setAiTaskQueue(queue) {
  state.aiTaskQueue = queue;
}

/**
 * @param {AiTaskQueueItem} task
 * @returns {AiTaskQueueItem}
 */
export function pushAiTaskQueueItem(task) {
  state.aiTaskQueue.push(task);
  return task;
}

/**
 * @param {string} taskId
 * @param {(task: AiTaskQueueItem) => AiTaskQueueItem} updater
 * @returns {AiTaskQueueItem|null}
 */
export function replaceAiTaskQueueItem(taskId, updater) {
  const index = state.aiTaskQueue.findIndex((task) => String(task.id) === String(taskId));
  if (index < 0) return null;

  const nextTask = updater(state.aiTaskQueue[index]);
  state.aiTaskQueue[index] = nextTask;
  return nextTask;
}

/**
 * @param {string} taskId
 * @returns {AiTaskQueueItem|null}
 */
export function removeAiTaskQueueItem(taskId) {
  const index = state.aiTaskQueue.findIndex((task) => String(task.id) === String(taskId));
  if (index < 0) return null;

  const [removedTask] = state.aiTaskQueue.splice(index, 1);
  return removedTask || null;
}

/**
 * @param {string} taskId
 * @returns {void}
 */
export function setAiSelectedQueueTaskId(taskId) {
  state.aiSelectedQueueTaskId = taskId;
}

/**
 * @param {boolean} value
 * @returns {void}
 */
export function setAiQueueSelectionPinned(value) {
  state.aiQueueSelectionPinned = value;
}

/**
 * @returns {number}
 */
export function bumpAiTaskQueueCounter() {
  state.aiTaskQueueCounter = Number(state.aiTaskQueueCounter || 0) + 1;
  return state.aiTaskQueueCounter;
}

/**
 * @param {ResetAiTaskQueueStateOptions} [options]
 * @returns {void}
 */
export function resetAiTaskQueueState(options = {}) {
  const keepRunningTask = Boolean(options.keepRunningTask);
  const runningTask = keepRunningTask
    ? state.aiTaskQueue.find((task) => task.status === 'running') || null
    : null;

  state.aiTaskQueue = runningTask ? [runningTask] : [];
  state.aiSelectedQueueTaskId = runningTask && runningTask.id ? String(runningTask.id) : '';
  state.aiQueueSelectionPinned = false;

  if (options.resetCounter) {
    state.aiTaskQueueCounter = 0;
  }
}

/* ---- 滚动位置记忆 ---- */

/**
 * @typedef {object} HotelListScrollMemory
 * @property {number} lastScrollTop
 * @property {string|number|null} lastAnchorHotelId
 * @property {number} lastAnchorRank
 * @property {ViewMode} viewMode
 * @property {string} filtersKey
 */

/** @type {HotelListScrollMemory} */
export const hotelListScrollMemory = {
  lastScrollTop: 0,
  lastAnchorHotelId: null,
  lastAnchorRank: 0,
  viewMode: 'card',
  filtersKey: ''
};

/**
 * 记录当前滚动位置到 hotelListScrollMemory。
 *
 * @param {{ scrollTop: number, anchorHotelId?: string|number|null, anchorRank?: number, viewMode?: ViewMode, filtersKey?: string }} params
 * @returns {void}
 */
export function saveScrollMemory(params) {
  hotelListScrollMemory.lastScrollTop = params.scrollTop;
  hotelListScrollMemory.lastAnchorHotelId = params.anchorHotelId ?? null;
  hotelListScrollMemory.lastAnchorRank = params.anchorRank ?? 0;
  hotelListScrollMemory.viewMode = params.viewMode ?? state.viewMode;
  hotelListScrollMemory.filtersKey = params.filtersKey ?? '';
}

/**
 * 根据渲染原因决定虚拟列表的滚动行为。
 *
 * @param {string} reason
 * @param {string} currentFiltersKey
 * @returns {'keep'|'top'|'anchor'}
 */
export function getScrollBehaviorForReason(reason, currentFiltersKey) {
  if (!reason) return 'top';

  // 局部更新/删除：保持当前位置（虚拟模式下 patch 失败会回退到这里）
  if (reason === 'favorite' || reason === 'hotel-update' || reason === 'hotel-delete') {
    return 'keep';
  }

  // 视图切换：尝试锚定到原 hotelId（仅当筛选条件未变时）
  if (reason === 'view-mode-change') {
    if (hotelListScrollMemory.filtersKey && hotelListScrollMemory.filtersKey !== currentFiltersKey) {
      return 'top';
    }
    return 'anchor';
  }

  // 筛选/排序等结构性变化：回到顶部
  if (
    reason === 'filter-change' ||
    reason === 'sort-change' ||
    reason === 'ranking-change' ||
    reason === 'template-sync' ||
    reason === 'settings-change'
  ) {
    return 'top';
  }

  // 其他原因：筛选条件变化时回到顶部
  if (hotelListScrollMemory.filtersKey && hotelListScrollMemory.filtersKey !== currentFiltersKey) {
    return 'top';
  }

  return 'top';
}

/**
 * 从已排序的酒店列表中，根据锚定 hotelId 找到对应的 scrollTop。
 *
 * @param {Array<{id: string|number}>} sortedHotels
 * @param {string|number|null} anchorHotelId
 * @param {number} estimatedItemHeight
 * @param {number} columns
 * @param {number} gap
 * @param {'card'|'list'} viewMode
 * @returns {number} 目标 scrollTop
 */
export function calculateScrollTopForAnchor(sortedHotels, anchorHotelId, estimatedItemHeight, columns, gap, viewMode) {
  if (anchorHotelId == null || !sortedHotels.length) return 0;

  const anchorIndex = sortedHotels.findIndex((h) => String(h.id) === String(anchorHotelId));
  if (anchorIndex < 0) return 0;

  if (viewMode === 'list') {
    return anchorIndex * estimatedItemHeight;
  }

  // card mode: 计算所在行
  const row = Math.floor(anchorIndex / Math.max(1, columns));
  const rowHeight = estimatedItemHeight + gap;
  return row * rowHeight;
}

/**
 * 根据被删除的酒店 ID，计算删除后的目标 scrollTop。
 *
 * @param {Array<{id: string|number}>} sortedHotelsBeforeDelete
 * @param {Set<string|number>} deletedIds
 * @param {number} currentScrollTop
 * @param {number} estimatedItemHeight
 * @param {number} columns
 * @param {number} gap
 * @param {'card'|'list'} viewMode
 * @returns {number} 目标 scrollTop
 */
export function calculateScrollTopAfterDelete(sortedHotelsBeforeDelete, deletedIds, currentScrollTop, estimatedItemHeight, columns, gap, viewMode) {
  if (!sortedHotelsBeforeDelete.length || !deletedIds.size) return currentScrollTop;

  // 找到被删项中最大的 index（即最后可见的被删项）
  let maxDeletedIndex = -1;
  for (let i = 0; i < sortedHotelsBeforeDelete.length; i++) {
    if (deletedIds.has(String(sortedHotelsBeforeDelete[i].id))) {
      maxDeletedIndex = i;
    }
  }

  if (maxDeletedIndex < 0) return currentScrollTop;

  // 定位到被删项的下一个位置
  const nextIndex = Math.min(maxDeletedIndex + 1, sortedHotelsBeforeDelete.length - 1);

  if (viewMode === 'list') {
    return nextIndex * estimatedItemHeight;
  }

  const row = Math.floor(nextIndex / Math.max(1, columns));
  const rowHeight = estimatedItemHeight + gap;
  return row * rowHeight;
}

/* ---- 常量 ---- */
export const HOTEL_RENDER_BATCH_SIZE = 36;
export const LARGE_HOTEL_RENDER_THRESHOLD = 120;
export const TEMPLATE_SELECT_BATCH_SIZE = 180;
export const TEMPLATE_FILTER_BATCH_SIZE = 180;
export const INTERACTION_FIRST_RENDER_DELAY = 260;

/* ---- 宾馆数据客户端缓存元信息 ---- */

/**
 * @typedef {object} HotelDataClientCache
 * @property {number|null} revision - 主进程最新已知 revision，null 表示未知
 * @property {number} count - 主进程最新已知宾馆数量
 * @property {boolean} loaded - 是否曾经成功加载过
 */

/** @type {HotelDataClientCache} */
export const hotelDataClientCache = {
  revision: null,
  count: 0,
  loaded: false
};

/**
 * 获取本地缓存的宾馆 revision。
 * @returns {number|null}
 */
export function getLocalHotelsRevision() {
  return hotelDataClientCache.revision;
}

/**
 * 设置本地缓存的宾馆 revision 和 count。
 * @param {{ revision: number, count: number }} meta
 * @returns {void}
 */
export function setLocalHotelsRevision(meta) {
  hotelDataClientCache.revision = meta.revision;
  hotelDataClientCache.count = meta.count;
  hotelDataClientCache.loaded = true;
}

/**
 * 标记本地宾馆 revision 未知，下次加载时必须查询主进程。
 * @returns {void}
 */
export function markLocalHotelsRevisionUnknown() {
  hotelDataClientCache.revision = null;
}

/* ---- 排名缓存 ---- */
export const rankingCache = {
  data: null,
  filters: null,
  hotelsHash: null,
  weights: null,
  invalidate() {
    this.data = null;
    this.filters = null;
    this.hotelsHash = null;
    this.weights = null;
  }
};

/**
 * @returns {void}
 */
export function markRankingCacheDirty() {
  rankingCache.invalidate();
}

/* ---- 可见宾馆缓存 ---- */

/** @type {{data: NormalizedHotelRecord[]|null, hotelsVersion: number, filtersKey: string, sortMode: string, hitCount: number, missCount: number}} */
export const visibleHotelsCache = {
  data: null,
  hotelsVersion: -1,
  filtersKey: '',
  sortMode: '',
  hitCount: 0,
  missCount: 0,
  invalidate() {
    this.data = null;
    this.hotelsVersion = -1;
    this.filtersKey = '';
    this.sortMode = '';
  }
};

/**
 * 递增 hotelsVersion，用于标记数据已变更。
 * @returns {number}
 */
export function bumpHotelsVersion() {
  state.hotelsVersion += 1;
  return state.hotelsVersion;
}

/**
 * 使可见宾馆缓存失效（独立于 hotelsVersion 的安全清理入口）。
 * @returns {void}
 */
export function markVisibleHotelsCacheDirty() {
  visibleHotelsCache.invalidate();
}

/**
 * 构建筛选条件的稳定缓存 key（不含 sortMode）。
 * @param {CurrentFilters} filters
 * @returns {string}
 */
export function buildVisibleHotelsFiltersKey(filters) {
  const normalize = (v) => (v === undefined || v === null ? '' : String(v));
  return JSON.stringify([
    normalize(filters.name),
    normalize(filters.score),
    normalize(filters.favorite),
    normalize(filters.template),
    normalize(filters.transportTime),
    normalize(filters.subwayDistance)
  ]);
}
