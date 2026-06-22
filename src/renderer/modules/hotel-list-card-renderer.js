/**
 * 宾馆卡片视图渲染。
 */

import { state, HOTEL_RENDER_BATCH_SIZE, LARGE_HOTEL_RENDER_THRESHOLD } from './state.js';
import {
  escapeHtml,
  escapeHtmlWithLineBreaks,
  hasDisplayValue,
  formatDateChinese,
  getRoomCountText,
  getSelectionKey,
  iconHtml
} from './dom-helpers.js';
import { isHotelInputPriorityActive, queueHotelRenderResume } from './render-scheduler.js';
import { formatSubwayInfo } from './hotel-filters.js';
import { normalizeHotelCardVisibleFields, renderCardFields } from './hotel-card-fields.js';

const CARD_TITLE_ROW_HEIGHT_VAR = '--hotel-card-title-row-height';

export function getCurrentHotelCardVisibleKeys() {
  return normalizeHotelCardVisibleFields(state.settings.hotelCardVisibleFields);
}

export function createHotelCard(hotel, index, visibleKeys = getCurrentHotelCardVisibleKeys()) {
  const rank = index + 1;
  const isTop3 = rank <= 3;
  const hotelIdText = String(hotel.id);
  const hotelIdAttr = escapeHtml(hotelIdText);

  const hasTemplate = !!hotel.template_info;
  const template = hotel.template_info;

  const isFromTemplate = (field) => {
    if (!hasTemplate) return false;
    if (
      field === 'destination' &&
      template.destination &&
      hotel.destination === template.destination
    )
      return true;
    if (field === 'room_count' && template.room_count && hotel.room_count === template.room_count)
      return true;
    if (
      field === 'check_in_date' &&
      template.check_in_date &&
      hotel.check_in_date === template.check_in_date
    )
      return true;
    if (
      field === 'check_out_date' &&
      template.check_out_date &&
      hotel.check_out_date === template.check_out_date
    )
      return true;
    return false;
  };

  const helpers = {
    escapeHtml,
    escapeHtmlWithLineBreaks,
    hasDisplayValue,
    formatDateChinese,
    getRoomCountText,
    formatSubwayInfo,
    isFromTemplate
  };

  const { headerFieldItems, compactItems, fullItems, footerItems, actionItems } = renderCardFields(
    hotel,
    visibleKeys,
    helpers
  );

  const card = document.createElement('div');
  card.className = `hotel-card ${hotel.is_favorite ? 'favorite' : ''}`;
  card.dataset.id = hotelIdText;
  state.renderedHotelNodeMap?.set(getSelectionKey(hotel.id), card);

  const originalRoomHtml =
    headerFieldItems.find((item) => item.key === 'original_room_type')?.html || '';
  const diamondLevelHtml =
    headerFieldItems.find((item) => item.key === 'ctrip_diamond_level')?.html || '';
  const websiteHtml = headerFieldItems.find((item) => item.key === 'website')?.html || '';
  const addressHtml = headerFieldItems.find((item) => item.key === 'address')?.html || '';
  const extraHeaderHtml = headerFieldItems
    .filter(
      (item) =>
        !['ctrip_diamond_level', 'original_room_type', 'website', 'address'].includes(item.key)
    )
    .map((item) => item.html)
    .join('');

  const originalRoomLineHtml = originalRoomHtml
    ? `<div class="hotel-card-original-room-row">${originalRoomHtml}</div>`
    : '';
  const diamondLevelLineHtml = diamondLevelHtml
    ? `<div class="hotel-card-level-row">${diamondLevelHtml}</div>`
    : '';

  const metaPairClasses = [
    'hotel-card-meta-pair',
    websiteHtml ? 'has-website' : '',
    addressHtml ? 'has-address' : '',
    websiteHtml && addressHtml ? '' : 'is-single-meta'
  ]
    .filter(Boolean)
    .join(' ');

  const metaPairHtml =
    websiteHtml || addressHtml
      ? `<div class="${metaPairClasses}">
        ${websiteHtml ? `<div class="hotel-card-meta-cell hotel-card-meta-cell-website">${websiteHtml}</div>` : ''}
        ${addressHtml ? `<div class="hotel-card-meta-cell hotel-card-meta-cell-address">${addressHtml}</div>` : ''}
      </div>`
      : '';

  const extraHeaderLineHtml = extraHeaderHtml
    ? `<div class="hotel-card-extra-header">${extraHeaderHtml}</div>`
    : '';

  const headerMetaHtml =
    diamondLevelLineHtml || originalRoomLineHtml || metaPairHtml || extraHeaderLineHtml
      ? `<div class="hotel-card-header-meta">
          ${diamondLevelLineHtml}
          ${originalRoomLineHtml}
          ${metaPairHtml}
          ${extraHeaderLineHtml}
        </div>`
      : '';
  const infoItems = [...compactItems, ...fullItems];
  const notesHtml = footerItems.join('');
  const favoriteLabel = hotel.is_favorite ? '取消收藏' : '收藏';
  const favoriteIcon = hotel.is_favorite ? '★' : '☆';
  const favoriteButtonClass = hotel.is_favorite
    ? 'hotel-favorite-star is-active'
    : 'hotel-favorite-star';

  card.innerHTML = `
    <div class="hotel-card-corner">
      <div class="hotel-rank ${isTop3 ? 'top3' : ''}">#${rank}</div>
      <button
        class="${favoriteButtonClass}"
        type="button"
        data-action="favorite"
        data-id="${hotelIdAttr}"
        data-favorite="${hotel.is_favorite}"
        aria-label="${favoriteLabel} ${escapeHtml(hotel.name)}"
        title="${favoriteLabel}"
      >
        <span aria-hidden="true">${favoriteIcon}</span>
      </button>
    </div>

    <div class="hotel-card-header">
      <div class="hotel-card-header-main">
        <div class="hotel-name">${escapeHtml(hotel.name)}</div>
        ${headerMetaHtml}
      </div>
    </div>

    <div class="hotel-info-grid">${infoItems.join('')}</div>

    ${notesHtml}

    <div class="hotel-actions">
      <button class="btn btn-secondary btn-sm" data-action="edit" data-id="${hotelIdAttr}">${iconHtml('edit')} 编辑</button>
      <button class="btn btn-danger btn-sm" data-action="delete" data-id="${hotelIdAttr}" data-confirming="false">
        ${iconHtml('trash')} 删除
      </button>
      ${actionItems.join('')}
    </div>
  `;

  return card;
}

