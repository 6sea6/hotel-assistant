/**
 * 宾馆 CRUD —— 保存、删除、收藏、批量删除和表单相关计算。
 */

import {
  state,
  TEMPLATE_SELECT_BATCH_SIZE,
  setHotels,
  setTemplates,
  setSettings,
  clearSelectedHotels,
  getLocalHotelsRevision,
  setLocalHotelsRevision,
  markLocalHotelsRevisionUnknown,
  setResourceLoadState,
  getResourceLoadState,
  beginMutation,
  endMutation
} from './state.js';
import {
  appendHotelToList,
  replaceHotelInList,
  removeHotelById,
  assertSavedHotelResult,
  insertHotelAtIndex,
  restoreHotelFields
} from './hotel-state-helpers.js';
import {
  $,
  getValue,
  setValue,
  idsEqual,
  normalizeIdValue,
  getSelectionKey,
  iconHtml
} from './dom-helpers.js';
import { showNotification } from './notification.js';
import { perfStart, perfEnd } from './perf.js';
import {
  setModalActive,
  resetBatchDeleteConfirmation,
  startBatchDeleteConfirmation,
  syncBatchDeleteButton,
  scheduleHotelModalFocus,
  clearFormError,
  showFormError,
  setActionButtonBusy
} from './ui-utils.js';
import { actions } from './actions.js';
import { refreshCustomSelects } from './custom-select.js';
import {
  attachDerivedFields,
  attachDerivedFieldsToHotel,
  stripDerivedFieldsFromHotel
} from './hotel-derived.js';
import { logRendererDebug } from './debug-log.js';

/**
 * @typedef {import('../../shared/contracts').AppSettings} AppSettings
 * @typedef {import('../../shared/contracts').EntityId} EntityId
 * @typedef {import('../../shared/contracts').NormalizedHotelRecord} NormalizedHotelRecord
 * @typedef {import('../../shared/contracts').NormalizedTemplateRecord} NormalizedTemplateRecord
 * @typedef {import('../../shared/contracts').RawHotelRecord} RawHotelRecord
 * @typedef {import('../../shared/contracts').TemplateInfo} TemplateInfo
 * @typedef {HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement} FormValueElement
 */

/**
 * @param {string} id
 * @returns {FormValueElement|null}
 */
const getFormValueElement = (id) => /** @type {FormValueElement|null} */ ($(id));

/**
 * @param {{reason?: string, changedIds?: Array<EntityId|null|undefined>|Set<EntityId|null|undefined>, forceFull?: boolean, interactionFirst?: boolean}} [options]
 * @returns {void}
 */
function requestHotelRender(options = {}) {
  if (typeof actions.requestHotelListRender === 'function') {
    actions.requestHotelListRender(options);
    return;
  }

  actions.renderHotelList({ interactionFirst: options.interactionFirst });
}

/* ---- 公共数据加载 ---- */

/**
 * @param {{force?: boolean}} [options]
 * @returns {Promise<NormalizedHotelRecord[]>}
 */
