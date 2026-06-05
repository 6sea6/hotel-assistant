/**
 * 卡片视图规则删除 —— 阈值解析、预览和批量删除确认流程。
 */

import { state, setHotels, markVisibleHotelsCacheDirty } from './state.js';
import { $, getValue, getSelectionKey } from './dom-helpers.js';
import { showNotification } from './notification.js';
import {
  setModalActive,
  resetActionButtonConfirmation,
  startActionButtonConfirmation
} from './ui-utils.js';
import { applyFiltersToHotels, extractDistanceNumber, extractTimeNumber } from './hotel-filters.js';
import { requestHotelListRender } from './hotel-list-render-orchestrator.js';

const RULE_DELETE_MODAL_ID = 'ruleDeleteModal';
let ruleDeleteInProgress = false;

/**
 * @typedef {HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement} RuleDeleteFormValueElement
 */

/**
 * @param {string} id
 * @returns {RuleDeleteFormValueElement|null}
 */
const getFormValueElement = (id) => /** @type {RuleDeleteFormValueElement|null} */ ($(id));

function resetRuleDeleteConfirmation() {
  const confirmBtn = $('ruleDeleteConfirmBtn');
  if (!confirmBtn) return;
  if (!confirmBtn.dataset.originalHtml) {
    confirmBtn.dataset.originalHtml = '<span>🗑️</span> 删除命中项';
  }
  confirmBtn.dataset.variantClass = 'btn-danger';
  resetActionButtonConfirmation(confirmBtn);
}

function getCurrentCardHotels() {
  return applyFiltersToHotels(state.hotels, state.currentFilters);
}

function getRuleDeleteThresholds() {
  const parseThreshold = (rawValue, label) => {
    const normalized = String(rawValue ?? '').trim();
    if (normalized === '') {
      return { value: null };
    }

    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return { error: `${label}必须是大于或等于 0 的数字` };
    }

    return { value: parsed };
  };

  const price = parseThreshold(getValue('ruleDeletePrice'), '总价格阈值');
  if (price.error) return price;

  const subwayDistance = parseThreshold(getValue('ruleDeleteSubwayDistance'), '地铁站距离阈值');
  if (subwayDistance.error) return subwayDistance;

  const transportTime = parseThreshold(getValue('ruleDeleteTransportTime'), '公共交通时间阈值');
  if (transportTime.error) return transportTime;

  return {
    value: {
      price: price.value,
      subwayDistance: subwayDistance.value,
      transportTime: transportTime.value
    }
  };
}

function getRuleDeleteCandidates(thresholds, sourceHotels = getCurrentCardHotels()) {
  const hasActiveRule =
    thresholds.price !== null ||
    thresholds.subwayDistance !== null ||
    thresholds.transportTime !== null;

  if (!hasActiveRule) {
    return [];
  }

  return sourceHotels.filter((hotel) => {
    const totalPrice = Number(hotel.total_price);
    const subwayDistance = extractDistanceNumber(hotel.subway_distance);
    const transportTime = extractTimeNumber(hotel.transport_time);

    return (
      (thresholds.price !== null && Number.isFinite(totalPrice) && totalPrice > thresholds.price) ||
      (thresholds.subwayDistance !== null &&
        subwayDistance !== null &&
        subwayDistance > thresholds.subwayDistance) ||
      (thresholds.transportTime !== null &&
        transportTime !== null &&
        transportTime > thresholds.transportTime)
    );
  });
}

