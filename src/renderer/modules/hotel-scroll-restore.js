/**
 * 虚拟宾馆列表滚动恢复补丁。
 *
 * 说明：hotel-list.js 内部在完整重渲染虚拟列表时，会先创建新的滚动容器并尝试
 * 恢复 scrollTop，然后才通过 updateVirtualList/updateVirtualCards 撑开 spacer 高度。
 * 当 scrollHeight 仍然很小时，scrollTop 会被浏览器夹到 0，导致不影响排序的更新也回顶。
 *
 * 这里以 actions 包裹层做低侵入修复：
 * 1. 在触发渲染前，从旧虚拟滚动容器同步捕获 scrollTop 和锚点；
 * 2. 调用原始渲染逻辑；
 * 3. 在后续若干帧中等待新虚拟容器完成初次渲染/撑高，再恢复 scrollTop；
 * 4. 恢复后主动派发 scroll 事件，让虚拟区间重新计算到目标位置。
 */

import { actions } from './actions.js';
import {
  state,
  buildVisibleHotelsFiltersKey,
  getScrollBehaviorForReason,
  saveScrollMemory
} from './state.js';
import {
  LIST_ROW_ESTIMATED_HEIGHT,
  CARD_ESTIMATED_HEIGHT,
  CARD_GAP,
  calculateCardColumns
} from './hotel-virtual-list.js';

const VIRTUAL_SCROLL_SELECTOR = '.virtual-card-scroll, .virtual-list-scroll';
const VIRTUAL_ITEM_SELECTOR = '.hotel-card[data-id], .hotel-table-row[data-id]';
const MAX_RESTORE_ATTEMPTS = 12;

let installed = false;
let viewModeCaptureInstalled = false;

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

/**
 * 安全地通过 data-id 查找元素。
 * 优先使用 CSS.escape 避免特殊字符导致 querySelector 报错；
 * 若 CSS.escape 不可用或查询失败，则回退到遍历 dataset 匹配。
 *
 * @param {Element} root
 * @param {string} id
 * @returns {HTMLElement|null}
 */
function findElementByDataId(root, id) {
  if (!id) return null;

  // 尝试 CSS.escape 安全查询
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    try {
      const el = root.querySelector(`[data-id="${CSS.escape(id)}"]`);
      if (el instanceof HTMLElement) return el;
    } catch {
      // querySelector 仍可能在极端情况下抛出，忽略并走 fallback
    }
  }

  // fallback: 遍历匹配 dataset.id
  const all = root.querySelectorAll('[data-id]');
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    if (el instanceof HTMLElement && el.dataset.id === id) {
      return el;
    }
  }

  return null;
}

/**
 * @returns {HTMLElement|null}
 */
function getCurrentVirtualScrollContainer() {
  const element = document.querySelector(VIRTUAL_SCROLL_SELECTOR);
  return element instanceof HTMLElement ? element : null;
}

/**
 * @param {HTMLElement} scrollContainer
 * @returns {'card'|'list'}
 */
function getVirtualViewMode(scrollContainer) {
  return scrollContainer.classList.contains('virtual-card-scroll') ? 'card' : 'list';
}

/**
 * @param {HTMLElement} scrollContainer
 * @param {number} anchorRank
 * @returns {number|null}
 */
function estimateScrollTopForAnchorRank(scrollContainer, anchorRank) {
  const rank = Math.max(1, Number(anchorRank) || 0);
  if (!rank) return null;

  const zeroBasedIndex = rank - 1;
  if (getVirtualViewMode(scrollContainer) === 'list') {
    return zeroBasedIndex * LIST_ROW_ESTIMATED_HEIGHT;
  }

  const width =
    scrollContainer.clientWidth ||
    (scrollContainer.parentElement instanceof HTMLElement ? scrollContainer.parentElement.clientWidth : 0);
  const columns = Math.max(1, calculateCardColumns(width));
  const row = Math.floor(zeroBasedIndex / columns);
  return row * (CARD_ESTIMATED_HEIGHT + CARD_GAP);
}

