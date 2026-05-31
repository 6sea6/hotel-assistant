/**
 * 宾馆列表渲染 —— 卡片视图、行式视图、批量渲染、事件委托和选择管理。
 */

import {
  state,
  HOTEL_RENDER_BATCH_SIZE,
  LARGE_HOTEL_RENDER_THRESHOLD,
  INTERACTION_FIRST_RENDER_DELAY,
  setHotels,
  updateCurrentFilters,
  replaceCurrentFilters,
  clearSelectedHotels,
  setViewMode,
  markRankingCacheDirty,
  bumpHotelListRenderVersion,
  setRenderScheduled,
  setPendingRenderInteractionFirst,
  setHotelNameFilterOptionSignature,
  visibleHotelsCache,
  buildVisibleHotelsFiltersKey,
  hotelListScrollMemory,
  saveScrollMemory,
  getScrollBehaviorForReason
} from './state.js';
import {
  $,
  getValue,
  escapeHtml,
  escapeHtmlWithLineBreaks,
  idsEqual,
  getSelectionKey,
  hasDisplayValue,
  formatDateChinese,
  getRoomCountText,
  normalizeFilterOptionKey
} from './dom-helpers.js';
import { showNotification } from './notification.js';
import { perfStart, perfEnd } from './perf.js';
import {
  isHotelInputPriorityActive,
  clearPendingHotelRenderTimers,
  queueHotelRenderResume,
  scheduleHotelRenderTask
} from './render-scheduler.js';
import {
  setModalActive,
  resetDeleteConfirmation,
  startDeleteConfirmation,
  resetActionButtonConfirmation,
  startActionButtonConfirmation,
  resetBatchDeleteConfirmation
} from './ui-utils.js';
import {
  applyFiltersToHotels,
  sortHotels,
  DEFAULT_SORT_MODE,
  getVisibleHotelSummary,
  formatSubwayInfo,
  formatDistanceValue,
  formatTransportValue,
  extractDistanceNumber,
  extractTimeNumber
} from './hotel-filters.js';
import { getHotelListRenderDecision } from './hotel-render-decision.js';
import { actions } from './actions.js';
import { refreshCustomSelects } from './custom-select.js';
import {
  normalizeHotelCardVisibleFields,
  renderCardFields
} from './hotel-card-fields.js';
import {
  shouldUseVirtualHotelList,
  getVirtualScrollThreshold,
  calculateVirtualRange,
  calculateCardVirtualRange,
  createDefaultVirtualState,
  measureAverageHeight,
  calculateCardColumns,
  VIRTUAL_OVERSCAN,
  LIST_ROW_ESTIMATED_HEIGHT,
  CARD_ESTIMATED_HEIGHT,
  CARD_GAP
} from './hotel-virtual-list.js';
import {
  calculateThumbMetrics,
  calculateScrollTopFromTrackClick,
  calculateScrollTopFromDrag,
  clampValue,
  normalizeWheelDelta,
  normalizeWheelToStep
} from './virtual-scrollbar-math.js';

const RULE_DELETE_MODAL_ID = 'ruleDeleteModal';
let ruleDeleteInProgress = false;
export { shouldFullRerender } from './hotel-render-decision.js';

/** @type {ReturnType<typeof createDefaultVirtualState>|null} */
let virtualHotelListState = null;
let virtualScrollRafId = 0;
let virtualResizeObserver = null;
let virtualResizeRafId = 0;
let virtualScrollbarCleanup = null;

/**
 * @typedef {HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement} FormValueElement
 */

/**
 * @param {string} id
 * @returns {FormValueElement|null}
 */
const getFormValueElement = (id) => /** @type {FormValueElement|null} */ ($(id));

function resetRuleDeleteConfirmation() {
  const confirmBtn = $('ruleDeleteConfirmBtn');
  if (!confirmBtn) return;
  if (!confirmBtn.dataset.originalHtml) {
    confirmBtn.dataset.originalHtml = '<span>🗑️</span> 删除命中项';
  }
  confirmBtn.dataset.variantClass = 'btn-danger';
  resetActionButtonConfirmation(confirmBtn);
}

/* ---- 宾馆名称筛选选项同步 ---- */

export function buildHotelNameFilterOptions(sourceHotels) {
  sourceHotels = sourceHotels || state.hotels;
  const seen = new Set();
  const options = [];
  for (const hotel of sourceHotels) {
    const name = hotel?.name;
    if (!name) continue;
    const key = normalizeFilterOptionKey(name);
    if (key && !seen.has(key)) {
      seen.add(key);
      options.push(name);
    }
  }
  options.sort((a, b) => a.localeCompare(b, 'zh-CN'));
  return options;
}

/**
 * @param {{selectedValue?: string}} [options]
 * @returns {string}
 */
export function syncHotelNameFilterOptions(options = {}) {
  const select = /** @type {HTMLSelectElement|null} */ ($('filterName'));
  if (!select) return options.selectedValue || '';

  const selectedValue = options.selectedValue ?? select.value;
  const newOptions = buildHotelNameFilterOptions();
  const signature = newOptions.join('\x00');

  if (signature === state.hotelNameFilterOptionSignature) {
    if (selectedValue) {
      select.value = selectedValue;
      if (select.value !== selectedValue) {
        select.value = '';
      }
    }
    return select.value;
  }

  setHotelNameFilterOptionSignature(signature);

  select.innerHTML = '<option value="">全部</option>';
  const fragment = document.createDocumentFragment();
  for (const name of newOptions) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    fragment.appendChild(option);
  }
  select.appendChild(fragment);

  if (selectedValue) {
    select.value = selectedValue;
    if (select.value !== selectedValue) {
      select.value = '';
    }
  }

  refreshCustomSelects();

  return select.value;
}

/* ---- 渲染主入口 ---- */

function renderHotelListPreparingState() {
  const container = $('hotelList');
  if (!container) return;

  container.className = state.viewMode === 'list' ? 'hotel-list list-view' : 'hotel-list';
  container.innerHTML = `
    <div class="empty-state empty-state-loading">
      <div class="empty-state-icon">⏳</div>
      <div class="empty-state-text">数据已导入，正在后台整理列表</div>
      <div class="empty-state-subtext">现在可以先继续添加或编辑宾馆，列表会在你空闲时继续恢复。</div>
    </div>
  `;
}

function getSortedVisibleHotels() {
  const sortMode = state.currentFilters.sortMode || DEFAULT_SORT_MODE;
  const filtersKey = buildVisibleHotelsFiltersKey(state.currentFilters);

  if (
    visibleHotelsCache.data &&
    visibleHotelsCache.hotelsVersion === state.hotelsVersion &&
    visibleHotelsCache.filtersKey === filtersKey &&
    visibleHotelsCache.sortMode === sortMode
  ) {
    visibleHotelsCache.hitCount += 1;
    return visibleHotelsCache.data;
  }

  visibleHotelsCache.missCount += 1;
  const filteredHotels = applyFiltersToHotels(state.hotels, state.currentFilters);
  const sortedHotels = sortHotels(filteredHotels, sortMode);

  visibleHotelsCache.data = sortedHotels;
  visibleHotelsCache.hotelsVersion = state.hotelsVersion;
  visibleHotelsCache.filtersKey = filtersKey;
  visibleHotelsCache.sortMode = sortMode;

  return sortedHotels;
}

function updateVisibleHotelSummary(sortedHotels) {
  const countElement = document.getElementById('hotelCount');
  const roomTypeCountElement = document.getElementById('roomTypeCount');
  if (!countElement || !roomTypeCountElement) return false;

  const summary = getVisibleHotelSummary(sortedHotels);
  countElement.textContent = String(summary.hotelCount);
  roomTypeCountElement.textContent = String(summary.roomTypeCount);
  return true;
}

function getRenderedHotelNodes(container) {
  const selector = state.viewMode === 'list' ? '.hotel-table-row[data-id]' : '.hotel-card[data-id]';
  return Array.from(container.querySelectorAll(selector));
}

function findRenderedHotelNode(container, id) {
  const idKey = getSelectionKey(id);
  return getRenderedHotelNodes(container).find((node) => idsEqual(node.dataset.id, idKey)) || null;
}

function updateRenderedRankLabels(container) {
  const nodes = getRenderedHotelNodes(container);
  nodes.forEach((node, index) => {
    const rank = index + 1;
    const isTop3 = rank <= 3;
    const rankElement =
      state.viewMode === 'list'
        ? node.querySelector('.rank-badge')
        : node.querySelector('.hotel-rank');
    if (!rankElement) return;

    rankElement.textContent = `#${rank}`;
    rankElement.classList.toggle('top3', isTop3);
  });
}

function hasFavoriteFilterActive() {
  return state.currentFilters.favorite !== undefined && state.currentFilters.favorite !== '';
}

/**
 * @param {Array<string|number>} changedIds
 * @param {{reason?: string}} [options]
 * @returns {boolean}
 */
