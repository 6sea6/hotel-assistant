/**
 * 宾馆列表局部更新 —— 只处理已挂载节点的 patch / 删除 / 排名标签同步。
 */

import { state, updateCurrentFilters, bumpHotelListRenderVersion } from './state.js';
import { $, idsEqual, getSelectionKey } from './dom-helpers.js';
import { resetBatchDeleteConfirmation } from './ui-utils.js';
import { getSortedVisibleHotels, getVisibleHotelListSummary } from './hotel-list-model.js';
import { syncHotelNameFilterOptions } from './hotel-list-filter-options.js';
import { createHotelListRow } from './hotel-list-table-renderer.js';
import { cleanupHotelActionArtifacts, createHotelCard } from './hotel-list-card-renderer.js';
import { syncSelectAllCheckboxState } from './hotel-list-selection.js';

export function updateVisibleHotelSummary(sortedHotels) {
  const countElement = document.getElementById('hotelCount');
  const roomTypeCountElement = document.getElementById('roomTypeCount');
  if (!countElement || !roomTypeCountElement) return false;

  const summary = getVisibleHotelListSummary(sortedHotels);
  countElement.textContent = String(summary.hotelCount);
  roomTypeCountElement.textContent = String(summary.roomTypeCount);
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
