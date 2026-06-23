/**
 * 宾馆列表虚拟滚动适配器。
 */

import {
  Virtualizer,
  elementScroll,
  observeElementOffset,
  observeElementRect
} from './tanstack-virtual-core.js';
import {
  state,
  buildVisibleHotelsFiltersKey,
  hotelListScrollMemory,
  saveScrollMemory,
  getScrollBehaviorForReason
} from './state.js';
import { $, getSelectionKey } from './dom-helpers.js';
import {
  createDefaultVirtualState,
  calculateCardColumns,
  VIRTUAL_OVERSCAN,
  LIST_ROW_ESTIMATED_HEIGHT,
  CARD_ESTIMATED_HEIGHT,
  CARD_GAP
} from './hotel-virtual-list.js';
import { createHotelListRow } from './hotel-list-table-renderer.js';
import {
  alignHotelCardTitleRows,
  createHotelCard,
  getCurrentHotelCardVisibleKeys
} from './hotel-list-card-renderer.js';

/** @type {ReturnType<typeof createDefaultVirtualState>|null} */
let virtualHotelListState = null;
let virtualScrollRafId = 0;
let virtualResizeObserver = null;
let virtualResizeRafId = 0;
let virtualRenderCleanup = null;

/* ---- 虚拟滚动：行式视图 ---- */

export function renderVirtualHotelListView(
  container,
  sortedHotels,
  taskVersion,
  perfLabel,
  reason,
  options = {}
) {
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
  scrollContainer.className = 'hotel-table-body virtual-scroll-body virtual-list-scroll';

  const itemsContainer = document.createElement('div');
  itemsContainer.className = 'virtual-items';

  scrollContainer.appendChild(itemsContainer);
  listScrollShell.appendChild(scrollContainer);
  table.appendChild(listScrollShell);
  container.appendChild(table);

  renderVirtualHotelCollection({
    mode: 'list',
    scrollContainer,
    itemsContainer,
    sortedHotels,
    taskVersion,
    perfLabel,
    reason,
    options,
    count: sortedHotels.length,
    estimateSize: () => LIST_ROW_ESTIMATED_HEIGHT,
    renderItems({ virtualizer, virtualItems }) {
      const fragment = document.createDocumentFragment();

      for (const virtualItem of virtualItems) {
        const hotel = sortedHotels[virtualItem.index];
        if (!hotel) continue;

        const row = createHotelListRow(hotel, virtualItem.index);
        row.dataset.index = String(virtualItem.index);
        row.style.position = 'absolute';
        row.style.left = '0';
        row.style.top = '0';
        row.style.width = '100%';
        row.style.transform = `translateY(${virtualItem.start}px)`;
        row.style.willChange = 'transform';
        fragment.appendChild(row);
      }

      itemsContainer.innerHTML = '';
      itemsContainer.appendChild(fragment);

      const rows = /** @type {HTMLElement[]} */ (
        Array.from(itemsContainer.querySelectorAll('.hotel-table-row[data-index]')).filter(
          (row) => row instanceof HTMLElement
        )
      );
      for (const row of rows) {
        virtualizer.measureElement(row);
      }
    },
    updateVirtualState(virtualItems, virtualizer) {
      updateListVirtualState(virtualItems, virtualizer);
    },
    getAnchorHotelIndex(virtualItems) {
      if (!virtualItems.length) return 0;
      return virtualItems[Math.floor(virtualItems.length / 2)].index;
    },
    afterInitialRender() {
      syncVirtualSelectAllCheckboxState(sortedHotels);
    }
  });
}

/**
 * @param {{
 *   mode: 'card'|'list',
 *   scrollContainer: HTMLElement,
 *   itemsContainer: HTMLElement,
 *   sortedHotels: Array<{ id?: string|number|null }>,
 *   taskVersion: number,
 *   perfLabel: string,
 *   reason?: string,
 *   options?: { finishHotelRender?: (taskVersion: number, perfLabel: string) => void },
 *   count: number,
 *   estimateSize: (index: number) => number,
 *   gap?: number,
 *   renderItems: (params: { virtualizer: Virtualizer<any, any>, virtualItems: Array<{ index: number, start: number, size: number }> }) => void,
 *   updateVirtualState: (virtualItems: Array<{ index: number, start: number, size: number }>, virtualizer: Virtualizer<any, any>) => void,
 *   getAnchorHotelIndex: (virtualItems: Array<{ index: number, start: number, size: number }>) => number,
 *   afterInitialRender?: (() => void)|null
 * }} params
 * @returns {{ scheduleVirtualUpdate: () => void, updateVirtualItems: () => void, resetRenderedRange: () => void, setVirtualizerCount: (count: number) => void, measure: () => void }}
 */
