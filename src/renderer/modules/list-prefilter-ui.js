/**
 * 列表页前筛设置 UI —— 携程列表筛选和 AI 目标条数。
 */

import { state } from './state.js';
import { $, escapeHtml, setChecked, setValue } from './dom-helpers.js';
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
  'aiCtripAccommodationTypeMode',
  'aiCtripAccommodationTypes',
  'aiCtripRoomTypes',
  'aiCtripRoomFeatures',
  'aiCtripFeatureThemes',
  'aiListDesiredHotelCount'
]);

const CTRIP_CHOICE_GROUPS = Object.freeze([
  {
    key: 'aiCtripAccommodationTypes',
    containerId: 'aiCtripAccommodationTypeOptions',
    options: [
      '酒店',
      '民宿',
      '青年旅馆',
      '酒店公寓',
      '公寓',
      '别墅',
      '特色酒店',
      '度假村',
      '度假屋',
      '特色住宿',
      '胶囊旅馆',
      '乡村民宿',
      '客栈',
      '露营地',
      '木屋',
      '家庭旅馆',
      '旅馆',
      '农家乐'
    ]
  },
  {
    key: 'aiCtripRoomTypes',
    containerId: 'aiCtripRoomTypeOptions',
    options: ['大床房', '双床房', '单人床房', '三床房', '特大床房', '多床房']
  },
  {
    key: 'aiCtripRoomFeatures',
    containerId: 'aiCtripRoomFeatureOptions',
    options: [
      '家庭房',
      '复式loft房',
      '影音房',
      '亲子主题房',
      '棋牌房',
      '整栋',
      '套房',
      '电竞房',
      '情侣房',
      '私汤房',
      '江河景房',
      '水床房',
      '阳台房',
      '独栋别墅',
      '榻榻米房',
      '圆床房',
      '湖景房',
      '自营影音房',
      '自营亲子房',
      '自营电玩房',
      '山景房',
      '自营舒睡房'
    ]
  },
  {
    key: 'aiCtripFeatureThemes',
    containerId: 'aiCtripFeatureThemeOptions',
    options: [
      '电竞酒店',
      '迷人江景',
      '亲子酒店',
      '窗外好景',
      '拍照出片',
      '浪漫之旅',
      '网红泳池',
      '动人夜景',
      '湖畔美居',
      '设计师酒店',
      '自助入住',
      '低碳酒店',
      '宜人山色',
      '历史名宅',
      '露营',
      '无烟酒店',
      '美食酒店'
    ]
  }
]);

