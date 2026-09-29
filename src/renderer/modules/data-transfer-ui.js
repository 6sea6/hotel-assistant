/**
 * 数据迁移和外部网站 UI —— 数据路径、导入导出和官网入口。
 */

import { $, escapeHtml, setValue, iconHtml } from './dom-helpers.js';
import { showNotification } from './notification.js';
import {
  setModalActive,
  getEventButton,
  resetActionButtonConfirmation,
  setActionButtonBusy,
  startActionButtonConfirmation
} from './ui-utils.js';
import { actions } from './actions.js';
import { state } from './state.js';
import { sortHotels } from './hotel-filters.js';

/** @type {null|(() => void)} */
let disposeMenuExportListener = null;
/** @type {null|(() => void)} */
let disposeMenuImportListener = null;
/** @type {Array<import('../../shared/contracts').NormalizedHotelRecord>} */
let exportHotelsSnapshot = [];
/** @type {Array<import('../../shared/contracts').NormalizedTemplateRecord>} */
let exportTemplatesSnapshot = [];
/** @type {string[]} */
let exportRoomSearchTexts = [];

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
      confirmHtml: `${iconHtml('warning')} 确认更改`,
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

function getHotelExportGroupKey(hotel) {
  const website = String(hotel.website || '')
    .trim()
    .toLocaleLowerCase('zh-CN');
  if (website) return `website:${website}`;
  const name = String(hotel.name || '')
    .trim()
    .toLocaleLowerCase('zh-CN');
  const address = String(hotel.address || '')
    .trim()
    .toLocaleLowerCase('zh-CN');
  return name || address ? `hotel:${name}\u0000${address}` : `id:${String(hotel.id ?? '')}`;
}

function buildExportRoomSearchTexts() {
  const templateNames = new Map(
    exportTemplatesSnapshot.map((template) => [
      String(template.id),
      String(template.name || '未命名模板')
    ])
  );
  return exportHotelsSnapshot.map((hotel) =>
    [
      hotel.name,
      hotel.room_type,
      hotel.original_room_type,
      hotel.address,
      templateNames.get(String(hotel.template_id))
    ]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('zh-CN')
  );
}

function getExportScopeMode() {
  const checked = /** @type {HTMLInputElement|null} */ (
    document.querySelector('input[name="dataExportScope"]:checked')
  );
  return checked?.value || 'all';
}

function getSelectedTemplateIndexes() {
  return [...document.querySelectorAll('.data-export-template-option:checked')]
    .map((input) => Number(/** @type {HTMLInputElement} */ (input).dataset.exportIndex))
    .filter(Number.isInteger);
}

function getSelectedRoomIndexes() {
  return [...document.querySelectorAll('.data-export-room-option:checked')]
    .map((input) => Number(/** @type {HTMLInputElement} */ (input).dataset.exportIndex))
    .filter(Number.isInteger);
}

function formatExportPrice(value) {
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? `¥${price.toFixed(2).replace(/\.00$/, '')}` : '';
}

function renderDataExportLists(preselectedRoomIndexes = new Set()) {
  const templateList = $('dataExportTemplateList');
  const roomList = $('dataExportRoomList');
  if (templateList) {
    templateList.innerHTML = exportTemplatesSnapshot.length
      ? exportTemplatesSnapshot
          .map((template, index) => {
            const templateId = String(template.id);
            const rooms = exportHotelsSnapshot.filter(
              (hotel) => String(hotel.template_id) === templateId
            );
            const hotelCount = new Set(rooms.map(getHotelExportGroupKey)).size;
            return `<label class="data-export-check-item">
              <input class="data-export-template-option" type="checkbox" data-export-index="${index}" />
              <span><strong>${escapeHtml(template.name || '未命名模板')}</strong>
              <small>${hotelCount} 家宾馆 · ${rooms.length} 个房型</small></span>
            </label>`;
          })
          .join('')
      : '<div class="data-export-empty">暂无可选模板</div>';
  }
  if (roomList) {
    const templateNames = new Map(
      exportTemplatesSnapshot.map((template) => [
        String(template.id),
        String(template.name || '未命名模板')
      ])
    );
    roomList.innerHTML = exportHotelsSnapshot.length
      ? exportHotelsSnapshot
          .map(
            (
              hotel,
              index
            ) => `<label class="data-export-check-item" data-export-room-index="${index}">
              <input class="data-export-room-option" type="checkbox" data-export-index="${index}" ${preselectedRoomIndexes.has(index) ? 'checked' : ''} />
              <span><strong>${escapeHtml(hotel.name || '未命名宾馆')} · ${escapeHtml(hotel.original_room_type || hotel.room_type || '未命名房型')}</strong>
              <small>${
                [
                  formatExportPrice(hotel.total_price)
                    ? `总价 ${formatExportPrice(hotel.total_price)}`
                    : '',
                  formatExportPrice(hotel.daily_price)
                    ? `日均 ${formatExportPrice(hotel.daily_price)}`
                    : '',
                  templateNames.get(String(hotel.template_id)) || '',
                  hotel.check_in_date && hotel.check_out_date
                    ? `${hotel.check_in_date} 至 ${hotel.check_out_date}`
                    : '',
                  hotel.address || ''
                ]
                  .filter(Boolean)
                  .map(escapeHtml)
                  .join(' · ') || '价格未知'
              }</small></span>
            </label>`
          )
          .join('')
      : '<div class="data-export-empty">暂无可选房型</div>';
  }
}

