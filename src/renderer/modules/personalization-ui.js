/**
 * 个性化设置 UI —— 主题、卡片字段和应用图标。
 */

import { state } from './state.js';
import { $ } from './dom-helpers.js';
import { showNotification } from './notification.js';
import { setModalActive } from './ui-utils.js';
import { actions } from './actions.js';
import {
  normalizeHotelCardVisibleFields,
  DEFAULT_HOTEL_CARD_VISIBLE_FIELDS,
  SUPPORTED_HOTEL_CARD_FIELD_KEYS
} from './hotel-card-fields.js';

/**
 * @typedef {HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement} PersonalizationFormValueElement
 */

/**
 * @param {string} id
 * @returns {PersonalizationFormValueElement|null}
 */
const getFormValueElement = (id) => /** @type {PersonalizationFormValueElement|null} */ ($(id));

const THEME_ALIAS_MAP = Object.freeze({
  light: 'cloud-white',
  dark: 'oak-brown',
  'changing-mode': 'colorful-mode'
});

const SUPPORTED_THEMES = new Set([
  'totoro-blue',
  'sweet-lime',
  'grass-green',
  'pineapple-yellow',
  'oak-brown',
  'cloud-white',
  'autumn-gold',
  'diehard-pink',
  'grape-purple',
  'colorful-mode'
]);

export async function openPersonalization() {
  setModalActive('personalizationModal', true);
  syncThemePicker(normalizeThemeKey(state.settings.theme));
  syncHotelCardFieldPicker();
  await loadAppIconState();
}

export function closePersonalizationModal() {
  setModalActive('personalizationModal', false);
}

/**
 * @param {unknown} theme
 * @returns {string}
 */
export function normalizeThemeKey(theme) {
  const themeKey = String(theme || '');
  const normalizedTheme = THEME_ALIAS_MAP[themeKey] || themeKey;
  return SUPPORTED_THEMES.has(normalizedTheme) ? normalizedTheme : 'totoro-blue';
}

/**
 * @param {string} theme
 * @returns {void}
 */
function syncThemePicker(theme) {
  document.querySelectorAll('input[name="themeOption"]').forEach((radio) => {
    const input = /** @type {HTMLInputElement} */ (radio);
    input.checked = input.value === theme;
  });
}

function setRenderedTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  state.settings.activeTheme = theme;
}

async function previewWindowTheme(theme) {
  if (!window.electronAPI?.applyThemeAppearance) {
    return;
  }

  try {
    await window.electronAPI.applyThemeAppearance(theme);
  } catch (error) {
    console.error('更新窗口主题外观失败:', error);
  }
}

export function applyThemeSelection(theme) {
  const normalizedTheme = normalizeThemeKey(theme);
  state.settings.theme = normalizedTheme;
  syncThemePicker(normalizedTheme);
  setRenderedTheme(normalizedTheme);
  void previewWindowTheme(normalizedTheme);
  return normalizedTheme;
}

export async function changeTheme(theme) {
  const normalizedTheme = normalizeThemeKey(theme);

  try {
    await window.electronAPI.setSetting('theme', normalizedTheme);
    applyThemeSelection(normalizedTheme);
  } catch (error) {
    console.error('保存主题设置失败:', error);
  }
}

function syncHotelCardFieldPicker() {
  const visibleFields = normalizeHotelCardVisibleFields(state.settings.hotelCardVisibleFields);
  const visibleSet = new Set(visibleFields);
  const picker = document.getElementById('cardFieldPicker');
  if (!picker) return;

  picker.querySelectorAll('input[data-card-field]').forEach((input) => {
    const checkbox = /** @type {HTMLInputElement} */ (input);
    const key = checkbox.dataset.cardField;
    if (key && SUPPORTED_HOTEL_CARD_FIELD_KEYS.has(key)) {
      checkbox.checked = visibleSet.has(key);
    }
  });
}

function readHotelCardFieldPicker() {
  const picker = document.getElementById('cardFieldPicker');
  if (!picker) return [...DEFAULT_HOTEL_CARD_VISIBLE_FIELDS];

  const selected = [];
  picker.querySelectorAll('input[data-card-field]').forEach((input) => {
    const checkbox = /** @type {HTMLInputElement} */ (input);
    if (checkbox.checked && checkbox.dataset.cardField) {
      selected.push(checkbox.dataset.cardField);
    }
  });
  return normalizeHotelCardVisibleFields(selected);
}

