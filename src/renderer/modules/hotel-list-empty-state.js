/**
 * 宾馆列表空状态 / 过渡状态渲染。
 */

import { state } from './state.js';
import { $, iconHtml } from './dom-helpers.js';

export function renderHotelListPreparingState() {
  const container = $('hotelList');
  if (!container) return;

  container.className = state.viewMode === 'list' ? 'hotel-list list-view' : 'hotel-list';
  container.innerHTML = `
    <div class="empty-state empty-state-loading">
      ${iconHtml('loader', 'empty-state-icon')}
      <div class="empty-state-text">数据已导入，正在后台整理列表</div>
      <div class="empty-state-subtext">现在可以先继续添加或编辑宾馆，列表会在你空闲时继续恢复。</div>
    </div>
  `;
}
