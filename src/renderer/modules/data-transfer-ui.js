/**
 * 数据迁移和外部网站 UI —— 数据路径、导入导出和官网入口。
 */

import { $, setValue } from './dom-helpers.js';
import { showNotification } from './notification.js';
import {
  setModalActive,
  getEventButton,
  resetActionButtonConfirmation,
  startActionButtonConfirmation
} from './ui-utils.js';
import { actions } from './actions.js';

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
      await actions.refreshCurrentPage({ showSuccess: false, interactionFirst: true });
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
      showNotification(
        `数据已导出到: ${result.path}\n宾馆 ${result.hotelCount || 0} 条，模板 ${result.templateCount || 0} 条`,
        'success'
      );
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
      const importedVersion = result.meta?.appVersion
        ? `\n来源版本: ${result.meta.appVersion}`
        : '';
      const importTitle = result.mode === 'append' ? '追加导入成功' : '数据导入成功';
      const importCountText =
        result.mode === 'append'
          ? `新增宾馆 ${result.hotelCount || 0} 条，新增模板 ${result.templateCount || 0} 条`
          : `宾馆 ${result.hotelCount || 0} 条，模板 ${result.templateCount || 0} 条`;
      const skippedCountText =
        result.mode === 'append' &&
        ((result.skippedHotelCount || 0) > 0 || (result.skippedTemplateCount || 0) > 0)
          ? `\n跳过重复宾馆 ${result.skippedHotelCount || 0} 条，跳过重复模板 ${result.skippedTemplateCount || 0} 条`
          : '';
      const settingsNote = result.mode === 'append' ? '\n当前设置和应用图标保持不变' : '';
      showNotification(
        `${importTitle}\n${importCountText}${skippedCountText}${importedVersion}${settingsNote}`,
        'success'
      );
    } else if (result?.error) {
      showNotification(`导入失败: ${result.error}`, 'error');
    }
  } catch (error) {
    console.error('导入数据失败:', error);
    showNotification('导入失败,请重试', 'error');
  }
}

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

export function setupMenuListeners() {
  window.electronAPI.onMenuExportData(() => handleExportData());
  window.electronAPI.onMenuImportData(() => openDataTransfer('import'));
}
