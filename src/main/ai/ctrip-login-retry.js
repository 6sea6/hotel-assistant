function getPageSnapshot(result = {}) {
  return result.pageSnapshot || result.page_snapshot || null;
}

function hasLockedPriceSignal(result = {}) {
  const pageSnapshot = getPageSnapshot(result);
  if (!pageSnapshot || typeof pageSnapshot !== 'object') {
    return false;
  }

  if (pageSnapshot.selected_room_price_locked) {
    return true;
  }

  return (Array.isArray(pageSnapshot.sources) ? pageSnapshot.sources : []).some(
    (source) => source && source.locked_price_detected
  );
}

function getVisibleLoginRetryNeed(result = {}) {
  if (!result || result.success !== true) {
    return {
      needed: false,
      reason: ''
    };
  }

  const pageSnapshot = getPageSnapshot(result) || {};
  const totalPriceMissing =
    result.totalPrice === null || result.totalPrice === undefined || result.totalPrice === '';
  const roomPricesMissing = !Array.isArray(result.roomPrices) || result.roomPrices.length === 0;
  const candidatesCount = Number(pageSnapshot.room_candidates_count || 0);
  const visiblePriceMissing = candidatesCount > 0 && pageSnapshot.room_price_visible === false;
  const lockedPrice = hasLockedPriceSignal(result);

  if (lockedPrice && totalPriceMissing) {
    return {
      needed: true,
      reason: '检测到携程页面显示“登录看低价/解锁优惠”，当前登录态可能已失效。'
    };
  }

  if (totalPriceMissing && (visiblePriceMissing || (roomPricesMissing && candidatesCount > 0))) {
    return {
      needed: true,
      reason: '已找到房型信息，但未采集到有效价格，携程可能要求重新登录后才显示价格。'
    };
  }

  return {
    needed: false,
    reason: ''
  };
}

function buildLoginRetrySummary(previousResult = {}, retryNeed = {}) {
  return {
    attempted: true,
    reason: retryNeed.reason || '',
    previousTotalPrice: previousResult.totalPrice ?? null,
    previousEligibleCount: previousResult.eligibleCount ?? 0,
    previousPageSnapshot: getPageSnapshot(previousResult)
  };
}

module.exports = {
  buildLoginRetrySummary,
  getPageSnapshot,
  getVisibleLoginRetryNeed,
  hasLockedPriceSignal
};