function getCardTop(card) {
  return card.getBoundingClientRect().top;
}

function getElementHeight(element) {
  return element.getBoundingClientRect().height;
}

export function alignHotelCardTitleRows(container) {
  const cards = Array.from(container.querySelectorAll('.hotel-card'));
  const rows = new Map();

  for (const card of cards) {
    const name = card.querySelector('.hotel-card-header-main .hotel-name');

    name.style.removeProperty(CARD_TITLE_ROW_HEIGHT_VAR);

    const rowKey = String(Math.round(getCardTop(card)));
    const height = Math.ceil(getElementHeight(name));
    if (!height) continue;

    const row = rows.get(rowKey) || { height: 0, names: [] };
    row.height = Math.max(row.height, height);
    row.names.push(name);
    rows.set(rowKey, row);
  }

  for (const row of rows.values()) {
    for (const name of row.names) {
      name.style.setProperty(CARD_TITLE_ROW_HEIGHT_VAR, `${row.height}px`);
    }
  }
}

function renderHotelCardsInBatches(
  container,
  hotelsToRender,
  taskVersion,
  perfLabel,
  options = {},
  startIndex = 0,
  visibleKeys = getCurrentHotelCardVisibleKeys()
) {
  if (taskVersion !== state.hotelListRenderVersion) {
    options.finishHotelRender?.(taskVersion, perfLabel);
    return;
  }

  if (isHotelInputPriorityActive()) {
    queueHotelRenderResume(() =>
      renderHotelCardsInBatches(
        container,
        hotelsToRender,
        taskVersion,
        perfLabel,
        options,
        startIndex,
        visibleKeys
      )
    );
    return;
  }

  const fragment = document.createDocumentFragment();
  const endIndex = Math.min(startIndex + HOTEL_RENDER_BATCH_SIZE, hotelsToRender.length);

  for (let index = startIndex; index < endIndex; index++) {
    fragment.appendChild(createHotelCard(hotelsToRender[index], index, visibleKeys));
  }

  container.appendChild(fragment);

  if (endIndex < hotelsToRender.length) {
    requestAnimationFrame(() =>
      renderHotelCardsInBatches(
        container,
        hotelsToRender,
        taskVersion,
        perfLabel,
        options,
        endIndex,
        visibleKeys
      )
    );
    return;
  }

  alignHotelCardTitleRows(container);
  options.finishHotelRender?.(taskVersion, perfLabel);
}

export function renderHotelCardGrid(
  container,
  hotelsToRender,
  taskVersion,
  perfLabel,
  options = {}
) {
  const visibleKeys = getCurrentHotelCardVisibleKeys();

  if (hotelsToRender.length <= LARGE_HOTEL_RENDER_THRESHOLD) {
    const fragment = document.createDocumentFragment();
    hotelsToRender.forEach((hotel, index) => {
      fragment.appendChild(createHotelCard(hotel, index, visibleKeys));
    });
    container.appendChild(fragment);
    alignHotelCardTitleRows(container);
    options.finishHotelRender?.(taskVersion, perfLabel);
    return;
  }

  renderHotelCardsInBatches(
    container,
    hotelsToRender,
    taskVersion,
    perfLabel,
    options,
    0,
    visibleKeys
  );
}
