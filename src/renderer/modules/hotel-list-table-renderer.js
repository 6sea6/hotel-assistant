/**
 * 宾馆列表行式表格渲染。
 */

import {
  state,
  HOTEL_RENDER_BATCH_SIZE,
  LARGE_HOTEL_RENDER_THRESHOLD
} from './state.js';
import { escapeHtml, getSelectionKey, hasDisplayValue } from './dom-helpers.js';
import { isHotelInputPriorityActive, queueHotelRenderResume } from './render-scheduler.js';
import { formatSubwayInfo } from './hotel-filters.js';

export function createHotelListRow(hotel, index) {
  const rank = index + 1;
  const isTop3 = rank <= 3;
  const hasTemplate = !!hotel.template_info;
  const template = hotel.template_info;
  const hotelIdText = String(hotel.id);
  const hotelIdAttr = escapeHtml(hotelIdText);
  const isSelected = state.selectedHotels.has(getSelectionKey(hotel.id));

  const row = document.createElement('div');
  row.className = `hotel-table-row ${hotel.is_favorite ? 'favorite' : ''} ${isSelected ? 'selected' : ''}`;
  row.dataset.id = hotelIdText;

  const dailyPrice = hotel.daily_price ? `¥${hotel.daily_price}` : '-';
  const totalPrice = hotel.total_price ? `¥${hotel.total_price}` : '-';
  const score = hotel.ctrip_score ? hotel.ctrip_score.toFixed(1) : '-';
  const distance = hasDisplayValue(hotel.distance) ? `${hotel.distance}km` : '-';
  const transport = hasDisplayValue(hotel.transport_time) ? `${hotel.transport_time}min` : '-';
  const subwayInfo = formatSubwayInfo(hotel.subway_station, hotel.subway_distance);
  const roomTypeLine = hasDisplayValue(hotel.room_type)
    ? `<div class="hotel-room-type">房间类型：${escapeHtml(hotel.room_type)}</div>`
    : '';
  const originalRoomTypeLine = hasDisplayValue(hotel.original_room_type)
    ? `<div class="hotel-original-room">原始房型：${escapeHtml(hotel.original_room_type)}</div>`
    : '';

  row.innerHTML = `
    <div class="table-col checkbox-col">
      <input type="checkbox" data-action="toggle-selection" data-id="${hotelIdAttr}" ${isSelected ? 'checked' : ''}>
    </div>
    <div class="table-col rank-col">
      <span class="rank-badge ${isTop3 ? 'top3' : ''}">#${rank}</span>
    </div>
    <div class="table-col name-col">
      <div class="hotel-name ${hotel.is_favorite ? 'favorite-name' : ''}">${escapeHtml(hotel.name)}</div>
      ${roomTypeLine}
      ${originalRoomTypeLine}
      ${subwayInfo !== '-' ? `<small>🚇 ${escapeHtml(subwayInfo)}</small>` : ''}
    </div>
    <div class="table-col price-col">
      <div class="price-value">${dailyPrice}</div>
      <small class="price-total">${totalPrice}</small>
    </div>
    <div class="table-col score-col">${score}</div>
    <div class="table-col distance-col">${distance}</div>
    <div class="table-col transport-col">${transport}</div>
    <div class="table-col template-col">
      ${hasTemplate ? `<span class="template-badge">${escapeHtml(template.name)}</span>` : '-'}
    </div>
    <div class="table-col actions-col">
      <button class="btn btn-secondary btn-xs" data-action="edit" data-id="${hotelIdAttr}">编辑</button>
      <button class="btn btn-secondary btn-xs" data-action="details" data-id="${hotelIdAttr}" title="更多">…</button>
    </div>
  `;

  return row;
}

function renderHotelRowsInBatches(
  tbody,
  hotelsToRender,
  taskVersion,
  perfLabel,
  options = {},
  startIndex = 0
) {
  if (taskVersion !== state.hotelListRenderVersion) {
    options.finishHotelRender?.(taskVersion, perfLabel);
    return;
  }

  if (isHotelInputPriorityActive()) {
    queueHotelRenderResume(() =>
      renderHotelRowsInBatches(tbody, hotelsToRender, taskVersion, perfLabel, options, startIndex)
    );
    return;
  }

  const fragment = document.createDocumentFragment();
  const endIndex = Math.min(startIndex + HOTEL_RENDER_BATCH_SIZE, hotelsToRender.length);

  for (let index = startIndex; index < endIndex; index++) {
    fragment.appendChild(createHotelListRow(hotelsToRender[index], index));
  }

  tbody.appendChild(fragment);

  if (endIndex < hotelsToRender.length) {
    requestAnimationFrame(() =>
      renderHotelRowsInBatches(tbody, hotelsToRender, taskVersion, perfLabel, options, endIndex)
    );
    return;
  }

  options.syncSelectAllCheckboxState?.();
  options.finishHotelRender?.(taskVersion, perfLabel);
}

export function renderHotelListView(container, hotelsToRender, taskVersion, perfLabel, options = {}) {
  const table = document.createElement('div');
  table.className = 'hotel-table';
  const isAllSelected =
    hotelsToRender.length > 0 &&
    hotelsToRender.every((hotel) => state.selectedHotels.has(getSelectionKey(hotel.id)));

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

  const tbody = document.createElement('div');
  tbody.className = 'hotel-table-body';

  table.appendChild(tbody);
  container.appendChild(table);

  if (hotelsToRender.length <= LARGE_HOTEL_RENDER_THRESHOLD) {
    const fragment = document.createDocumentFragment();
    hotelsToRender.forEach((hotel, index) => {
      fragment.appendChild(createHotelListRow(hotel, index));
    });
    tbody.appendChild(fragment);
    options.syncSelectAllCheckboxState?.();
    options.finishHotelRender?.(taskVersion, perfLabel);
    return;
  }

  renderHotelRowsInBatches(tbody, hotelsToRender, taskVersion, perfLabel, options);
}