export function patchHotelCards(changedIds, options = {}) {
  const container = $('hotelList');
  if (!container || !Array.isArray(changedIds) || changedIds.length === 0) {
    return false;
  }

  if (options.reason === 'favorite' && hasFavoriteFilterActive()) {
    return false;
  }

  const currentNameFilter = String(state.currentFilters.name || '');
  const syncedNameFilter = syncHotelNameFilterOptions({ selectedValue: currentNameFilter });
  if (currentNameFilter !== syncedNameFilter) {
    updateCurrentFilters({ name: syncedNameFilter });
    return false;
  }

  const sortedHotels = getSortedVisibleHotels();
  if (sortedHotels.length === 0) {
    return false;
  }
  if (!updateVisibleHotelSummary(sortedHotels)) {
    return false;
  }

  const renderedNodes = getRenderedHotelNodes(container);
  if (renderedNodes.length !== sortedHotels.length && options.reason !== 'hotel-delete') {
    return false;
  }

  if (options.reason === 'hotel-delete') {
    let removedAny = false;
    for (const id of changedIds) {
      const existingNode = findRenderedHotelNode(container, id);
      if (existingNode) {
        existingNode.remove();
        removedAny = true;
      }
    }

    const nextNodes = getRenderedHotelNodes(container);
    if (nextNodes.length !== sortedHotels.length) {
      return false;
    }

    if (removedAny) {
      bumpHotelListRenderVersion();
    }
    updateRenderedRankLabels(container);
    syncSelectAllCheckboxState();
    resetBatchDeleteConfirmation({ count: state.selectedHotels.size });
    return true;
  }

  const patchPlan = [];
  for (const id of changedIds) {
    const visibleIndex = sortedHotels.findIndex((hotel) => idsEqual(hotel.id, id));
    if (visibleIndex < 0) return false;

    const existingNode = findRenderedHotelNode(container, id);
    if (!existingNode) return false;

    const currentIndex = renderedNodes.indexOf(existingNode);
    if (currentIndex !== visibleIndex) return false;

    patchPlan.push({
      existingNode,
      hotel: sortedHotels[visibleIndex],
      index: visibleIndex
    });
  }

  bumpHotelListRenderVersion();
  for (const item of patchPlan) {
    const replacement =
      state.viewMode === 'list'
        ? createHotelListRow(item.hotel, item.index)
        : createHotelCard(item.hotel, item.index);
    item.existingNode.replaceWith(replacement);
  }

  cleanupHotelActionArtifacts(container);
  syncSelectAllCheckboxState();
  resetBatchDeleteConfirmation({ count: state.selectedHotels.size });
  return true;
}

/**
 * @param {{reason?: string, changedIds?: Array<string|number|null|undefined>|Set<string|number|null|undefined>, forceFull?: boolean, interactionFirst?: boolean}} [options]
 * @returns {void}
 */
export function requestHotelListRender(options = {}) {
  const decision = getHotelListRenderDecision({
    reason: options.reason,
    changedIds: options.changedIds,
    forceFull: options.forceFull,
    renderScheduled: state.renderScheduled,
    hasPendingRenderResume: Boolean(state.pendingHotelRenderResume)
  });

  if (
    decision.mode === 'patch' &&
    patchHotelCards(decision.changedIds, { reason: decision.reason })
  ) {
    return;
  }

  renderHotelList({ interactionFirst: options.interactionFirst, reason: decision.reason });
}

