/**
 * 设置表单 UI —— 主设置弹窗、采集偏好、权重和页面刷新。
 */

import { state, rankingCache } from './state.js';
import { $, setValue } from './dom-helpers.js';
import { showNotification } from './notification.js';
import {
  setModalActive,
  getEventButton,
  resetActionButtonConfirmation,
  startActionButtonConfirmation
} from './ui-utils.js';
import { actions } from './actions.js';
import { refreshCustomSelects } from './custom-select.js';
import { applyThemeSelection, loadAppIconState, applyAppIconState } from './personalization-ui.js';
import { applyListPrefilterSettings } from './list-prefilter-ui.js';
import { loadDataPath } from './data-transfer-ui.js';

/**
 * @typedef {HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement} SettingsFormValueElement
 */

/**
 * @param {string} id
 * @returns {SettingsFormValueElement|null}
 */
const getFormValueElement = (id) => /** @type {SettingsFormValueElement|null} */ ($(id));

/**
 * @param {unknown} value
 * @returns {1|2}
 */
function normalizeCollectBatchConcurrency(value) {
  return Number(value) === 2 ? 2 : 1;
}

export async function openSettings() {
  setModalActive('settingsModal', true);
  applySettings();
  await loadDataPath();
}

export function closeSettingsModal() {
  setModalActive('settingsModal', false);
}

export function applySettings() {
  const theme = applyThemeSelection(state.settings.theme);
  state.settings.theme = theme;

  applyBooleanSettingToggle(
    'includeFourPersonRoomsForThreePersonTemplate',
    'includeFourPersonRoomsForThreePersonTemplate',
    'includeFourPersonRoomsForThreePersonTemplateText'
  );
  applyBooleanSettingToggle(
    'enableCollectPerfLog',
    'enableCollectPerfLog',
    'enableCollectPerfLogText'
  );
  setValue(
    'collectBatchConcurrency',
    String(normalizeCollectBatchConcurrency(state.settings.collectBatchConcurrency))
  );
  setValue('amapApiKeyInput', state.settings.amapApiKey || '');
  applyListPrefilterSettings();
  refreshCustomSelects();

  const weightMappings = [
    { key: 'weight_price', id: 'weightPrice', valueId: 'priceWeightValue' },
    { key: 'weight_score', id: 'weightScore', valueId: 'scoreWeightValue' },
    { key: 'weight_distance', id: 'weightDistance', valueId: 'distanceWeightValue' },
    { key: 'weight_transport', id: 'weightTransport', valueId: 'transportWeightValue' }
  ];

  weightMappings.forEach(({ key, id, valueId }) => {
    if (state.settings[key]) {
      const weightEl = /** @type {HTMLInputElement|null} */ (document.getElementById(id));
      const valueEl = document.getElementById(valueId);
      if (weightEl) weightEl.value = String(state.settings[key]);
      if (valueEl) valueEl.textContent = String(state.settings[key]);
    }
  });
}

function applyBooleanSettingToggle(settingKey, checkboxId, textId) {
  const checkbox = /** @type {HTMLInputElement|null} */ (document.getElementById(checkboxId));
  const textEl = document.getElementById(textId);
  if (!checkbox || !textEl) {
    return;
  }

  const isEnabled = Boolean(state.settings[settingKey]);
  checkbox.checked = isEnabled;
  textEl.textContent = isEnabled ? '开启' : '关闭';
}

export async function toggleIncludeFourPersonRoomsForThreePersonTemplate() {
  const checkbox = /** @type {HTMLInputElement|null} */ (
    document.getElementById('includeFourPersonRoomsForThreePersonTemplate')
  );
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

export async function toggleEnableCollectPerfLog() {
  const checkbox = /** @type {HTMLInputElement|null} */ (
    document.getElementById('enableCollectPerfLog')
  );
  const textEl = document.getElementById('enableCollectPerfLogText');
  const isEnabled = Boolean(checkbox && checkbox.checked);

  try {
    await window.electronAPI.setSetting('enableCollectPerfLog', isEnabled);
    state.settings.enableCollectPerfLog = isEnabled;
    if (textEl) {
      textEl.textContent = isEnabled ? '开启' : '关闭';
    }
  } catch (error) {
    console.error('保存采集性能日志设置失败:', error);
    if (checkbox) {
      checkbox.checked = !isEnabled;
    }
    if (textEl) {
      textEl.textContent = !isEnabled ? '开启' : '关闭';
    }
  }
}

export async function saveCollectBatchConcurrencySetting() {
  const input = getFormValueElement('collectBatchConcurrency');
  const previousValue = normalizeCollectBatchConcurrency(state.settings.collectBatchConcurrency);
  const nextValue = normalizeCollectBatchConcurrency(input ? input.value : previousValue);

  try {
    await window.electronAPI.setSetting('collectBatchConcurrency', nextValue);
    state.settings.collectBatchConcurrency = nextValue;
    setValue('collectBatchConcurrency', String(nextValue));
    refreshCustomSelects();
    showNotification(nextValue === 2 ? '已开启并发采集' : '已切换为串行采集', 'success');
  } catch (error) {
    console.error('保存并发采集设置失败:', error);
    state.settings.collectBatchConcurrency = previousValue;
    setValue('collectBatchConcurrency', String(previousValue));
    refreshCustomSelects();
    showNotification('保存并发采集设置失败，请重试', 'error');
  }
}

export async function saveAmapApiKeySetting() {
  const input = getFormValueElement('amapApiKeyInput');
  const nextValue = String(input ? input.value : '').trim();
  const previousValue = state.settings.amapApiKey || '';

  try {
    await window.electronAPI.setSetting('amapApiKey', nextValue);
    state.settings.amapApiKey = nextValue;
    setValue('amapApiKeyInput', nextValue);
    showNotification(nextValue ? '高德 API Key 已保存' : '已恢复使用默认高德 Key', 'success');
  } catch (error) {
    console.error('保存高德 API Key 失败:', error);
    state.settings.amapApiKey = previousValue;
    setValue('amapApiKeyInput', previousValue);
    showNotification('保存高德 API Key 失败，请重试', 'error');
  }
}

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

    state.settings = result.settings || (await actions.loadSettings());
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
  const refreshButton = /** @type {HTMLButtonElement|null} */ ($('refreshPageBtn'));
  if (!refreshButton) return;
  refreshButton.disabled = isRefreshing;
  refreshButton.classList.toggle('is-refreshing', isRefreshing);
  refreshButton.title = isRefreshing ? '正在刷新当前页面' : '刷新当前页面';
  refreshButton.setAttribute('aria-label', refreshButton.title);
}
