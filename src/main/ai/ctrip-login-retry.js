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

function getLoginRequiredSignal(result = {}) {
  const pageSnapshot = getPageSnapshot(result);
  if (!pageSnapshot || typeof pageSnapshot !== 'object' || !pageSnapshot.login_required) {
    return {
      detected: false,
      reason: ''
    };
  }

  return {
    detected: true,
    reason:
      pageSnapshot.login_reason ||
      '检测到携程页面显示“登录看低价/解锁优惠”，当前登录态可能已失效。'
  };
}

function getVisibleLoginRetryNeed(result = {}) {
  if (!result || result.success !== true) {
    return {
      needed: false,
      reason: ''
    };
  }

  const pageSnapshot = getPageSnapshot(result) || {};
  if (pageSnapshot.booking_unavailable) {
    return {
      needed: false,
      reason: ''
    };
  }

  const loginRequired = getLoginRequiredSignal(result);
  if (loginRequired.detected) {
    return {
      needed: true,
      reason: loginRequired.reason
    };
  }

  const totalPriceMissing =
    result.totalPrice === null || result.totalPrice === undefined || result.totalPrice === '';
  const lockedPrice = hasLockedPriceSignal(result);

  if (lockedPrice && totalPriceMissing) {
    return {
      needed: true,
      reason: '检测到携程页面显示“登录看低价/解锁优惠”，当前登录态可能已失效。'
    };
  }

  const sources = Array.isArray(pageSnapshot.sources) ? pageSnapshot.sources : [];
  const roomCandidateCount = Number(pageSnapshot.room_candidates_count || 0);
  const hasRoomCandidates =
    roomCandidateCount > 0 ||
    sources.some((source) => source && Number(source.room_candidates_count || 0) > 0);
  const roomPriceVisible =
    Boolean(pageSnapshot.room_price_visible) ||
    sources.some((source) => source && source.room_price_visible && !source.login_required);
  const hasNoEligibleResult =
    Number.isFinite(Number(result.eligibleCount)) && Number(result.eligibleCount) <= 0;
  if (totalPriceMissing && hasNoEligibleResult && hasRoomCandidates && !roomPriceVisible) {
    return {
      needed: true,
      reason: '已找到房型信息，但未采集到有效价格；请重新登录携程后重试。'
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
  getLoginRequiredSignal,
  getPageSnapshot,
  getVisibleLoginRetryNeed,
  hasLockedPriceSignal
};
