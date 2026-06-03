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
  getSelectionKey
} from './dom-helpers.js';
import { isHotelInputPriorityActive, queueHotelRenderResume } from './render-scheduler.js';
import { formatSubwayInfo } from './hotel-filters.js';
import { normalizeHotelCardVisibleFields, renderCardFields } from './hotel-card-fields.js';

export function createHotelCard(hotel, index) {
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

  const visibleKeys = normalizeHotelCardVisibleFields(state.settings.hotelCardVisibleFields);

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
  const websiteHtml = headerFieldItems.find((item) => item.key === 'website')?.html || '';
  const addressHtml = headerFieldItems.find((item) => item.key === 'address')?.html || '';
  const extraHeaderHtml = headerFieldItems
    .filter((item) => !['original_room_type', 'website', 'address'].includes(item.key))
    .map((item) => item.html)
    .join('');

  const originalRoomLineHtml = originalRoomHtml
    ? `<div class="hotel-card-original-room-row">${originalRoomHtml}</div>`
    : '';

  const metaPairHtml =
    websiteHtml || addressHtml
      ? `<div class="hotel-card-meta-pair">
        <div class="hotel-card-meta-cell hotel-card-meta-cell-website">${websiteHtml || ''}</div>
        <div class="hotel-card-meta-cell hotel-card-meta-cell-address">${addressHtml || ''}</div>
      </div>`
      : '';

  const extraHeaderLineHtml = extraHeaderHtml
    ? `<div class="hotel-card-extra-header">${extraHeaderHtml}</div>`
    : '';

  const headerMetaHtml =
    originalRoomLineHtml || metaPairHtml || extraHeaderLineHtml
      ? `<div class="hotel-card-header-meta">
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
      <button class="btn btn-secondary btn-sm" data-action="edit" data-id="${hotelIdAttr}">✏️ 编辑</button>
      <button class="btn btn-danger btn-sm" data-action="delete" data-id="${hotelIdAttr}" data-confirming="false">
        🗑️ 删除
      </button>
      ${actionItems.join('')}
    </div>
  `;

  return card;
}

export function cleanupHotelActionArtifacts(container) {
  container.querySelectorAll('.hotel-actions *').forEach((el) => {
    if (!el || !el.textContent) return;
    const txt = el.textContent.trim();
    if (/^[\.·\u2026\u22EF]{1,4}$/.test(txt)) {
      el.remove();
    }
  });
}

function renderHotelCardsInBatches(
  container,
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
      renderHotelCardsInBatches(
        container,
        hotelsToRender,
        taskVersion,
        perfLabel,
        options,
        startIndex
      )
    );
    return;
  }

  const fragment = document.createDocumentFragment();
  const endIndex = Math.min(startIndex + HOTEL_RENDER_BATCH_SIZE, hotelsToRender.length);

  for (let index = startIndex; index < endIndex; index++) {
    fragment.appendChild(createHotelCard(hotelsToRender[index], index));
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
        endIndex
      )
    );
    return;
  }

  cleanupHotelActionArtifacts(container);
  options.finishHotelRender?.(taskVersion, perfLabel);
}

export function renderHotelCardGrid(
  container,
  hotelsToRender,
  taskVersion,
  perfLabel,
  options = {}
) {
  if (hotelsToRender.length <= LARGE_HOTEL_RENDER_THRESHOLD) {
    const fragment = document.createDocumentFragment();
    hotelsToRender.forEach((hotel, index) => {
      fragment.appendChild(createHotelCard(hotel, index));
    });
    container.appendChild(fragment);
    cleanupHotelActionArtifacts(container);
    options.finishHotelRender?.(taskVersion, perfLabel);
    return;
  }

  renderHotelCardsInBatches(container, hotelsToRender, taskVersion, perfLabel, options);
}