function renderVirtualHotelCollection(params) {
  const {
    mode,
    scrollContainer,
    itemsContainer,
    sortedHotels,
    taskVersion,
    perfLabel,
    reason,
    options = {},
    count,
    estimateSize,
    gap = 0,
    renderItems,
    updateVirtualState,
    getAnchorHotelIndex,
    afterInitialRender = null
  } = params;

  let virtualizerCount = count;
  let lastRenderedRangeKey = '';
  let saveScrollRafId = 0;
  let didFinishInitialRender = false;
  /** @type {Virtualizer<any, any>|null} */
  let virtualizer = null;
  let cleanupVirtualizer = () => {};

  const finishRender = () => {
    if (didFinishInitialRender) return;
    didFinishInitialRender = true;
    options.finishHotelRender?.(taskVersion, perfLabel);
  };

  const buildVirtualizerOptions = () => ({
    count: virtualizerCount,
    getScrollElement: () => scrollContainer,
    estimateSize,
    overscan: VIRTUAL_OVERSCAN,
    gap,
    scrollToFn: elementScroll,
    observeElementRect,
    observeElementOffset,
    initialRect: {
      width: scrollContainer.clientWidth || 0,
      height: scrollContainer.clientHeight || 600
    },
    onChange: () => {
      scheduleVirtualUpdate();
    }
  });

  const resetRenderedRange = () => {
    lastRenderedRangeKey = '';
  };

  const getRangeKey = (virtualItems) =>
    virtualItems
      .map((item) => `${item.index}:${Math.round(item.start)}:${Math.round(item.size)}`)
      .join('|');

  const updateVirtualItems = () => {
    if (!virtualHotelListState) return;
    const currentVirtualizer = virtualizer;
    if (!currentVirtualizer) return;

    if (taskVersion !== state.hotelListRenderVersion) {
      finishRender();
      return;
    }

    const virtualItems = currentVirtualizer.getVirtualItems();
    const totalSize = currentVirtualizer.getTotalSize();

    itemsContainer.style.height = `${totalSize}px`;
    virtualHotelListState.scrollTop = scrollContainer.scrollTop;
    virtualHotelListState.viewportHeight = scrollContainer.clientHeight || 600;
    virtualHotelListState.totalHeight = totalSize;
    updateVirtualState(virtualItems, currentVirtualizer);

    const rangeKey = `${mode}:${virtualizerCount}:${getRangeKey(virtualItems)}`;
    if (rangeKey === lastRenderedRangeKey) {
      return;
    }
    lastRenderedRangeKey = rangeKey;

    state.renderedHotelNodeMap?.clear?.();
    renderItems({ virtualizer: currentVirtualizer, virtualItems });
  };

  const scheduleVirtualUpdate = () => {
    if (!virtualizer) return;
    if (virtualScrollRafId) return;
    virtualScrollRafId = requestAnimationFrame(() => {
      virtualScrollRafId = 0;
      const currentVirtualizer = virtualizer;
      if (!currentVirtualizer) return;
      currentVirtualizer._willUpdate();
      updateVirtualItems();
    });
  };

  virtualizer = new Virtualizer(buildVirtualizerOptions());
  cleanupVirtualizer = virtualizer._didMount();
  virtualizer._willUpdate();

  const currentFiltersKey = buildVisibleHotelsFiltersKey(state.currentFilters);
  const scheduleSaveScrollMemory = () => {
    if (saveScrollRafId) cancelAnimationFrame(saveScrollRafId);
    saveScrollRafId = requestAnimationFrame(() => {
      saveScrollRafId = 0;
      const currentVirtualizer = virtualizer;
      if (!currentVirtualizer) return;
      const virtualItems = currentVirtualizer.getVirtualItems();
      const anchorIndex = clampIndex(getAnchorHotelIndex(virtualItems), sortedHotels.length);
      const anchorHotel = sortedHotels[anchorIndex] || null;

      saveScrollMemory({
        scrollTop: scrollContainer.scrollTop,
        anchorHotelId: anchorHotel?.id ?? null,
        anchorRank: anchorHotel ? anchorIndex + 1 : 0,
        viewMode: mode,
        filtersKey: currentFiltersKey
      });
    });
  };

  const handleVirtualListScroll = () => {
    scheduleVirtualUpdate();
    scheduleSaveScrollMemory();
  };
  scrollContainer.addEventListener('scroll', handleVirtualListScroll, { passive: true });

  virtualRenderCleanup = () => {
    if (saveScrollRafId) {
      cancelAnimationFrame(saveScrollRafId);
      saveScrollRafId = 0;
    }
    scrollContainer.removeEventListener('scroll', handleVirtualListScroll);
    cleanupVirtualizer();
    virtualizer = null;
  };

  updateVirtualItems();
  if (typeof afterInitialRender === 'function') {
    afterInitialRender();
  }

  const scrollBehavior = getScrollBehaviorForReason(reason || '', currentFiltersKey);
  const initialScrollTop =
    scrollBehavior === 'keep' ? Number(hotelListScrollMemory.lastScrollTop || 0) : 0;

  requestAnimationFrame(() => {
    if (taskVersion !== state.hotelListRenderVersion) return;
    const currentVirtualizer = virtualizer;
    if (!currentVirtualizer) return;

    const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
    const targetScrollTop = clampValue(initialScrollTop, 0, maxScrollTop);
    if (Math.abs(scrollContainer.scrollTop - targetScrollTop) > 1) {
      scrollContainer.scrollTop = targetScrollTop;
      scrollContainer.dispatchEvent(new Event('scroll', { bubbles: false }));
    }

    currentVirtualizer._willUpdate();
    updateVirtualItems();
  });

  finishRender();

  return {
    scheduleVirtualUpdate,
    updateVirtualItems,
    resetRenderedRange,
    setVirtualizerCount(nextCount) {
      const currentVirtualizer = virtualizer;
      if (!currentVirtualizer) return;
      virtualizerCount = nextCount;
      currentVirtualizer.setOptions(buildVirtualizerOptions());
      currentVirtualizer.measure();
      currentVirtualizer._willUpdate();
    },
    measure() {
      const currentVirtualizer = virtualizer;
      if (!currentVirtualizer) return;
      currentVirtualizer.measure();
      currentVirtualizer._willUpdate();
    }
  };
}

