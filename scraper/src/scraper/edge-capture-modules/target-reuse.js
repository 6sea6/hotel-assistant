const { normalizeText } = require('../../utils');
const { extractStayDates, parseHotelIdFromUrl } = require('../../ctrip-url');

function buildEdgeReuseSignature(url) {
  const normalizedUrl = String(url || '');
  const hotelId = parseHotelIdFromUrl(normalizedUrl);
  if (!hotelId) {
    return null;
  }

  try {
    const parsed = new URL(normalizedUrl);
    const stayDates = extractStayDates(normalizedUrl);
    return {
      domainFamily: /(^|\.)ctrip\.com$/i.test(parsed.hostname) ? 'ctrip.com' : parsed.hostname,
      hotelId,
      checkIn: normalizeText(stayDates.checkIn),
      checkOut: normalizeText(stayDates.checkOut),
      adult: normalizeText(stayDates.adult),
      children: normalizeText(stayDates.children),
      infants: normalizeText(stayDates.infants)
    };
  } catch (_error) {
    return null;
  }
}

function isReusableEdgeHotelTarget(targetUrl, requestedUrl) {
  const targetSignature = buildEdgeReuseSignature(targetUrl);
  const requestedSignature = buildEdgeReuseSignature(requestedUrl);
  if (!targetSignature || !requestedSignature) {
    return false;
  }

  return targetSignature.domainFamily === requestedSignature.domainFamily
    && targetSignature.hotelId === requestedSignature.hotelId
    && targetSignature.checkIn === requestedSignature.checkIn
    && targetSignature.checkOut === requestedSignature.checkOut
    && targetSignature.adult === requestedSignature.adult
    && targetSignature.children === requestedSignature.children
    && targetSignature.infants === requestedSignature.infants;
}

module.exports = {
  buildEdgeReuseSignature,
  isReusableEdgeHotelTarget
};
