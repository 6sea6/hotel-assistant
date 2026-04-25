/**
 * 宾馆 CRUD —— 保存、删除、收藏、批量删除和表单相关计算。
 */

import { state, rankingCache, TEMPLATE_SELECT_BATCH_SIZE } from './state.js';
import { $, getValue, setValue, idsEqual, normalizeIdValue, getSelectionKey } from './dom-helpers.js';
import { showNotification } from './notification.js';
import { perfStart, perfEnd } from './perf.js';
import { setModalActive, getEventButton, resetBatchDeleteConfirmation, startBatchDeleteConfirmation, syncBatchDeleteButton, scheduleHotelModalFocus, resetDeleteConfirmation, startDeleteConfirmation, resetActionButtonConfirmation, startActionButtonConfirmation } from './ui-utils.js';
import { actions } from './actions.js';

/* ---- 公共数据加载 ---- */

export async function loadHotels() {
  perfStart('loadHotels');
  try {
    const result = await window.electronAPI.getAllHotels();
    perfEnd('loadHotels');
    return result || [];
  } catch (error) {
    perfEnd('loadHotels');
    console.error('加载宾馆失败:', error);
    return [];
  }
}

export async function loadTemplates() {
  try {
    return await window.electronAPI.getAllTemplates() || [];
  } catch (error) {
    console.error('加载模板失败:', error);
    return [];
  }
}

export async function loadSettings() {
  try {
    return await window.electronAPI.getAllSettings();
  } catch (error) {
    console.error('加载设置失败:', error);
    return {};
  }
}

export async function reloadAllData(options = {}) {
  const { includeSettings = false, invalidateCache = false, verbose = true } = options;

  if (invalidateCache && window.electronAPI.invalidateRendererCache) {
    window.electronAPI.invalidateRendererCache();
  }

  const requests = [
    window.electronAPI.getAllHotels(),
    window.electronAPI.getAllTemplates()
  ];

  if (includeSettings) {
    requests.push(window.electronAPI.getAllSettings());
  }

  try {
    if (verbose) console.log('[数据重载] 开始重新加载数据...');

    const [loadedHotels, loadedTemplates, loadedSettings] = await Promise.all(requests);
    state.hotels = loadedHotels || [];
    state.templates = loadedTemplates || [];

    if (includeSettings) {
      state.settings = loadedSettings || state.settings;
    }

    if (verbose) {
      console.log('[数据重载] 完成:', {
        hotels: state.hotels.length,
        templates: state.templates.length,
        settingsLoaded: includeSettings
      });
    }

    return {
      hotelsCount: state.hotels.length,
      templatesCount: state.templates.length,
      settingsLoaded: includeSettings
    };
  } catch (error) {
    console.error('数据重载失败:', error);
    throw error;
  }
}

/* ---- 模板查找 ---- */

export function findTemplateById(templateId) {
  return state.templates.find(template => idsEqual(template.id, templateId));
}

/* ---- 宾馆编辑弹窗 ---- */

export function openAddHotelModal(templateId = null) {
  const modalTitle = document.getElementById('modalTitle');
  const hotelForm = document.getElementById('hotelForm');
  const hotelIdInput = document.getElementById('hotelId');
  const hotelModal = document.getElementById('hotelModal');

  if (!modalTitle || !hotelForm || !hotelIdInput || !hotelModal) {
    console.error('[openAddHotelModal] 关键DOM元素未找到');
    return;
  }

  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  resetBatchDeleteConfirmation({ count: state.selectedHotels.size });

  modalTitle.textContent = '添加宾馆';
  hotelForm.reset();
  hotelIdInput.value = '';

  const selectedTemplate = templateId ? findTemplateById(templateId) : null;
  if (selectedTemplate) {
    applyTemplateDataToForm(selectedTemplate);
  }

  setModalActive('hotelModal', true);
  scheduleHotelModalFocus();
  updateHotelTemplateSelect({
    selectedValue: templateId || '',
    applyTemplateOnReady: Boolean(templateId)
  });
}