const LIST_PREFILTER_DEFAULT_SETTINGS = Object.freeze({
  aiCtripPriceMin: '',
  aiCtripPriceMax: '',
  aiCtripStarLevels: [],
  aiCtripSortMode: '',
  aiCtripFreeCancel: false,
  aiCtripReviewCountMin: '',
  aiCtripScoreMin: '',
  aiCtripAccommodationTypeMode: 'include',
  aiCtripAccommodationTypes: [],
  aiCtripRoomTypes: [],
  aiCtripRoomFeatures: [],
  aiCtripFeatureThemes: [],
  aiListDesiredHotelCount: 10
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

  if (
    key === 'aiCtripAccommodationTypes' ||
    key === 'aiCtripRoomTypes' ||
    key === 'aiCtripRoomFeatures' ||
    key === 'aiCtripFeatureThemes'
  ) {
    const values = Array.isArray(value) ? value : String(value || '').split(/[,，;；\n\r|]+/);
    const seen = new Set();
    return values
      .map((item) => String(item || '').trim())
      .filter((item) => item && !seen.has(item) && seen.add(item));
  }

  if (key === 'aiCtripAccommodationTypeMode') {
    return String(value || '').trim() === 'exclude' ? 'exclude' : 'include';
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

function renderCtripChoiceGroups() {
  CTRIP_CHOICE_GROUPS.forEach((group) => {
    const container = $(group.containerId);
    if (!container || container.dataset.rendered === 'true') {
      return;
    }
    container.innerHTML = group.options
      .map(
        (option) => `
          <button
            class="prefilter-option-pill"
            type="button"
            data-action="toggle-ai-ctrip-list-option"
            data-setting-key="${group.key}"
            data-option-value="${escapeHtml(option)}"
            aria-pressed="false"
          >
            ${escapeHtml(option)}
          </button>
        `
      )
      .join('');
    container.dataset.rendered = 'true';
  });
}

function applyCtripChoiceGroup(key) {
  const selected = new Set(
    (Array.isArray(state.settings[key]) ? state.settings[key] : []).map((item) => String(item))
  );
  document.querySelectorAll(`[data-setting-key="${key}"][data-option-value]`).forEach((button) => {
    const optionButton = /** @type {HTMLElement} */ (button);
    const isSelected = selected.has(String(optionButton.dataset.optionValue || ''));
    optionButton.classList.toggle('is-selected', isSelected);
    optionButton.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  });
}

function applyCtripAccommodationTypeMode() {
  const mode = normalizeListPrefilterSettingValue(
    'aiCtripAccommodationTypeMode',
    state.settings.aiCtripAccommodationTypeMode
  );
  document.querySelectorAll('[data-accommodation-type-mode]').forEach((button) => {
    const modeButton = /** @type {HTMLElement} */ (button);
    const isSelected = modeButton.dataset.accommodationTypeMode === mode;
    modeButton.classList.toggle('is-selected', isSelected);
    modeButton.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  });
}

export function applyListPrefilterSettings() {
  renderCtripChoiceGroups();
  LIST_PREFILTER_SETTING_KEYS.forEach((key) => {
    if (key === 'aiCtripFreeCancel') {
      setChecked(key, Boolean(state.settings[key]));
      return;
    }
    if (key === 'aiCtripStarLevels') {
      applyCtripStarLevelPills();
      return;
    }
    if (key === 'aiCtripAccommodationTypeMode') {
      applyCtripAccommodationTypeMode();
      return;
    }
    if (
      key === 'aiCtripAccommodationTypes' ||
      key === 'aiCtripRoomTypes' ||
      key === 'aiCtripRoomFeatures' ||
      key === 'aiCtripFeatureThemes'
    ) {
      applyCtripChoiceGroup(key);
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
    aiCtripAccommodationTypeMode: normalizeListPrefilterSettingValue(
      'aiCtripAccommodationTypeMode',
      state.settings.aiCtripAccommodationTypeMode
    ),
    aiCtripAccommodationTypes: normalizeListPrefilterSettingValue(
      'aiCtripAccommodationTypes',
      Array.from(
        document.querySelectorAll(
          '[data-setting-key="aiCtripAccommodationTypes"][data-option-value].is-selected'
        )
      ).map((button) => /** @type {HTMLElement} */ (button).dataset.optionValue)
    ),
    aiCtripRoomTypes: normalizeListPrefilterSettingValue(
      'aiCtripRoomTypes',
      Array.from(
        document.querySelectorAll('[data-setting-key="aiCtripRoomTypes"][data-option-value].is-selected')
      ).map((button) => /** @type {HTMLElement} */ (button).dataset.optionValue)
    ),
    aiCtripRoomFeatures: normalizeListPrefilterSettingValue(
      'aiCtripRoomFeatures',
      Array.from(
        document.querySelectorAll(
          '[data-setting-key="aiCtripRoomFeatures"][data-option-value].is-selected'
        )
      ).map((button) => /** @type {HTMLElement} */ (button).dataset.optionValue)
    ),
    aiCtripFeatureThemes: normalizeListPrefilterSettingValue(
      'aiCtripFeatureThemes',
      Array.from(
        document.querySelectorAll(
          '[data-setting-key="aiCtripFeatureThemes"][data-option-value].is-selected'
        )
      ).map((button) => /** @type {HTMLElement} */ (button).dataset.optionValue)
    ),
    aiListDesiredHotelCount: normalizeListPrefilterSettingValue(
      'aiListDesiredHotelCount',
      getFormValueElement('aiListDesiredHotelCount')?.value
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

export async function setAiCtripAccommodationTypeMode(mode) {
  const nextMode = normalizeListPrefilterSettingValue('aiCtripAccommodationTypeMode', mode);
  return persistListPrefilterSettings({
    aiCtripAccommodationTypeMode: nextMode
  });
}

export async function toggleAiCtripListOption(settingKey, optionValue) {
  if (!LIST_PREFILTER_SETTING_KEYS.has(settingKey)) {
    return false;
  }
  const option = String(optionValue || '').trim();
  if (!option) {
    return false;
  }

  const current = Array.isArray(state.settings[settingKey])
    ? state.settings[settingKey].map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const next = current.includes(option)
    ? current.filter((item) => item !== option)
    : [...current, option];
  return persistListPrefilterSettings({
    [settingKey]: normalizeListPrefilterSettingValue(settingKey, next)
  });
}
