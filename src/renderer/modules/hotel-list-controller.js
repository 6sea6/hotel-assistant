/**
 * 宾馆列表渲染 —— 卡片视图、行式视图、批量渲染、事件委托和选择管理。
 */

import {
  state,
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
  setHotelNameFilterOptionSignature
} from './state.js';
import {
  $,
  getValue,
  escapeHtml,
  escapeHtmlWithLineBreaks,
  idsEqual,
  getSelectionKey,
  getRoomCountText,
  normalizeFilterOptionKey
} from './dom-helpers.js';
import { showNotification } from './notification.js';
import { perfStart, perfEnd } from './perf.js';
import {
  isHotelInputPriorityActive,
  clearPendingHotelRenderTimers,
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
  DEFAULT_SORT_MODE,
  formatSubwayInfo,
  formatDistanceValue,
  formatTransportValue,
  extractDistanceNumber,
  extractTimeNumber
} from './hotel-filters.js';
import { getHotelListRenderDecision } from './hotel-render-decision.js';
import { getSortedVisibleHotels, getVisibleHotelListSummary } from './hotel-list-model.js';
import { actions } from './actions.js';
import { refreshCustomSelects } from './custom-select.js';
import { shouldUseVirtualHotelList, getVirtualScrollThreshold } from './hotel-virtual-list.js';
import { renderHotelListPreparingState } from './hotel-list-empty-state.js';
import { createHotelListRow, renderHotelListView } from './hotel-list-table-renderer.js';
import {
  cleanupHotelActionArtifacts,
  createHotelCard,
  renderHotelCardGrid
} from './hotel-list-card-renderer.js';
import {
  renderVirtualHotelCardGrid,
  renderVirtualHotelListView,
  resetVirtualHotelListState
} from './hotel-list-virtual-adapter.js';
import {
  configureHotelListSelection,
  syncSelectAllCheckboxState,
  toggleHotelRowSelection,
  toggleSelectAll
} from './hotel-list-selection.js';

const RULE_DELETE_MODAL_ID = 'ruleDeleteModal';
let ruleDeleteInProgress = false;
export { shouldFullRerender } from './hotel-render-decision.js';

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

configureHotelListSelection({ getSortedVisibleHotels });

function updateVisibleHotelSummary(sortedHotels) {
  const countElement = document.getElementById('hotelCount');
  const roomTypeCountElement = document.getElementById('roomTypeCount');
  if (!countElement || !roomTypeCountElement) return false;

  const summary = getVisibleHotelListSummary(sortedHotels);
  countElement.textContent = String(summary.hotelCount);
  roomTypeCountElement.textContent = String(summary.roomTypeCount);
  return true;
}

function getRenderedHotelNodes(container) {
  const nodeMap = state.renderedHotelNodeMap;
  if (nodeMap instanceof Map) {
    return Array.from(nodeMap.values()).filter(
      (node) =>
        node &&
        node.dataset &&
        (!container || typeof container.contains !== 'function' || container.contains(node))
    );
  }

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
        state.renderedHotelNodeMap?.delete?.(getSelectionKey(id));
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
      state.renderedHotelNodeMap?.clear?.();
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
    state.renderedHotelNodeMap?.clear?.();
    container.className = state.viewMode === 'list' ? 'hotel-list list-view' : 'hotel-list';

    try {
      const virtualScrollThreshold = getVirtualScrollThreshold(state.viewMode);
      if (shouldUseVirtualHotelList(sortedHotels.length, { threshold: virtualScrollThreshold })) {
        if (state.viewMode === 'list') {
          renderVirtualHotelListView(
            container,
            sortedHotels,
            taskVersion,
            perfLabel,
            options.reason,
            {
              finishHotelRender
            }
          );
        } else {
          renderVirtualHotelCardGrid(
            container,
            sortedHotels,
            taskVersion,
            perfLabel,
            options.reason,
            {
              finishHotelRender
            }
          );
        }
        return;
      }
    } catch (error) {
      console.error('[virtual-list] fallback to full render', error);
    }

    if (state.viewMode === 'list') {
      renderHotelListView(container, sortedHotels, taskVersion, perfLabel, {
        finishHotelRender,
        syncSelectAllCheckboxState
      });
    } else {
      renderHotelCardGrid(container, sortedHotels, taskVersion, perfLabel, {
        finishHotelRender
      });
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

/* ---- 事件委托 ---- */

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

  setModalActive('hotelDetailsModal', true);

  const detailsEl = document.getElementById('hotelDetailsContent');
  if (detailsEl) {
    detailsEl.innerHTML = `<div class="hotel-details-grid">${content.join('')}</div>`;
  }
}

export function closeHotelDetails() {
  setModalActive('hotelDetailsModal', false);
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

  setModalActive(RULE_DELETE_MODAL_ID, true);

  const priceInput = getFormValueElement('ruleDeletePrice');
  const subwayInput = getFormValueElement('ruleDeleteSubwayDistance');
  const transportInput = getFormValueElement('ruleDeleteTransportTime');
  if (priceInput) priceInput.value = '';
  if (subwayInput) subwayInput.value = '';
  if (transportInput) transportInput.value = '';
  resetRuleDeleteConfirmation();

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
