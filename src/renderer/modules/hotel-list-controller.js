/**
 * 宾馆列表渲染 —— 卡片视图、行式视图、批量渲染、事件委托和选择管理。
 */

import {
  state,
  replaceCurrentFilters,
  clearSelectedHotels,
  setViewMode,
  markVisibleHotelsCacheDirty
} from './state.js';
import {
  $,
  getValue,
  escapeHtml,
  escapeHtmlWithLineBreaks,
  idsEqual,
  getRoomCountText
} from './dom-helpers.js';
import {
  setModalActive,
  resetDeleteConfirmation,
  startDeleteConfirmation,
  resetBatchDeleteConfirmation
} from './ui-utils.js';
import {
  DEFAULT_SORT_MODE,
  formatSubwayInfo,
  formatDistanceValue,
  formatTransportValue
} from './hotel-filters.js';
import {
  buildHotelNameFilterOptions,
  syncHotelNameFilterOptions
} from './hotel-list-filter-options.js';
import { renderHotelList, requestHotelListRender } from './hotel-list-render-orchestrator.js';
import {
  closeRuleDeleteModal,
  confirmRuleDelete,
  openRuleDeleteModal,
  updateRuleDeletePreview
} from './rule-delete-controller.js';
import { actions } from './actions.js';
import { refreshCustomSelects } from './custom-select.js';
import { toggleHotelRowSelection, toggleSelectAll } from './hotel-list-selection.js';

export { shouldFullRerender } from './hotel-render-decision.js';
export {
  buildHotelNameFilterOptions,
  syncHotelNameFilterOptions,
  renderHotelList,
  requestHotelListRender,
  closeRuleDeleteModal,
  confirmRuleDelete,
  openRuleDeleteModal,
  updateRuleDeletePreview
};

/**
 * @typedef {HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement} FormValueElement
 */

/**
 * @param {string} id
 * @returns {FormValueElement|null}
 */
const getFormValueElement = (id) => /** @type {FormValueElement|null} */ ($(id));

/* ---- 事件委托 ---- */

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
    const row = /** @type {HTMLElement|null} */ (target.closest('.hotel-table-row'));
    if (!hotelId || !row) return;

    toggleHotelRowSelection(row, target.checked);
  }
}

/* ---- 详情弹窗 ---- */

export function showHotelDetails(id) {
  const hotel = state.hotels.find((h) => idsEqual(h.id, id));
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
  content.push(
    getField(
      '携程评分',
      hotel.ctrip_score !== undefined && hotel.ctrip_score !== null
        ? hotel.ctrip_score.toFixed(1)
        : '-'
    )
  );
  content.push(getField('目的地', hotel.destination));
  content.push(getField('距离', formatDistanceValue(hotel.distance, 'km')));
  content.push(
    getField('最近地铁站', formatSubwayInfo(hotel.subway_station, hotel.subway_distance, 'km'))
  );
  content.push(getField('公共交通时间', formatTransportValue(hotel.transport_time, 'min')));
  content.push(getField('公交路线', hotel.bus_route, true));
  content.push(getField('房间类型', hotel.room_type));
  content.push(getField('原始房型', hotel.original_room_type));
  content.push(getField('入住人数', hotel.room_count ? getRoomCountText(hotel.room_count) : '-'));
  content.push(getField('房间面积', hotel.room_area ? `${hotel.room_area} ㎡` : '-'));
  content.push(getField('备注', hotel.notes));
  content.push(getField('模板', hotel.template_info ? hotel.template_info.name : '-'));
  content.push(getField('收藏', hotel.is_favorite === 1 ? '是' : '否'));

  setModalActive('hotelDetailsModal', true);

  const detailsEl = document.getElementById('hotelDetailsContent');
  if (detailsEl) {
    detailsEl.innerHTML = `<div class="hotel-details-grid">${content.join('')}</div>`;
  }
}

