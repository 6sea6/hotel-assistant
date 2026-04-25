/**
 * 设置与个性化 UI —— 主题、图标、权重、数据路径、采集偏好、数据导入导出、外部网站。
 */

import { state, rankingCache } from './state.js';
import { $, setValue } from './dom-helpers.js';
import { showNotification } from './notification.js';
import { setModalActive, getEventButton, resetActionButtonConfirmation, startActionButtonConfirmation } from './ui-utils.js';
import { actions } from './actions.js';

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

/* ---- 设置弹窗 ---- */

export async function openSettings() {
  setModalActive('settingsModal', true);
  await loadDataPath();
}

export function closeSettingsModal() {
  setModalActive('settingsModal', false);
}

export async function openPersonalization() {
  setModalActive('personalizationModal', true);
  syncThemePicker(normalizeThemeKey(state.settings.theme));
  await loadAppIconState();
}

export function closePersonalizationModal() {
  setModalActive('personalizationModal', false);
}

/* ---- 应用设置到 UI ---- */

export function applySettings() {
  const theme = normalizeThemeKey(state.settings.theme);
  applyThemeSelection(theme);

  applyBooleanSettingToggle(
    'includeFourPersonRoomsForThreePersonTemplate',
    'includeFourPersonRoomsForThreePersonTemplate',
    'includeFourPersonRoomsForThreePersonTemplateText'
  );

  const weightMappings = [
    { key: 'weight_price', id: 'weightPrice', valueId: 'priceWeightValue' },
    { key: 'weight_score', id: 'weightScore', valueId: 'scoreWeightValue' },
    { key: 'weight_distance', id: 'weightDistance', valueId: 'distanceWeightValue' },
    { key: 'weight_transport', id: 'weightTransport', valueId: 'transportWeightValue' }
  ];

  weightMappings.forEach(({ key, id, valueId }) => {
    if (state.settings[key]) {
      const weightEl = document.getElementById(id);
      const valueEl = document.getElementById(valueId);
      if (weightEl) weightEl.value = state.settings[key];
      if (valueEl) valueEl.textContent = state.settings[key];
    }
  });
}

function normalizeThemeKey(theme) {
  const normalizedTheme = THEME_ALIAS_MAP[theme] || theme;
  return SUPPORTED_THEMES.has(normalizedTheme) ? normalizedTheme : 'totoro-blue';
}