export function editHotel(id) {
  const hotel = state.hotels.find(h => idsEqual(h.id, id));
  if (!hotel) {
    console.error('[editHotel] 未找到宾馆ID:', id);
    return;
  }

  const setElementValue = (elementId, value, isCheckbox = false) => {
    const element = document.getElementById(elementId);
    if (element) {
      if (isCheckbox) { element.checked = value; } else { element.value = value; }
    }
  };

  const modalTitle = $('modalTitle');
  if (modalTitle) modalTitle.textContent = '编辑宾馆';
  setElementValue('hotelId', hotel.id);
  setElementValue('hotelName', hotel.name || '');
  setElementValue('hotelAddress', hotel.address || '');
  setElementValue('hotelWebsite', hotel.website || '');
  setElementValue('totalPrice', hotel.total_price || '');
  setElementValue('dailyPrice', hotel.daily_price || '');
  setElementValue('checkInDate', hotel.check_in_date || '');
  setElementValue('checkOutDate', hotel.check_out_date || '');
  setElementValue('days', hotel.days || '');
  setElementValue('ctripScore', hotel.ctrip_score || '');
  setElementValue('destination', hotel.destination || '');
  setElementValue('distance', hotel.distance || '');
  setElementValue('subwayStation', hotel.subway_station || '');
  setElementValue('subwayDistance', hotel.subway_distance || '');
  setElementValue('transportTime', hotel.transport_time || '');
  setElementValue('busRoute', hotel.bus_route || '');
  setElementValue('roomType', hotel.room_type || '');
  setElementValue('originalRoomType', hotel.original_room_type || '');
  setElementValue('roomCount', hotel.room_count || 1);
  setElementValue('roomArea', hotel.room_area || '');
  setElementValue('notes', hotel.notes || '');
  setElementValue('isFavorite', hotel.is_favorite === 1, true);

  setModalActive('hotelModal', true);
  scheduleHotelModalFocus();
  updateHotelTemplateSelect({ selectedValue: hotel.template_id || '' });
}

export function closeHotelModal() {
  setModalActive('hotelModal', false);
}

/* ---- 模板选择（宾馆编辑弹窗内） ---- */

function updateHotelTemplateSelect(options = {}) {
  const select = document.getElementById('hotelTemplateSelect');
  if (!select) return;

  const selectedValue = options.selectedValue ?? select.value;
  const applyTemplateOnReady = Boolean(options.applyTemplateOnReady);
  const renderVersion = ++state.hotelTemplateSelectRenderVersion;
  select.innerHTML = '<option value="">不使用模板</option>';

  if (state.templates.length === 0) {
    select.value = '';
    return;
  }

  const renderBatch = (startIndex = 0) => {
    if (renderVersion !== state.hotelTemplateSelectRenderVersion) return;

    const fragment = document.createDocumentFragment();
    const endIndex = Math.min(startIndex + TEMPLATE_SELECT_BATCH_SIZE, state.templates.length);

    for (let index = startIndex; index < endIndex; index++) {
      const template = state.templates[index];
      const option = document.createElement('option');
      option.value = template.id;
      option.textContent = template.name;
      fragment.appendChild(option);
    }

    select.appendChild(fragment);

    if (endIndex < state.templates.length) {
      requestAnimationFrame(() => renderBatch(endIndex));
      return;
    }

    if (selectedValue) {
      select.value = selectedValue;
    }

    if (applyTemplateOnReady && select.value) {
      applyTemplateToForm();
    }
  };

  requestAnimationFrame(() => renderBatch());
}

function applyTemplateDataToForm(template) {
  if (!template) return;
  if (template.check_in_date) setValue('checkInDate', template.check_in_date);
  if (template.check_out_date) {
    setValue('checkOutDate', template.check_out_date);
    calculateDays();
  }
  if (template.room_count) setValue('roomCount', template.room_count);
  if (template.destination) setValue('destination', template.destination);
}

