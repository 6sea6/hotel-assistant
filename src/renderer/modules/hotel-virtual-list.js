/**
 * 宾馆虚拟滚动配置。
 *
 * 可见区间和动态高度测量由 @tanstack/virtual-core 负责，这里只保留
 * 项目级阈值、估算尺寸和卡片列数规则。
 */

export const VIRTUAL_SCROLL_THRESHOLD = 200;
export const LIST_VIRTUAL_SCROLL_THRESHOLD = VIRTUAL_SCROLL_THRESHOLD;
export const CARD_VIRTUAL_SCROLL_THRESHOLD = 80;
export const VIRTUAL_OVERSCAN = 10;
export const LIST_ROW_ESTIMATED_HEIGHT = 96;
export const CARD_ESTIMATED_HEIGHT = 260;
export const CARD_GAP = 16;
export const CARD_TWO_COLUMN_MIN_WIDTH = 768;
export const CARD_THREE_COLUMN_MIN_WIDTH = 1000;
export const CARD_FOUR_COLUMN_MIN_WIDTH = 1500;

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
 * 根据容器宽度计算卡片列数。
 *
 * @param {number} containerWidth
 * @returns {number}
 */
export function calculateCardColumns(containerWidth) {
  if (containerWidth <= 0) return 1;
  const width = Number(containerWidth);
  if (!Number.isFinite(width) || width <= 0) return 1;
  if (width >= CARD_FOUR_COLUMN_MIN_WIDTH) return 4;
  if (width >= CARD_THREE_COLUMN_MIN_WIDTH) return 3;
  if (width >= CARD_TWO_COLUMN_MIN_WIDTH) return 2;
  return 1;
}
