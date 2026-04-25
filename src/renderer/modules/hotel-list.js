/**
 * 宾馆列表渲染 —— 卡片视图、行式视图、批量渲染、事件委托和选择管理。
 */

import { state, rankingCache, HOTEL_RENDER_BATCH_SIZE, LARGE_HOTEL_RENDER_THRESHOLD, INTERACTION_FIRST_RENDER_DELAY } from './state.js';
import { $, getValue, escapeHtml, escapeHtmlWithLineBreaks, idsEqual, getSelectionKey, hasDisplayValue, formatDateChinese, getRoomCountText, normalizeFilterOptionKey } from './dom-helpers.js';
import { showNotification } from './notification.js';
import { perfStart, perfEnd } from './perf.js';
import { isHotelInputPriorityActive, clearPendingHotelRenderTimers, queueHotelRenderResume, scheduleHotelRenderTask } from './render-scheduler.js';
import { setModalActive, resetDeleteConfirmation, startDeleteConfirmation, resetBatchDeleteConfirmation, startBatchDeleteConfirmation, syncBatchDeleteButton } from './ui-utils.js';
import { applyFiltersToHotels, rankHotels, getVisibleHotelSummary, formatSubwayInfo, formatDistanceValue, formatTransportValue, extractDistanceNumber, extractTimeNumber } from './hotel-filters.js';
import { actions } from './actions.js';

const RULE_DELETE_MODAL_ID = 'ruleDeleteModal';
let ruleDeleteInProgress = false;

/* ---- 宾馆名称筛选选项同步 ---- */

export function buildHotelNameFilterOptions(sourceHotels) {
  sourceHotels = sourceHotels || state.hotels;
  const seen = new Set();
  const options = [];
  for (const hotel of sourceHotels) {
    const name = hotel?.name;
    if (!name) continue;
    const key = normalizeFilterOptionKey(name);
    if (key && !seen.has(key)) {
      seen.add(key);
      options.push(name);
    }
  }
  options.sort((a, b) => a.localeCompare(b, 'zh-CN'));
  return options;
}

export function syncHotelNameFilterOptions(options = {}) {
  const select = $('filterName');
  if (!select) return options.selectedValue || '';

  const selectedValue = options.selectedValue ?? select.value;
  const newOptions = buildHotelNameFilterOptions();
  const signature = newOptions.join('\x00');

  if (signature === state.hotelNameFilterOptionSignature) {
    if (selectedValue) {
      select.value = selectedValue;
      if (select.value !== selectedValue) {
        select.value = '';
      }
    }
    return select.value;
  }

  state.hotelNameFilterOptionSignature = signature;

  select.innerHTML = '<option value="">全部</option>';
  const fragment = document.createDocumentFragment();
  for (const name of newOptions) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    fragment.appendChild(option);
  }
  select.appendChild(fragment);

  if (selectedValue) {
    select.value = selectedValue;
    if (select.value !== selectedValue) {
      select.value = '';
    }
  }

  return select.value;
}

/* ---- 渲染主入口 ---- */

function renderHotelListPreparingState() {
  const container = $('hotelList');
  if (!container) return;

  container.className = state.viewMode === 'list' ? 'hotel-list list-view' : 'hotel-list';
  container.innerHTML = `
    <div class="empty-state empty-state-loading">
      <div class="empty-state-icon">⏳</div>
      <div class="empty-state-text">数据已导入，正在后台整理列表</div>
      <div class="empty-state-subtext">现在可以先继续添加或编辑宾馆，列表会在你空闲时继续恢复。</div>
    </div>
  `;
}