export async function loadHotels(options = {}) {
  const { force = false } = options;
  perfStart('loadHotels');
  setResourceLoadState('hotels', 'loading');

  try {
    // 强制刷新时直接拉全量
    if (force) {
      const result = await window.electronAPI.getAllHotelsWithMeta();
      const hotels = attachDerivedFields(result.hotels || []);
      setLocalHotelsRevision({ revision: result.revision, count: result.count });
      setResourceLoadState('hotels', hotels.length ? 'ready' : 'empty');
      perfEnd('loadHotels');
      return hotels;
    }

    // 非强制时，先检查 revision
    const localRevision = getLocalHotelsRevision();
    if (localRevision !== null && state.hotels.length > 0) {
      try {
        const meta = await window.electronAPI.getHotelsMeta();
        if (meta.revision === localRevision && meta.count === state.hotels.length) {
          // revision 未变化，复用本地数据
          logRendererDebug('[hotels] revision unchanged, skip full load', meta);
          setResourceLoadState('hotels', state.hotels.length ? 'ready' : 'empty');
          perfEnd('loadHotels');
          return state.hotels;
        }
      } catch (metaError) {
        // meta 查询失败，降级到全量拉取
        console.warn('[hotels] getHotelsMeta failed, fallback to full load', metaError);
      }
    }

    // revision 变化或首次加载，拉全量
    const localRev = getLocalHotelsRevision();
    const result = await window.electronAPI.getAllHotelsWithMeta();
    const hotels = attachDerivedFields(result.hotels || []);
    setLocalHotelsRevision({ revision: result.revision, count: result.count });
    setResourceLoadState('hotels', hotels.length ? 'ready' : 'empty');
    if (localRev !== null) {
      logRendererDebug('[hotels] revision changed, reload full hotels', {
        localRevision: localRev,
        remoteRevision: result.revision
      });
    }
    perfEnd('loadHotels');
    return hotels;
  } catch (error) {
    perfEnd('loadHotels');
    console.error('加载宾馆失败:', error);
    // 降级到旧 API
    try {
      const result = await window.electronAPI.getAllHotels();
      const hotels = attachDerivedFields(result || []);
      setResourceLoadState('hotels', hotels.length ? 'ready' : 'empty');
      return hotels;
    } catch (fallbackError) {
      console.error('加载宾馆失败（降级）:', fallbackError);
      setResourceLoadState('hotels', 'error', fallbackError || error);
      return state.hotels;
    }
  }
}

/**
 * @returns {Promise<NormalizedTemplateRecord[]>}
 */
export async function loadTemplates() {
  setResourceLoadState('templates', 'loading');
  try {
    const templates = (await window.electronAPI.getAllTemplates()) || [];
    setResourceLoadState('templates', templates.length ? 'ready' : 'empty');
    return templates;
  } catch (error) {
    console.error('加载模板失败:', error);
    setResourceLoadState('templates', 'error', error);
    return state.templates;
  }
}

/**
 * @returns {Promise<AppSettings>}
 */
export async function loadSettings() {
  setResourceLoadState('settings', 'loading');
  try {
    const settings = (await window.electronAPI.getAllSettings()) || {};
    setResourceLoadState('settings', 'ready');
    return settings;
  } catch (error) {
    console.error('加载设置失败:', error);
    setResourceLoadState('settings', 'error', error);
    return state.settings;
  }
}

/**
 * @returns {Promise<boolean>}
 */
export async function retryLoadHotels() {
  setResourceLoadState('hotels', 'loading');
  requestHotelRender({ reason: 'data-reload', forceFull: true });
  const hotels = await loadHotels({ force: true });
  setHotels(hotels || []);
  requestHotelRender({ reason: 'data-reload', forceFull: true });
  return getResourceLoadState('hotels').status !== 'error';
}

/**
 * @param {{includeSettings?: boolean, invalidateCache?: boolean, verbose?: boolean, forceHotels?: boolean}} [options]
 * @returns {Promise<{hotelsCount: number, templatesCount: number, settingsLoaded: boolean}>}
 */
