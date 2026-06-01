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

let getSortedVisibleHotels = () => [];

export function configureHotelListSelection(dependencies = {}) {
  if (typeof dependencies.getSortedVisibleHotels === 'function') {
    getSortedVisibleHotels = dependencies.getSortedVisibleHotels;
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
