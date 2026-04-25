/**
 * 中央状态管理 —— 所有渲染进程的共享可变状态集中于此。
 *
 * 其他模块通过 import { state } from './state.js' 获取同一引用，
 * 直接读写 state.xxx 即可，无需事件或回调。
 */

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

  // AI 提示词编辑
  currentPromptType: '',
  isPromptEditing: false,
  promptContentBackup: '',
  customPromptContent: {
    protective: null,
    guide: null,
    optimize: null
  }
};

/* ---- 常量 ---- */
export const HOTEL_RENDER_BATCH_SIZE = 36;
export const LARGE_HOTEL_RENDER_THRESHOLD = 120;
export const TEMPLATE_SELECT_BATCH_SIZE = 180;
export const TEMPLATE_FILTER_BATCH_SIZE = 180;
export const INTERACTION_FIRST_RENDER_DELAY = 260;

export const PROMPT_TITLES = {
  protective: '🛡️ 保护性提示词',
  guide: '📋 数据填充指南',
  optimize: '⚡ AI优化提示词'
};

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