export async function reloadAllData(options = {}) {
  const {
    includeSettings = false,
    invalidateCache = false,
    verbose = true,
    forceHotels = false
  } = options;

  if (invalidateCache && window.electronAPI.invalidateRendererCache) {
    window.electronAPI.invalidateRendererCache();
    markLocalHotelsRevisionUnknown();
  }

  const shouldForceHotels = forceHotels || invalidateCache;

  /** @type {[Promise<NormalizedHotelRecord[]>, Promise<NormalizedTemplateRecord[]>, Promise<AppSettings|null>]} */
  const requests = [
    loadHotels({ force: shouldForceHotels }),
    loadTemplates(),
    includeSettings ? loadSettings() : Promise.resolve(null)
  ];

  try {
    if (verbose) logRendererDebug('[数据重载] 开始重新加载数据...');

    const [loadedHotels, loadedTemplates, loadedSettings] = await Promise.all(requests);
    setHotels(loadedHotels || []);
    setTemplates(loadedTemplates || []);

    if (includeSettings) {
      setSettings(loadedSettings || state.settings);
    }

    if (verbose) {
      logRendererDebug('[数据重载] 完成:', {
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

/**
 * @param {EntityId|null|undefined} templateId
 * @returns {NormalizedTemplateRecord|undefined}
 */
export function findTemplateById(templateId) {
  return state.templates.find((template) => idsEqual(template.id, templateId));
}

/* ---- 宾馆编辑弹窗 ---- */

/**
 * @param {EntityId|null} [templateId]
 * @returns {void}
 */
export function openAddHotelModal(templateId = null) {
  const modalTitle = document.getElementById('modalTitle');
  const hotelForm = /** @type {HTMLFormElement|null} */ (document.getElementById('hotelForm'));
  const hotelIdInput = /** @type {HTMLInputElement|null} */ (document.getElementById('hotelId'));
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
  clearFormError('hotelForm');
  hotelIdInput.value = '';

  const selectedTemplate = templateId ? findTemplateById(templateId) : null;
  if (selectedTemplate) {
    applyTemplateDataToForm(selectedTemplate);
  }

  setModalActive('hotelModal', true);
  scheduleHotelModalFocus();
  updateHotelTemplateSelect({
    selectedValue: String(templateId || ''),
    applyTemplateOnReady: Boolean(templateId)
  });
  refreshCustomSelects();
}

/**
 * @param {EntityId} id
 * @returns {void}
 */
export function editHotel(id) {
  const hotel = state.hotels.find((h) => idsEqual(h.id, id));
  if (!hotel) {
    console.error('[editHotel] 未找到宾馆ID:', id);
    return;
  }

  /**
   * @param {string} elementId
   * @param {unknown} value
   * @param {boolean} [isCheckbox]
   */
  const setElementValue = (elementId, value, isCheckbox = false) => {
    const element = /** @type {FormValueElement|null} */ (document.getElementById(elementId));
    if (element) {
      if (isCheckbox) {
        /** @type {HTMLInputElement} */ (element).checked = /** @type {boolean} */ (value);
      } else {
        /** @type {any} */ (element).value = value;
      }
    }
  };

  const modalTitle = $('modalTitle');
  if (modalTitle) modalTitle.textContent = '编辑宾馆';
  clearFormError('hotelForm');
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
  setElementValue('ctripDiamondLevel', hotel.ctrip_diamond_level || '');
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
  updateHotelTemplateSelect({ selectedValue: String(hotel.template_id || '') });
  refreshCustomSelects();
}

export function closeHotelModal() {
  setModalActive('hotelModal', false);
}

/* ---- 模板选择（宾馆编辑弹窗内） ---- */

/**
 * @param {{selectedValue?: string, applyTemplateOnReady?: boolean}} [options]
 */
function updateHotelTemplateSelect(options = {}) {
  const select = /** @type {HTMLSelectElement|null} */ (
    document.getElementById('hotelTemplateSelect')
  );
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
      option.value = String(template.id ?? '');
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

    refreshCustomSelects();
  };

  requestAnimationFrame(() => renderBatch());
}

/**
 * @param {NormalizedTemplateRecord|undefined|null} template
 */
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
  const templateSelect = /** @type {HTMLSelectElement|null} */ (
    document.getElementById('hotelTemplateSelect')
  );
  if (!templateSelect) return;
  const templateId = templateSelect.value;
  if (!templateId) return;
  const template = findTemplateById(templateId);
  applyTemplateDataToForm(template);
}

/* ---- 保存宾馆 ---- */

export async function saveHotel() {
  clearFormError('hotelForm');
  /**
   * @param {string} id
   * @returns {string}
   */
  const getVal = (id) => {
    const el = /** @type {FormValueElement|null} */ (document.getElementById(id));
    return el ? el.value : '';
  };
  /**
   * @param {string} id
   * @returns {boolean}
   */
  const getChk = (id) => {
    const el = /** @type {HTMLInputElement|null} */ (document.getElementById(id));
    return el ? el.checked : false;
  };

  const id = getVal('hotelId');
  const selectedTemplateId = getVal('hotelTemplateSelect');

  /** @type {TemplateInfo|null} */
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

  /** @type {Partial<RawHotelRecord>} */
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
    ctrip_diamond_level: parseFloat(getVal('ctripDiamondLevel')) || null,
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
    const nameInput = /** @type {HTMLInputElement|null} */ ($('hotelName'));
    showFormError('hotelForm', '请填写宾馆名称。', nameInput);
    return;
  }

  const normalizedId = id ? normalizeIdValue(id) : null;
  const mutationKey = normalizedId === null ? 'hotel:add' : `hotel:${String(normalizedId)}`;
  if (!beginMutation(mutationKey)) return;

  const saveButton = /** @type {HTMLButtonElement|null} */ ($('saveHotelBtn'));
  setActionButtonBusy(saveButton, true, { busyText: '正在保存…' });

  const temporaryId = `pending:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const previousHotel =
    normalizedId === null
      ? null
      : state.hotels.find((item) => idsEqual(item.id, normalizedId)) || null;
  const optimisticHotel = attachDerivedFieldsToHotel(
    /** @type {NormalizedHotelRecord} */ ({
      ...(previousHotel || {}),
      ...hotel,
      id: normalizedId ?? temporaryId
    })
  );

  try {
    if (normalizedId !== null) {
      hotel.id = normalizedId;
      setHotels(replaceHotelInList(state.hotels, optimisticHotel, normalizedId).list);
      requestHotelRender({ reason: 'hotel-update', changedIds: [normalizedId] });

      const savedHotel = attachDerivedFieldsToHotel(
        assertSavedHotelResult(await window.electronAPI.updateHotel(hotel), '更新宾馆失败')
      );
      setHotels(replaceHotelInList(state.hotels, savedHotel, normalizedId).list);
      markLocalHotelsRevisionUnknown();
      requestHotelRender({
        reason: 'hotel-update',
        changedIds: [savedHotel.id || normalizedId]
      });
    } else {
      setHotels(appendHotelToList(state.hotels, optimisticHotel));
      requestHotelRender({
        reason: 'hotel-add',
        changedIds: [temporaryId],
        forceFull: true
      });

      const savedHotel = attachDerivedFieldsToHotel(
        assertSavedHotelResult(await window.electronAPI.addHotel(hotel), '新增宾馆失败')
      );
      setHotels(appendHotelToList(removeHotelById(state.hotels, temporaryId).list, savedHotel));
      markLocalHotelsRevisionUnknown();
      requestHotelRender({
        reason: 'hotel-add',
        changedIds: [savedHotel.id],
        forceFull: true
      });
    }
    closeHotelModal();
  } catch (error) {
    console.error('保存宾馆失败:', error);
    if (normalizedId === null) {
      setHotels(removeHotelById(state.hotels, temporaryId).list);
    } else if (previousHotel) {
      const restoredHotels = restoreHotelFields(
        state.hotels,
        normalizedId,
        previousHotel,
        Object.keys(hotel)
      );
      const restoredHotel = restoredHotels.find((item) => idsEqual(item.id, normalizedId));
      setHotels(
        restoredHotel
          ? replaceHotelInList(
              restoredHotels,
              attachDerivedFieldsToHotel(restoredHotel),
              normalizedId
            ).list
          : restoredHotels
      );
    }
    requestHotelRender({ reason: 'fallback', forceFull: true });
    const message = `保存失败：${error.message}。原数据已恢复，可以重试。`;
    showFormError('hotelForm', message);
    showNotification(message, 'error');
  } finally {
    endMutation(mutationKey);
    setActionButtonBusy(saveButton, false);
  }
}

/* ---- 删除宾馆 ---- */

export async function deleteHotel(id) {
  perfStart('deleteHotel');
  const mutationKey = `hotel:${String(id)}`;
  if (!beginMutation(mutationKey)) {
    perfEnd('deleteHotel');
    return;
  }

  const previousIndex = state.hotels.findIndex((hotel) => idsEqual(hotel.id, id));
  const previousHotel = previousIndex >= 0 ? state.hotels[previousIndex] : null;
  try {
    const { list: nextHotels, removed } = removeHotelById(state.hotels, id);
    if (removed) {
      setHotels(nextHotels);
      requestHotelRender({ reason: 'hotel-delete', changedIds: [id] });
    }

    const result = await window.electronAPI.deleteHotel(id);
    if (!result || !result.success) {
      throw new Error(result?.error || '删除失败');
    }
    markLocalHotelsRevisionUnknown();
    showNotification('删除成功', 'success');
  } catch (error) {
    console.error('删除宾馆失败:', error);
    if (previousHotel) {
      setHotels(insertHotelAtIndex(state.hotels, previousHotel, previousIndex));
      requestHotelRender({ reason: 'fallback', forceFull: true });
    }
    showNotification(`删除失败：${error.message || '请重试'}，原数据已恢复`, 'error');
  } finally {
    endMutation(mutationKey);
    perfEnd('deleteHotel');
  }
}

/* ---- 收藏 ---- */

export async function toggleFavorite(id, currentStatus) {
  const mutationKey = `hotel:${String(id)}`;
  if (!beginMutation(mutationKey)) return;

  let operationStarted = false;
  /** @type {0|1} */
  let previousFavorite = currentStatus ? 1 : 0;
  try {
    const hotel = state.hotels.find((h) => idsEqual(h.id, id));
    if (!hotel) return;

    perfStart('toggleFavorite');
    operationStarted = true;
    previousFavorite = hotel.is_favorite ? 1 : 0;
    const nextFavorite = previousFavorite ? 0 : 1;
    const updatedLocalHotel = attachDerivedFieldsToHotel({ ...hotel, is_favorite: nextFavorite });
    setHotels(replaceHotelInList(state.hotels, updatedLocalHotel, id).list);
    requestHotelRender({ reason: 'favorite', changedIds: [id] });

    const savedHotel = attachDerivedFieldsToHotel(
      assertSavedHotelResult(
        await window.electronAPI.updateHotel(stripDerivedFieldsFromHotel(updatedLocalHotel)),
        '更新收藏状态失败'
      )
    );
    setHotels(replaceHotelInList(state.hotels, savedHotel, id).list);
    markLocalHotelsRevisionUnknown();
    requestHotelRender({ reason: 'favorite', changedIds: [savedHotel.id || id] });
  } catch (error) {
    console.error('更新收藏状态失败:', error);
    const currentHotel = state.hotels.find((hotel) => idsEqual(hotel.id, id));
    if (currentHotel) {
      setHotels(
        restoreHotelFields(state.hotels, id, { ...currentHotel, is_favorite: previousFavorite }, [
          'is_favorite'
        ])
      );
      requestHotelRender({ reason: 'favorite', changedIds: [id] });
    }
    showNotification('收藏状态更新失败，原状态已恢复，可以重试', 'error');
  } finally {
    endMutation(mutationKey);
    if (operationStarted) perfEnd('toggleFavorite');
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

  const batchDeleteBtn = /** @type {HTMLButtonElement|null} */ ($('batchDeleteBtn'));
  if (!batchDeleteBtn) return;

  if (batchDeleteBtn.dataset.confirming !== 'true') {
    startBatchDeleteConfirmation();
    return;
  }

  const hotelIds = Array.from(state.selectedHotels);
  const mutationKeys = hotelIds.map((id) => `hotel:${String(id)}`);
  if (mutationKeys.some((key) => state.pendingMutations.has(key))) return;
  mutationKeys.forEach((key) => beginMutation(key));

  /** @type {Array<{hotel: NormalizedHotelRecord, index: number}>} */
  let removedHotels = [];
  try {
    const deletedCount = hotelIds.length;
    const hotelIdSet = new Set(hotelIds.map((id) => getSelectionKey(id)));
    removedHotels = state.hotels
      .map((hotel, index) => ({ hotel, index }))
      .filter(({ hotel }) => hotelIdSet.has(getSelectionKey(hotel.id)));
    state.batchDeleteInProgress = true;

    batchDeleteBtn.disabled = true;
    batchDeleteBtn.innerHTML = `${iconHtml('loader')} 正在删除...`;

    setHotels(state.hotels.filter((hotel) => !hotelIdSet.has(getSelectionKey(hotel.id))));
    requestHotelRender({ reason: 'batch-delete', forceFull: true });

    const result = await window.electronAPI.deleteMultipleHotels(hotelIds);
    if (!result || !result.success) {
      throw new Error('批量删除失败');
    }

    clearSelectedHotels();
    markLocalHotelsRevisionUnknown();

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    state.batchDeleteInProgress = false;
    resetBatchDeleteConfirmation({ count: 0, disabled: false });
    showNotification(`成功删除 ${deletedCount} 个宾馆`, 'success');
  } catch (error) {
    console.error('批量删除失败:', error);
    state.batchDeleteInProgress = false;
    let restoredHotels = state.hotels;
    for (const snapshot of removedHotels.sort((a, b) => a.index - b.index)) {
      restoredHotels = insertHotelAtIndex(restoredHotels, snapshot.hotel, snapshot.index);
    }
    setHotels(restoredHotels);
    requestHotelRender({ reason: 'batch-delete', forceFull: true });
    resetBatchDeleteConfirmation({ count: state.selectedHotels.size, disabled: false });
    showNotification('批量删除失败，原数据已恢复，可以重试', 'error');
  } finally {
    mutationKeys.forEach((key) => endMutation(key));
  }
}

/* ---- 表单计算 ---- */

export function calculateDays() {
  const checkIn = getValue('checkInDate');
  const checkOut = getValue('checkOutDate');

  if (checkIn && checkOut) {
    const checkInDate = new Date(checkIn);
    const checkOutDate = new Date(checkOut);
    const diffTime = Math.abs(checkOutDate.getTime() - checkInDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    setValue('days', diffDays);
    calculateDailyPrice();
  }
}

export function onCheckInChange() {
  const checkInEl = getFormValueElement('checkInDate');
  const checkOutEl = getFormValueElement('checkOutDate');
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
  const checkInEl = getFormValueElement('checkInDate');
  const checkOutEl = getFormValueElement('checkOutDate');
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
  const totalPriceEl = getFormValueElement('totalPrice');
  const daysEl = getFormValueElement('days');
  const dailyPriceEl = getFormValueElement('dailyPrice');
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
  const dailyPriceEl = getFormValueElement('dailyPrice');
  const daysEl = getFormValueElement('days');
  const totalPriceEl = getFormValueElement('totalPrice');
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
  const daysEl = getFormValueElement('days');
  const totalPriceEl = getFormValueElement('totalPrice');
  const dailyPriceEl = getFormValueElement('dailyPrice');
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

/**
 * @param {FormValueElement} input
 */
export function validateScore(input) {
  let value = input.value;
  if (!value || value === '') return;
  let numValue = parseFloat(value);
  if (isNaN(numValue)) return;
}

/**
 * @param {FormValueElement} input
 */
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
