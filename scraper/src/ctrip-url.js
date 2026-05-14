const { normalizeText, toNumber } = require('./utils');

function hasValue(value) {
  return value !== null && value !== undefined && normalizeText(value) !== '';
}

function normalizeOccupancyValue(value, options = {}) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return '';
  }

  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) {
    return '';
  }

  const integer = Math.trunc(numeric);
  if (integer < 0) {
    return '';
  }

  if (!options.allowZero && integer === 0) {
    return '';
  }

  return String(integer);
}

function parseHotelIdFromUrl(url) {
  const normalizedUrl = String(url || '');
  const htmlMatch = normalizedUrl.match(/hotels\/(\d+)\.html/i);
  if (htmlMatch) {
    return htmlMatch[1];
  }

  const mobileMatch = normalizedUrl.match(/hoteldetail\/(\d+)\.html/i);
  if (mobileMatch) {
    return mobileMatch[1];
  }

  try {
    const parsed = new URL(normalizedUrl);
    const queryHotelId = normalizeText(parsed.searchParams.get('hotelId') || parsed.searchParams.get('hotelid'));
    if (/^\d+$/.test(queryHotelId)) {
      return queryHotelId;
    }
  } catch (_error) {
    const queryMatch = normalizedUrl.match(/[?&]hotel[Ii]d=(\d+)/);
    if (queryMatch) {
      return queryMatch[1];
    }
  }

  return '';
}

function extractStayDates(url) {
  try {
    const parsed = new URL(url);
    let checkIn = parsed.searchParams.get('checkIn') || '';
    let checkOut = parsed.searchParams.get('checkOut') || '';

    if (!checkIn) {
      const atime = parsed.searchParams.get('atime');
      if (atime && /^\d{8}$/.test(atime)) {
        checkIn = `${atime.slice(0, 4)}-${atime.slice(4, 6)}-${atime.slice(6, 8)}`;
      }
    }

    if (!checkOut && checkIn) {
      const days = parseInt(parsed.searchParams.get('days'), 10);
      if (days > 0) {
        const date = new Date(checkIn);
        date.setDate(date.getDate() + days);
        checkOut = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      }
    }

    return {
      checkIn: normalizeText(checkIn),
      checkOut: normalizeText(checkOut),
      adult: normalizeOccupancyValue(parsed.searchParams.get('adult')),
      children: normalizeOccupancyValue(parsed.searchParams.get('children'), { allowZero: true }),
      infants: normalizeOccupancyValue(parsed.searchParams.get('infants'), { allowZero: true })
    };
  } catch (_error) {
    return {
      checkIn: '',
      checkOut: '',
      adult: '',
      children: '',
      infants: ''
    };
  }
}

function resolveStayOptions(rawUrl, overrides = {}) {
  const extracted = extractStayDates(rawUrl);
  return {
    checkIn: hasValue(overrides.checkIn) ? normalizeText(overrides.checkIn) : extracted.checkIn,
    checkOut: hasValue(overrides.checkOut) ? normalizeText(overrides.checkOut) : extracted.checkOut,
    adult: hasValue(overrides.adult) ? normalizeOccupancyValue(overrides.adult) : extracted.adult,
    children: hasValue(overrides.children)
      ? normalizeOccupancyValue(overrides.children, { allowZero: true })
      : extracted.children,
    infants: hasValue(overrides.infants)
      ? normalizeOccupancyValue(overrides.infants, { allowZero: true })
      : extracted.infants
  };
}

function setOrDeleteSearchParam(targetUrl, key, value) {
  if (hasValue(value)) {
    targetUrl.searchParams.set(key, value);
    return;
  }

  targetUrl.searchParams.delete(key);
}

function applyStayOptions(targetUrl, stayOptions) {
  setOrDeleteSearchParam(targetUrl, 'checkIn', stayOptions.checkIn);
  setOrDeleteSearchParam(targetUrl, 'checkOut', stayOptions.checkOut);
  setOrDeleteSearchParam(targetUrl, 'adult', stayOptions.adult);
  setOrDeleteSearchParam(targetUrl, 'children', stayOptions.children);
  setOrDeleteSearchParam(targetUrl, 'infants', stayOptions.infants);
}

function buildDesktopUrl(rawUrl, overrides = {}) {
  const normalizedUrl = normalizeText(rawUrl);
  if (!normalizedUrl) {
    return '';
  }

  const hotelId = parseHotelIdFromUrl(normalizedUrl);
  const stayOptions = resolveStayOptions(normalizedUrl, overrides);

  if (hotelId) {
    const desktopUrl = new URL('https://hotels.ctrip.com/hotels/detail/');
    desktopUrl.searchParams.set('hotelId', hotelId);
    applyStayOptions(desktopUrl, stayOptions);
    return desktopUrl.toString();
  }

  try {
    const fallbackUrl = new URL(normalizedUrl);
    applyStayOptions(fallbackUrl, stayOptions);
    return fallbackUrl.toString();
  } catch (_error) {
    return normalizedUrl;
  }
}

function buildMobileUrl(rawUrl, overrides = {}) {
  const normalizedUrl = normalizeText(rawUrl);
  if (!normalizedUrl) {
    return '';
  }

  const hotelId = parseHotelIdFromUrl(normalizedUrl);
  const stayOptions = resolveStayOptions(normalizedUrl, overrides);

  if (hotelId) {
    const mobileUrl = new URL(`https://m.ctrip.com/html5/hotel/hoteldetail/${hotelId}.html`);
    applyStayOptions(mobileUrl, stayOptions);
    return mobileUrl.toString();
  }

  try {
    const fallbackUrl = new URL(normalizedUrl);
    applyStayOptions(fallbackUrl, stayOptions);
    return fallbackUrl.toString();
  } catch (_error) {
    return normalizedUrl;
  }
}

function buildUrlOverridesFromTemplate(template = {}) {
  const roomCount = toNumber(template.room_count);
  return {
    checkIn: normalizeText(template.check_in_date),
    checkOut: normalizeText(template.check_out_date),
    adult: roomCount || undefined,
    children: roomCount ? 0 : undefined,
    infants: roomCount ? 0 : undefined
  };
}

module.exports = {
  buildDesktopUrl,
  buildMobileUrl,
  buildUrlOverridesFromTemplate,
  extractStayDates,
  parseHotelIdFromUrl
};