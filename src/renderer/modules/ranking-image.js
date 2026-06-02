/**
 * 排名图片导出 —— Canvas 绘制宾馆排名卡片并保存 PNG。
 */

import { state } from './state.js';
import { $, getValue, hasDisplayValue, setText, setValue } from './dom-helpers.js';
import { showNotification } from './notification.js';
import { setModalActive } from './ui-utils.js';
import {
  applyFiltersToHotels,
  sortHotels,
  DEFAULT_SORT_MODE,
  formatSubwayDistanceValue
} from './hotel-filters.js';

export function roundRect(ctx, x, y, width, height, radius) {
  if (typeof radius === 'number') {
    radius = [radius, radius, radius, radius];
  }
  ctx.beginPath();
  ctx.moveTo(x + radius[0], y);
  ctx.lineTo(x + width - radius[1], y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius[1]);
  ctx.lineTo(x + width, y + height - radius[2]);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius[2], y + height);
  ctx.lineTo(x + radius[3], y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius[3]);
  ctx.lineTo(x, y + radius[0]);
  ctx.quadraticCurveTo(x, y, x + radius[0], y);
  ctx.closePath();
}

function getSortedRankingHotels() {
  const filteredHotels = applyFiltersToHotels(state.hotels, state.currentFilters);
  return sortHotels(filteredHotels, String(state.currentFilters.sortMode || DEFAULT_SORT_MODE));
}

/**
 * @param {unknown} value
 * @param {number} availableCount
 * @returns {number|null}
 */
export function normalizeRankingExportLimit(value, availableCount) {
  const max = Math.floor(Number(availableCount) || 0);
  if (max <= 0) return null;

  if (value === null || value === undefined || String(value).trim() === '') {
    return Math.min(10, max);
  }

  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.min(parsed, max);
}

function getSelectedRankingExportLimit(availableCount) {
  const customValue = getValue('rankingExportCustomCount').trim();
  const checked = /** @type {HTMLInputElement|null} */ (
    document.querySelector('input[name="rankingExportCount"]:checked')
  );
  const selectedValue = customValue || checked?.value || '10';
  return normalizeRankingExportLimit(selectedValue, availableCount);
}

export function closeRankingImageExportModal() {
  setModalActive('rankingExportModal', false);
}

export function openRankingImageExportModal() {
  if (state.hotels.length === 0) {
    showNotification('暂无宾馆数据，无法导出排名图片', 'warning');
    return;
  }

  const sortedHotels = getSortedRankingHotels();
  if (sortedHotels.length === 0) {
    showNotification('当前筛选条件下没有宾馆数据，无法导出排名图片', 'warning');
    return;
  }

  setModalActive('rankingExportModal', true);
  setText('rankingExportAvailableCount', String(sortedHotels.length));
  setValue('rankingExportCustomCount', '');

  const defaultOption = /** @type {HTMLInputElement|null} */ (
    document.querySelector('input[name="rankingExportCount"][value="10"]')
  );
  if (defaultOption) defaultOption.checked = true;

  const customInput = /** @type {HTMLInputElement|null} */ ($('rankingExportCustomCount'));
  if (customInput) {
    customInput.max = String(sortedHotels.length);
  }
}

export async function confirmRankingImageExport() {
  const sortedHotels = getSortedRankingHotels();
  const limit = getSelectedRankingExportLimit(sortedHotels.length);
  if (!limit) {
    showNotification('请输入大于 0 的导出数量', 'warning');
    return;
  }

  closeRankingImageExportModal();
  await exportRankingImage({ limit });
}

/**
 * @param {{limit?: number}} [options]
 */
