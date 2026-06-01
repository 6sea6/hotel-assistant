/**
 * 宾馆列表虚拟滚动适配器。
 */

import {
  state,
  buildVisibleHotelsFiltersKey,
  hotelListScrollMemory,
  saveScrollMemory,
  getScrollBehaviorForReason
} from './state.js';
import { $, getSelectionKey } from './dom-helpers.js';
import {
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
import { createHotelListRow } from './hotel-list-table-renderer.js';
import { cleanupHotelActionArtifacts, createHotelCard } from './hotel-list-card-renderer.js';

/** @type {ReturnType<typeof createDefaultVirtualState>|null} */
let virtualHotelListState = null;
let virtualScrollRafId = 0;
let virtualResizeObserver = null;
let virtualResizeRafId = 0;
let virtualScrollbarCleanup = null;

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
      options.finishHotelRender?.(taskVersion, perfLabel);
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
  options.finishHotelRender?.(taskVersion, perfLabel);
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
      options.finishHotelRender?.(taskVersion, perfLabel);
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
  options.finishHotelRender?.(taskVersion, perfLabel);
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
