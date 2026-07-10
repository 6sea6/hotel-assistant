const { normalizeText } = require('../utils');

const BOOKING_UNAVAILABLE_PATTERNS = [
  { pattern: /不接受预[订定]/, reason: '当前日期不接受预订' },
  { pattern: /暂不接受预[订定]/, reason: '当前日期暂不接受预订' },
  { pattern: /暂不可预[订定]/, reason: '当前日期暂不可预订' },
  { pattern: /不可预[订定]/, reason: '当前日期不可预订' },
  { pattern: /暂无可订房型/, reason: '当前日期暂无可订房型' },
  { pattern: /无可订房型/, reason: '当前日期无可订房型' },
  { pattern: /已售[完罄]/, reason: '当前日期房型已售完' },
  { pattern: /满房/, reason: '当前日期满房' },
  { pattern: /不可售/, reason: '当前日期房型不可售' },
  { pattern: /已下架/, reason: '当前日期房型已下架' },
  {
    pattern: /(?:当前|所选|选择的)?日期[^。；;，,\n]{0,24}(?:无房|满房|不可预[订定]|不接受预[订定])/,
    reason: '当前日期不可预订'
  }
];

// 注意：携程页面预加载的 i18n 多语言字典 JSON 里会包含"本酒店目前不接受预订"等翻译值，
// 这些文字在静态 HTML 里就会被正则匹配到。对于真实不可预订的酒店（如 hotelId=895608），
// 字典里的这条恰好是正确的（JS 会渲染到 DOM）；但对于可订酒店（如 hotelId=441585），
// 字典里同样有这条（全量预加载），会造成误判。
// 纯靠 HTML 文本无法区分这两种情况（携程用 JS 动态渲染，axios 静态 HTML 抓不到渲染后 DOM）。
// 因此 booking_unavailable 的误判风险由 refresh 侧 shouldClearExistingHotelsForUnavailableRefresh
// 的 room_price_visible 双保险约束兜底：有可见价格时即使 booking_unavailable=true 也不清空旧数据。
function detectBookingUnavailableFromText(value) {
  const text = normalizeText(value);
  if (!text) {
    return {
      detected: false,
      reason: ''
    };
  }

  for (const item of BOOKING_UNAVAILABLE_PATTERNS) {
    const match = text.match(item.pattern);
    if (match) {
      return {
        detected: true,
        reason: item.reason,
        evidence: match[0]
      };
    }
  }

  return {
    detected: false,
    reason: ''
  };
}

function detectBookingUnavailableFromTexts(values = []) {
  const candidates = Array.isArray(values) ? values : [values];
  for (const value of candidates) {
    const result = detectBookingUnavailableFromText(value);
    if (result.detected) {
      return result;
    }
  }
  return {
    detected: false,
    reason: ''
  };
}

module.exports = {
  BOOKING_UNAVAILABLE_PATTERNS,
  detectBookingUnavailableFromText,
  detectBookingUnavailableFromTexts
};
