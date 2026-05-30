/**
 * 自定义虚拟滚动条数学计算 —— 纯函数，可独立测试。
 */

/**
 * 计算 thumb 的高度和位置。
 *
 * @param {{
 *   clientHeight: number,
 *   scrollHeight: number,
 *   scrollTop: number,
 *   trackHeight: number,
 *   minThumbHeight?: number
 * }} params
 * @returns {{
 *   shouldHide: boolean,
 *   thumbHeight: number,
 *   thumbTop: number,
 *   maxThumbTop: number,
 *   maxScrollTop: number
 * }}
 */
export function calculateThumbMetrics(params) {
  const {
    clientHeight,
    scrollHeight,
    scrollTop,
    trackHeight,
    minThumbHeight = 32
  } = params;

  if (clientHeight <= 0 || scrollHeight <= clientHeight || trackHeight <= 0) {
    return { shouldHide: true, thumbHeight: 0, thumbTop: 0, maxThumbTop: 0, maxScrollTop: 0 };
  }

  const thumbHeight = Math.max(minThumbHeight, Math.round((clientHeight / scrollHeight) * trackHeight));
  const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
  const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
  const thumbTop = maxScrollTop > 0
    ? Math.round((scrollTop / maxScrollTop) * maxThumbTop)
    : 0;

  return { shouldHide: false, thumbHeight, thumbTop, maxThumbTop, maxScrollTop };
}

/**
 * 计算点击轨道后应跳转到的 scrollTop。
 * 点击点尽量落在 thumb 中心。
 *
 * @param {{
 *   clickY: number,
 *   trackHeight: number,
 *   thumbHeight: number,
 *   clientHeight: number,
 *   scrollHeight: number
 * }} params
 * @returns {number} 目标 scrollTop
 */
export function calculateScrollTopFromTrackClick(params) {
  const { clickY, trackHeight, thumbHeight, clientHeight, scrollHeight } = params;

  if (trackHeight <= 0 || thumbHeight <= 0 || scrollHeight <= clientHeight) return 0;

  const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
  const maxScrollTop = Math.max(0, scrollHeight - clientHeight);

  if (maxThumbTop <= 0) return 0;

  const targetThumbTop = clampValue(clickY - thumbHeight / 2, 0, maxThumbTop);
  return (targetThumbTop / maxThumbTop) * maxScrollTop;
}

/**
 * 计算拖动 thumb 时的 scrollTop。
 *
 * @param {{
 *   deltaY: number,
 *   maxThumbTop: number,
 *   maxScrollTop: number,
 *   startScrollTop: number
 * }} params
 * @returns {number} 目标 scrollTop
 */
export function calculateScrollTopFromDrag(params) {
  const { deltaY, maxThumbTop, maxScrollTop, startScrollTop } = params;

  if (maxThumbTop <= 0) return startScrollTop;

  const scrollDelta = (deltaY / maxThumbTop) * maxScrollTop;
  return clampValue(startScrollTop + scrollDelta, 0, maxScrollTop);
}

/**
 * 将值钳制到 [min, max] 范围。
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clampValue(value, min, max) {
  if (Number.isNaN(value)) return min;
  if (!Number.isFinite(value)) return value > 0 ? max : min;
  return Math.min(max, Math.max(min, value));
}