export function applyTemplateToForm() {
  const templateSelect = document.getElementById('hotelTemplateSelect');
  if (!templateSelect) return;
  const templateId = templateSelect.value;
  if (!templateId) return;
  const template = findTemplateById(templateId);
  applyTemplateDataToForm(template);
}

/* ---- 保存宾馆 ---- */

export async function saveHotel() {
  const getVal = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
  const getChk = (id) => { const el = document.getElementById(id); return el ? el.checked : false; };

  const id = getVal('hotelId');
  const selectedTemplateId = getVal('hotelTemplateSelect');

  let templateInfo = null;
  if (selectedTemplateId) {
    const selectedTemplate = findTemplateById(selectedTemplateId);
    if (selectedTemplate) {
      templateInfo = {
        id: selectedTemplate.id,
        name: selectedTemplate.name,
        destination: selectedTemplate.destination,
        check_in_date: selectedTemplate.check_in_date,
        check_out_date: selectedTemplate.check_out_date,
        room_count: selectedTemplate.room_count
      };
    }
  }

  const hotel = {
    name: getVal('hotelName').trim(),
    address: getVal('hotelAddress').trim(),
    website: getVal('hotelWebsite').trim(),
    total_price: parseFloat(getVal('totalPrice')) || null,
    daily_price: parseFloat(getVal('dailyPrice')) || null,
    check_in_date: getVal('checkInDate') || null,
    check_out_date: getVal('checkOutDate') || null,
    days: parseInt(getVal('days')) || null,
    ctrip_score: parseFloat(getVal('ctripScore')) || null,
    destination: getVal('destination').trim(),
    distance: getVal('distance').trim(),
    subway_station: getVal('subwayStation').trim(),
    subway_distance: getVal('subwayDistance').trim(),
    transport_time: getVal('transportTime').trim(),
    bus_route: getVal('busRoute').trim(),
    room_type: getVal('roomType').trim(),
    original_room_type: getVal('originalRoomType').trim(),
    room_count: parseInt(getVal('roomCount')) || 1,
    room_area: getVal('roomArea').trim(),
    notes: getVal('notes').trim(),
    is_favorite: getChk('isFavorite') ? 1 : 0,
    template_id: selectedTemplateId || null,
    template_info: templateInfo
  };

  if (!hotel.name) {
    const nameInput = $('hotelName');
    if (nameInput) {
      nameInput.focus();
      nameInput.style.borderColor = '#F53F3F';
      setTimeout(() => { nameInput.style.borderColor = ''; }, 2000);
    }
    return;
  }

  let previousHotels = null;
  try {
    previousHotels = state.hotels.slice();
    if (id) {
      hotel.id = normalizeIdValue(id);
      await window.electronAPI.updateHotel(hotel);
    } else {
      await window.electronAPI.addHotel(hotel);
    }

    state.hotels = await loadHotels();
    rankingCache.invalidate();
    actions.renderHotelList();
    closeHotelModal();
  } catch (error) {
    console.error('保存宾馆失败:', error);
    try {
      state.hotels = previousHotels || await loadHotels();
      rankingCache.invalidate();
      actions.renderHotelList();
    } catch (recoveryError) {
      console.error('恢复宾馆数据失败:', recoveryError);
    }
    showNotification(`保存失败：${error.message}`, 'error');
  }
}

/* ---- 删除宾馆 ---- */

export async function deleteHotel(id) {
  perfStart('deleteHotel');
  try {
    const idx = state.hotels.findIndex(h => idsEqual(h.id, id));
    if (idx !== -1) {
      state.hotels.splice(idx, 1);
      rankingCache.invalidate();
      actions.renderHotelList();
    }

    (async () => {
      try {
        const result = await window.electronAPI.deleteHotel(id);
        if (!result || !result.success) {
          throw new Error(result?.error || '删除失败');
        }
        const loaded = await loadHotels();
        state.hotels = loaded || [];
        rankingCache.invalidate();
        actions.renderHotelList();
        showNotification('删除成功', 'success');
        perfEnd('deleteHotel');
      } catch (err) {
        perfEnd('deleteHotel');
        console.error('后台删除失败:', err);
        try {
          state.hotels = await loadHotels();
          rankingCache.invalidate();
          actions.renderHotelList();
        } catch (recoveryErr) {
          console.error('恢复宾馆列表失败:', recoveryErr);
        }
        showNotification('删除失败，请重试', 'error');
      }
    })();
  } catch (error) {
    perfEnd('deleteHotel');
    console.error('删除宾馆失败:', error);
    showNotification('删除失败，请重试', 'error');
  }
}