function syncThemePicker(theme) {
  document.querySelectorAll('input[name="themeOption"]').forEach((radio) => {
    radio.checked = radio.value === theme;
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

function applyThemeSelection(theme) {
  const normalizedTheme = normalizeThemeKey(theme);
  state.settings.theme = normalizedTheme;
  syncThemePicker(normalizedTheme);
  setRenderedTheme(normalizedTheme);
  void previewWindowTheme(normalizedTheme);
  return normalizedTheme;
}

function applyBooleanSettingToggle(settingKey, checkboxId, textId) {
  const checkbox = document.getElementById(checkboxId);
  const textEl = document.getElementById(textId);
  if (!checkbox || !textEl) {
    return;
  }

  const isEnabled = Boolean(state.settings[settingKey]);
  checkbox.checked = isEnabled;
  textEl.textContent = isEnabled ? '开启' : '关闭';
}

/* ---- 主题 ---- */

export async function changeTheme(theme) {
  const normalizedTheme = normalizeThemeKey(theme);

  try {
    await window.electronAPI.setSetting('theme', normalizedTheme);
    applyThemeSelection(normalizedTheme);
  } catch (error) {
    console.error('保存主题设置失败:', error);
  }
}

/* ---- 采集偏好 ---- */

export async function toggleIncludeFourPersonRoomsForThreePersonTemplate() {
  const checkbox = document.getElementById('includeFourPersonRoomsForThreePersonTemplate');
  const textEl = document.getElementById('includeFourPersonRoomsForThreePersonTemplateText');
  const isEnabled = Boolean(checkbox && checkbox.checked);

  try {
    await window.electronAPI.setSetting('includeFourPersonRoomsForThreePersonTemplate', isEnabled);
    state.settings.includeFourPersonRoomsForThreePersonTemplate = isEnabled;
    if (textEl) {
      textEl.textContent = isEnabled ? '开启' : '关闭';
    }
  } catch (error) {
    console.error('保存采集偏好设置失败:', error);
    if (checkbox) {
      checkbox.checked = !isEnabled;
    }
    if (textEl) {
      textEl.textContent = !isEnabled ? '开启' : '关闭';
    }
  }
}

/* ---- 数据路径 ---- */

export async function loadDataPath() {
  try {
    const path = await window.electronAPI.getDataPath();
    setValue('dataPathInput', path);
  } catch (error) {
    console.error('加载数据路径失败:', error);
    setValue('dataPathInput', '加载失败');
  }
}

export async function showDataInFolder() {
  try {
    await window.electronAPI.showDataInFolder();
  } catch (error) {
    console.error('打开文件夹失败:', error);
    showNotification('打开文件夹失败，请重试', 'error');
  }
}

export async function changeDataPath(eventLike) {
  const triggerButton = getEventButton(eventLike);
  if (triggerButton && triggerButton.dataset.confirming !== 'true') {
    startActionButtonConfirmation(triggerButton, {
      confirmHtml: '<span>⚠️</span> 确认更改',
      variantClass: 'btn-secondary'
    });
    return;
  }

  if (triggerButton) {
    resetActionButtonConfirmation(triggerButton);
    triggerButton.disabled = true;
  }

  try {
    const result = await window.electronAPI.changeDataPath();
    if (result.success) {
      setValue('dataPathInput', result.path);
      showNotification(`数据存储位置已更改为:\n${result.path}`, 'success');
    } else if (!result.canceled) {
      showNotification(result.error || '更改失败，请重试', 'error');
    }
  } catch (error) {
    console.error('更改数据路径失败:', error);
    showNotification('更改失败，请重试', 'error');
  } finally {
    if (triggerButton) {
      triggerButton.disabled = false;
      resetActionButtonConfirmation(triggerButton);
    }
  }
}

/* ---- 应用图标 ---- */

export async function loadAppIconState() {
  const iconPathInput = $('appIconPathInput');
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
  const iconPathInput = $('appIconPathInput');
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

/* ---- 恢复默认设置 ---- */

export async function resetSettings(eventLike) {
  const triggerButton = getEventButton(eventLike);
  if (triggerButton && triggerButton.dataset.confirming !== 'true') {
    startActionButtonConfirmation(triggerButton, {
      confirmHtml: '⚠️ 确认恢复默认',
      variantClass: 'btn-secondary'
    });
    return;
  }

  if (triggerButton) {
    resetActionButtonConfirmation(triggerButton);
    triggerButton.disabled = true;
  }

  try {
    const result = await window.electronAPI.resetAllSettings();
    if (!result || !result.success) {
      throw new Error('恢复默认设置失败');
    }

    state.settings = result.settings || await actions.loadSettings();
    rankingCache.invalidate();
    applySettings();
    applyAppIconState(result.iconState);
    showNotification('设置已恢复默认', 'success');
  } catch (error) {
    console.error('重置设置失败:', error);
    showNotification('操作失败，请重试', 'error');
  } finally {
    if (triggerButton) {
      triggerButton.disabled = false;
      resetActionButtonConfirmation(triggerButton);
    }
  }
}

/* ---- 数据导入导出 ---- */

function focusImportTransferOption() {
  const importOption = $('importTransferOption');
  if (!importOption) return;
  importOption.classList.add('transfer-option-focus');
  importOption.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  setTimeout(() => importOption.classList.remove('transfer-option-focus'), 1800);
}

export function openDataTransfer(section = '') {
  setModalActive('dataTransferModal', true);
  if (section === 'import') {
    requestAnimationFrame(() => focusImportTransferOption());
  }
}

export function closeDataTransfer() {
  setModalActive('dataTransferModal', false);
}

export async function handleExportData() {
  closeDataTransfer();
  try {
    const result = await window.electronAPI.exportData();
    if (result.success) {
      showNotification(`数据已导出到: ${result.path}\n宾馆 ${result.hotelCount || 0} 条，模板 ${result.templateCount || 0} 条`, 'success');
    }
  } catch (error) {
    console.error('导出数据失败:', error);
    showNotification('导出失败，请重试', 'error');
  }
}

export async function handleImportData(mode) {
  if (mode !== 'replace' && mode !== 'append') {
    openDataTransfer('import');
    return;
  }

  closeDataTransfer();
  try {
    const result = await window.electronAPI.importData(mode);
    if (result.success) {
      await actions.refreshCurrentPage({ showSuccess: false, interactionFirst: true });
      const importedVersion = result.meta?.appVersion ? `\n来源版本: ${result.meta.appVersion}` : '';
      const importTitle = result.mode === 'append' ? '追加导入成功' : '数据导入成功';
      const importCountText = result.mode === 'append'
        ? `新增宾馆 ${result.hotelCount || 0} 条，新增模板 ${result.templateCount || 0} 条`
        : `宾馆 ${result.hotelCount || 0} 条，模板 ${result.templateCount || 0} 条`;
      const skippedCountText = result.mode === 'append' && ((result.skippedHotelCount || 0) > 0 || (result.skippedTemplateCount || 0) > 0)
        ? `\n跳过重复宾馆 ${result.skippedHotelCount || 0} 条，跳过重复模板 ${result.skippedTemplateCount || 0} 条`
        : '';
      const settingsNote = result.mode === 'append' ? '\n当前设置和应用图标保持不变' : '';
      showNotification(`${importTitle}\n${importCountText}${skippedCountText}${importedVersion}${settingsNote}`, 'success');
    } else if (result?.error) {
      showNotification(`导入失败: ${result.error}`, 'error');
    }
  } catch (error) {
    console.error('导入数据失败:', error);
    showNotification('导入失败,请重试', 'error');
  }
}

/* ---- 外部网站 ---- */

export async function openCtripWebsite() {
  try {
    await window.electronAPI.openCtrip();
  } catch (error) {
    console.error('打开携程官网失败:', error);
    showNotification('打开携程官网失败，请重试', 'error');
  }
}

export async function openFliggyWebsite() {
  try {
    await window.electronAPI.openFliggy();
  } catch (error) {
    console.error('打开飞猪官网失败:', error);
    showNotification('打开飞猪官网失败，请重试', 'error');
  }
}

export async function openWebsite(url) {
  if (!url) return;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }
  try {
    await window.electronAPI.openExternal(url);
  } catch (error) {
    console.error('打开网址失败:', error);
    showNotification('打开网址失败，请重试', 'error');
  }
}

/* ---- 刷新当前页面 ---- */

export async function refreshCurrentPage(options = {}) {
  if (state.manualRefreshInProgress) return;

  const { showSuccess = true, interactionFirst = false } = options;
  state.manualRefreshInProgress = true;
  setRefreshButtonState(true);

  try {
    await actions.reloadAllData({ includeSettings: true, invalidateCache: true, verbose: false });
    applySettings();
    actions.updateTemplateFilter({ interactionFirst });

    if ($('templateModal')?.classList.contains('active')) {
      actions.renderTemplateList();
    }

    if ($('settingsModal')?.classList.contains('active')) {
      await loadDataPath();
    }

    if ($('personalizationModal')?.classList.contains('active')) {
      await loadAppIconState();
    }

    rankingCache.invalidate();
    actions.renderHotelList({ interactionFirst });

    if (showSuccess) {
      showNotification('当前页面已刷新', 'success');
    }
  } catch (error) {
    console.error('手动刷新页面失败:', error);
    showNotification('刷新失败，请重试', 'error');
  } finally {
    state.manualRefreshInProgress = false;
    setRefreshButtonState(false);
  }
}

function setRefreshButtonState(isRefreshing) {
  const refreshButton = $('refreshPageBtn');
  if (!refreshButton) return;
  refreshButton.disabled = isRefreshing;
  refreshButton.classList.toggle('is-refreshing', isRefreshing);
  refreshButton.title = isRefreshing ? '正在刷新当前页面' : '刷新当前页面';
  refreshButton.setAttribute('aria-label', refreshButton.title);
}

/* ---- 菜单事件 ---- */

export function setupMenuListeners() {
  window.electronAPI.onMenuExportData(() => handleExportData());
  window.electronAPI.onMenuImportData(() => openDataTransfer('import'));
}

/* ---- 注册到 actions ---- */
actions.openWebsite = openWebsite;
actions.applySettings = applySettings;
actions.refreshCurrentPage = refreshCurrentPage;
actions.loadDataPath = loadDataPath;
actions.loadAppIconState = loadAppIconState;