/**
 * @param {Array<{ index: number, start: number, size: number }>} virtualItems
 * @param {Virtualizer<any, any>} virtualizer
 */
function updateListVirtualState(virtualItems, virtualizer) {
  const firstItem = virtualItems[0];
  const lastItem = virtualItems[virtualItems.length - 1];

  virtualHotelListState.startIndex = firstItem ? firstItem.index : 0;
  virtualHotelListState.endIndex = lastItem ? lastItem.index + 1 : 0;
  virtualHotelListState.totalHeight = virtualizer.getTotalSize();
}

/**
 * @param {Array<{ index: number, start: number, size: number }>} virtualItems
 * @param {Virtualizer<any, any>} virtualizer
 * @param {number} columns
 * @param {number} itemCount
 */
function updateCardVirtualState(virtualItems, virtualizer, columns, itemCount) {
  const firstRow = virtualItems[0];
  const lastRow = virtualItems[virtualItems.length - 1];

  virtualHotelListState.startIndex = firstRow ? firstRow.index * columns : 0;
  virtualHotelListState.endIndex = lastRow ? Math.min(itemCount, (lastRow.index + 1) * columns) : 0;
  virtualHotelListState.totalHeight = virtualizer.getTotalSize();
}

/**
 * @param {number} value
 * @param {number} length
 * @returns {number}
 */
