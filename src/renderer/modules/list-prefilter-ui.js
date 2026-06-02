/**
 * 列表页前筛设置 UI —— 携程列表筛选和 AI 目标条数。
 */

import { state } from './state.js';
import { $, setChecked, setValue } from './dom-helpers.js';
import { showNotification } from './notification.js';
import { setModalActive } from './ui-utils.js';
import { refreshCustomSelects } from './custom-select.js';

/**
 * @typedef {HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement} ListPrefilterFormValueElement
 */

/**
 * @param {string} id
 * @returns {ListPrefilterFormValueElement|null}
 */
const getFormValueElement = (id) => /** @type {ListPrefilterFormValueElement|null} */ ($(id));

const LIST_PREFILTER_SETTING_KEYS = new Set([
  'aiCtripPriceMin',
  'aiCtripPriceMax',
  'aiCtripStarLevels',
  'aiCtripSortMode',
  'aiCtripFreeCancel',
  'aiCtripReviewCountMin',
  'aiCtripScoreMin',
  'aiListDesiredHotelCount',
  'aiListExcludeHotelTypes'
]);

const LIST_PREFILTER_DEFAULT_SETTINGS = Object.freeze({
  aiCtripPriceMin: '',
  aiCtripPriceMax: '',
  aiCtripStarLevels: [],
  aiCtripSortMode: '',
  aiCtripFreeCancel: false,
  aiCtripReviewCountMin: '',
  aiCtripScoreMin: '',
  aiListDesiredHotelCount: 10,
  aiListExcludeHotelTypes: '民宿,客栈,青年旅舍,公寓'
});

export function openListPrefilterSettings() {
  setModalActive('listPrefilterModal', true);
  applyListPrefilterSettings();
  refreshCustomSelects();
}

export function closeListPrefilterSettings() {
  setModalActive('listPrefilterModal', false);
}

function normalizeListPrefilterSettingValue(key, value) {
  if (key === 'aiCtripFreeCancel') {
    return Boolean(value);
  }

  if (key === 'aiCtripStarLevels') {
    const values = Array.isArray(value) ? value : String(value || '').split(/[,，;；\s|]+/);
    const seen = new Set();
    return values
      .map((item) => Number(item))
      .filter(
        (item) =>
          Number.isInteger(item) && item >= 2 && item <= 5 && !seen.has(item) && seen.add(item)
      )
      .sort((left, right) => left - right);
  }

  if (key === 'aiCtripPriceMin') {
    const text = String(value || '').trim();
    if (!text) return '';
    const number = Number(text);
    return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : '';
  }

  if (key === 'aiCtripPriceMax') {
    const text = String(value || '')
      .trim()
      .toLowerCase();
    if (!text) return '';
    if (text === 'max') return 'max';
    const number = Number(text);
    return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : '';
  }

  if (key === 'aiCtripSortMode') {
    return ['popularity', 'price_low', 'review_high'].includes(String(value || '').trim())
      ? String(value || '').trim()
      : '';
  }

  if (key === 'aiCtripReviewCountMin') {
    const number = Number(String(value || '').trim());
    return [100, 200, 500].includes(number) ? number : '';
  }

  if (key === 'aiCtripScoreMin') {
    const number = Number(String(value || '').trim());
    return [4, 4.5, 4.7].includes(number) ? number : '';
  }

  if (key === 'aiListDesiredHotelCount') {
    const number = Number(String(value || '').trim());
    return Number.isFinite(number) && number > 0 ? Math.trunc(number) : '';
  }

  return String(value || '').trim();
}

function applyCtripStarLevelPills() {
  const selected = new Set(
    (Array.isArray(state.settings.aiCtripStarLevels) ? state.settings.aiCtripStarLevels : []).map(
      (item) => String(item)
    )
  );
  document.querySelectorAll('[data-star-level]').forEach((button) => {
    const starButton = /** @type {HTMLElement} */ (button);
    const isSelected = selected.has(String(starButton.dataset.starLevel));
    starButton.classList.toggle('is-selected', isSelected);
    starButton.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  });
}

export function applyListPrefilterSettings() {
  LIST_PREFILTER_SETTING_KEYS.forEach((key) => {
    if (key === 'aiCtripFreeCancel') {
      setChecked(key, Boolean(state.settings[key]));
      return;
    }
    if (key === 'aiCtripStarLevels') {
      applyCtripStarLevelPills();
      return;
    }
    setValue(key, state.settings[key] ?? '');
  });
}

