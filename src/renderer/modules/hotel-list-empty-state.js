/**
 * 宾馆列表空状态 / 过渡状态渲染。
 */

import { state, getResourceLoadState } from './state.js';
import { $, iconHtml } from './dom-helpers.js';

export function renderHotelListPreparingState() {
  const container = $('hotelList');
  if (!container) return;

  container.className = state.viewMode === 'list' ? 'hotel-list list-view' : 'hotel-list';
  container.setAttribute('aria-busy', 'true');
  container.innerHTML = `
    <div class="empty-state empty-state-loading">
      ${iconHtml('loader', 'empty-state-icon')}
      <div class="empty-state-text">数据已导入，正在后台整理列表</div>
      <div class="empty-state-subtext">现在可以先继续添加或编辑宾馆，列表会在你空闲时继续恢复。</div>
    </div>
  `;
}

/**
 * Render loading/error states distinctly from a valid empty data set.
 * @returns {boolean} whether a resource state was rendered
 */
export function renderHotelListResourceState() {
  const container = $('hotelList');
  if (!container || state.hotels.length > 0) return false;

  const loadState = getResourceLoadState('hotels');
  if (loadState.status !== 'loading' && loadState.status !== 'error') return false;

  container.className = state.viewMode === 'list' ? 'hotel-list list-view' : 'hotel-list';
  container.setAttribute('aria-busy', loadState.status === 'loading' ? 'true' : 'false');
  container.innerHTML =
    loadState.status === 'loading'
      ? `
      <div class="empty-state empty-state-loading" role="status" aria-live="polite">
        ${iconHtml('loader', 'empty-state-icon')}
        <div class="empty-state-text">正在读取宾馆数据</div>
        <div class="empty-state-subtext">请稍候，数据准备完成后会自动显示。</div>
      </div>
    `
      : `
      <div class="empty-state" role="alert">
        ${iconHtml('warning', 'empty-state-icon')}
        <div class="empty-state-text">宾馆数据读取失败</div>
        <div class="empty-state-subtext">本地数据没有被清空，请检查后重试。</div>
        <button class="btn btn-primary" type="button" data-action="retry-load-hotels">重新读取</button>
      </div>
    `;
  return true;
}