export function renderHotelList(options = {}) {
  state.hotelListRenderVersion += 1;
  state.pendingRenderInteractionFirst = state.pendingRenderInteractionFirst || Boolean(options.interactionFirst);
  if (state.renderScheduled) return;

  clearPendingHotelRenderTimers();
  state.renderScheduled = true;

  const runRender = () => {
    state.renderScheduled = false;
    const taskVersion = state.hotelListRenderVersion;
    const interactionFirst = state.pendingRenderInteractionFirst;
    state.pendingRenderInteractionFirst = false;
    const perfLabel = `renderHotelList:${taskVersion}`;
    perfStart(perfLabel);
    const container = document.getElementById('hotelList');
    const countElement = document.getElementById('hotelCount');
    const roomTypeCountElement = document.getElementById('roomTypeCount');

    if (!container || !countElement || !roomTypeCountElement) {
      console.error('[renderHotelList] 关键DOM元素未找到');
      perfEnd(perfLabel);
      return;
    }

    if (interactionFirst && isHotelInputPriorityActive()) {
      state.renderScheduled = true;
      scheduleHotelRenderTask(runRender, 120);
      perfEnd(perfLabel);
      return;
    }

    const currentNameFilter = state.currentFilters.name || '';
    const syncedNameFilter = syncHotelNameFilterOptions({ selectedValue: currentNameFilter });
    if (currentNameFilter !== syncedNameFilter) {
      state.currentFilters = {
        ...state.currentFilters,
        name: syncedNameFilter
      };
    }

    const filteredHotels = applyFiltersToHotels(state.hotels, state.currentFilters);

    let sortedHotels;
    if (state.currentFilters.priceSort) {
      sortedHotels = [...filteredHotels].sort((a, b) => {
        const priceA = a.total_price || 0;
        const priceB = b.total_price || 0;
        return state.currentFilters.priceSort === 'asc' ? priceA - priceB : priceB - priceA;
      });
    } else {
      sortedHotels = rankHotels(filteredHotels);
    }

    const summary = getVisibleHotelSummary(sortedHotels);
    countElement.textContent = summary.hotelCount;
    roomTypeCountElement.textContent = summary.roomTypeCount;

    if (sortedHotels.length === 0) {
      const hasActiveFilters = Object.values(state.currentFilters).some(value => value !== undefined && value !== null && value !== '');
      const isFilterEmptyState = state.hotels.length > 0 && hasActiveFilters;
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🏨</div>
          <div class="empty-state-text">${isFilterEmptyState ? '当前筛选条件下没有匹配结果' : '暂无宾馆数据'}</div>
          <button class="btn ${isFilterEmptyState ? 'btn-secondary' : 'btn-primary'}" onclick="${isFilterEmptyState ? 'clearFilters()' : 'openAddHotelModal()'}">${isFilterEmptyState ? '清除筛选' : '添加第一个宾馆'}</button>
        </div>
      `;
      perfEnd(perfLabel);
      return;
    }

    container.innerHTML = '';
    container.className = state.viewMode === 'list' ? 'hotel-list list-view' : 'hotel-list';

    if (state.viewMode === 'list') {
      renderHotelListView(container, sortedHotels, taskVersion, perfLabel);
    } else {
      renderHotelCardGrid(container, sortedHotels, taskVersion, perfLabel);
    }
  };

  if (state.pendingRenderInteractionFirst && state.hotels.length > LARGE_HOTEL_RENDER_THRESHOLD) {
    renderHotelListPreparingState();
    scheduleHotelRenderTask(runRender, INTERACTION_FIRST_RENDER_DELAY);
    return;
  }

  scheduleHotelRenderTask(runRender);
}

function finishHotelRender(taskVersion, perfLabel) {
  if (taskVersion !== state.hotelListRenderVersion) {
    perfEnd(perfLabel);
    return;
  }
  perfEnd(perfLabel);
}

/* ---- 行式视图 ---- */

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

/* ---- 批量渲染 ---- */

function renderHotelRowsInBatches(tbody, hotelsToRender, taskVersion, perfLabel, startIndex = 0) {
  if (taskVersion !== state.hotelListRenderVersion) {
    finishHotelRender(taskVersion, perfLabel);
    return;
  }

  if (isHotelInputPriorityActive()) {
    queueHotelRenderResume(() => renderHotelRowsInBatches(tbody, hotelsToRender, taskVersion, perfLabel, startIndex));
    return;
  }

  const fragment = document.createDocumentFragment();
  const endIndex = Math.min(startIndex + HOTEL_RENDER_BATCH_SIZE, hotelsToRender.length);

  for (let index = startIndex; index < endIndex; index++) {
    fragment.appendChild(createHotelListRow(hotelsToRender[index], index));
  }

  tbody.appendChild(fragment);

  if (endIndex < hotelsToRender.length) {
    requestAnimationFrame(() => renderHotelRowsInBatches(tbody, hotelsToRender, taskVersion, perfLabel, endIndex));
    return;
  }

  syncSelectAllCheckboxState();
  finishHotelRender(taskVersion, perfLabel);
}

function renderHotelCardsInBatches(container, hotelsToRender, taskVersion, perfLabel, startIndex = 0) {
  if (taskVersion !== state.hotelListRenderVersion) {
    finishHotelRender(taskVersion, perfLabel);
    return;
  }

  if (isHotelInputPriorityActive()) {
    queueHotelRenderResume(() => renderHotelCardsInBatches(container, hotelsToRender, taskVersion, perfLabel, startIndex));
    return;
  }

  const fragment = document.createDocumentFragment();
  const endIndex = Math.min(startIndex + HOTEL_RENDER_BATCH_SIZE, hotelsToRender.length);

  for (let index = startIndex; index < endIndex; index++) {
    fragment.appendChild(createHotelCard(hotelsToRender[index], index));
  }

  container.appendChild(fragment);

  if (endIndex < hotelsToRender.length) {
    requestAnimationFrame(() => renderHotelCardsInBatches(container, hotelsToRender, taskVersion, perfLabel, endIndex));
    return;
  }

  cleanupHotelActionArtifacts(container);
  finishHotelRender(taskVersion, perfLabel);
}

function renderHotelCardGrid(container, hotelsToRender, taskVersion, perfLabel) {
  if (hotelsToRender.length <= LARGE_HOTEL_RENDER_THRESHOLD) {
    const fragment = document.createDocumentFragment();
    hotelsToRender.forEach((hotel, index) => {
      fragment.appendChild(createHotelCard(hotel, index));
    });
    container.appendChild(fragment);
    cleanupHotelActionArtifacts(container);
    finishHotelRender(taskVersion, perfLabel);
    return;
  }

  renderHotelCardsInBatches(container, hotelsToRender, taskVersion, perfLabel);
}

function renderHotelListView(container, hotelsToRender, taskVersion, perfLabel) {
  const table = document.createElement('div');
  table.className = 'hotel-table';
  const isAllSelected = hotelsToRender.length > 0 && hotelsToRender.every(hotel => state.selectedHotels.has(getSelectionKey(hotel.id)));

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
    syncSelectAllCheckboxState();
    finishHotelRender(taskVersion, perfLabel);
    return;
  }

  renderHotelRowsInBatches(tbody, hotelsToRender, taskVersion, perfLabel);
}

/* ---- 卡片视图 ---- */

export function createHotelCard(hotel, index) {
  const rank = index + 1;
  const isTop3 = rank <= 3;
  const hotelIdText = String(hotel.id);
  const hotelIdAttr = escapeHtml(hotelIdText);

  const hasTemplate = !!hotel.template_info;
  const template = hotel.template_info;

  const isFromTemplate = (field) => {
    if (!hasTemplate) return false;
    if (field === 'destination' && template.destination && hotel.destination === template.destination) return true;
    if (field === 'room_count' && template.room_count && hotel.room_count === template.room_count) return true;
    if (field === 'check_in_date' && template.check_in_date && hotel.check_in_date === template.check_in_date) return true;
    if (field === 'check_out_date' && template.check_out_date && hotel.check_out_date === template.check_out_date) return true;
    return false;
  };

  const card = document.createElement('div');
  card.className = `hotel-card ${hotel.is_favorite ? 'favorite' : ''}`;
  card.dataset.id = hotelIdText;

  const compactInfoItems = [];
  const fullWidthInfoItems = [];

  if (hotel.total_price) {
    compactInfoItems.push(`<div class="info-item"><div class="info-label">总价格</div><div class="info-value price">¥${hotel.total_price}</div></div>`);
  }
  if (hotel.daily_price) {
    compactInfoItems.push(`<div class="info-item"><div class="info-label">日均价格</div><div class="info-value price">¥${hotel.daily_price}</div></div>`);
  }
  if (hotel.destination && !isFromTemplate('destination')) {
    compactInfoItems.push(`<div class="info-item"><div class="info-label">目的地</div><div class="info-value">${escapeHtml(hotel.destination)}</div></div>`);
  }
  if (hotel.distance) {
    compactInfoItems.push(`<div class="info-item"><div class="info-label">距离</div><div class="info-value">${escapeHtml(hotel.distance)} 公里</div></div>`);
  }
  if (hasDisplayValue(hotel.subway_station) || hasDisplayValue(hotel.subway_distance)) {
    compactInfoItems.push(`<div class="info-item"><div class="info-label">最近地铁站</div><div class="info-value">${escapeHtml(formatSubwayInfo(hotel.subway_station, hotel.subway_distance))}</div></div>`);
  }
  if (hotel.transport_time) {
    compactInfoItems.push(`<div class="info-item"><div class="info-label">公共交通</div><div class="info-value">${escapeHtml(hotel.transport_time)} 分钟</div></div>`);
  }
  if (hasDisplayValue(hotel.bus_route)) {
    fullWidthInfoItems.push(`<div class="info-item info-item-full info-item-route"><div class="info-label">公交路线</div><div class="info-value">${escapeHtmlWithLineBreaks(hotel.bus_route)}</div></div>`);
  }
  if (hotel.room_type) {
    compactInfoItems.push(`<div class="info-item"><div class="info-label">房间类型</div><div class="info-value">${escapeHtml(hotel.room_type)}</div></div>`);
  }
  if (hotel.room_count && !isFromTemplate('room_count')) {
    compactInfoItems.push(`<div class="info-item"><div class="info-label">入住人数</div><div class="info-value">${getRoomCountText(hotel.room_count)}</div></div>`);
  }
  if (hotel.room_area) {
    compactInfoItems.push(`<div class="info-item"><div class="info-label">房间面积</div><div class="info-value">${escapeHtml(hotel.room_area)} ㎡</div></div>`);
  }
  if (hotel.days) {
    compactInfoItems.push(`<div class="info-item"><div class="info-label">住宿天数</div><div class="info-value">${hotel.days}天</div></div>`);
  }
  if (hotel.check_in_date && hotel.check_out_date && !isFromTemplate('check_in_date')) {
    compactInfoItems.push(`<div class="info-item"><div class="info-label">入住日期</div><div class="info-value">${formatDateChinese(hotel.check_in_date)}</div></div>`);
  }
  if (hotel.check_out_date && !isFromTemplate('check_out_date')) {
    compactInfoItems.push(`<div class="info-item"><div class="info-label">离店日期</div><div class="info-value">${formatDateChinese(hotel.check_out_date)}</div></div>`);
  }

  const infoItems = [...compactInfoItems, ...fullWidthInfoItems];

  card.innerHTML = `
    <div class="hotel-rank ${isTop3 ? 'top3' : ''}">#${rank}</div>

    <div class="hotel-card-header">
      <div class="hotel-card-header-main">
        <div class="hotel-name ${hotel.is_favorite ? 'favorite-name' : ''}">${escapeHtml(hotel.name)}</div>
        ${hotel.original_room_type ? `<div class="hotel-original-room">原始房型：${escapeHtml(hotel.original_room_type)}</div>` : ''}
        ${(hotel.address || hotel.website) ? `
          <div class="hotel-meta-row">
            ${hotel.address ? `<div class="hotel-address">📍 ${escapeHtml(hotel.address)}</div>` : ''}
            ${hotel.website ? `<div class="hotel-website"><span class="hotel-website-icon">🌐</span><a href="#" data-url="${escapeHtml(hotel.website)}" title="${escapeHtml(hotel.website)}">${escapeHtml(hotel.website)}</a></div>` : ''}
          </div>
        ` : ''}
      </div>
    </div>

    <div class="hotel-info-grid">${infoItems.join('')}</div>

    ${hotel.notes ? `<div class="hotel-notes">📝 ${escapeHtml(hotel.notes)}</div>` : ''}

    <div class="hotel-actions">
      <button class="btn btn-secondary btn-sm" data-action="edit" data-id="${hotelIdAttr}">✏️ 编辑</button>
      <button class="btn btn-secondary btn-sm" data-action="favorite" data-id="${hotelIdAttr}" data-favorite="${hotel.is_favorite}">
        ${hotel.is_favorite ? '💔 取消收藏' : '❤️ 收藏'}
      </button>
      <button class="btn btn-danger btn-sm" data-action="delete" data-id="${hotelIdAttr}" data-confirming="false">
        🗑️ 删除
      </button>

      ${hasTemplate ? `<div class="hotel-template-badge">${escapeHtml(template.name)}</div>` : ''}
    </div>
  `;

  return card;
}

function cleanupHotelActionArtifacts(container) {
  container.querySelectorAll('.hotel-actions *').forEach(el => {
    if (!el || !el.textContent) return;
    const txt = el.textContent.trim();
    if (/^[\.·\u2026\u22EF]{1,4}$/.test(txt)) {
      el.remove();
    }
  });
}

/* ---- 事件委托 ---- */

function handleHotelAction(e) {
  const btn = e.currentTarget || e.target;
  const action = btn.dataset.action;
  const id = btn.dataset.id;

  switch (action) {
    case 'edit':
      actions.editHotel(id);
      return;
    case 'favorite':
      actions.toggleFavorite(id, parseInt(btn.dataset.favorite));
      return;
    case 'delete': {
      if (btn.dataset.confirming === 'true') {
        resetDeleteConfirmation(btn);
        actions.deleteHotel(id);
      } else {
        startDeleteConfirmation(btn);
      }
      return;
    }
    case 'details':
      showHotelDetails(id);
      return;
    default:
      return;
  }
}

export function handleHotelListClick(event) {
  const websiteLink = event.target.closest('.hotel-website a[data-url]');
  if (websiteLink) {
    event.preventDefault();
    actions.openWebsite(websiteLink.dataset.url);
    return;
  }

  const actionButton = event.target.closest('button[data-action][data-id]');
  if (actionButton) {
    handleHotelAction({ currentTarget: actionButton });
    return;
  }

  if (event.target.closest('input, label, a, select, textarea')) {
    return;
  }

  const hotelRow = event.target.closest('.hotel-table-row');
  if (!hotelRow) return;

  toggleHotelRowSelection(hotelRow);
}

export function handleHotelDetailsClick(event) {
  const websiteLink = event.target.closest('.detail-link[data-url]');
  if (!websiteLink) return;

  event.preventDefault();
  actions.openWebsite(websiteLink.dataset.url);
}

export function handleHotelListChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;

  const action = target.dataset.action;
  if (action === 'toggle-select-all') {
    toggleSelectAll(target);
    return;
  }

  if (action === 'toggle-selection') {
    const hotelId = target.dataset.id;
    const row = target.closest('.hotel-table-row');
    if (!hotelId || !row) return;

    toggleHotelRowSelection(row, target.checked);
  }
}

/* ---- 详情弹窗 ---- */

export function showHotelDetails(id) {
  const hotel = state.hotels.find(h => idsEqual(h.id, id));
  if (!hotel) return;

  const getField = (label, value, allowMultiline = false) => `
    <div class="detail-row">
      <div class="detail-label">${label}</div>
      <div class="detail-value">${allowMultiline ? escapeHtmlWithLineBreaks(value === null || value === undefined || value === '' ? '-' : String(value)) : escapeHtml(value === null || value === undefined || value === '' ? '-' : String(value))}</div>
    </div>`;

  const getLinkField = (label, value) => {
    const linkValue = value === null || value === undefined ? '' : String(value).trim();
    const displayValue = linkValue || '-';
    const linkHtml = linkValue
      ? `<a class="detail-link" href="#" data-url="${escapeHtml(linkValue)}" title="${escapeHtml(linkValue)}">${escapeHtml(linkValue)}</a>`
      : displayValue;

    return `
    <div class="detail-row">
      <div class="detail-label">${label}</div>
      <div class="detail-value detail-value-link">${linkHtml}</div>
    </div>`;
  };

  const content = [];
  content.push(getField('名称', hotel.name));
  content.push(getField('地址', hotel.address));
  content.push(getLinkField('网址', hotel.website));
  content.push(getField('总价格', hotel.total_price ? `¥${hotel.total_price}` : '-'));
  content.push(getField('日均价格', hotel.daily_price ? `¥${hotel.daily_price}` : '-'));
  content.push(getField('入住日期', hotel.check_in_date));
  content.push(getField('离店日期', hotel.check_out_date));
  content.push(getField('住宿天数', hotel.days));
  content.push(getField('携程评分', hotel.ctrip_score !== undefined && hotel.ctrip_score !== null ? hotel.ctrip_score.toFixed(1) : '-'));
  content.push(getField('目的地', hotel.destination));
  content.push(getField('距离', formatDistanceValue(hotel.distance, 'km')));
  content.push(getField('最近地铁站', formatSubwayInfo(hotel.subway_station, hotel.subway_distance, 'km')));
  content.push(getField('公共交通时间', formatTransportValue(hotel.transport_time, 'min')));
  content.push(getField('公交路线', hotel.bus_route, true));
  content.push(getField('房间类型', hotel.room_type));
  content.push(getField('原始房型', hotel.original_room_type));
  content.push(getField('入住人数', hotel.room_count ? getRoomCountText(hotel.room_count) : '-'));
  content.push(getField('房间面积', hotel.room_area ? `${hotel.room_area} ㎡` : '-'));
  content.push(getField('备注', hotel.notes));
  content.push(getField('模板', hotel.template_info ? hotel.template_info.name : '-'));
  content.push(getField('收藏', hotel.is_favorite === 1 ? '是' : '否'));

  const detailsEl = document.getElementById('hotelDetailsContent');
  if (detailsEl) {
    detailsEl.innerHTML = `<div class="hotel-details-grid">${content.join('')}</div>`;
  }

  setModalActive('hotelDetailsModal', true);
}

export function closeHotelDetails() {
  setModalActive('hotelDetailsModal', false);
}

/* ---- 选择管理 ---- */

function toggleSelectAll(checkbox) {
  const hotelRows = document.querySelectorAll('.hotel-table-row');

  if (checkbox.checked) {
    hotelRows.forEach(row => {
      const hotelId = getSelectionKey(row.dataset.id);
      state.selectedHotels.add(hotelId);
      row.classList.add('selected');
      const cb = row.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = true;
    });
  } else {
    state.selectedHotels.clear();
    hotelRows.forEach(row => {
      row.classList.remove('selected');
      const cb = row.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = false;
    });
  }

  syncSelectAllCheckboxState();
  resetBatchDeleteConfirmation({ count: state.selectedHotels.size });
}

function setHotelRowSelection(row, checked) {
  if (!row) return;
  const hotelId = row.dataset.id;
  if (!hotelId) return;
  const hotelKey = getSelectionKey(hotelId);
  const checkbox = row.querySelector('input[data-action="toggle-selection"]');
  if (checked) { state.selectedHotels.add(hotelKey); } else { state.selectedHotels.delete(hotelKey); }
  row.classList.toggle('selected', checked);
  if (checkbox) checkbox.checked = checked;
}

function toggleHotelRowSelection(row, nextChecked = null) {
  if (!row) return;
  const hotelId = row.dataset.id;
  if (!hotelId) return;
  const shouldSelect = typeof nextChecked === 'boolean'
    ? nextChecked
    : !state.selectedHotels.has(getSelectionKey(hotelId));
  setHotelRowSelection(row, shouldSelect);
  syncSelectAllCheckboxState();
  resetBatchDeleteConfirmation({ count: state.selectedHotels.size });
}

function syncSelectAllCheckboxState() {
  const selectAllCheckbox = $('selectAll');
  if (!selectAllCheckbox) return;
  const hotelRows = document.querySelectorAll('.hotel-table-row');
  if (hotelRows.length === 0) {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
    return;
  }
  const selectedCount = Array.from(hotelRows).filter(row => state.selectedHotels.has(getSelectionKey(row.dataset.id))).length;
  selectAllCheckbox.checked = selectedCount > 0 && selectedCount === hotelRows.length;
  selectAllCheckbox.indeterminate = selectedCount > 0 && selectedCount < hotelRows.length;
}

/* ---- 视图切换 ---- */

export function toggleViewMode() {
  state.viewMode = state.viewMode === 'card' ? 'list' : 'card';

  const viewIcon = document.getElementById('viewIcon');
  const viewText = document.getElementById('viewText');
  const batchDeleteBtn = $('batchDeleteBtn');
  const ruleDeleteBtn = $('ruleDeleteBtn');

  if (state.viewMode === 'list') {
    if (viewIcon) viewIcon.textContent = '📝';
    if (viewText) viewText.textContent = '行式';
    if (batchDeleteBtn) batchDeleteBtn.style.display = 'inline-flex';
    if (ruleDeleteBtn) ruleDeleteBtn.style.display = 'none';
  } else {
    if (viewIcon) viewIcon.textContent = '🛏️';
    if (viewText) viewText.textContent = '卡片';
    if (batchDeleteBtn) batchDeleteBtn.style.display = 'none';
    if (ruleDeleteBtn) ruleDeleteBtn.style.display = 'inline-flex';
    state.selectedHotels.clear();
  }

  resetBatchDeleteConfirmation({ count: state.selectedHotels.size });
  renderHotelList();
}

function getCurrentCardHotels() {
  return applyFiltersToHotels(state.hotels, state.currentFilters);
}

function getRuleDeleteThresholds() {
  const parseThreshold = (rawValue, label) => {
    const normalized = String(rawValue ?? '').trim();
    if (normalized === '') {
      return { value: null };
    }

    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return { error: `${label}必须是大于或等于 0 的数字` };
    }

    return { value: parsed };
  };

  const price = parseThreshold(getValue('ruleDeletePrice'), '总价格阈值');
  if (price.error) return price;

  const subwayDistance = parseThreshold(getValue('ruleDeleteSubwayDistance'), '地铁站距离阈值');
  if (subwayDistance.error) return subwayDistance;

  const transportTime = parseThreshold(getValue('ruleDeleteTransportTime'), '公共交通时间阈值');
  if (transportTime.error) return transportTime;

  return {
    value: {
      price: price.value,
      subwayDistance: subwayDistance.value,
      transportTime: transportTime.value
    }
  };
}

function getRuleDeleteCandidates(thresholds, sourceHotels = getCurrentCardHotels()) {
  const hasActiveRule = thresholds.price !== null
    || thresholds.subwayDistance !== null
    || thresholds.transportTime !== null;

  if (!hasActiveRule) {
    return [];
  }

  return sourceHotels.filter((hotel) => {
    const totalPrice = Number(hotel.total_price);
    const subwayDistance = extractDistanceNumber(hotel.subway_distance);
    const transportTime = extractTimeNumber(hotel.transport_time);

    return (
      (thresholds.price !== null && Number.isFinite(totalPrice) && totalPrice > thresholds.price) ||
      (thresholds.subwayDistance !== null && subwayDistance !== null && subwayDistance > thresholds.subwayDistance) ||
      (thresholds.transportTime !== null && transportTime !== null && transportTime > thresholds.transportTime)
    );
  });
}

export function updateRuleDeletePreview() {
  const summaryText = $('ruleDeleteSummaryText');
  const confirmBtn = $('ruleDeleteConfirmBtn');
  if (!summaryText || !confirmBtn) {
    return;
  }

  const visibleHotels = getCurrentCardHotels();
  const thresholdsResult = getRuleDeleteThresholds();

  if (thresholdsResult.error) {
    summaryText.textContent = thresholdsResult.error;
    confirmBtn.disabled = true;
    return;
  }

  const candidates = getRuleDeleteCandidates(thresholdsResult.value, visibleHotels);
  summaryText.textContent = `当前卡片结果 ${visibleHotels.length} 条，命中规则 ${candidates.length} 条`;
  confirmBtn.disabled = ruleDeleteInProgress || candidates.length === 0;
}

export function openRuleDeleteModal() {
  if (state.viewMode !== 'card') {
    showNotification('规则删除仅在卡片视图下可用', 'info');
    return;
  }

  const priceInput = $('ruleDeletePrice');
  const subwayInput = $('ruleDeleteSubwayDistance');
  const transportInput = $('ruleDeleteTransportTime');
  if (priceInput) priceInput.value = '';
  if (subwayInput) subwayInput.value = '';
  if (transportInput) transportInput.value = '';

  setModalActive(RULE_DELETE_MODAL_ID, true);
  updateRuleDeletePreview();
}

export function closeRuleDeleteModal(force = false) {
  if (ruleDeleteInProgress && !force) {
    return;
  }

  setModalActive(RULE_DELETE_MODAL_ID, false);
}

export async function confirmRuleDelete() {
  if (ruleDeleteInProgress) {
    return;
  }

  const thresholdsResult = getRuleDeleteThresholds();
  if (thresholdsResult.error) {
    showNotification(thresholdsResult.error, 'error');
    updateRuleDeletePreview();
    return;
  }

  const visibleHotels = getCurrentCardHotels();
  const candidates = getRuleDeleteCandidates(thresholdsResult.value, visibleHotels);

  if (candidates.length === 0) {
    showNotification('没有命中规则的宾馆', 'info');
    updateRuleDeletePreview();
    return;
  }

  const confirmBtn = $('ruleDeleteConfirmBtn');
  const originalHtml = confirmBtn ? confirmBtn.innerHTML : '';
  let previousHotels = null;

  try {
    ruleDeleteInProgress = true;
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<span>⏳</span> 正在删除...';
    }

    const hotelIds = candidates.map((hotel) => getSelectionKey(hotel.id));
    previousHotels = state.hotels.slice();
    const deleteIdSet = new Set(hotelIds);

    const result = await window.electronAPI.deleteMultipleHotels(hotelIds);
    if (!result || !result.success) {
      throw new Error(result?.error || '规则删除失败');
    }

    state.hotels = previousHotels.filter((hotel) => !deleteIdSet.has(getSelectionKey(hotel.id)));
    rankingCache.invalidate();
    renderHotelList();
    closeRuleDeleteModal(true);
    showNotification(`成功删除 ${candidates.length} 个命中规则的宾馆`, 'success');
  } catch (error) {
    console.error('规则删除失败:', error);
    if (previousHotels) {
      state.hotels = previousHotels;
      rankingCache.invalidate();
      renderHotelList();
    }
    showNotification('规则删除失败，请重试', 'error');
  } finally {
    ruleDeleteInProgress = false;
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = originalHtml || '<span>🗑️</span> 删除命中项';
    }
    updateRuleDeletePreview();
  }
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

/* ---- 筛选 UI ---- */

export function applyFilters() {
  state.currentFilters = {
    name: getValue('filterName'),
    priceSort: getValue('priceSort'),
    score: getValue('filterScore'),
    favorite: getValue('filterFavorite'),
    template: getValue('filterTemplate'),
    transportTime: getValue('filterTransportTime'),
    subwayDistance: getValue('filterSubwayDistance')
  };
  rankingCache.invalidate();
  renderHotelList();
}

export function clearFilters() {
  ['filterName', 'priceSort', 'filterScore', 'filterFavorite', 'filterTemplate', 'filterTransportTime', 'filterSubwayDistance'].forEach(id => {
    const el = $(id);
    if (el) el.value = '';
  });
  state.currentFilters = {};
  rankingCache.invalidate();
  renderHotelList();
}

export function changeRankingMode(mode) {
  state.rankingMode = mode;
  const weightSettings = document.getElementById('weightSettings');
  if (weightSettings) {
    weightSettings.style.display = mode === 'manual' ? 'block' : 'none';
  }
  rankingCache.invalidate();
  renderHotelList();
}

export function updateWeight(type, value) {
  const valueEl = document.getElementById(`${type}WeightValue`);
  if (valueEl) {
    valueEl.textContent = value;
  }
  rankingCache.invalidate();
  renderHotelList();
}

/* ---- 注册到 actions ---- */
actions.renderHotelList = renderHotelList;
actions.showHotelDetails = showHotelDetails;
