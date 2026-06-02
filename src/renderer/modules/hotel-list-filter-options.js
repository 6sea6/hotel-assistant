/**
 * 宾馆列表筛选选项 —— 同步名称筛选下拉，避免渲染/patch 模块反向依赖 controller。
 */

import { state, setHotelNameFilterOptionSignature } from './state.js';
import { $, normalizeFilterOptionKey } from './dom-helpers.js';
import { refreshCustomSelects } from './custom-select.js';

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

/**
 * @param {{selectedValue?: string}} [options]
 * @returns {string}
 */
export function syncHotelNameFilterOptions(options = {}) {
  const select = /** @type {HTMLSelectElement|null} */ ($('filterName'));
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

  setHotelNameFilterOptionSignature(signature);

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

  refreshCustomSelects();

  return select.value;
}