function readListPrefilterFormValues() {
  const selectedStars = Array.from(document.querySelectorAll('[data-star-level].is-selected')).map(
    (button) => /** @type {HTMLElement} */ (button).dataset.starLevel
  );
  return {
    aiCtripPriceMin: normalizeListPrefilterSettingValue(
      'aiCtripPriceMin',
      getFormValueElement('aiCtripPriceMin')?.value
    ),
    aiCtripPriceMax: normalizeListPrefilterSettingValue(
      'aiCtripPriceMax',
      getFormValueElement('aiCtripPriceMax')?.value
    ),
    aiCtripStarLevels: normalizeListPrefilterSettingValue('aiCtripStarLevels', selectedStars),
    aiCtripSortMode: normalizeListPrefilterSettingValue(
      'aiCtripSortMode',
      getFormValueElement('aiCtripSortMode')?.value
    ),
    aiCtripFreeCancel: normalizeListPrefilterSettingValue(
      'aiCtripFreeCancel',
      Boolean(/** @type {HTMLInputElement|null} */ ($('aiCtripFreeCancel'))?.checked)
    ),
    aiCtripReviewCountMin: normalizeListPrefilterSettingValue(
      'aiCtripReviewCountMin',
      getFormValueElement('aiCtripReviewCountMin')?.value
    ),
    aiCtripScoreMin: normalizeListPrefilterSettingValue(
      'aiCtripScoreMin',
      getFormValueElement('aiCtripScoreMin')?.value
    ),
    aiListDesiredHotelCount: normalizeListPrefilterSettingValue(
      'aiListDesiredHotelCount',
      getFormValueElement('aiListDesiredHotelCount')?.value
    ),
    aiListExcludeHotelTypes: normalizeListPrefilterSettingValue(
      'aiListExcludeHotelTypes',
      getFormValueElement('aiListExcludeHotelTypes')?.value
    )
  };
}

async function persistListPrefilterSettings(nextSettings) {
  const entries = Object.entries(nextSettings).filter(([key]) =>
    LIST_PREFILTER_SETTING_KEYS.has(key)
  );
  const previousSettings = {};
  entries.forEach(([key]) => {
    previousSettings[key] = state.settings[key];
  });

  try {
    await Promise.all(entries.map(([key, value]) => window.electronAPI.setSetting(key, value)));
    entries.forEach(([key, value]) => {
      state.settings[key] = value;
    });
    applyListPrefilterSettings();
    return true;
  } catch (error) {
    console.error('保存列表页前筛设置失败:', error);
    entries.forEach(([key]) => {
      state.settings[key] = previousSettings[key];
    });
    applyListPrefilterSettings();
    showNotification('保存列表页前筛设置失败，请重试', 'error');
    return false;
  }
}

/**
 * @param {Event} event
 */
export async function saveAiListPrefilterSetting(event) {
  const input =
    event && event.target instanceof HTMLElement
      ? /** @type {HTMLInputElement|HTMLSelectElement} */ (event.target)
      : null;
  const key = input && input.dataset ? input.dataset.settingKey : '';
  if (!LIST_PREFILTER_SETTING_KEYS.has(key)) {
    return;
  }

  const previousValue = state.settings[key] ?? '';
  const rawValue =
    key === 'aiCtripFreeCancel'
      ? /** @type {HTMLInputElement} */ (input).checked
      : key === 'aiCtripStarLevels'
        ? Array.from(/** @type {HTMLSelectElement} */ (input).selectedOptions || []).map(
            (option) => option.value
          )
        : input.value;
  const nextValue = normalizeListPrefilterSettingValue(key, rawValue);

  try {
    await window.electronAPI.setSetting(key, nextValue);
    state.settings[key] = nextValue;
    applyListPrefilterSettings();
  } catch (error) {
    console.error('保存列表页前筛设置失败:', error);
    state.settings[key] = previousValue;
    applyListPrefilterSettings();
    showNotification('保存列表页前筛设置失败，请重试', 'error');
  }
}

export async function saveAiListPrefilterSettings() {
  const ok = await persistListPrefilterSettings(readListPrefilterFormValues());
  if (ok) {
    showNotification('列表页前筛设置已保存', 'success');
  }
  return ok;
}

export async function resetAiListPrefilterSettings() {
  const ok = await persistListPrefilterSettings({
    ...LIST_PREFILTER_DEFAULT_SETTINGS
  });
  if (ok) {
    showNotification('列表页前筛已重置', 'success');
  }
  return ok;
}

export async function toggleAiCtripStarLevel(starLevel) {
  const star = Number(starLevel);
  if (![2, 3, 4, 5].includes(star)) {
    return false;
  }

  const current = Array.isArray(state.settings.aiCtripStarLevels)
    ? state.settings.aiCtripStarLevels
        .map((item) => Number(item))
        .filter((item) => [2, 3, 4, 5].includes(item))
    : [];
  const next = current.includes(star)
    ? current.filter((item) => item !== star)
    : [...current, star].sort((left, right) => left - right);
  const ok = await persistListPrefilterSettings({
    aiCtripStarLevels: next
  });
  return ok;
}