export async function exportRankingImage(options = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  const padding = 20;
  const cardWidth = 760;
  const cardHeight = 166;
  const gap = 20;

  const sortedHotels = getSortedRankingHotels();

  if (sortedHotels.length === 0) {
    showNotification('当前筛选条件下没有宾馆数据，无法导出排名图片', 'warning');
    return;
  }

  const exportLimit = normalizeRankingExportLimit(options.limit, sortedHotels.length);
  if (!exportLimit) {
    showNotification('请输入大于 0 的导出数量', 'warning');
    return;
  }

  const exportedHotels = sortedHotels.slice(0, exportLimit);
  const rows = exportedHotels.length;

  canvas.width = padding * 2 + cardWidth;
  const bottomPadding = 15;
  canvas.height = padding + 60 + rows * (cardHeight + gap) - gap + bottomPadding;

  ctx.fillStyle = '#F7F8FA';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#1D2129';
  ctx.font = 'bold 24px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`宾馆排名榜 · 前 ${rows} 名`, canvas.width / 2, padding + 30);

  const drawSingleLineText = (text, x, y, maxWidth) => {
    if (!text) return;
    const value = String(text);
    if (ctx.measureText(value).width <= maxWidth) {
      ctx.fillText(value, x, y);
      return;
    }
    const ellipsis = '...';
    let truncated = value;
    while (truncated && ctx.measureText(truncated + ellipsis).width > maxWidth) {
      truncated = truncated.slice(0, -1);
    }
    ctx.fillText((truncated || '') + ellipsis, x, y);
  };

  const drawImageField = (label, value, x, y, maxWidth) => {
    if (!value) return;
    ctx.fillStyle = '#86909C';
    ctx.font = '18px "Segoe UI", sans-serif';
    ctx.fillText(label, x, y);
    ctx.fillStyle = '#4E5969';
    drawSingleLineText(value, x + 78, y, maxWidth - 78);
  };

  const priceLineGap = 24;
  const sectionGap = 30;

  const drawPriceField = (hotel, x, y, cellWidth) => {
    const moduleX = x - 10;
    const moduleY = y - 19;
    const moduleWidth = cellWidth - 6;
    const moduleHeight = 58;

    ctx.fillStyle = '#FFF7E8';
    roundRect(ctx, moduleX, moduleY, moduleWidth, moduleHeight, 10);
    ctx.fill();

    ctx.strokeStyle = '#FFE0B0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(moduleX + 12, moduleY + moduleHeight / 2);
    ctx.lineTo(moduleX + moduleWidth - 12, moduleY + moduleHeight / 2);
    ctx.stroke();

    ctx.fillStyle = '#86909C';
    ctx.font = '18px "Segoe UI", sans-serif';
    ctx.fillText('总价格', x + 10, y);
    ctx.fillText('日均价格', x + 10, y + priceLineGap);

    ctx.fillStyle = '#1D2129';
    ctx.font = 'bold 22px "Segoe UI", sans-serif';
    if (hotel.total_price) drawSingleLineText(`¥${hotel.total_price}`, x + 100, y, cellWidth - 110);
    if (hotel.daily_price)
      drawSingleLineText(`¥${hotel.daily_price}`, x + 100, y + priceLineGap, cellWidth - 110);
    ctx.font = '18px "Segoe UI", sans-serif';
  };

  const batchSize = 10;

  const processBatch = (startIndex) => {
    const endIndex = Math.min(startIndex + batchSize, exportedHotels.length);

    for (let index = startIndex; index < endIndex; index++) {
      const hotel = exportedHotels[index];
      const x = padding;
      const y = padding + 60 + index * (cardHeight + gap);
      const rank = index + 1;

      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.1)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 2;
      roundRect(ctx, x, y, cardWidth, cardHeight, 12);
      ctx.fill();

      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;

      const gradient = ctx.createLinearGradient(x + cardWidth - 80, y, x + cardWidth, y + 30);
      if (rank <= 3) {
        gradient.addColorStop(0, '#FF7D00');
        gradient.addColorStop(1, '#FFB800');
      } else {
        gradient.addColorStop(0, '#165DFF');
        gradient.addColorStop(1, '#165DFF');
      }
      ctx.fillStyle = gradient;
      roundRect(ctx, x + cardWidth - 80, y, 80, 30, [0, 12, 0, 12]);
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 18px "Segoe UI", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`#${rank}`, x + cardWidth - 30, y + 22);

      ctx.fillStyle = '#1D2129';
      ctx.font = 'bold 24px "Segoe UI", sans-serif';
      ctx.textAlign = 'left';
      drawSingleLineText(hotel.name, x + 20, y + 42, cardWidth - 130);

      ctx.fillStyle = '#4E5969';
      ctx.font = '18px "Segoe UI", sans-serif';
      ctx.textAlign = 'left';

      const gridLeft = x + 20;
      const gridTop = y + 78;
      const columnGap = 28;
      const rowGap = priceLineGap + sectionGap;
      const cellWidth = 220;
      const col1X = gridLeft;
      const col2X = gridLeft + cellWidth + columnGap;
      const col3X = gridLeft + (cellWidth + columnGap) * 2;
      const row1Y = gridTop;
      const row2Y = gridTop + rowGap;

      drawPriceField(hotel, col1X, row1Y, cellWidth);

      const gridItems = [
        hasDisplayValue(hotel.distance) ? ['距离:', `${hotel.distance}公里`] : null,
        hasDisplayValue(hotel.subway_distance)
          ? ['距地铁:', formatSubwayDistanceValue(hotel.subway_distance)]
          : null,
        hasDisplayValue(hotel.transport_time) ? ['交通:', `${hotel.transport_time}分钟`] : null,
        hasDisplayValue(hotel.room_type) ? ['房型:', hotel.room_type] : null,
        hasDisplayValue(hotel.original_room_type) ? ['原始房型:', hotel.original_room_type] : null,
        hasDisplayValue(hotel.room_area) ? ['面积:', `${hotel.room_area}㎡`] : null
      ].filter(Boolean);

      const positions = [
        [col2X, row1Y],
        [col3X, row1Y],
        [col1X, row2Y],
        [col2X, row2Y],
        [col3X, row2Y]
      ];

      gridItems.slice(0, positions.length).forEach(([label, value], itemIndex) => {
        const [fieldX, fieldY] = positions[itemIndex];
        drawImageField(label, value, fieldX, fieldY, cellWidth);
      });
    }

    if (endIndex < exportedHotels.length) {
      requestAnimationFrame(() => processBatch(endIndex));
    } else {
      finishExport();
    }
  };

  const finishExport = async () => {
    try {
      const imageBuffer = canvas.toDataURL('image/png').split(',')[1];
      const result = await window.electronAPI.exportRankingImage(imageBuffer);
      if (result.success) {
        showNotification(`排名图片已导出前 ${rows} 名到: ${result.path}`, 'success');
      }
    } catch (error) {
      console.error('导出图片失败:', error);
      showNotification('导出失败，请重试', 'error');
    }
  };

  processBatch(0);
}