function updateDataExportView() {
  const mode = getExportScopeMode();
  const templatePanel = $('dataExportTemplatePanel');
  const roomPanel = $('dataExportRoomPanel');
  if (templatePanel) templatePanel.hidden = mode !== 'templates';
  if (roomPanel) roomPanel.hidden = mode !== 'rooms';

  let hotelCount = new Set(exportHotelsSnapshot.map(getHotelExportGroupKey)).size;
  let roomCount = exportHotelsSnapshot.length;
  let templateCount = exportTemplatesSnapshot.length;
  let valid = true;
  if (mode === 'templates') {
    const templateIds = new Set(
      getSelectedTemplateIndexes().map((index) => String(exportTemplatesSnapshot[index]?.id))
    );
    const hotels = exportHotelsSnapshot.filter((hotel) =>
      templateIds.has(String(hotel.template_id))
    );
    hotelCount = new Set(hotels.map(getHotelExportGroupKey)).size;
    roomCount = hotels.length;
    templateCount = templateIds.size;
    valid = templateCount > 0;
  } else if (mode === 'rooms') {
    const rooms = getSelectedRoomIndexes()
      .map((index) => exportHotelsSnapshot[index])
      .filter(Boolean);
    const referencedTemplates = new Set(
      rooms
        .map((room) => room.template_id)
        .filter(
          (templateId) => templateId !== null && templateId !== undefined && templateId !== ''
        )
        .map(String)
    );
    hotelCount = new Set(rooms.map(getHotelExportGroupKey)).size;
    roomCount = rooms.length;
    templateCount = referencedTemplates.size;
    valid = roomCount > 0;
  }

  const summary = $('dataExportSummary');
  if (summary) {
    summary.textContent = valid
      ? `将导出 ${hotelCount} 家宾馆、${roomCount} 个房型、${templateCount} 个模板；个性化设置不会导出。`
      : mode === 'templates'
        ? '请至少选择一个模板。'
        : '请至少选择一个房型。';
  }
  const confirmButton = /** @type {HTMLButtonElement|null} */ ($('confirmDataExportBtn'));
  if (confirmButton && confirmButton.dataset.busy !== 'true') confirmButton.disabled = !valid;
}

export function openDataExport() {
  closeDataTransfer();
  exportHotelsSnapshot = sortHotels(state.hotels.slice(), 'price_low');
  exportTemplatesSnapshot = state.templates.slice();
  exportRoomSearchTexts = buildExportRoomSearchTexts();
  const selectedIds = new Set([...state.selectedHotels].map(String));
  const preselectedRoomIndexes = new Set(
    exportHotelsSnapshot
      .map((hotel, index) => (selectedIds.has(String(hotel.id)) ? index : -1))
      .filter((index) => index >= 0)
  );

  setModalActive('dataExportModal', true);
  renderDataExportLists(preselectedRoomIndexes);
  const preferredMode = preselectedRoomIndexes.size > 0 ? 'rooms' : 'all';
  const preferredRadio = /** @type {HTMLInputElement|null} */ (
    document.querySelector(`input[name="dataExportScope"][value="${preferredMode}"]`)
  );
  if (preferredRadio) preferredRadio.checked = true;
  const searchInput = /** @type {HTMLInputElement|null} */ ($('dataExportRoomSearch'));
  if (searchInput) searchInput.value = '';
  updateDataExportView();
}