/* ---- 收藏 ---- */

export async function toggleFavorite(id, currentStatus) {
  try {
    const hotel = state.hotels.find(h => idsEqual(h.id, id));
    if (!hotel) return;

    perfStart('toggleFavorite');
    hotel.is_favorite = currentStatus ? 0 : 1;
    actions.renderHotelList();

    (async () => {
      try {
        await window.electronAPI.updateHotel(hotel);
        state.hotels = await loadHotels();
        rankingCache.invalidate();
        actions.renderHotelList();
        perfEnd('toggleFavorite');
      } catch (err) {
        perfEnd('toggleFavorite');
        console.error('更新收藏状态失败（后台）:', err);
        try {
          state.hotels = await loadHotels();
          rankingCache.invalidate();
          actions.renderHotelList();
        } catch (recoveryErr) {
          console.error('恢复宾馆列表失败:', recoveryErr);
        }
        showNotification('操作失败，请重试', 'error');
      }
    })();
  } catch (error) {
    console.error('更新收藏状态失败:', error);
    showNotification('操作失败，请重试', 'error');
  }
}

/* ---- 批量删除 ---- */

export async function confirmBatchDelete() {
  if (state.batchDeleteInProgress) return;

  if (state.selectedHotels.size === 0) {
    syncBatchDeleteButton({ warning: true });
    window.setTimeout(() => resetBatchDeleteConfirmation({ count: 0 }), 1800);
    return;
  }

  const batchDeleteBtn = $('batchDeleteBtn');
  if (!batchDeleteBtn) return;

  if (batchDeleteBtn.dataset.confirming !== 'true') {
    startBatchDeleteConfirmation();
    return;
  }

  let previousHotels = null;
  try {
    const deletedCount = state.selectedHotels.size;
    const hotelIds = Array.from(state.selectedHotels);
    const hotelIdSet = new Set(hotelIds);
    previousHotels = state.hotels.slice();
    state.batchDeleteInProgress = true;

    batchDeleteBtn.disabled = true;
    batchDeleteBtn.innerHTML = '<span>⏳</span> 正在删除...';

    const result = await window.electronAPI.deleteMultipleHotels(hotelIds);
    if (!result || !result.success) {
      throw new Error('批量删除失败');
    }

    state.hotels = previousHotels.filter(h => !hotelIdSet.has(getSelectionKey(h.id)));
    state.selectedHotels.clear();
    rankingCache.invalidate();
    actions.renderHotelList();

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    state.batchDeleteInProgress = false;
    resetBatchDeleteConfirmation({ count: 0, disabled: false });
    showNotification(`成功删除 ${deletedCount} 个宾馆`, 'success');
  } catch (error) {
    console.error('批量删除失败:', error);
    state.batchDeleteInProgress = false;
    state.hotels = previousHotels || state.hotels;
    rankingCache.invalidate();
    actions.renderHotelList();
    resetBatchDeleteConfirmation({ count: state.selectedHotels.size, disabled: false });
    showNotification('删除失败，请重试', 'error');
  }
}

/* ---- 表单计算 ---- */