export function renderHotelList(options = {}) {
  bumpHotelListRenderVersion();
  setPendingRenderInteractionFirst(
    state.pendingRenderInteractionFirst || Boolean(options.interactionFirst)
  );
  if (state.renderScheduled) return;

  clearPendingHotelRenderTimers();
  resetVirtualHotelListState();
  setRenderScheduled(true);

  const runRender = () => {
    setRenderScheduled(false);
    const taskVersion = state.hotelListRenderVersion;
    const interactionFirst = state.pendingRenderInteractionFirst;
    setPendingRenderInteractionFirst(false);
    const perfLabel = `renderHotelList:${taskVersion}`;
    perfStart(perfLabel);
    const container = document.getElementById('hotelList');
    const countElement = document.getElementById('hotelCount');
    const roomTypeCountElement = document.getElementById('roomTypeCount');

    if (!container || !countElement || !roomTypeCountElement) {
      console.error('[renderHotelList] 关键DOM元素未找到');
      perfEnd(perfLabel);
      return;
    }

    if (interactionFirst && isHotelInputPriorityActive()) {
      setRenderScheduled(true);
      scheduleHotelRenderTask(runRender, 120);
      perfEnd(perfLabel);
      return;
    }

    const currentNameFilter = String(state.currentFilters.name || '');
    const syncedNameFilter = syncHotelNameFilterOptions({ selectedValue: currentNameFilter });
    if (currentNameFilter !== syncedNameFilter) {
      updateCurrentFilters({ name: syncedNameFilter });
    }

    const sortedHotels = getSortedVisibleHotels();
    updateVisibleHotelSummary(sortedHotels);

    if (sortedHotels.length === 0) {
      const hasActiveFilters = Object.values(state.currentFilters).some(
        (value) => value !== undefined && value !== null && value !== ''
      );
      const isFilterEmptyState = state.hotels.length > 0 && hasActiveFilters;
      const emptyAction = isFilterEmptyState ? 'clear-filters' : 'open-ai-assistant';
      const emptyActionText = isFilterEmptyState ? '清除筛选' : '打开采集助手';
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🏨</div>
          <div class="empty-state-text">${isFilterEmptyState ? '当前筛选条件下没有匹配结果' : '暂无宾馆数据'}</div>
          <button class="btn ${isFilterEmptyState ? 'btn-secondary' : 'btn-primary'}" type="button" data-action="${emptyAction}">${emptyActionText}</button>
        </div>
      `;
      perfEnd(perfLabel);
      return;
    }

    container.innerHTML = '';
    container.className = state.viewMode === 'list' ? 'hotel-list list-view' : 'hotel-list';

    try {
      const virtualScrollThreshold = getVirtualScrollThreshold(state.viewMode);
      if (shouldUseVirtualHotelList(sortedHotels.length, { threshold: virtualScrollThreshold })) {
        if (state.viewMode === 'list') {
          renderVirtualHotelListView(container, sortedHotels, taskVersion, perfLabel, options.reason);
        } else {
          renderVirtualHotelCardGrid(container, sortedHotels, taskVersion, perfLabel, options.reason);
        }
        return;
      }
    } catch (error) {
      console.error('[virtual-list] fallback to full render', error);
    }

    if (state.viewMode === 'list') {
      renderHotelListView(container, sortedHotels, taskVersion, perfLabel);
    } else {
      renderHotelCardGrid(container, sortedHotels, taskVersion, perfLabel);
    }
  };

  if (state.pendingRenderInteractionFirst && state.hotels.length > LARGE_HOTEL_RENDER_THRESHOLD) {
    renderHotelListPreparingState();
    scheduleHotelRenderTask(runRender, INTERACTION_FIRST_RENDER_DELAY);
    return;
  }

  scheduleHotelRenderTask(runRender);
}

function finishHotelRender(taskVersion, perfLabel) {
  if (taskVersion !== state.hotelListRenderVersion) {
    perfEnd(perfLabel);
    return;
  }
  perfEnd(perfLabel);
}

/* ---- 行式视图 ---- */

export function createHotelListRow(hotel, index) {
  const rank = index + 1;
  const isTop3 = rank <= 3;
  const hasTemplate = !!hotel.template_info;
  const template = hotel.template_info;
  const hotelIdText = String(hotel.id);
  const hotelIdAttr = escapeHtml(hotelIdText);
  const isSelected = state.selectedHotels.has(getSelectionKey(hotel.id));

  const row = document.createElement('div');
  row.className = `hotel-table-row ${hotel.is_favorite ? 'favorite' : ''} ${isSelected ? 'selected' : ''}`;
  row.dataset.id = hotelIdText;

  const dailyPrice = hotel.daily_price ? `¥${hotel.daily_price}` : '-';
  const totalPrice = hotel.total_price ? `¥${hotel.total_price}` : '-';
  const score = hotel.ctrip_score ? hotel.ctrip_score.toFixed(1) : '-';
  const distance = hasDisplayValue(hotel.distance) ? `${hotel.distance}km` : '-';
  const transport = hasDisplayValue(hotel.transport_time) ? `${hotel.transport_time}min` : '-';
  const subwayInfo = formatSubwayInfo(hotel.subway_station, hotel.subway_distance);
  const roomTypeLine = hasDisplayValue(hotel.room_type)
    ? `<div class="hotel-room-type">房间类型：${escapeHtml(hotel.room_type)}</div>`
    : '';
  const originalRoomTypeLine = hasDisplayValue(hotel.original_room_type)
    ? `<div class="hotel-original-room">原始房型：${escapeHtml(hotel.original_room_type)}</div>`
    : '';

  row.innerHTML = `
    <div class="table-col checkbox-col">
      <input type="checkbox" data-action="toggle-selection" data-id="${hotelIdAttr}" ${isSelected ? 'checked' : ''}>
    </div>
    <div class="table-col rank-col">
      <span class="rank-badge ${isTop3 ? 'top3' : ''}">#${rank}</span>
    </div>
    <div class="table-col name-col">
      <div class="hotel-name ${hotel.is_favorite ? 'favorite-name' : ''}">${escapeHtml(hotel.name)}</div>
      ${roomTypeLine}
      ${originalRoomTypeLine}
      ${subwayInfo !== '-' ? `<small>🚇 ${escapeHtml(subwayInfo)}</small>` : ''}
    </div>
    <div class="table-col price-col">
      <div class="price-value">${dailyPrice}</div>
      <small class="price-total">${totalPrice}</small>
    </div>
    <div class="table-col score-col">${score}</div>
    <div class="table-col distance-col">${distance}</div>
    <div class="table-col transport-col">${transport}</div>
    <div class="table-col template-col">
      ${hasTemplate ? `<span class="template-badge">${escapeHtml(template.name)}</span>` : '-'}
    </div>
    <div class="table-col actions-col">
      <button class="btn btn-secondary btn-xs" data-action="edit" data-id="${hotelIdAttr}">编辑</button>
      <button class="btn btn-secondary btn-xs" data-action="details" data-id="${hotelIdAttr}" title="更多">…</button>
    </div>
  `;

  return row;
}

/* ---- 批量渲染 ---- */

function renderHotelRowsInBatches(tbody, hotelsToRender, taskVersion, perfLabel, startIndex = 0) {
  if (taskVersion !== state.hotelListRenderVersion) {
    finishHotelRender(taskVersion, perfLabel);
    return;
  }

  if (isHotelInputPriorityActive()) {
    queueHotelRenderResume(() =>
      renderHotelRowsInBatches(tbody, hotelsToRender, taskVersion, perfLabel, startIndex)
    );
    return;
  }

  const fragment = document.createDocumentFragment();
  const endIndex = Math.min(startIndex + HOTEL_RENDER_BATCH_SIZE, hotelsToRender.length);

  for (let index = startIndex; index < endIndex; index++) {
    fragment.appendChild(createHotelListRow(hotelsToRender[index], index));
  }

  tbody.appendChild(fragment);

  if (endIndex < hotelsToRender.length) {
    requestAnimationFrame(() =>
      renderHotelRowsInBatches(tbody, hotelsToRender, taskVersion, perfLabel, endIndex)
    );
    return;
  }

  syncSelectAllCheckboxState();
  finishHotelRender(taskVersion, perfLabel);
}

function renderHotelCardsInBatches(
  container,
  hotelsToRender,
  taskVersion,
  perfLabel,
  startIndex = 0
) {
  if (taskVersion !== state.hotelListRenderVersion) {
    finishHotelRender(taskVersion, perfLabel);
    return;
  }

  if (isHotelInputPriorityActive()) {
    queueHotelRenderResume(() =>
      renderHotelCardsInBatches(container, hotelsToRender, taskVersion, perfLabel, startIndex)
    );
    return;
  }

  const fragment = document.createDocumentFragment();
  const endIndex = Math.min(startIndex + HOTEL_RENDER_BATCH_SIZE, hotelsToRender.length);

  for (let index = startIndex; index < endIndex; index++) {
    fragment.appendChild(createHotelCard(hotelsToRender[index], index));
  }

  container.appendChild(fragment);

  if (endIndex < hotelsToRender.length) {
    requestAnimationFrame(() =>
      renderHotelCardsInBatches(container, hotelsToRender, taskVersion, perfLabel, endIndex)
    );
    return;
  }

  cleanupHotelActionArtifacts(container);
  finishHotelRender(taskVersion, perfLabel);
}

function renderHotelCardGrid(container, hotelsToRender, taskVersion, perfLabel) {
  if (hotelsToRender.length <= LARGE_HOTEL_RENDER_THRESHOLD) {
    const fragment = document.createDocumentFragment();
    hotelsToRender.forEach((hotel, index) => {
      fragment.appendChild(createHotelCard(hotel, index));
    });
    container.appendChild(fragment);
    cleanupHotelActionArtifacts(container);
    finishHotelRender(taskVersion, perfLabel);
    return;
  }

  renderHotelCardsInBatches(container, hotelsToRender, taskVersion, perfLabel);
}

function renderHotelListView(container, hotelsToRender, taskVersion, perfLabel) {
  const table = document.createElement('div');
  table.className = 'hotel-table';
  const isAllSelected =
    hotelsToRender.length > 0 &&
    hotelsToRender.every((hotel) => state.selectedHotels.has(getSelectionKey(hotel.id)));

  const header = document.createElement('div');
  header.className = 'hotel-table-header';
  header.innerHTML = `
    <div class="table-col checkbox-col">
      <input type="checkbox" id="selectAll" data-action="toggle-select-all" ${isAllSelected ? 'checked' : ''}>
    </div>
    <div class="table-col rank-col">排名</div>
    <div class="table-col name-col">宾馆名称</div>
    <div class="table-col price-col">价格</div>
    <div class="table-col score-col">评分</div>
    <div class="table-col distance-col">距离</div>
    <div class="table-col transport-col">交通</div>
    <div class="table-col template-col">模板</div>
    <div class="table-col actions-col">操作</div>
  `;
  table.appendChild(header);

  const tbody = document.createElement('div');
  tbody.className = 'hotel-table-body';

  table.appendChild(tbody);
  container.appendChild(table);

  if (hotelsToRender.length <= LARGE_HOTEL_RENDER_THRESHOLD) {
    const fragment = document.createDocumentFragment();
    hotelsToRender.forEach((hotel, index) => {
      fragment.appendChild(createHotelListRow(hotel, index));
    });
    tbody.appendChild(fragment);
    syncSelectAllCheckboxState();
    finishHotelRender(taskVersion, perfLabel);
    return;
  }

  renderHotelRowsInBatches(tbody, hotelsToRender, taskVersion, perfLabel);
}

/* ---- 虚拟滚动：行式视图 ---- */

function renderVirtualHotelListView(container, sortedHotels, taskVersion, perfLabel, reason) {
  virtualHotelListState = createDefaultVirtualState('list');
  virtualHotelListState.enabled = true;
  virtualHotelListState.itemCount = sortedHotels.length;

  const table = document.createElement('div');
  table.className = 'hotel-table';

  const isAllSelected =
    sortedHotels.length > 0 &&
    sortedHotels.every((hotel) => state.selectedHotels.has(getSelectionKey(hotel.id)));

  const header = document.createElement('div');
  header.className = 'hotel-table-header';
  header.innerHTML = `
    <div class="table-col checkbox-col">
      <input type="checkbox" id="selectAll" data-action="toggle-select-all" ${isAllSelected ? 'checked' : ''}>
    </div>
    <div class="table-col rank-col">排名</div>
    <div class="table-col name-col">宾馆名称</div>
    <div class="table-col price-col">价格</div>
    <div class="table-col score-col">评分</div>
    <div class="table-col distance-col">距离</div>
    <div class="table-col transport-col">交通</div>
    <div class="table-col template-col">模板</div>
    <div class="table-col actions-col">操作</div>
  `;
  table.appendChild(header);

  const listScrollShell = document.createElement('div');
  listScrollShell.className = 'virtual-list-scroll-shell';

  const scrollContainer = document.createElement('div');
  scrollContainer.className = 'hotel-table-body virtual-scroll-body virtual-list-scroll virtual-scroll-native-hidden';
  scrollContainer.style.position = 'relative';
  scrollContainer.style.overflowY = 'auto';
  scrollContainer.style.maxHeight = 'none';

  const spacerBefore = document.createElement('div');
  spacerBefore.className = 'virtual-spacer virtual-spacer-before';

  const itemsContainer = document.createElement('div');
  itemsContainer.className = 'virtual-items';

  const spacerAfter = document.createElement('div');
  spacerAfter.className = 'virtual-spacer virtual-spacer-after';

  scrollContainer.appendChild(spacerBefore);
  scrollContainer.appendChild(itemsContainer);
  scrollContainer.appendChild(spacerAfter);

  listScrollShell.appendChild(scrollContainer);
  table.appendChild(listScrollShell);
  container.appendChild(table);

  virtualHotelListState.viewportHeight = scrollContainer.clientHeight || 600;

  let customScrollbar = null;
  let lastRenderedRangeKey = '';
  let scrollbarUpdateRafId = 0;

  const scheduleScrollbarUpdate = () => {
    if (scrollbarUpdateRafId) return;
    scrollbarUpdateRafId = requestAnimationFrame(() => {
      scrollbarUpdateRafId = 0;
      if (customScrollbar) customScrollbar.update();
    });
  };

  const updateVirtualList = () => {
    const scrollTop = scrollContainer.scrollTop;
    const viewportHeight = scrollContainer.clientHeight || 600;
    virtualHotelListState.scrollTop = scrollTop;
    virtualHotelListState.viewportHeight = viewportHeight;

    const range = calculateVirtualRange({
      itemCount: sortedHotels.length,
      scrollTop,
      viewportHeight,
      estimatedItemHeight: virtualHotelListState.estimatedItemHeight,
      overscan: VIRTUAL_OVERSCAN
    });

    virtualHotelListState.startIndex = range.startIndex;
    virtualHotelListState.endIndex = range.endIndex;

    if (taskVersion !== state.hotelListRenderVersion) {
      finishHotelRender(taskVersion, perfLabel);
      return;
    }

    const rangeKey = `${range.startIndex}:${range.endIndex}`;
    if (rangeKey === lastRenderedRangeKey) {
      return;
    }
    lastRenderedRangeKey = rangeKey;

    spacerBefore.style.height = range.beforeHeight + 'px';
    spacerAfter.style.height = range.afterHeight + 'px';

    const fragment = document.createDocumentFragment();
    for (let i = range.startIndex; i < range.endIndex; i++) {
      fragment.appendChild(createHotelListRow(sortedHotels[i], i));
    }

    itemsContainer.innerHTML = '';
    itemsContainer.appendChild(fragment);

    if (!virtualHotelListState.hasMeasuredItemHeight) {
      const measured = measureAverageHeight(
        itemsContainer.querySelectorAll('.hotel-table-row'),
        LIST_ROW_ESTIMATED_HEIGHT
      );
      if (Math.abs(measured - virtualHotelListState.estimatedItemHeight) > 4) {
        virtualHotelListState.estimatedItemHeight = measured;
      }
      virtualHotelListState.hasMeasuredItemHeight = true;
    }
  };

  const scheduleVirtualListUpdate = () => {
    if (virtualScrollRafId) cancelAnimationFrame(virtualScrollRafId);
    virtualScrollRafId = requestAnimationFrame(() => {
      virtualScrollRafId = 0;
      updateVirtualList();
      scheduleScrollbarUpdate();
    });
  };

  let listWheelController = null;

  customScrollbar = createCustomVirtualScrollbar(scrollContainer, {
    className: 'virtual-list-scrollbar',
    onScrollRequest: scheduleVirtualListUpdate,
    onExternalScrollChange: () => listWheelController?.syncToCurrentScroll({ stop: true })
  });
  listScrollShell.appendChild(customScrollbar.element);

  const cleanupFns = [];

  listWheelController = createSmoothWheelController(scrollContainer, {
    getStep: () => {
      const estimated = virtualHotelListState?.estimatedItemHeight || LIST_ROW_ESTIMATED_HEIGHT;
      return Math.max(110, Math.min(240, estimated * 3));
    },
    duration: 160,
    onScrollProgress: scheduleScrollbarUpdate,
    onScrollRequest: scheduleVirtualListUpdate
  });

  scrollContainer.addEventListener('wheel', listWheelController.handleWheel, {
    passive: false,
    capture: true
  });

  cleanupFns.push(() => {
    scrollContainer.removeEventListener('wheel', listWheelController.handleWheel, true);
    listWheelController.cleanup();
  });

  virtualScrollbarCleanup = () => {
    if (scrollbarUpdateRafId) {
      cancelAnimationFrame(scrollbarUpdateRafId);
      scrollbarUpdateRafId = 0;
    }
    customScrollbar?.cleanup();
    for (const cleanup of cleanupFns) {
      try {
        cleanup();
      } catch (_) { /* ignore */ }
    }
  };

  // 滚动位置记忆：保存
  const currentFiltersKey = buildVisibleHotelsFiltersKey(state.currentFilters);
  let saveScrollRafId = 0;
  const scheduleSaveScrollMemory = () => {
    if (saveScrollRafId) cancelAnimationFrame(saveScrollRafId);
    saveScrollRafId = requestAnimationFrame(() => {
      saveScrollRafId = 0;
      const vs = virtualHotelListState;
      if (!vs) return;
      // 从当前可见范围找锚定酒店
      const midIndex = Math.floor((vs.startIndex + vs.endIndex) / 2);
      const anchorHotel = sortedHotels[midIndex] || null;
      saveScrollMemory({
        scrollTop: scrollContainer.scrollTop,
        anchorHotelId: anchorHotel?.id ?? null,
        anchorRank: midIndex + 1,
        viewMode: 'list',
        filtersKey: currentFiltersKey
      });
    });
  };

  scrollContainer.addEventListener('scroll', () => {
    scheduleVirtualListUpdate();
    scheduleSaveScrollMemory();
  }, { passive: true });

  // 滚动位置记忆：恢复
  const scrollBehavior = getScrollBehaviorForReason(reason, currentFiltersKey);
  let initialScrollTop = 0;
  if (scrollBehavior === 'keep') {
    initialScrollTop = hotelListScrollMemory.lastScrollTop || 0;
  }
  scrollContainer.scrollTop = clampValue(initialScrollTop, 0, Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight));

  updateVirtualList();
  if (customScrollbar) customScrollbar.update();

  requestAnimationFrame(() => {
    if (taskVersion !== state.hotelListRenderVersion) return;
    scheduleScrollbarUpdate();
  });

  syncVirtualSelectAllCheckboxState(sortedHotels);
  finishHotelRender(taskVersion, perfLabel);
}

/* ---- 自定义虚拟滚动条 ---- */

/**
 * 创建平滑滚动 wheel 控制器，使用 requestAnimationFrame + easeOutCubic 实现。
 * 每个 wheel 事件最多追加一个 step，防止飞滚。
 *
 * @param {HTMLElement} scrollContainer
 * @param {{ getStep?: () => number, onScrollRequest?: (() => void)|null, duration?: number }} [options]
 * @returns {{ handleWheel: (event: WheelEvent) => void, cleanup: () => void, stopAnimation: () => void, syncToCurrentScroll: (options?: { stop?: boolean }) => void }}
 */
function createSmoothWheelController(scrollContainer, options = {}) {
  const {
    getStep = () => 160,
    onScrollRequest = null,
    onScrollProgress = null,
    duration = 180
  } = options;

  let targetScrollTop = scrollContainer.scrollTop;
  let animationFrameId = 0;
  let animationStartTime = 0;
  let animationStartScrollTop = 0;

  function getMaxScrollTop() {
    return Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function stopAnimation() {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = 0;
    }
  }

  /**
   * 同步内部 targetScrollTop 到 scrollContainer 的真实 scrollTop。
   * 当外部（如滚动轴点击、拖动 thumb）直接修改了 scrollTop 时调用。
   *
   * @param {{ stop?: boolean }} [syncOptions]
   */
  function syncToCurrentScroll(syncOptions = {}) {
    const { stop = true } = syncOptions;
    const current = scrollContainer.scrollTop;
    if (stop) {
      stopAnimation();
    }
    targetScrollTop = current;
    animationStartScrollTop = current;
    animationStartTime =
      typeof performance !== 'undefined' && performance.now
        ? performance.now()
        : Date.now();
  }

  function animate(now) {
    const elapsed = now - animationStartTime;
    const progress = duration <= 0 ? 1 : Math.min(1, elapsed / duration);
    const eased = easeOutCubic(progress);
    const next =
      animationStartScrollTop +
      (targetScrollTop - animationStartScrollTop) * eased;

    scrollContainer.scrollTop = next;

    if (typeof onScrollProgress === 'function') {
      onScrollProgress();
    }

    if (typeof onScrollRequest === 'function') {
      onScrollRequest();
    }

    if (progress < 1) {
      animationFrameId = requestAnimationFrame(animate);
    } else {
      scrollContainer.scrollTop = targetScrollTop;
      animationFrameId = 0;
      if (typeof onScrollProgress === 'function') {
        onScrollProgress();
      }
      if (typeof onScrollRequest === 'function') {
        onScrollRequest();
      }
    }
  }

  function scrollBy(delta) {
    const maxScrollTop = getMaxScrollTop();
    const current = scrollContainer.scrollTop;

    // 如果真实位置和内部目标差距很大，说明用户通过滚动轴点击、拖动
    // 或其它方式改变了 scrollTop，需要从真实位置重新开始。
    if (!animationFrameId && Math.abs(current - targetScrollTop) > 2) {
      targetScrollTop = current;
    }

    targetScrollTop = clampValue(targetScrollTop + delta, 0, maxScrollTop);

    animationStartScrollTop = scrollContainer.scrollTop;
    animationStartTime =
      typeof performance !== 'undefined' && performance.now
        ? performance.now()
        : Date.now();

    if (!animationFrameId) {
      animationFrameId = requestAnimationFrame(animate);
    }
  }

  function handleWheel(event) {
    event.preventDefault();
    event.stopPropagation();

    const rawStep = Number(getStep());
    const step = Math.max(60, Number.isFinite(rawStep) ? rawStep : 160);
    const delta = normalizeWheelToStep(event, step);
    if (!delta) return;

    scrollBy(delta);
  }

  function cleanup() {
    stopAnimation();
  }

  return {
    handleWheel,
    cleanup,
    stopAnimation,
    syncToCurrentScroll
  };
}

/**
 * 创建受控的 wheel 事件处理器，防止惯性/加速导致页面持续快速滚动。
 *
 * @param {HTMLElement} scrollContainer
 * @param {{ getStep?: () => number, onScrollRequest?: (() => void)|null }} [options]
 * @returns {(event: WheelEvent) => void}
 */
function createControlledWheelHandler(scrollContainer, options = {}) {
  const { getStep = () => 120, onScrollRequest = null } = options;

  let lastWheelTime = 0;

  return function handleControlledWheel(event) {
    event.preventDefault();
    event.stopPropagation();

    const now = performance.now();

    // 过滤极高频的惯性尾巴
    if (now - lastWheelTime < 8) {
      return;
    }
    lastWheelTime = now;

    const step = Math.max(40, Number(getStep()) || 120);
    const delta = normalizeWheelDelta(event, step);
    if (!delta) return;

    const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
    const nextScrollTop = clampValue(scrollContainer.scrollTop + delta, 0, maxScrollTop);

    if (Math.abs(nextScrollTop - scrollContainer.scrollTop) < 0.5) {
      return;
    }

    scrollContainer.scrollTop = nextScrollTop;

    if (typeof onScrollRequest === 'function') {
      onScrollRequest();
    }
  };
}

/**
 * @param {HTMLElement} scrollContainer
 * @param {{ className?: string, onScrollRequest?: (() => void)|null, onExternalScrollChange?: (() => void)|null }} [options]
 * @returns {{ element: HTMLElement, update: () => void, cleanup: () => void }}
 */
function createCustomVirtualScrollbar(scrollContainer, options = {}) {
  const { className = '', onScrollRequest = null, onExternalScrollChange = null } = options;

  const scrollbar = document.createElement('div');
  scrollbar.className = `virtual-scrollbar ${className}`.trim();

  const track = document.createElement('div');
  track.className = 'virtual-scrollbar-track';

  const thumb = document.createElement('div');
  thumb.className = 'virtual-scrollbar-thumb';

  track.appendChild(thumb);
  scrollbar.appendChild(track);

  let isDragging = false;
  let dragPointerId = null;
  let dragStartY = 0;
  let dragStartScrollTop = 0;

  function getScrollMetrics() {
    const clientHeight = scrollContainer.clientHeight;
    const scrollHeight = scrollContainer.scrollHeight;
    const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
    const trackHeight = track.clientHeight;
    const thumbHeight = thumb.offsetHeight || 32;
    const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
    return { clientHeight, scrollHeight, maxScrollTop, trackHeight, thumbHeight, maxThumbTop };
  }

  function setScrollTopSafely(nextScrollTop) {
    const { maxScrollTop } = getScrollMetrics();
    const target = clampValue(nextScrollTop, 0, maxScrollTop);
    scrollContainer.scrollTop = target;
    update();
    if (typeof onExternalScrollChange === 'function') onExternalScrollChange();
    if (typeof onScrollRequest === 'function') onScrollRequest();
  }

  function update() {
    const { clientHeight, scrollHeight, trackHeight } = getScrollMetrics();
    const scrollTop = scrollContainer.scrollTop;

    const metrics = calculateThumbMetrics({
      clientHeight,
      scrollHeight,
      scrollTop,
      trackHeight,
      minThumbHeight: 32
    });

    if (metrics.shouldHide) {
      scrollbar.hidden = true;
      return;
    }

    scrollbar.hidden = false;
    thumb.style.height = `${metrics.thumbHeight}px`;
    thumb.style.transform = `translateY(${metrics.thumbTop}px)`;
  }

  function jumpToPointer(event) {
    const rect = track.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const { trackHeight, thumbHeight, clientHeight, scrollHeight } = getScrollMetrics();

    const targetScrollTop = calculateScrollTopFromTrackClick({
      clickY: y,
      trackHeight,
      thumbHeight,
      clientHeight,
      scrollHeight
    });

    setScrollTopSafely(targetScrollTop);
  }

  function handlePointerMove(event) {
    if (!isDragging) return;
    if (dragPointerId !== null && event.pointerId !== dragPointerId) return;
    event.preventDefault();

    const metrics = getScrollMetrics();
    const deltaY = event.clientY - dragStartY;
    const targetScrollTop = calculateScrollTopFromDrag({
      deltaY,
      maxThumbTop: metrics.maxThumbTop,
      maxScrollTop: metrics.maxScrollTop,
      startScrollTop: dragStartScrollTop
    });

    setScrollTopSafely(targetScrollTop);
  }

  function stopDragging() {
    if (!isDragging) return;
    isDragging = false;
    dragPointerId = null;
    document.removeEventListener('pointermove', handlePointerMove);
    document.removeEventListener('pointerup', stopDragging);
    document.removeEventListener('pointercancel', stopDragging);
    window.removeEventListener('blur', stopDragging);
    document.body.classList.remove('is-dragging-virtual-scrollbar');
    thumb.classList.remove('is-dragging');
  }

  function startDragging(event) {
    event.preventDefault();
    event.stopPropagation();

    stopDragging();
    isDragging = true;
    dragPointerId = event.pointerId;
    dragStartY = event.clientY;
    dragStartScrollTop = scrollContainer.scrollTop;

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', stopDragging);
    document.addEventListener('pointercancel', stopDragging);
    window.addEventListener('blur', stopDragging);
    document.body.classList.add('is-dragging-virtual-scrollbar');
    thumb.classList.add('is-dragging');

    try { thumb.setPointerCapture?.(event.pointerId); } catch (_) { /* ignore */ }
  }

  const handleScrollbarWheel = createControlledWheelHandler(scrollContainer, {
    getStep: () => Math.max(80, scrollContainer.clientHeight * 0.18),
    onScrollRequest
  });

  function handleTrackPointerDown(event) {
    event.preventDefault();
    event.stopPropagation();

    if (event.button !== undefined && event.button !== 0) return;

    stopDragging();

    if (event.target === thumb) {
      startDragging(event);
      return;
    }

    jumpToPointer(event);

    const pointerId = event.pointerId;
    try { track.setPointerCapture?.(pointerId); } catch (_) { /* ignore */ }

    const releaseTrackPress = () => {
      try { track.releasePointerCapture?.(pointerId); } catch (_) { /* ignore */ }
      track.removeEventListener('pointerup', releaseTrackPress);
      track.removeEventListener('pointercancel', releaseTrackPress);
    };

    track.addEventListener('pointerup', releaseTrackPress, { once: true });
    track.addEventListener('pointercancel', releaseTrackPress, { once: true });
  }

  scrollbar.addEventListener('wheel', handleScrollbarWheel, { passive: false });
  track.addEventListener('pointerdown', handleTrackPointerDown);

  function cleanup() {
    stopDragging();
    scrollbar.removeEventListener('wheel', handleScrollbarWheel);
    track.removeEventListener('pointerdown', handleTrackPointerDown);
    document.removeEventListener('pointermove', handlePointerMove);
    document.removeEventListener('pointerup', stopDragging);
    document.removeEventListener('pointercancel', stopDragging);
    window.removeEventListener('blur', stopDragging);
    document.body.classList.remove('is-dragging-virtual-scrollbar');
    thumb.classList.remove('is-dragging');
  }

  return { element: scrollbar, update, cleanup };
}

/* ---- 虚拟滚动：卡片视图 ---- */

function renderVirtualHotelCardGrid(container, sortedHotels, taskVersion, perfLabel, reason) {
  virtualHotelListState = createDefaultVirtualState('card');
  virtualHotelListState.enabled = true;
  virtualHotelListState.itemCount = sortedHotels.length;

  let columns = calculateCardColumns(container.clientWidth);
  virtualHotelListState.columns = columns;

  const shell = document.createElement('div');
  shell.className = 'virtual-card-scroll-shell';

  const scrollContainer = document.createElement('div');
  scrollContainer.className = 'virtual-card-scroll virtual-scroll-native-hidden';
  scrollContainer.style.position = 'relative';
  scrollContainer.style.overflowY = 'auto';
  scrollContainer.style.maxHeight = 'none';

  const spacerBefore = document.createElement('div');
  spacerBefore.className = 'virtual-spacer virtual-spacer-before';

  const itemsContainer = document.createElement('div');
  itemsContainer.className = 'virtual-card-items';
  itemsContainer.style.display = 'grid';
  itemsContainer.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
  itemsContainer.style.gap = CARD_GAP + 'px';

  const spacerAfter = document.createElement('div');
  spacerAfter.className = 'virtual-spacer virtual-spacer-after';

  scrollContainer.appendChild(spacerBefore);
  scrollContainer.appendChild(itemsContainer);
  scrollContainer.appendChild(spacerAfter);

  shell.appendChild(scrollContainer);
  container.appendChild(shell);

  virtualHotelListState.viewportHeight = scrollContainer.clientHeight || 600;

  let customScrollbar = null;
  let cardWheelController = null;
  let lastRenderedRangeKey = '';
  let scrollbarUpdateRafId = 0;

  const scheduleScrollbarUpdate = () => {
    if (scrollbarUpdateRafId) return;
    scrollbarUpdateRafId = requestAnimationFrame(() => {
      scrollbarUpdateRafId = 0;
      if (customScrollbar) customScrollbar.update();
    });
  };

  const updateVirtualCards = () => {
    const scrollTop = scrollContainer.scrollTop;
    const viewportHeight = scrollContainer.clientHeight || 600;
    virtualHotelListState.scrollTop = scrollTop;
    virtualHotelListState.viewportHeight = viewportHeight;

    const range = calculateCardVirtualRange({
      itemCount: sortedHotels.length,
      scrollTop,
      viewportHeight,
      estimatedItemHeight: virtualHotelListState.estimatedItemHeight,
      columns,
      gap: CARD_GAP,
      overscan: VIRTUAL_OVERSCAN
    });

    virtualHotelListState.startIndex = range.startIndex;
    virtualHotelListState.endIndex = range.endIndex;

    if (taskVersion !== state.hotelListRenderVersion) {
      finishHotelRender(taskVersion, perfLabel);
      return;
    }

    const rangeKey = `${range.startIndex}:${range.endIndex}`;
    if (rangeKey === lastRenderedRangeKey) {
      return;
    }
    lastRenderedRangeKey = rangeKey;

    spacerBefore.style.height = range.beforeHeight + 'px';
    spacerAfter.style.height = range.afterHeight + 'px';

    const fragment = document.createDocumentFragment();
    for (let i = range.startIndex; i < range.endIndex; i++) {
      fragment.appendChild(createHotelCard(sortedHotels[i], i));
    }

    itemsContainer.innerHTML = '';
    itemsContainer.appendChild(fragment);
    cleanupHotelActionArtifacts(itemsContainer);

    if (!virtualHotelListState.hasMeasuredItemHeight) {
      const firstRowCards = itemsContainer.querySelectorAll('.hotel-card');
      const measured = measureAverageHeight(firstRowCards, CARD_ESTIMATED_HEIGHT);
      if (Math.abs(measured - virtualHotelListState.estimatedItemHeight) > 8) {
        virtualHotelListState.estimatedItemHeight = measured;
      }
      virtualHotelListState.hasMeasuredItemHeight = true;
    }
  };

  const scheduleVirtualCardUpdate = () => {
    if (virtualScrollRafId) cancelAnimationFrame(virtualScrollRafId);
    virtualScrollRafId = requestAnimationFrame(() => {
      virtualScrollRafId = 0;
      updateVirtualCards();
      scheduleScrollbarUpdate();
    });
  };

  const updateCardColumnsFromWidth = () => {
    const width = container.clientWidth || scrollContainer.clientWidth;
    if (width <= 0) return;

    const nextColumns = calculateCardColumns(width);
    if (nextColumns !== columns) {
      columns = nextColumns;
      virtualHotelListState.columns = columns;
      itemsContainer.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
      virtualHotelListState.hasMeasuredItemHeight = false;
      lastRenderedRangeKey = '';
      updateVirtualCards();
      scheduleScrollbarUpdate();
    }
  };

  customScrollbar = createCustomVirtualScrollbar(scrollContainer, {
    className: 'virtual-card-scrollbar',
    onScrollRequest: scheduleVirtualCardUpdate,
    onExternalScrollChange: () => cardWheelController?.syncToCurrentScroll({ stop: true })
  });
  shell.appendChild(customScrollbar.element);

  const cleanupFns = [];

  cardWheelController = createSmoothWheelController(scrollContainer, {
    getStep: () => {
      const estimated = virtualHotelListState?.estimatedItemHeight || CARD_ESTIMATED_HEIGHT;
      return Math.max(140, Math.min(280, estimated * 0.75));
    },
    duration: 180,
    onScrollProgress: scheduleScrollbarUpdate,
    onScrollRequest: scheduleVirtualCardUpdate
  });

  scrollContainer.addEventListener('wheel', cardWheelController.handleWheel, {
    passive: false,
    capture: true
  });

  cleanupFns.push(() => {
    scrollContainer.removeEventListener('wheel', cardWheelController.handleWheel, true);
    cardWheelController.cleanup();
  });

  virtualScrollbarCleanup = () => {
    if (scrollbarUpdateRafId) {
      cancelAnimationFrame(scrollbarUpdateRafId);
      scrollbarUpdateRafId = 0;
    }
    customScrollbar?.cleanup();
    for (const cleanup of cleanupFns) {
      try {
        cleanup();
      } catch (_) { /* ignore */ }
    }
  };

  // 滚动位置记忆：保存
  const currentFiltersKey = buildVisibleHotelsFiltersKey(state.currentFilters);
  let saveScrollRafId = 0;
  const scheduleSaveScrollMemory = () => {
    if (saveScrollRafId) cancelAnimationFrame(saveScrollRafId);
    saveScrollRafId = requestAnimationFrame(() => {
      saveScrollRafId = 0;
      const vs = virtualHotelListState;
      if (!vs) return;
      const midIndex = Math.floor((vs.startIndex + vs.endIndex) / 2);
      const anchorHotel = sortedHotels[midIndex] || null;
      saveScrollMemory({
        scrollTop: scrollContainer.scrollTop,
        anchorHotelId: anchorHotel?.id ?? null,
        anchorRank: midIndex + 1,
        viewMode: 'card',
        filtersKey: currentFiltersKey
      });
    });
  };

  scrollContainer.addEventListener('scroll', () => {
    scheduleVirtualCardUpdate();
    scheduleSaveScrollMemory();
  }, { passive: true });

  if (typeof ResizeObserver !== 'undefined') {
    virtualResizeObserver = new ResizeObserver(() => {
      if (virtualResizeRafId) cancelAnimationFrame(virtualResizeRafId);
      virtualResizeRafId = requestAnimationFrame(() => {
        virtualResizeRafId = 0;
        updateCardColumnsFromWidth();
      });
    });
    virtualResizeObserver.observe(container);
  }

  // 滚动位置记忆：恢复
  const scrollBehavior = getScrollBehaviorForReason(reason, currentFiltersKey);
  let initialScrollTop = 0;
  if (scrollBehavior === 'keep') {
    initialScrollTop = hotelListScrollMemory.lastScrollTop || 0;
  }
  scrollContainer.scrollTop = clampValue(initialScrollTop, 0, Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight));

  updateVirtualCards();
  if (customScrollbar) customScrollbar.update();
  finishHotelRender(taskVersion, perfLabel);
}

/**
 * 虚拟滚动模式下的全选状态同步。
 * 基于 sortedHotels 全量数据判断，而非仅可见 DOM。
 *
 * @param {import('../../shared/contracts').NormalizedHotelRecord[]} sortedHotels
 */
function syncVirtualSelectAllCheckboxState(sortedHotels) {
  const selectAllCheckbox = /** @type {HTMLInputElement|null} */ ($('selectAll'));
  if (!selectAllCheckbox) return;

  if (sortedHotels.length === 0) {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
    return;
  }

  const selectedCount = sortedHotels.filter((hotel) =>
    state.selectedHotels.has(getSelectionKey(hotel.id))
  ).length;

  selectAllCheckbox.checked = selectedCount > 0 && selectedCount === sortedHotels.length;
  selectAllCheckbox.indeterminate = selectedCount > 0 && selectedCount < sortedHotels.length;
}

/**
 * 获取当前虚拟滚动状态（供测试使用）。
 * @returns {ReturnType<typeof createDefaultVirtualState>|null}
 */
export function getVirtualHotelListState() {
  return virtualHotelListState;
}

/**
 * 重置虚拟滚动状态。
 */
export function resetVirtualHotelListState() {
  virtualHotelListState = null;
  if (virtualScrollRafId) {
    cancelAnimationFrame(virtualScrollRafId);
    virtualScrollRafId = 0;
  }
  if (virtualResizeObserver) {
    virtualResizeObserver.disconnect();
    virtualResizeObserver = null;
  }
  if (virtualResizeRafId) {
    cancelAnimationFrame(virtualResizeRafId);
    virtualResizeRafId = 0;
  }
  if (typeof virtualScrollbarCleanup === 'function') {
    virtualScrollbarCleanup();
    virtualScrollbarCleanup = null;
  }
}

/* ---- 卡片视图 ---- */

export function createHotelCard(hotel, index) {
  const rank = index + 1;
  const isTop3 = rank <= 3;
  const hotelIdText = String(hotel.id);
  const hotelIdAttr = escapeHtml(hotelIdText);

  const hasTemplate = !!hotel.template_info;
  const template = hotel.template_info;

  const isFromTemplate = (field) => {
    if (!hasTemplate) return false;
    if (
      field === 'destination' &&
      template.destination &&
      hotel.destination === template.destination
    )
      return true;
    if (field === 'room_count' && template.room_count && hotel.room_count === template.room_count)
      return true;
    if (
      field === 'check_in_date' &&
      template.check_in_date &&
      hotel.check_in_date === template.check_in_date
    )
      return true;
    if (
      field === 'check_out_date' &&
      template.check_out_date &&
      hotel.check_out_date === template.check_out_date
    )
      return true;
    return false;
  };

  const visibleKeys = normalizeHotelCardVisibleFields(state.settings.hotelCardVisibleFields);

  const helpers = {
    escapeHtml,
    escapeHtmlWithLineBreaks,
    hasDisplayValue,
    formatDateChinese,
    getRoomCountText,
    formatSubwayInfo,
    isFromTemplate
  };

  const { headerFieldItems, compactItems, fullItems, footerItems, actionItems } = renderCardFields(
    hotel,
    visibleKeys,
    helpers
  );

  const card = document.createElement('div');
  card.className = `hotel-card ${hotel.is_favorite ? 'favorite' : ''}`;
  card.dataset.id = hotelIdText;

  const originalRoomHtml = headerFieldItems.find(item => item.key === 'original_room_type')?.html || '';
  const websiteHtml = headerFieldItems.find(item => item.key === 'website')?.html || '';
  const addressHtml = headerFieldItems.find(item => item.key === 'address')?.html || '';
  const extraHeaderHtml = headerFieldItems
    .filter(item => !['original_room_type', 'website', 'address'].includes(item.key))
    .map(item => item.html)
    .join('');

  const originalRoomLineHtml = originalRoomHtml
    ? `<div class="hotel-card-original-room-row">${originalRoomHtml}</div>`
    : '';

  const metaPairHtml = websiteHtml || addressHtml
    ? `<div class="hotel-card-meta-pair">
        <div class="hotel-card-meta-cell hotel-card-meta-cell-website">${websiteHtml || ''}</div>
        <div class="hotel-card-meta-cell hotel-card-meta-cell-address">${addressHtml || ''}</div>
      </div>`
    : '';

  const extraHeaderLineHtml = extraHeaderHtml
    ? `<div class="hotel-card-extra-header">${extraHeaderHtml}</div>`
    : '';

  const headerMetaHtml =
    originalRoomLineHtml || metaPairHtml || extraHeaderLineHtml
      ? `<div class="hotel-card-header-meta">
          ${originalRoomLineHtml}
          ${metaPairHtml}
          ${extraHeaderLineHtml}
        </div>`
      : '';
  const infoItems = [...compactItems, ...fullItems];
  const notesHtml = footerItems.join('');

  card.innerHTML = `
    <div class="hotel-rank ${isTop3 ? 'top3' : ''}">#${rank}</div>

    <div class="hotel-card-header">
      <div class="hotel-card-header-main">
        <div class="hotel-name ${hotel.is_favorite ? 'favorite-name' : ''}">${escapeHtml(hotel.name)}</div>
        ${headerMetaHtml}
      </div>
    </div>

    <div class="hotel-info-grid">${infoItems.join('')}</div>

    ${notesHtml}

    <div class="hotel-actions">
      <button class="btn btn-secondary btn-sm" data-action="edit" data-id="${hotelIdAttr}">✏️ 编辑</button>
      <button class="btn btn-secondary btn-sm" data-action="favorite" data-id="${hotelIdAttr}" data-favorite="${hotel.is_favorite}">
        ${hotel.is_favorite ? '💔 取消收藏' : '❤️ 收藏'}
      </button>
      <button class="btn btn-danger btn-sm" data-action="delete" data-id="${hotelIdAttr}" data-confirming="false">
        🗑️ 删除
      </button>
      ${actionItems.join('')}
    </div>
  `;

  return card;
}

function cleanupHotelActionArtifacts(container) {
  container.querySelectorAll('.hotel-actions *').forEach((el) => {
    if (!el || !el.textContent) return;
    const txt = el.textContent.trim();
    if (/^[\.·\u2026\u22EF]{1,4}$/.test(txt)) {
      el.remove();
    }
  });
}

/* ---- 事件委托 ---- */

function handleHotelAction(e) {
  const btn = e.currentTarget || e.target;
  const action = btn.dataset.action;
  const id = btn.dataset.id;

  switch (action) {
    case 'edit':
      actions.editHotel(id);
      return;
    case 'favorite':
      actions.toggleFavorite(id, parseInt(btn.dataset.favorite));
      return;
    case 'delete': {
      if (btn.dataset.confirming === 'true') {
        resetDeleteConfirmation(btn);
        actions.deleteHotel(id);
      } else {
        startDeleteConfirmation(btn);
      }
      return;
    }
    case 'details':
      showHotelDetails(id);
      return;
    default:
      return;
  }
}

export function handleHotelListClick(event) {
  const websiteLink = event.target.closest('.hotel-website a[data-url]');
  if (websiteLink) {
    event.preventDefault();
    actions.openWebsite(websiteLink.dataset.url);
    return;
  }

  const actionButton = event.target.closest('button[data-action][data-id]');
  if (actionButton) {
    handleHotelAction({ currentTarget: actionButton });
    return;
  }

  if (event.target.closest('input, label, a, select, textarea')) {
    return;
  }

  const hotelRow = event.target.closest('.hotel-table-row');
  if (!hotelRow) return;

  toggleHotelRowSelection(hotelRow);
}

export function handleHotelDetailsClick(event) {
  const websiteLink = event.target.closest('.detail-link[data-url]');
  if (!websiteLink) return;

  event.preventDefault();
  actions.openWebsite(websiteLink.dataset.url);
}

export function handleHotelListChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;

  const action = target.dataset.action;
  if (action === 'toggle-select-all') {
    toggleSelectAll(target);
    return;
  }

  if (action === 'toggle-selection') {
    const hotelId = target.dataset.id;
    const row = /** @type {HTMLElement|null} */ (target.closest('.hotel-table-row'));
    if (!hotelId || !row) return;

    toggleHotelRowSelection(row, target.checked);
  }
}

/* ---- 详情弹窗 ---- */

export function showHotelDetails(id) {
  const hotel = state.hotels.find((h) => idsEqual(h.id, id));
  if (!hotel) return;

  const getField = (label, value, allowMultiline = false) => `
    <div class="detail-row">
      <div class="detail-label">${label}</div>
      <div class="detail-value">${allowMultiline ? escapeHtmlWithLineBreaks(value === null || value === undefined || value === '' ? '-' : String(value)) : escapeHtml(value === null || value === undefined || value === '' ? '-' : String(value))}</div>
    </div>`;

  const getLinkField = (label, value) => {
    const linkValue = value === null || value === undefined ? '' : String(value).trim();
    const displayValue = linkValue || '-';
    const linkHtml = linkValue
      ? `<a class="detail-link" href="#" data-url="${escapeHtml(linkValue)}" title="${escapeHtml(linkValue)}">${escapeHtml(linkValue)}</a>`
      : displayValue;

    return `
    <div class="detail-row">
      <div class="detail-label">${label}</div>
      <div class="detail-value detail-value-link">${linkHtml}</div>
    </div>`;
  };

  const content = [];
  content.push(getField('名称', hotel.name));
  content.push(getField('地址', hotel.address));
  content.push(getLinkField('网址', hotel.website));
  content.push(getField('总价格', hotel.total_price ? `¥${hotel.total_price}` : '-'));
  content.push(getField('日均价格', hotel.daily_price ? `¥${hotel.daily_price}` : '-'));
  content.push(getField('入住日期', hotel.check_in_date));
  content.push(getField('离店日期', hotel.check_out_date));
  content.push(getField('住宿天数', hotel.days));
  content.push(
    getField(
      '携程评分',
      hotel.ctrip_score !== undefined && hotel.ctrip_score !== null
        ? hotel.ctrip_score.toFixed(1)
        : '-'
    )
  );
  content.push(getField('目的地', hotel.destination));
  content.push(getField('距离', formatDistanceValue(hotel.distance, 'km')));
  content.push(
    getField('最近地铁站', formatSubwayInfo(hotel.subway_station, hotel.subway_distance, 'km'))
  );
  content.push(getField('公共交通时间', formatTransportValue(hotel.transport_time, 'min')));
  content.push(getField('公交路线', hotel.bus_route, true));
  content.push(getField('房间类型', hotel.room_type));
  content.push(getField('原始房型', hotel.original_room_type));
  content.push(getField('入住人数', hotel.room_count ? getRoomCountText(hotel.room_count) : '-'));
  content.push(getField('房间面积', hotel.room_area ? `${hotel.room_area} ㎡` : '-'));
  content.push(getField('备注', hotel.notes));
  content.push(getField('模板', hotel.template_info ? hotel.template_info.name : '-'));
  content.push(getField('收藏', hotel.is_favorite === 1 ? '是' : '否'));

  const detailsEl = document.getElementById('hotelDetailsContent');
  if (detailsEl) {
    detailsEl.innerHTML = `<div class="hotel-details-grid">${content.join('')}</div>`;
  }

  setModalActive('hotelDetailsModal', true);
}

export function closeHotelDetails() {
  setModalActive('hotelDetailsModal', false);
}

/* ---- 选择管理 ---- */

/**
 * @param {HTMLInputElement} checkbox
 */
function toggleSelectAll(checkbox) {
  const isVirtualMode = virtualHotelListState && virtualHotelListState.enabled;

  if (isVirtualMode) {
    const sortedHotels = getSortedVisibleHotels();
    if (checkbox.checked) {
      for (const hotel of sortedHotels) {
        state.selectedHotels.add(getSelectionKey(hotel.id));
      }
    } else {
      clearSelectedHotels();
    }
    const itemsContainer = document.querySelector('.virtual-items, .virtual-card-items');
    if (itemsContainer) {
      itemsContainer.querySelectorAll('.hotel-table-row, .hotel-card').forEach((row) => {
        const hotelId = row.dataset.id;
        if (!hotelId) return;
        row.classList.toggle('selected', checkbox.checked);
        const cb = row.querySelector('input[type="checkbox"]');
        if (cb instanceof HTMLInputElement) cb.checked = checkbox.checked;
      });
    }
    syncVirtualSelectAllCheckboxState(sortedHotels);
    resetBatchDeleteConfirmation({ count: state.selectedHotels.size });
    return;
  }

  const hotelRows = /** @type {NodeListOf<HTMLElement>} */ (
    document.querySelectorAll('.hotel-table-row')
  );

  if (checkbox.checked) {
    hotelRows.forEach((row) => {
      const hotelId = getSelectionKey(row.dataset.id);
      state.selectedHotels.add(hotelId);
      row.classList.add('selected');
      const cb = /** @type {HTMLInputElement|null} */ (row.querySelector('input[type="checkbox"]'));
      if (cb) cb.checked = true;
    });
  } else {
    clearSelectedHotels();
    hotelRows.forEach((row) => {
      row.classList.remove('selected');
      const cb = /** @type {HTMLInputElement|null} */ (row.querySelector('input[type="checkbox"]'));
      if (cb) cb.checked = false;
    });
  }

  syncSelectAllCheckboxState();
  resetBatchDeleteConfirmation({ count: state.selectedHotels.size });
}

/**
 * @param {HTMLElement|null} row
 * @param {boolean} checked
 */
function setHotelRowSelection(row, checked) {
  if (!row) return;
  const hotelId = row.dataset.id;
  if (!hotelId) return;
  const hotelKey = getSelectionKey(hotelId);
  const checkbox = /** @type {HTMLInputElement|null} */ (
    row.querySelector('input[data-action="toggle-selection"]')
  );
  if (checked) {
    state.selectedHotels.add(hotelKey);
  } else {
    state.selectedHotels.delete(hotelKey);
  }
  row.classList.toggle('selected', checked);
  if (checkbox) checkbox.checked = checked;
}

/**
 * @param {HTMLElement|null} row
 * @param {boolean|null} [nextChecked]
 */
function toggleHotelRowSelection(row, nextChecked = null) {
  if (!row) return;
  const hotelId = row.dataset.id;
  if (!hotelId) return;
  const shouldSelect =
    typeof nextChecked === 'boolean'
      ? nextChecked
      : !state.selectedHotels.has(getSelectionKey(hotelId));
  setHotelRowSelection(row, shouldSelect);
  syncSelectAllCheckboxState();
  resetBatchDeleteConfirmation({ count: state.selectedHotels.size });
}

function syncSelectAllCheckboxState() {
  const isVirtualMode = virtualHotelListState && virtualHotelListState.enabled;
  if (isVirtualMode) {
    const sortedHotels = getSortedVisibleHotels();
    syncVirtualSelectAllCheckboxState(sortedHotels);
    return;
  }

  const selectAllCheckbox = /** @type {HTMLInputElement|null} */ ($('selectAll'));
  if (!selectAllCheckbox) return;
  const hotelRows = /** @type {NodeListOf<HTMLElement>} */ (
    document.querySelectorAll('.hotel-table-row')
  );
  if (hotelRows.length === 0) {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
    return;
  }
  const selectedCount = Array.from(hotelRows).filter((row) =>
    state.selectedHotels.has(getSelectionKey(row.dataset.id))
  ).length;
  selectAllCheckbox.checked = selectedCount > 0 && selectedCount === hotelRows.length;
  selectAllCheckbox.indeterminate = selectedCount > 0 && selectedCount < hotelRows.length;
}

/* ---- 视图切换 ---- */

export function toggleViewMode() {
  setViewMode(state.viewMode === 'card' ? 'list' : 'card');

  const viewIcon = document.getElementById('viewIcon');
  const viewText = document.getElementById('viewText');
  const batchDeleteBtn = $('batchDeleteBtn');
  const ruleDeleteBtn = $('ruleDeleteBtn');

  if (state.viewMode === 'list') {
    if (viewIcon) viewIcon.textContent = '📝';
    if (viewText) viewText.textContent = '行式';
    if (batchDeleteBtn) batchDeleteBtn.style.display = 'inline-flex';
    if (ruleDeleteBtn) ruleDeleteBtn.style.display = 'none';
  } else {
    if (viewIcon) viewIcon.textContent = '🛏️';
    if (viewText) viewText.textContent = '卡片';
    if (batchDeleteBtn) batchDeleteBtn.style.display = 'none';
    if (ruleDeleteBtn) ruleDeleteBtn.style.display = 'inline-flex';
    clearSelectedHotels();
  }

  resetBatchDeleteConfirmation({ count: state.selectedHotels.size });
  requestHotelListRender({ reason: 'view-mode-change', forceFull: true });
}

function getCurrentCardHotels() {
  return applyFiltersToHotels(state.hotels, state.currentFilters);
}

function getRuleDeleteThresholds() {
  const parseThreshold = (rawValue, label) => {
    const normalized = String(rawValue ?? '').trim();
    if (normalized === '') {
      return { value: null };
    }

    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return { error: `${label}必须是大于或等于 0 的数字` };
    }

    return { value: parsed };
  };

  const price = parseThreshold(getValue('ruleDeletePrice'), '总价格阈值');
  if (price.error) return price;

  const subwayDistance = parseThreshold(getValue('ruleDeleteSubwayDistance'), '地铁站距离阈值');
  if (subwayDistance.error) return subwayDistance;

  const transportTime = parseThreshold(getValue('ruleDeleteTransportTime'), '公共交通时间阈值');
  if (transportTime.error) return transportTime;

  return {
    value: {
      price: price.value,
      subwayDistance: subwayDistance.value,
      transportTime: transportTime.value
    }
  };
}

function getRuleDeleteCandidates(thresholds, sourceHotels = getCurrentCardHotels()) {
  const hasActiveRule =
    thresholds.price !== null ||
    thresholds.subwayDistance !== null ||
    thresholds.transportTime !== null;

  if (!hasActiveRule) {
    return [];
  }

  return sourceHotels.filter((hotel) => {
    const totalPrice = Number(hotel.total_price);
    const subwayDistance = extractDistanceNumber(hotel.subway_distance);
    const transportTime = extractTimeNumber(hotel.transport_time);

    return (
      (thresholds.price !== null && Number.isFinite(totalPrice) && totalPrice > thresholds.price) ||
      (thresholds.subwayDistance !== null &&
        subwayDistance !== null &&
        subwayDistance > thresholds.subwayDistance) ||
      (thresholds.transportTime !== null &&
        transportTime !== null &&
        transportTime > thresholds.transportTime)
    );
  });
}

export function updateRuleDeletePreview() {
  const summaryText = $('ruleDeleteSummaryText');
  const confirmBtn = /** @type {HTMLButtonElement|null} */ ($('ruleDeleteConfirmBtn'));
  if (!summaryText || !confirmBtn) {
    return;
  }
  if (!ruleDeleteInProgress) {
    resetRuleDeleteConfirmation();
  }

  const visibleHotels = getCurrentCardHotels();
  const thresholdsResult = getRuleDeleteThresholds();

  if (thresholdsResult.error) {
    summaryText.textContent = thresholdsResult.error;
    confirmBtn.disabled = true;
    return;
  }

  const candidates = getRuleDeleteCandidates(thresholdsResult.value, visibleHotels);
  summaryText.textContent = `当前卡片结果 ${visibleHotels.length} 条，命中规则 ${candidates.length} 条`;
  confirmBtn.disabled = ruleDeleteInProgress || candidates.length === 0;
}

export function openRuleDeleteModal() {
  if (state.viewMode !== 'card') {
    showNotification('规则删除仅在卡片视图下可用', 'info');
    return;
  }

  const priceInput = getFormValueElement('ruleDeletePrice');
  const subwayInput = getFormValueElement('ruleDeleteSubwayDistance');
  const transportInput = getFormValueElement('ruleDeleteTransportTime');
  if (priceInput) priceInput.value = '';
  if (subwayInput) subwayInput.value = '';
  if (transportInput) transportInput.value = '';
  resetRuleDeleteConfirmation();

  setModalActive(RULE_DELETE_MODAL_ID, true);
  updateRuleDeletePreview();
}

export function closeRuleDeleteModal(force = false) {
  if (ruleDeleteInProgress && !force) {
    return;
  }

  setModalActive(RULE_DELETE_MODAL_ID, false);
  resetRuleDeleteConfirmation();
}

export async function confirmRuleDelete() {
  if (ruleDeleteInProgress) {
    return;
  }

  const thresholdsResult = getRuleDeleteThresholds();
  if (thresholdsResult.error) {
    showNotification(thresholdsResult.error, 'error');
    updateRuleDeletePreview();
    return;
  }

  const visibleHotels = getCurrentCardHotels();
  const candidates = getRuleDeleteCandidates(thresholdsResult.value, visibleHotels);

  if (candidates.length === 0) {
    showNotification('没有命中规则的宾馆', 'info');
    updateRuleDeletePreview();
    return;
  }

  const confirmBtn = /** @type {HTMLButtonElement|null} */ ($('ruleDeleteConfirmBtn'));
  if (confirmBtn && confirmBtn.dataset.confirming !== 'true') {
    startActionButtonConfirmation(confirmBtn, {
      variantClass: 'btn-danger',
      confirmHtml: `<span>⚠️</span> 确认删除 (${candidates.length})`,
      timeout: 2600
    });
    return;
  }

  const originalHtml = confirmBtn ? confirmBtn.innerHTML : '';
  let previousHotels = null;

  try {
    ruleDeleteInProgress = true;
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<span>⏳</span> 正在删除...';
    }

    const hotelIds = candidates.map((hotel) => getSelectionKey(hotel.id));
    previousHotels = state.hotels.slice();
    const deleteIdSet = new Set(hotelIds);

    const result = await window.electronAPI.deleteMultipleHotels(hotelIds);
    if (!result || !result.success) {
      throw new Error(result?.error || '规则删除失败');
    }

    setHotels(previousHotels.filter((hotel) => !deleteIdSet.has(getSelectionKey(hotel.id))));
    markRankingCacheDirty();
    requestHotelListRender({ reason: 'rule-delete', forceFull: true });
    closeRuleDeleteModal(true);
    showNotification(`成功删除 ${candidates.length} 个命中规则的宾馆`, 'success');
  } catch (error) {
    console.error('规则删除失败:', error);
    if (previousHotels) {
      setHotels(previousHotels);
      markRankingCacheDirty();
      requestHotelListRender({ reason: 'rule-delete', forceFull: true });
    }
    showNotification('规则删除失败，请重试', 'error');
  } finally {
    ruleDeleteInProgress = false;
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = originalHtml || '<span>🗑️</span> 删除命中项';
      resetRuleDeleteConfirmation();
    }
    updateRuleDeletePreview();
  }
}

export function toggleHotelSelection(hotelId) {
  const hotelKey = getSelectionKey(hotelId);
  if (state.selectedHotels.has(hotelKey)) {
    state.selectedHotels.delete(hotelKey);
  } else {
    state.selectedHotels.add(hotelKey);
  }
  syncSelectAllCheckboxState();
  resetBatchDeleteConfirmation({ count: state.selectedHotels.size });
}

/* ---- 筛选 UI ---- */

function getSelectedSortMode() {
  const checked = document.querySelector('input[name="sortMode"]:checked');
  return checked instanceof HTMLInputElement ? checked.value : DEFAULT_SORT_MODE;
}

export function applyFilters() {
  replaceCurrentFilters({
    name: getValue('filterName'),
    score: getValue('filterScore'),
    favorite: getValue('filterFavorite'),
    template: getValue('filterTemplate'),
    transportTime: getValue('filterTransportTime'),
    subwayDistance: getValue('filterSubwayDistance'),
    sortMode: getSelectedSortMode()
  });
  markRankingCacheDirty();
  requestHotelListRender({ reason: 'sort-change', forceFull: true });
}

export function clearFilters() {
  [
    'filterName',
    'filterScore',
    'filterFavorite',
    'filterTemplate',
    'filterTransportTime',
    'filterSubwayDistance'
  ].forEach((id) => {
    const el = getFormValueElement(id);
    if (el) el.value = '';
  });

  replaceCurrentFilters({
    sortMode: getSelectedSortMode()
  });

  refreshCustomSelects();
  markRankingCacheDirty();
  requestHotelListRender({ reason: 'filter-change', forceFull: true });
}

/* ---- 注册到 actions ---- */
actions.renderHotelList = renderHotelList;
actions.requestHotelListRender = requestHotelListRender;
actions.showHotelDetails = showHotelDetails;
