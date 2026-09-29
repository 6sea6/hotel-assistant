/**
 * 宾馆列表局部更新 —— 只处理已挂载节点的 patch / 删除 / 排名标签同步。
 */

import { state, updateCurrentFilters, bumpHotelListRenderVersion } from './state.js';
import { $, idsEqual, getSelectionKey } from './dom-helpers.js';
import { resetBatchDeleteConfirmation } from './ui-utils.js';
import { getSortedVisibleHotels, getVisibleHotelListSummary } from './hotel-list-model.js';
import { syncHotelNameFilterOptions } from './hotel-list-filter-options.js';
import { createHotelListRow } from './hotel-list-table-renderer.js';
import {
  alignHotelCardTitleRows,
  createHotelCard,
  getCurrentHotelCardVisibleKeys
} from './hotel-list-card-renderer.js';
import { syncSelectAllCheckboxState } from './hotel-list-selection.js';
import { getActiveHotelFilterCount } from './hotel-filters.js';

export function updateVisibleHotelSummary(sortedHotels) {
  const countElement = document.getElementById('hotelCount');
  const roomTypeCountElement = document.getElementById('roomTypeCount');
  if (!countElement || !roomTypeCountElement) return false;

  const summary = getVisibleHotelListSummary(sortedHotels);
  countElement.textContent = String(summary.hotelCount);
  roomTypeCountElement.textContent = String(summary.roomTypeCount);

  const matchCountElement = document.getElementById('filterMatchCount');
  const totalCountElement = document.getElementById('filterTotalCount');
  const activeCountElement = document.getElementById('filterActiveCount');
  const filterStatusElement = document.getElementById('filterStatus');
  const clearButton = /** @type {HTMLButtonElement|null} */ (
    document.getElementById('clearFiltersBtn')
  );
  const totalSummary = getVisibleHotelListSummary(state.hotels);
  const activeFilterCount = getActiveHotelFilterCount(state.currentFilters);

  if (matchCountElement) matchCountElement.textContent = String(summary.hotelCount);
  if (totalCountElement) totalCountElement.textContent = String(totalSummary.hotelCount);
  if (activeCountElement) activeCountElement.textContent = String(activeFilterCount);
  if (filterStatusElement) {
    filterStatusElement.textContent =
      activeFilterCount > 0
        ? `已命中 ${summary.hotelCount} / ${totalSummary.hotelCount} 家宾馆，${activeFilterCount} 项筛选已生效`
        : `共 ${totalSummary.hotelCount} 家宾馆，尚未启用筛选`;
  }
  if (clearButton) clearButton.disabled = activeFilterCount === 0;
  return true;
}

export function getRenderedHotelNodes(container) {
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

function hasFavoriteFilterActive() {
  return state.currentFilters.favorite !== undefined && state.currentFilters.favorite !== '';
}

function hasVirtualHotelList(container) {
  return Boolean(container.querySelector('.virtual-card-scroll, .virtual-list-scroll'));
}

function syncRenderedRanks(nodes) {
  nodes.forEach((node, index) => {
    const rank = index + 1;
    const rankElement = node.querySelector('.hotel-rank, .rank-badge');
    if (!rankElement) return;
    rankElement.textContent = `#${rank}`;
    rankElement.classList.toggle('top3', rank <= 3);
  });
}

/**
 * Remove a visible non-virtual row/card in place. Virtualized and empty-result
 * cases deliberately fall back to the full renderer.
 * @param {HTMLElement} container
 * @param {Array<string|number>} changedIds
 * @returns {boolean}
 */
function patchDeletedHotelCards(container, changedIds) {
  if (hasVirtualHotelList(container)) return false;

  const deletedKeys = new Set(changedIds.map((id) => getSelectionKey(id)));
  const renderedNodes = getRenderedHotelNodes(container);
  const deletedNodes = renderedNodes.filter((node) =>
    deletedKeys.has(getSelectionKey(node.dataset.id))
  );
  const remainingNodes = renderedNodes.filter(
    (node) => !deletedKeys.has(getSelectionKey(node.dataset.id))
  );
  const sortedHotels = getSortedVisibleHotels();

  if (sortedHotels.length === 0 || remainingNodes.length !== sortedHotels.length) return false;
  const orderMatches = remainingNodes.every((node, index) =>
    idsEqual(node.dataset.id, sortedHotels[index]?.id)
  );
  if (!orderMatches || !updateVisibleHotelSummary(sortedHotels)) return false;
  if (deletedNodes.some((node) => typeof node.remove !== 'function')) return false;

  const currentNameFilter = String(state.currentFilters.name || '');
  syncHotelNameFilterOptions({ selectedValue: currentNameFilter });
  for (const key of deletedKeys) {
    state.selectedHotels.delete(key);
    state.renderedHotelNodeMap?.delete?.(key);
  }

  if (deletedNodes.length > 0) {
    bumpHotelListRenderVersion();
    deletedNodes.forEach((node) => node.remove());
    syncRenderedRanks(remainingNodes);
    if (state.viewMode !== 'list') alignHotelCardTitleRows(container);
  }

  syncSelectAllCheckboxState();
  resetBatchDeleteConfirmation({ count: state.selectedHotels.size });
  return true;
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

  if (options.reason === 'hotel-delete') return patchDeletedHotelCards(container, changedIds);

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
  if (renderedNodes.length !== sortedHotels.length) {
    return false;
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
  const visibleKeys = state.viewMode === 'list' ? null : getCurrentHotelCardVisibleKeys();
  for (const item of patchPlan) {
    const replacement =
      state.viewMode === 'list'
        ? createHotelListRow(item.hotel, item.index)
        : createHotelCard(item.hotel, item.index, visibleKeys);
    item.existingNode.replaceWith(replacement);
  }

  if (state.viewMode !== 'list') {
    alignHotelCardTitleRows(container);
  }
  syncSelectAllCheckboxState();
  resetBatchDeleteConfirmation({ count: state.selectedHotels.size });
  return true;
}