/**
 * @param {HTMLElement} scrollContainer
 * @param {HTMLElement} anchorElement
 * @returns {number}
 */
function calculateScrollTopFromRenderedAnchor(scrollContainer, anchorElement) {
  const containerRect = scrollContainer.getBoundingClientRect();
  const anchorRect = anchorElement.getBoundingClientRect();
  return scrollContainer.scrollTop + (anchorRect.top - containerRect.top);
}

/**
 * @param {HTMLElement} scrollContainer
 * @returns {{id: string|null, rank: number}}
 */
function getCurrentAnchor(scrollContainer) {
  const items = Array.from(scrollContainer.querySelectorAll(VIRTUAL_ITEM_SELECTOR))
    .filter((item) => item instanceof HTMLElement);

  if (!items.length) {
    return { id: null, rank: 0 };
  }

  const middleIndex = Math.floor(items.length / 2);
  const anchor = /** @type {HTMLElement} */ (items[middleIndex] || items[0]);
  const renderedIndex = Number(anchor.querySelector('.hotel-rank, .rank-badge')?.textContent?.replace('#', ''));

  return {
    id: anchor.dataset.id || null,
    rank: Number.isFinite(renderedIndex) && renderedIndex > 0 ? renderedIndex : 0
  };
}

/**
 * @returns {{scrollTop: number, anchorHotelId: string|null, anchorRank: number, viewMode: 'card'|'list', filtersKey: string}|null}
 */
function captureVirtualScrollSnapshot() {
  const scrollContainer = getCurrentVirtualScrollContainer();
  if (!scrollContainer) return null;

  const filtersKey = buildVisibleHotelsFiltersKey(state.currentFilters);
  const anchor = getCurrentAnchor(scrollContainer);
  /** @type {'card'|'list'} */
  const viewMode = getVirtualViewMode(scrollContainer);
  const snapshot = {
    scrollTop: scrollContainer.scrollTop,
    anchorHotelId: anchor.id,
    anchorRank: anchor.rank,
    viewMode,
    filtersKey
  };

  saveScrollMemory({
    scrollTop: snapshot.scrollTop,
    anchorHotelId: snapshot.anchorHotelId,
    anchorRank: snapshot.anchorRank,
    viewMode: snapshot.viewMode,
    filtersKey: snapshot.filtersKey
  });

  return snapshot;
}

/**
 * @param {{scrollTop: number, filtersKey: string, anchorHotelId?: string|null, anchorRank?: number}} snapshot
 * @param {'keep'|'anchor'} behavior
 * @param {number} [attempt]
 * @returns {void}
 */
function restoreVirtualScrollSnapshot(snapshot, behavior, attempt = 0) {
  if (!snapshot) return;

  const currentFiltersKey = buildVisibleHotelsFiltersKey(state.currentFilters);
  if (snapshot.filtersKey !== currentFiltersKey) {
    return;
  }

  const scrollContainer = getCurrentVirtualScrollContainer();
  if (!scrollContainer) {
    if (attempt < MAX_RESTORE_ATTEMPTS) {
      requestAnimationFrame(() => restoreVirtualScrollSnapshot(snapshot, behavior, attempt + 1));
    }
    return;
  }

  const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
  if (snapshot.scrollTop > 0 && maxScrollTop <= 0 && attempt < MAX_RESTORE_ATTEMPTS) {
    requestAnimationFrame(() => restoreVirtualScrollSnapshot(snapshot, behavior, attempt + 1));
    return;
  }

  let targetScrollTop = clamp(snapshot.scrollTop, 0, maxScrollTop);

  if (behavior === 'anchor') {
    const estimatedByRank = estimateScrollTopForAnchorRank(scrollContainer, snapshot.anchorRank || 0);
    if (estimatedByRank !== null) {
      targetScrollTop = clamp(estimatedByRank, 0, maxScrollTop);
    }

    // 第一次用 rank 估算把目标酒店滚进虚拟窗口；后续帧如果同一酒店已经进入 DOM，
    // 再用真实 DOM 位置微调，避免卡片/行式高度差导致切换后锚定失效。
    if (snapshot.anchorHotelId) {
      const anchorEl = findElementByDataId(scrollContainer, String(snapshot.anchorHotelId));
      if (anchorEl) {
        targetScrollTop = clamp(
          calculateScrollTopFromRenderedAnchor(scrollContainer, anchorEl),
          0,
          maxScrollTop
        );
      }
    }
  }

  if (Math.abs(scrollContainer.scrollTop - targetScrollTop) > 1) {
    scrollContainer.scrollTop = targetScrollTop;
  }

  // 主动触发虚拟区间重算。不同浏览器对脚本设置 scrollTop 的 scroll 事件时机不完全一致。
  scrollContainer.dispatchEvent(new Event('scroll', { bubbles: false }));

  // 某些情况下初次恢复会触发测量并改变 estimated height，再补一帧校准。
  if (attempt < 2) {
    requestAnimationFrame(() => restoreVirtualScrollSnapshot(snapshot, behavior, attempt + 1));
  }
}