export async function saveHotelCardVisibleFields() {
  const nextFields = readHotelCardFieldPicker();
  const previousFields = normalizeHotelCardVisibleFields(state.settings.hotelCardVisibleFields);

  try {
    await window.electronAPI.setSetting('hotelCardVisibleFields', nextFields);
    state.settings.hotelCardVisibleFields = nextFields;
    syncHotelCardFieldPicker();
    actions.requestHotelListRender({ reason: 'settings', forceFull: true });
    showNotification('卡片展示字段已保存', 'success');
  } catch (error) {
    console.error('保存卡片展示字段失败:', error);
    state.settings.hotelCardVisibleFields = previousFields;
    syncHotelCardFieldPicker();
    showNotification('保存卡片展示字段失败，请重试', 'error');
  }
}

export async function resetHotelCardVisibleFields() {
  const nextFields = [...DEFAULT_HOTEL_CARD_VISIBLE_FIELDS];
  const previousFields = normalizeHotelCardVisibleFields(state.settings.hotelCardVisibleFields);

  try {
    await window.electronAPI.setSetting('hotelCardVisibleFields', nextFields);
    state.settings.hotelCardVisibleFields = nextFields;
    syncHotelCardFieldPicker();
    actions.requestHotelListRender({ reason: 'settings', forceFull: true });
    showNotification('已恢复默认卡片展示字段', 'success');
  } catch (error) {
    console.error('恢复默认卡片展示字段失败:', error);
    state.settings.hotelCardVisibleFields = previousFields;
    syncHotelCardFieldPicker();
    showNotification('恢复默认失败，请重试', 'error');
  }
}

export async function loadAppIconState() {
  const iconPathInput = getFormValueElement('appIconPathInput');
  const iconStatus = $('appIconStatus');
  if (!iconPathInput || !iconStatus) return;

  try {
    const iconState = await window.electronAPI.getAppIconState();
    applyAppIconState(iconState);
  } catch (error) {
    console.error('加载图标状态失败:', error);
    iconPathInput.value = '加载失败';
    iconStatus.textContent = '图标状态获取失败';
  }
}

export function applyAppIconState(iconState) {
  const iconPathInput = getFormValueElement('appIconPathInput');
  const iconStatus = $('appIconStatus');
  if (!iconPathInput || !iconStatus) return;

  if (iconState && iconState.isCustom && iconState.customPath) {
    iconPathInput.value = iconState.activePath || iconState.customPath;
    iconStatus.textContent = iconState.isManaged
      ? `当前使用应用内自定义图标：${iconState.fileName || '未命名文件'}`
      : `当前使用自定义图标：${iconState.fileName || '未命名文件'}`;
    return;
  }

  if (iconState && iconState.missingCustomIcon) {
    iconPathInput.value = '默认图标';
    iconStatus.textContent = '原自定义图标文件未找到，当前已回退为内置默认图标';
    return;
  }

  iconPathInput.value = '默认图标';
  iconStatus.textContent = '当前使用内置默认图标';
}

export async function chooseAppIcon() {
  try {
    const result = await window.electronAPI.chooseAppIcon();
    if (result?.canceled) return;
    if (!result?.success) {
      showNotification(result?.error || '更换图标失败，请重试', 'error');
      return;
    }

    state.settings.app_icon_path = result.path || '';
    state.settings.app_icon_file_name = result.fileName || '';
    applyAppIconState(result.state);
    showNotification(`应用图标已更新并保存到应用内：${result.fileName}`, 'success');
  } catch (error) {
    console.error('更换应用图标失败:', error);
    showNotification('更换图标失败，请重试', 'error');
  }
}

export async function resetAppIcon() {
  try {
    const result = await window.electronAPI.resetAppIcon();
    if (!result?.success) {
      showNotification(result?.error || '恢复默认图标失败，请重试', 'error');
      return;
    }

    state.settings.app_icon_path = '';
    state.settings.app_icon_file_name = '';
    applyAppIconState(result.state);
    showNotification('已恢复为默认图标', 'success');
  } catch (error) {
    console.error('恢复默认图标失败:', error);
    showNotification('恢复默认图标失败，请重试', 'error');
  }
}