function clampIndex(value, length) {
  if (length <= 0) return 0;
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(length - 1, Math.max(0, Math.floor(number)));
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clampValue(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

/* ---- 虚拟滚动：卡片视图 ---- */

export function renderVirtualHotelCardGrid(
  container,
  sortedHotels,
  taskVersion,
  perfLabel,
  reason,
  options = {}
) {
  virtualHotelListState = createDefaultVirtualState('card');
  virtualHotelListState.enabled = true;
  virtualHotelListState.itemCount = sortedHotels.length;
  const visibleKeys = getCurrentHotelCardVisibleKeys();

  let columns = calculateCardColumns(container.clientWidth);
  let rowCount = Math.ceil(sortedHotels.length / columns);
  virtualHotelListState.columns = columns;

  const shell = document.createElement('div');
  shell.className = 'virtual-card-scroll-shell';

  const scrollContainer = document.createElement('div');
  scrollContainer.className = 'virtual-card-scroll';

  const itemsContainer = document.createElement('div');
  itemsContainer.className = 'virtual-card-items';

  scrollContainer.appendChild(itemsContainer);
  shell.appendChild(scrollContainer);
  container.appendChild(shell);

  const controls = renderVirtualHotelCollection({
    mode: 'card',
    scrollContainer,
    itemsContainer,
    sortedHotels,
    taskVersion,
    perfLabel,
    reason,
    options,
    count: rowCount,
    estimateSize: () => CARD_ESTIMATED_HEIGHT + CARD_GAP,
    renderItems({ virtualizer, virtualItems }) {
      const fragment = document.createDocumentFragment();

      for (const virtualRow of virtualItems) {
        const row = document.createElement('div');
        row.className = 'virtual-card-row';
        row.dataset.index = String(virtualRow.index);
        row.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
        row.style.gap = `${CARD_GAP}px`;
        row.style.paddingBottom = `${CARD_GAP}px`;
        row.style.transform = `translateY(${virtualRow.start}px)`;

        for (let columnIndex = 0; columnIndex < columns; columnIndex++) {
          const hotelIndex = virtualRow.index * columns + columnIndex;
          const hotel = sortedHotels[hotelIndex];
          if (!hotel) continue;
          row.appendChild(createHotelCard(hotel, hotelIndex, visibleKeys));
        }

        fragment.appendChild(row);
      }

      itemsContainer.innerHTML = '';
      itemsContainer.appendChild(fragment);
      alignHotelCardTitleRows(itemsContainer);

      const rows = /** @type {HTMLElement[]} */ (
        Array.from(itemsContainer.querySelectorAll('.virtual-card-row[data-index]')).filter(
          (row) => row instanceof HTMLElement
        )
      );
      for (const row of rows) {
        virtualizer.measureElement(row);
      }
    },
    updateVirtualState(virtualItems, virtualizer) {
      updateCardVirtualState(virtualItems, virtualizer, columns, sortedHotels.length);
    },
    getAnchorHotelIndex(virtualItems) {
      if (!virtualItems.length) return 0;
      const middleRow = virtualItems[Math.floor(virtualItems.length / 2)];
      return middleRow.index * columns + Math.floor(columns / 2);
    }
  });

  const updateCardColumnsFromWidth = () => {
    const width = container.clientWidth || scrollContainer.clientWidth;
    if (width <= 0) return;

    const nextColumns = calculateCardColumns(width);
    if (nextColumns !== columns) {
      columns = nextColumns;
      rowCount = Math.ceil(sortedHotels.length / columns);
      virtualHotelListState.columns = columns;
      controls.resetRenderedRange();
      controls.setVirtualizerCount(rowCount);
      controls.updateVirtualItems();
    } else {
      controls.measure();
      controls.updateVirtualItems();
    }
  };

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
}

/**
 * 虚拟滚动模式下的全选状态同步。
 * 基于 sortedHotels 全量数据判断，而非仅可见 DOM。
 *
 * @param {import('../../shared/contracts').NormalizedHotelRecord[]} sortedHotels
 */
export function syncVirtualSelectAllCheckboxState(sortedHotels) {
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
  if (typeof virtualRenderCleanup === 'function') {
    virtualRenderCleanup();
    virtualRenderCleanup = null;
  }
  virtualHotelListState = null;
}