/**
 * @param {string|undefined} reason
 * @returns {{snapshot: ReturnType<typeof captureVirtualScrollSnapshot>, shouldRestore: boolean, behavior: 'keep'|'anchor'|'top'}}
 */
function captureForRenderReason(reason) {
  const currentFiltersKey = buildVisibleHotelsFiltersKey(state.currentFilters);
  const behavior = getScrollBehaviorForReason(reason || '', currentFiltersKey);
  const shouldRestore = behavior === 'keep' || behavior === 'anchor';
  return {
    snapshot: shouldRestore ? captureVirtualScrollSnapshot() : null,
    shouldRestore,
    behavior
  };
}

function scheduleRestore(snapshot, behavior) {
  if (!snapshot) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => restoreVirtualScrollSnapshot(snapshot, behavior));
  });
}

function scheduleRestoreAfterCurrentClick(snapshot, behavior) {
  if (!snapshot) return;
  window.setTimeout(() => scheduleRestore(snapshot, behavior), 0);
}

function handleViewModeToggleCapture(event) {
  const target = event.target instanceof Element ? event.target : null;
  const actionElement = target?.closest('[data-action="toggle-view-mode"]');
  if (!actionElement) return;

  const { snapshot, shouldRestore, behavior } = captureForRenderReason('view-mode-change');
  if (shouldRestore) {
    scheduleRestoreAfterCurrentClick(snapshot, behavior);
  }
}

function installViewModeToggleCapture() {
  if (viewModeCaptureInstalled) return;
  document.addEventListener('click', handleViewModeToggleCapture, true);
  viewModeCaptureInstalled = true;
}

export function installHotelScrollRestorePatch() {
  installViewModeToggleCapture();

  if (installed) return;

  const originalRequestHotelListRender = actions.requestHotelListRender;
  const originalRenderHotelList = actions.renderHotelList;
  let wrappedAny = false;

  if (typeof originalRequestHotelListRender === 'function') {
    actions.requestHotelListRender = (options = {}) => {
      const { snapshot, shouldRestore, behavior } = captureForRenderReason(options.reason);
      originalRequestHotelListRender(options);
      if (shouldRestore) scheduleRestore(snapshot, behavior);
    };
    wrappedAny = true;
  }

  if (typeof originalRenderHotelList === 'function') {
    actions.renderHotelList = (options = {}) => {
      const opts = /** @type {Record<string, unknown>} */ (options);
      const { snapshot, shouldRestore, behavior } = captureForRenderReason(typeof opts.reason === 'string' ? opts.reason : undefined);
      originalRenderHotelList(options);
      if (shouldRestore) scheduleRestore(snapshot, behavior);
    };
    wrappedAny = true;
  }

  installed = wrappedAny;
}