export function calculateDays() {
  const checkIn = getValue('checkInDate');
  const checkOut = getValue('checkOutDate');

  if (checkIn && checkOut) {
    const checkInDate = new Date(checkIn);
    const checkOutDate = new Date(checkOut);
    const diffTime = Math.abs(checkOutDate - checkInDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    setValue('days', diffDays);
    calculateDailyPrice();
  }
}

export function onCheckInChange() {
  const checkInEl = $('checkInDate');
  const checkOutEl = $('checkOutDate');
  if (!checkInEl || !checkOutEl) return;
  const checkIn = checkInEl.value;
  const checkOut = checkOutEl.value;
  if (checkIn && (!checkOut || new Date(checkOut) <= new Date(checkIn))) {
    const d = new Date(checkIn);
    d.setDate(d.getDate() + 1);
    checkOutEl.value = d.toISOString().split('T')[0];
  }
  calculateDays();
}

export function onCheckOutChange() {
  const checkInEl = $('checkInDate');
  const checkOutEl = $('checkOutDate');
  if (!checkInEl || !checkOutEl) return;
  const checkIn = checkInEl.value;
  const checkOut = checkOutEl.value;
  if (checkOut && (!checkIn || new Date(checkIn) >= new Date(checkOut))) {
    const d = new Date(checkOut);
    d.setDate(d.getDate() - 1);
    checkInEl.value = d.toISOString().split('T')[0];
  }
  calculateDays();
}

export function calculateDailyPrice() {
  const totalPriceEl = $('totalPrice');
  const daysEl = $('days');
  const dailyPriceEl = $('dailyPrice');
  if (!totalPriceEl || !daysEl || !dailyPriceEl) return;
  const totalPrice = parseFloat(totalPriceEl.value) || 0;
  const days = parseInt(daysEl.value) || 1;
  state.lastEditedPriceField = 'total';
  if (totalPrice > 0 && days > 0) {
    dailyPriceEl.value = (totalPrice / days).toFixed(2);
  } else if (totalPrice === 0) {
    dailyPriceEl.value = '';
  }
}

export function calculateTotalPrice() {
  const dailyPriceEl = $('dailyPrice');
  const daysEl = $('days');
  const totalPriceEl = $('totalPrice');
  if (!dailyPriceEl || !daysEl || !totalPriceEl) return;
  const dailyPrice = parseFloat(dailyPriceEl.value) || 0;
  const days = parseInt(daysEl.value) || 1;
  state.lastEditedPriceField = 'daily';
  if (dailyPrice > 0 && days > 0) {
    totalPriceEl.value = (dailyPrice * days).toFixed(2);
  } else if (dailyPrice === 0) {
    totalPriceEl.value = '';
  }
}

export function onDaysChange() {
  const daysEl = $('days');
  const totalPriceEl = $('totalPrice');
  const dailyPriceEl = $('dailyPrice');
  if (!daysEl || !totalPriceEl || !dailyPriceEl) return;
  const days = parseInt(daysEl.value) || 1;
  if (state.lastEditedPriceField === 'daily') {
    const dailyPrice = parseFloat(dailyPriceEl.value) || 0;
    if (dailyPrice > 0 && days > 0) totalPriceEl.value = (dailyPrice * days).toFixed(2);
  } else {
    const totalPrice = parseFloat(totalPriceEl.value) || 0;
    if (totalPrice > 0 && days > 0) dailyPriceEl.value = (totalPrice / days).toFixed(2);
  }
}

export function validateScore(input) {
  let value = input.value;
  if (!value || value === '') return;
  let numValue = parseFloat(value);
  if (isNaN(numValue)) return;
}

export function formatScoreOnBlur(input) {
  let value = input.value;
  if (!value || value === '') return;
  let numValue = parseFloat(value);
  if (!isNaN(numValue)) {
    if (numValue < 0) numValue = 0;
    if (numValue > 5) numValue = 5;
    input.value = numValue.toFixed(1);
  } else {
    input.value = '';
  }
}

/* ---- 注册到 actions ---- */
actions.editHotel = editHotel;
actions.deleteHotel = deleteHotel;
actions.toggleFavorite = toggleFavorite;
actions.loadHotels = loadHotels;
actions.loadTemplates = loadTemplates;
actions.loadSettings = loadSettings;
actions.reloadAllData = reloadAllData;
actions.findTemplateById = findTemplateById;
actions.openAddHotelModal = openAddHotelModal;
