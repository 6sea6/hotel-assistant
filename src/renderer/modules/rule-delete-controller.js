/**
 * 卡片视图规则删除 —— 阈值解析、预览和批量删除确认流程。
 */

import { state, setHotels, markVisibleHotelsCacheDirty } from './state.js';
import { $, getValue, getSelectionKey, iconHtml } from './dom-helpers.js';
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

function getRuleDeleteProtectFavorite() {
  const input = $('ruleDeleteProtectFavorite');
  return input instanceof HTMLInputElement ? input.checked : true;
}

function resetRuleDeleteConfirmation() {
  const confirmBtn = $('ruleDeleteConfirmBtn');
  if (!confirmBtn) return;
  if (!confirmBtn.dataset.originalHtml) {
    confirmBtn.dataset.originalHtml = `${iconHtml('trash')} 删除命中项`;
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

  const parseScoreThreshold = (rawValue) => {
    const result = parseThreshold(rawValue, '携程评分阈值');
    if (result.error || result.value === null) {
      return result;
    }

    if (result.value > 5) {
      return { error: '携程评分阈值必须是 0 到 5 之间的数字' };
    }

    return result;
  };

  const price = parseThreshold(getValue('ruleDeletePrice'), '日均价格阈值');
  if (price.error) return price;

  const ctripScore = parseScoreThreshold(getValue('ruleDeleteCtripScore'));
  if (ctripScore.error) return ctripScore;

  const subwayDistance = parseThreshold(getValue('ruleDeleteSubwayDistance'), '地铁站距离阈值');
  if (subwayDistance.error) return subwayDistance;

  const transportTime = parseThreshold(getValue('ruleDeleteTransportTime'), '公共交通时间阈值');
  if (transportTime.error) return transportTime;

  return {
    value: {
      price: price.value,
      ctripScore: ctripScore.value,
      subwayDistance: subwayDistance.value,
      transportTime: transportTime.value,
      protectFavorite: getRuleDeleteProtectFavorite()
    }
  };
}

function hasRuleThreshold(value) {
  return value !== null && value !== undefined;
}

export function isSubwayDistanceRuleMatched(subwayDistance, threshold) {
  if (!hasRuleThreshold(threshold)) {
    return false;
  }

  if (subwayDistance === 0) {
    return true;
  }

  return subwayDistance !== null && subwayDistance > threshold;
}

export function isCtripScoreRuleMatched(score, threshold) {
  return (
    hasRuleThreshold(threshold) &&
    Number.isFinite(score) &&
    score > 0 &&
    score < threshold
  );
}

export function getRuleDeleteCandidates(thresholds, sourceHotels = getCurrentCardHotels()) {
  const hasActiveRule =
    hasRuleThreshold(thresholds.price) ||
    hasRuleThreshold(thresholds.ctripScore) ||
    hasRuleThreshold(thresholds.subwayDistance) ||
    hasRuleThreshold(thresholds.transportTime);

  if (!hasActiveRule) {
    return [];
  }

  const protectFavorite = thresholds.protectFavorite !== false;

  return sourceHotels.filter((hotel) => {
    if (protectFavorite && hotel.is_favorite === 1) {
      return false;
    }

    const dailyPrice = Number(hotel.daily_price);
    const ctripScore = Number(hotel.ctrip_score);
    const subwayDistance = extractDistanceNumber(hotel.subway_distance);
    const transportTime = extractTimeNumber(hotel.transport_time);

    return (
      (hasRuleThreshold(thresholds.price) &&
        Number.isFinite(dailyPrice) &&
        dailyPrice > thresholds.price) ||
      isCtripScoreRuleMatched(ctripScore, thresholds.ctripScore) ||
      isSubwayDistanceRuleMatched(subwayDistance, thresholds.subwayDistance) ||
      (hasRuleThreshold(thresholds.transportTime) &&
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
  const protectedFavoriteCount = thresholdsResult.value.protectFavorite
    ? getRuleDeleteCandidates({ ...thresholdsResult.value, protectFavorite: false }, visibleHotels)
        .length - candidates.length
    : 0;
  summaryText.textContent =
    protectedFavoriteCount > 0
      ? `当前卡片结果 ${visibleHotels.length} 条，命中规则 ${candidates.length} 条，已保护收藏 ${protectedFavoriteCount} 条`
      : `当前卡片结果 ${visibleHotels.length} 条，命中规则 ${candidates.length} 条`;
  confirmBtn.disabled = ruleDeleteInProgress || candidates.length === 0;
}

export function openRuleDeleteModal() {
  if (state.viewMode !== 'card') {
    showNotification('规则删除仅在卡片视图下可用', 'info');
    return;
  }

  setModalActive(RULE_DELETE_MODAL_ID, true);

  const priceInput = getFormValueElement('ruleDeletePrice');
  const scoreInput = getFormValueElement('ruleDeleteCtripScore');
  const subwayInput = getFormValueElement('ruleDeleteSubwayDistance');
  const transportInput = getFormValueElement('ruleDeleteTransportTime');
  const protectFavoriteInput = $('ruleDeleteProtectFavorite');
  if (priceInput) priceInput.value = '';
  if (scoreInput) scoreInput.value = '';
  if (subwayInput) subwayInput.value = '';
  if (transportInput) transportInput.value = '';
  if (protectFavoriteInput instanceof HTMLInputElement) {
    protectFavoriteInput.checked = true;
  }
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
      confirmHtml: `${iconHtml('warning')} 确认删除 (${candidates.length})`,
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
      confirmBtn.innerHTML = `${iconHtml('loader')} 正在删除...`;
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
      confirmBtn.innerHTML = originalHtml || `${iconHtml('trash')} 删除命中项`;
      resetRuleDeleteConfirmation();
    }
    updateRuleDeletePreview();
  }
}
