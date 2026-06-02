/**
 * 宾馆虚拟滚动纯函数 —— 计算可见区间、判断是否启用虚拟滚动。
 *
 * 所有函数均为纯函数，不依赖 DOM 或全局状态，可独立测试。
 */

export const VIRTUAL_SCROLL_THRESHOLD = 200;
export const LIST_VIRTUAL_SCROLL_THRESHOLD = VIRTUAL_SCROLL_THRESHOLD;
export const CARD_VIRTUAL_SCROLL_THRESHOLD = 80;
export const VIRTUAL_OVERSCAN = 10;
export const LIST_ROW_ESTIMATED_HEIGHT = 96;
export const CARD_ESTIMATED_HEIGHT = 260;
export const CARD_GAP = 16;

/**
 * 根据视图模式返回启用虚拟滚动的数量阈值。
 *
 * @param {'card'|'list'|string} viewMode
 * @returns {number}
 */
export function getVirtualScrollThreshold(viewMode) {
  return viewMode === 'card' ? CARD_VIRTUAL_SCROLL_THRESHOLD : LIST_VIRTUAL_SCROLL_THRESHOLD;
}

/**
 * 判断是否应启用虚拟滚动。
 *
 * @param {number} count
 * @param {{ threshold?: number }} [options]
 * @returns {boolean}
 */
export function shouldUseVirtualHotelList(count, options = {}) {
  const threshold = options.threshold ?? VIRTUAL_SCROLL_THRESHOLD;
  return count > threshold;
}

/**
 * 将 scrollTop 钳制到合法范围。
 *
 * @param {number} scrollTop
 * @param {number} maxScrollTop
 * @returns {number}
 */
export function clampScrollTop(scrollTop, maxScrollTop) {
  if (!Number.isFinite(scrollTop)) return 0;
  if (scrollTop < 0) return 0;
  if (scrollTop > maxScrollTop) return maxScrollTop > 0 ? maxScrollTop : 0;
  return scrollTop;
}

/**
 * 计算虚拟滚动可见区间。
 *
 * @param {{
 *   itemCount: number,
 *   scrollTop: number,
 *   viewportHeight: number,
 *   estimatedItemHeight: number,
 *   overscan?: number
 * }} params
 * @returns {{
 *   startIndex: number,
 *   endIndex: number,
 *   beforeHeight: number,
 *   afterHeight: number,
 *   offsetY: number
 * }}
 */
export function calculateVirtualRange(params) {
  const {
    itemCount,
    scrollTop,
    viewportHeight,
    estimatedItemHeight,
    overscan = VIRTUAL_OVERSCAN
  } = params;

  if (itemCount <= 0 || estimatedItemHeight <= 0 || viewportHeight <= 0) {
    return { startIndex: 0, endIndex: 0, beforeHeight: 0, afterHeight: 0, offsetY: 0 };
  }

  const maxScrollTop = Math.max(0, itemCount * estimatedItemHeight - viewportHeight);
  const safeScrollTop = clampScrollTop(scrollTop, maxScrollTop);

  const rawStart = Math.floor(safeScrollTop / estimatedItemHeight);
  const visibleCount = Math.ceil(viewportHeight / estimatedItemHeight);

  const startIndex = Math.max(0, rawStart - overscan);
  const endIndex = Math.min(itemCount, rawStart + visibleCount + overscan);

  const beforeHeight = startIndex * estimatedItemHeight;
  const afterHeight = Math.max(0, (itemCount - endIndex) * estimatedItemHeight);
  const offsetY = beforeHeight;

  return { startIndex, endIndex, beforeHeight, afterHeight, offsetY };
}