export function closeDataExport() {
  setModalActive('dataExportModal', false);
}

export function handleDataExportChange(event) {
  const target = event?.target;
  if (!(target instanceof HTMLInputElement) || !target.closest('#dataExportModal')) return false;
  if (
    target.name === 'dataExportScope' ||
    target.classList.contains('data-export-template-option') ||
    target.classList.contains('data-export-room-option')
  ) {
    updateDataExportView();
    return true;
  }
  return false;
}

export function handleDataExportSearch(event) {
  const target = event?.target;
  if (!(target instanceof HTMLInputElement) || target.id !== 'dataExportRoomSearch') return false;
  const query = target.value.trim().toLocaleLowerCase('zh-CN');
  document.querySelectorAll('[data-export-room-index]').forEach((element) => {
    const index = Number(/** @type {HTMLElement} */ (element).dataset.exportRoomIndex);
    /** @type {HTMLElement} */ (element).hidden = Boolean(
      query && !exportRoomSearchTexts[index]?.includes(query)
    );
  });
  return true;
}

export function selectAllExportItems() {
  const mode = getExportScopeMode();
  const selector =
    mode === 'templates' ? '.data-export-template-option' : '.data-export-room-option';
  document.querySelectorAll(selector).forEach((element) => {
    const input = /** @type {HTMLInputElement} */ (element);
    const item = /** @type {HTMLElement|null} */ (input.closest('.data-export-check-item'));
    if (!item?.hidden) input.checked = true;
  });
  updateDataExportView();
}

export function clearExportItems() {
  const mode = getExportScopeMode();
  const selector =
    mode === 'templates' ? '.data-export-template-option' : '.data-export-room-option';
  document.querySelectorAll(selector).forEach((element) => {
    /** @type {HTMLInputElement} */ (element).checked = false;
  });
  updateDataExportView();
}

export async function confirmDataExport(eventLike) {
  const mode = getExportScopeMode();
  /** @type {import('../../shared/contracts').DataExportSelection} */
  let selection = { mode: 'all' };
  if (mode === 'templates') {
    selection = {
      mode: 'templates',
      templateIds: getSelectedTemplateIndexes()
        .map((index) => exportTemplatesSnapshot[index]?.id)
        .filter((id) => id !== null && id !== undefined)
    };
  } else if (mode === 'rooms') {
    selection = {
      mode: 'rooms',
      roomIds: getSelectedRoomIndexes()
        .map((index) => exportHotelsSnapshot[index]?.id)
        .filter((id) => id !== null && id !== undefined)
    };
  }

  if (
    (mode === 'templates' && !selection.templateIds?.length) ||
    (mode === 'rooms' && !selection.roomIds?.length)
  ) {
    updateDataExportView();
    return;
  }

  const triggerButton = getEventButton(eventLike);
  setActionButtonBusy(triggerButton, true, { busyText: '正在导出…' });
  try {
    const result = await window.electronAPI.exportData(selection);
    if (result.success) {
      closeDataExport();
      showNotification(
        `数据已导出到: ${result.path}\n宾馆 ${result.hotelCount || 0} 家，房型 ${result.roomCount || 0} 个，模板 ${result.templateCount || 0} 个`,
        'success'
      );
    } else if (result.error) {
      showNotification(`导出失败: ${result.error}`, 'error');
    }
  } catch (error) {
    console.error('导出数据失败:', error);
    showNotification('导出失败，请重试', 'error');
  } finally {
    setActionButtonBusy(triggerButton, false);
  }
}

export function handleExportData() {
  openDataExport();
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
  if (disposeMenuExportListener || disposeMenuImportListener) {
    return () => {
      disposeMenuExportListener?.();
      disposeMenuImportListener?.();
      disposeMenuExportListener = null;
      disposeMenuImportListener = null;
    };
  }

  disposeMenuExportListener = window.electronAPI.onMenuExportData(() => handleExportData());
  disposeMenuImportListener = window.electronAPI.onMenuImportData(() => openDataTransfer('import'));

  return () => {
    disposeMenuExportListener?.();
    disposeMenuImportListener?.();
    disposeMenuExportListener = null;
    disposeMenuImportListener = null;
  };
}
