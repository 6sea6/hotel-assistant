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
 * @property {Record<string, unknown>} aiReview
 * @property {boolean} [aiTemplatePickerBound]
 */

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
  aiTaskConsole: {
    submitted: false,
    template: null,
    templateLabel: '',
    hotelUrl: '',
    startedAt: '',
    endedAt: '',
    result: null,
    collectResult: null,
    error: null,
    reply: ''
  },
  aiProviderPresets: [],
  aiProviderConfig: null,
  aiAssistantInitialized: false,
  aiTaskInProgress: false,
  aiTaskQueue: [],
  aiTaskQueueCounter: 0,
  aiSelectedQueueTaskId: '',
  aiQueueSelectionPinned: false,
  aiReviewInputSyncBound: false,
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

/* ---- 常量 ---- */
export const HOTEL_RENDER_BATCH_SIZE = 36;
export const LARGE_HOTEL_RENDER_THRESHOLD = 120;
export const TEMPLATE_SELECT_BATCH_SIZE = 180;
export const TEMPLATE_FILTER_BATCH_SIZE = 180;
export const INTERACTION_FIRST_RENDER_DELAY = 260;

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