export function closeHotelDetails() {
  setModalActive('hotelDetailsModal', false);
}

/* ---- 视图切换 ---- */

function normalizeViewModeChoice(viewMode) {
  return viewMode === 'list' ? 'list' : 'card';
}

export function syncViewModeControls() {
  const toggleButton = $('viewModeToggle');
  const cardOption = $('viewModeCardOption');
  const listOption = $('viewModeListOption');
  const activeMode = normalizeViewModeChoice(state.viewMode);

  if (toggleButton) {
    toggleButton.setAttribute(
      'aria-label',
      activeMode === 'list'
        ? '视图模式，当前表格，点击切换为卡片'
        : '视图模式，当前卡片，点击切换为表格'
    );
  }

  /** @type {Array<[HTMLElement|null, 'card'|'list']>} */
  const viewModeOptions = [
    [cardOption, 'card'],
    [listOption, 'list']
  ];

  viewModeOptions.forEach(([option, mode]) => {
    if (!option) return;
    const isActive = activeMode === mode;
    option.classList.toggle('is-active', isActive);
    option.setAttribute('aria-current', isActive ? 'true' : 'false');
  });

  const batchDeleteBtn = $('batchDeleteBtn');
  const ruleDeleteBtn = $('ruleDeleteBtn');

  if (activeMode === 'list') {
    if (batchDeleteBtn) {
      batchDeleteBtn.hidden = false;
      batchDeleteBtn.style.display = 'inline-flex';
    }
    if (ruleDeleteBtn) {
      ruleDeleteBtn.hidden = true;
      ruleDeleteBtn.style.display = 'none';
    }
  } else {
    if (batchDeleteBtn) {
      batchDeleteBtn.hidden = true;
      batchDeleteBtn.style.display = 'none';
    }
    if (ruleDeleteBtn) {
      ruleDeleteBtn.hidden = false;
      ruleDeleteBtn.style.display = 'inline-flex';
    }
  }
}

export function setViewModeChoice(viewMode) {
  const nextMode = normalizeViewModeChoice(viewMode);
  if (state.viewMode === nextMode) {
    syncViewModeControls();
    return;
  }

  setViewMode(nextMode);

  if (nextMode === 'card') {
    clearSelectedHotels();
  }

  syncViewModeControls();
  resetBatchDeleteConfirmation({ count: state.selectedHotels.size });
  requestHotelListRender({ reason: 'view-mode-change', forceFull: true });
}

export function toggleViewMode() {
  setViewModeChoice(state.viewMode === 'card' ? 'list' : 'card');
}

/* ---- 筛选 UI ---- */

function getSelectedSortMode() {
  const checked = document.querySelector('input[name="sortMode"]:checked');
  return checked instanceof HTMLInputElement ? checked.value : DEFAULT_SORT_MODE;
}

export function applyFilters() {
  replaceCurrentFilters({
    name: getValue('filterName'),
    score: getValue('filterScore'),
    favorite: getValue('filterFavorite'),
    template: getValue('filterTemplate'),
    transportTime: getValue('filterTransportTime'),
    subwayDistance: getValue('filterSubwayDistance'),
    sortMode: getSelectedSortMode()
  });
  markVisibleHotelsCacheDirty();
  requestHotelListRender({ reason: 'sort-change', forceFull: true });
}

export function clearFilters() {
  [
    'filterName',
    'filterScore',
    'filterFavorite',
    'filterTemplate',
    'filterTransportTime',
    'filterSubwayDistance'
  ].forEach((id) => {
    const el = getFormValueElement(id);
    if (el) el.value = '';
  });

  replaceCurrentFilters({
    sortMode: getSelectedSortMode()
  });

  refreshCustomSelects();
  markVisibleHotelsCacheDirty();
  requestHotelListRender({ reason: 'filter-change', forceFull: true });
}

/* ---- 注册到 actions ---- */
actions.showHotelDetails = showHotelDetails;