export function updateRuleDeletePreview() {
  const summaryText = $('ruleDeleteSummaryText');
  const confirmBtn = /** @type {HTMLButtonElement|null} */ ($('ruleDeleteConfirmBtn'));
  if (!summaryText || !confirmBtn) {
    return;
  }
  if (!ruleDeleteInProgress) {
    resetRuleDeleteConfirmation();
  }

  const visibleHotels = getCurrentCardHotels();
  const thresholdsResult = getRuleDeleteThresholds();

  if (thresholdsResult.error) {
    summaryText.textContent = thresholdsResult.error;
    confirmBtn.disabled = true;
    return;
  }

  const candidates = getRuleDeleteCandidates(thresholdsResult.value, visibleHotels);
  summaryText.textContent = `当前卡片结果 ${visibleHotels.length} 条，命中规则 ${candidates.length} 条`;
  confirmBtn.disabled = ruleDeleteInProgress || candidates.length === 0;
}

export function openRuleDeleteModal() {
  if (state.viewMode !== 'card') {
    showNotification('规则删除仅在卡片视图下可用', 'info');
    return;
  }

  setModalActive(RULE_DELETE_MODAL_ID, true);

  const priceInput = getFormValueElement('ruleDeletePrice');
  const subwayInput = getFormValueElement('ruleDeleteSubwayDistance');
  const transportInput = getFormValueElement('ruleDeleteTransportTime');
  if (priceInput) priceInput.value = '';
  if (subwayInput) subwayInput.value = '';
  if (transportInput) transportInput.value = '';
  resetRuleDeleteConfirmation();

  updateRuleDeletePreview();
}

export function closeRuleDeleteModal(force = false) {
  if (ruleDeleteInProgress && !force) {
    return;
  }

  setModalActive(RULE_DELETE_MODAL_ID, false);
  resetRuleDeleteConfirmation();
}

export async function confirmRuleDelete() {
  if (ruleDeleteInProgress) {
    return;
  }

  const thresholdsResult = getRuleDeleteThresholds();
  if (thresholdsResult.error) {
    showNotification(thresholdsResult.error, 'error');
    updateRuleDeletePreview();
    return;
  }

  const visibleHotels = getCurrentCardHotels();
  const candidates = getRuleDeleteCandidates(thresholdsResult.value, visibleHotels);

  if (candidates.length === 0) {
    showNotification('没有命中规则的宾馆', 'info');
    updateRuleDeletePreview();
    return;
  }

  const confirmBtn = /** @type {HTMLButtonElement|null} */ ($('ruleDeleteConfirmBtn'));
  if (confirmBtn && confirmBtn.dataset.confirming !== 'true') {
    startActionButtonConfirmation(confirmBtn, {
      variantClass: 'btn-danger',
      confirmHtml: `<span>⚠️</span> 确认删除 (${candidates.length})`,
      timeout: 2600
    });
    return;
  }

  const originalHtml = confirmBtn ? confirmBtn.innerHTML : '';
  let previousHotels = null;

  try {
    ruleDeleteInProgress = true;
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<span>⏳</span> 正在删除...';
    }

    const hotelIds = candidates.map((hotel) => getSelectionKey(hotel.id));
    previousHotels = state.hotels.slice();
    const deleteIdSet = new Set(hotelIds);

    const result = await window.electronAPI.deleteMultipleHotels(hotelIds);
    if (!result || !result.success) {
      throw new Error(result?.error || '规则删除失败');
    }

    setHotels(previousHotels.filter((hotel) => !deleteIdSet.has(getSelectionKey(hotel.id))));
    markVisibleHotelsCacheDirty();
    requestHotelListRender({ reason: 'rule-delete', forceFull: true });
    closeRuleDeleteModal(true);
    showNotification(`成功删除 ${candidates.length} 个命中规则的宾馆`, 'success');
  } catch (error) {
    console.error('规则删除失败:', error);
    if (previousHotels) {
      setHotels(previousHotels);
      markVisibleHotelsCacheDirty();
      requestHotelListRender({ reason: 'rule-delete', forceFull: true });
    }
    showNotification('规则删除失败，请重试', 'error');
  } finally {
    ruleDeleteInProgress = false;
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = originalHtml || '<span>🗑️</span> 删除命中项';
      resetRuleDeleteConfirmation();
    }
    updateRuleDeletePreview();
  }
}
