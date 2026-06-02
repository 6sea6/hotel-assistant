/**
 * 宾馆列表选择状态管理。
 */

import { state, clearSelectedHotels } from './state.js';
import { $, getSelectionKey } from './dom-helpers.js';
import { resetBatchDeleteConfirmation } from './ui-utils.js';
import {
  getVirtualHotelListState,
  syncVirtualSelectAllCheckboxState
} from './hotel-list-virtual-adapter.js';

/** @type {() => import('../../shared/contracts').NormalizedHotelRecord[]} */
let getSortedVisibleHotels = () => [];

export function configureHotelListSelection(dependencies = {}) {
  if (typeof dependencies.getSortedVisibleHotels === 'function') {
    getSortedVisibleHotels = dependencies.getSortedVisibleHotels;
  }
}

/**
 * @returns {HTMLElement[]}
 */
function getMountedHotelNodes() {
  const nodeMap = state.renderedHotelNodeMap;
  if (nodeMap instanceof Map) {
    return Array.from(nodeMap.values()).filter((node) => node && node.dataset && node.dataset.id);
  }

  const container = $('hotelList');
  if (!container || typeof container.querySelectorAll !== 'function') {
    return [];
  }
  return /** @type {HTMLElement[]} */ (
    Array.from(container.querySelectorAll('.hotel-table-row[data-id], .hotel-card[data-id]'))
  );
}

/**
 * @param {string|number|null|undefined} hotelId
 * @returns {HTMLElement|null}
 */
function getMountedHotelNode(hotelId) {
  const hotelKey = getSelectionKey(hotelId);
  const nodeMap = state.renderedHotelNodeMap;
  if (nodeMap instanceof Map) {
    return nodeMap.get(hotelKey) || null;
  }
  return (
    getMountedHotelNodes().find((node) => getSelectionKey(node.dataset.id) === hotelKey) || null
  );
}

/**
 * @param {HTMLElement[]} [mountedNodes]
 * @returns {string[]}
 */
function getSelectionScopeIds(mountedNodes = getMountedHotelNodes()) {
  const sortedHotels = getSortedVisibleHotels();
  if (Array.isArray(sortedHotels) && sortedHotels.length > 0) {
    return sortedHotels.map((hotel) => getSelectionKey(hotel.id));
  }

  return mountedNodes.map((node) => getSelectionKey(node.dataset.id)).filter(Boolean);
}

/**
 * @param {HTMLElement|null} node
 * @param {boolean} checked
 */
function applyMountedNodeSelection(node, checked) {
  if (!node) return;
  node.classList.toggle('selected', checked);
  const checkbox = /** @type {HTMLInputElement|null} */ (
    node.querySelector('input[data-action="toggle-selection"], input[type="checkbox"]')
  );
  if (checkbox) checkbox.checked = checked;
}

function syncMountedNodeSelectionStates() {
  for (const node of getMountedHotelNodes()) {
    applyMountedNodeSelection(node, state.selectedHotels.has(getSelectionKey(node.dataset.id)));
  }
}

/**
 * @param {HTMLInputElement} checkbox
 */
export function toggleSelectAll(checkbox) {
  const virtualState = getVirtualHotelListState();
  const isVirtualMode = virtualState && virtualState.enabled;

  if (isVirtualMode) {
    const sortedHotels = getSortedVisibleHotels();
    if (checkbox.checked) {
      for (const hotel of sortedHotels) {
        state.selectedHotels.add(getSelectionKey(hotel.id));
      }
    } else {
      clearSelectedHotels();
    }
    syncMountedNodeSelectionStates();
    syncVirtualSelectAllCheckboxState(sortedHotels);
    resetBatchDeleteConfirmation({ count: state.selectedHotels.size });
    return;
  }

  const mountedNodes = getMountedHotelNodes();
  const selectionIds = getSelectionScopeIds(mountedNodes);

  if (checkbox.checked) {
    selectionIds.forEach((hotelId) => state.selectedHotels.add(hotelId));
  } else {
    clearSelectedHotels();
  }

  syncMountedNodeSelectionStates();
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
  applyMountedNodeSelection(row, checked);
  if (checkbox) checkbox.checked = checked;
}

/**
 * @param {HTMLElement|null} row
 * @param {boolean|null} [nextChecked]
 */
export function toggleHotelRowSelection(row, nextChecked = null) {
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

export function syncSelectAllCheckboxState() {
  const virtualState = getVirtualHotelListState();
  const isVirtualMode = virtualState && virtualState.enabled;
  if (isVirtualMode) {
    const sortedHotels = getSortedVisibleHotels();
    syncVirtualSelectAllCheckboxState(sortedHotels);
    return;
  }

  const selectAllCheckbox = /** @type {HTMLInputElement|null} */ ($('selectAll'));
  if (!selectAllCheckbox) return;
  const mountedNodes = getMountedHotelNodes();
  const selectionIds = getSelectionScopeIds(mountedNodes);
  if (selectionIds.length === 0) {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
    return;
  }
  const selectedCount = selectionIds.filter((hotelId) => state.selectedHotels.has(hotelId)).length;
  selectAllCheckbox.checked = selectedCount > 0 && selectedCount === selectionIds.length;
  selectAllCheckbox.indeterminate = selectedCount > 0 && selectedCount < selectionIds.length;
}

export function toggleHotelSelection(hotelId) {
  const hotelKey = getSelectionKey(hotelId);
  if (state.selectedHotels.has(hotelKey)) {
    state.selectedHotels.delete(hotelKey);
  } else {
    state.selectedHotels.add(hotelKey);
  }
  applyMountedNodeSelection(getMountedHotelNode(hotelKey), state.selectedHotels.has(hotelKey));
  syncSelectAllCheckboxState();
  resetBatchDeleteConfirmation({ count: state.selectedHotels.size });
}