/**
 * 计算卡片视图的虚拟滚动区间（考虑多列布局和行间距）。
 *
 * @param {{
 *   itemCount: number,
 *   scrollTop: number,
 *   viewportHeight: number,
 *   estimatedItemHeight: number,
 *   columns: number,
 *   gap?: number,
 *   overscan?: number
 * }} params
 * @returns {{
 *   startIndex: number,
 *   endIndex: number,
 *   beforeHeight: number,
 *   afterHeight: number,
 *   rowStartIndex: number,
 *   rowEndIndex: number
 * }}
 */
export function calculateCardVirtualRange(params) {
  const {
    itemCount,
    scrollTop,
    viewportHeight,
    estimatedItemHeight,
    columns,
    gap = CARD_GAP,
    overscan = VIRTUAL_OVERSCAN
  } = params;

  if (itemCount <= 0 || columns <= 0 || estimatedItemHeight <= 0 || viewportHeight <= 0) {
    return {
      startIndex: 0,
      endIndex: 0,
      beforeHeight: 0,
      afterHeight: 0,
      rowStartIndex: 0,
      rowEndIndex: 0
    };
  }

  const rowHeight = estimatedItemHeight + gap;
  const totalRows = Math.ceil(itemCount / columns);
  const maxScrollTop = Math.max(0, totalRows * rowHeight - viewportHeight);
  const safeScrollTop = clampScrollTop(scrollTop, maxScrollTop);

  const rawStartRow = Math.floor(safeScrollTop / rowHeight);
  const visibleRows = Math.ceil(viewportHeight / rowHeight);

  const rowStartIndex = Math.max(0, rawStartRow - overscan);
  const rowEndIndex = Math.min(totalRows, rawStartRow + visibleRows + overscan);

  const startIndex = rowStartIndex * columns;
  const endIndex = Math.min(itemCount, rowEndIndex * columns);

  const beforeHeight = rowStartIndex * rowHeight;
  const afterHeight = Math.max(0, (totalRows - rowEndIndex) * rowHeight);

  return { startIndex, endIndex, beforeHeight, afterHeight, rowStartIndex, rowEndIndex };
}

/**
 * 创建默认虚拟滚动状态。
 *
 * @param {'card'|'list'} viewMode
 * @returns {{
 *   enabled: boolean,
 *   viewMode: string,
 *   itemCount: number,
 *   scrollTop: number,
 *   viewportHeight: number,
 *   estimatedItemHeight: number,
 *   overscan: number,
 *   startIndex: number,
 *   endIndex: number,
 *   totalHeight: number,
 *   columns: number,
 *   hasMeasuredItemHeight: boolean
 * }}
 */
export function createDefaultVirtualState(viewMode) {
  return {
    enabled: false,
    viewMode: viewMode || 'card',
    itemCount: 0,
    scrollTop: 0,
    viewportHeight: 0,
    estimatedItemHeight: viewMode === 'list' ? LIST_ROW_ESTIMATED_HEIGHT : CARD_ESTIMATED_HEIGHT,
    overscan: VIRTUAL_OVERSCAN,
    startIndex: 0,
    endIndex: 0,
    totalHeight: 0,
    columns: viewMode === 'list' ? 1 : 3,
    hasMeasuredItemHeight: false
  };
}

/**
 * 测量卡片平均高度（渲染后用）。
 *
 * @param {NodeListOf<HTMLElement>|HTMLElement[]} elements
 * @param {number} fallback
 * @returns {number}
 */
export function measureAverageHeight(elements, fallback) {
  if (!elements || elements.length === 0) return fallback;

  let totalHeight = 0;
  let measured = 0;
  for (const el of elements) {
    const h = el.offsetHeight;
    if (h > 0) {
      totalHeight += h;
      measured += 1;
    }
  }

  return measured > 0 ? Math.round(totalHeight / measured) : fallback;
}

/**
 * 根据容器宽度计算卡片列数。
 *
 * @param {number} containerWidth
 * @returns {number}
 */
export function calculateCardColumns(containerWidth) {
  if (containerWidth <= 0) return 1;
  if (containerWidth < 768) return 1;
  if (containerWidth < 1200) return 2;
  return 3;
}
