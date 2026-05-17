const { normalizeText, toNumber } = require('./utils');

const TRAILING_URL_PUNCTUATION = /[)\]}>，。；;、！？!?.,]+$/;
const INLINE_URL_TEXT_SEPARATOR = /[,，。；;、！？!?](?=[\u4e00-\u9fff])/;

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
    const queryHotelId = normalizeText(
      parsed.searchParams.get('hotelId') || parsed.searchParams.get('hotelid')
    );
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

function cleanExtractedUrl(value) {
  let cleaned = normalizeText(value)
    .replace(/&amp;/g, '&')
    .replace(/^["'(<\[]+/, '');
  const inlineTextIndex = cleaned.search(INLINE_URL_TEXT_SEPARATOR);
  if (inlineTextIndex > 0) {
    cleaned = cleaned.slice(0, inlineTextIndex);
  }

  while (TRAILING_URL_PUNCTUATION.test(cleaned)) {
    cleaned = cleaned.replace(TRAILING_URL_PUNCTUATION, '');
  }

  return cleaned;
}

function extractUrlsFromText(value) {
  const values = Array.isArray(value) ? value : [value];
  const urls = [];
  const seen = new Set();

  for (const item of values) {
    const text = String(item || '');
    const matches = text.match(/https?:\/\/[^\s"'<>]+/gi) || [];
    for (const match of matches) {
      const cleaned = cleanExtractedUrl(match);
      if (!cleaned || seen.has(cleaned)) {
        continue;
      }
      seen.add(cleaned);
      urls.push(cleaned);
    }
  }

  return urls;
}

function isCtripHost(hostname) {
  return /(^|\.)ctrip\.com$/i.test(String(hostname || ''));
}

function isCtripHotelUrl(url) {
  try {
    const parsed = new URL(cleanExtractedUrl(url));
    return isCtripHost(parsed.hostname) && /hotel|hotels/i.test(parsed.href);
  } catch (_error) {
    return false;
  }
}

function isCtripHotelDetailUrl(url) {
  if (!isCtripHotelUrl(url)) {
    return false;
  }
  return Boolean(parseHotelIdFromUrl(url));
}

function isCtripHotelListUrl(url) {
  if (!isCtripHotelUrl(url) || isCtripHotelDetailUrl(url)) {
    return false;
  }

  try {
    const parsed = new URL(cleanExtractedUrl(url));
    const href = parsed.href.toLowerCase();
    return (
      /list|hotelsearch|search|query|keyword|city|location|zone/.test(href) ||
      /\/hotels\/?$/.test(parsed.pathname.toLowerCase()) ||
      /\/hotel\/?$/.test(parsed.pathname.toLowerCase())
    );
  } catch (_error) {
    return false;
  }
}

function classifyCtripHotelUrl(url) {
  const normalizedUrl = cleanExtractedUrl(url);
  if (!isCtripHotelUrl(normalizedUrl)) {
    return {
      type: 'unsupported',
      url: normalizedUrl,
      hotelId: ''
    };
  }

  const hotelId = parseHotelIdFromUrl(normalizedUrl);
  if (hotelId) {
    return {
      type: 'detail',
      url: normalizedUrl,
      hotelId
    };
  }

  return {
    type: 'list',
    url: normalizedUrl,
    hotelId: ''
  };
}

function extractCtripUrlsFromInput(input = {}) {
  const rawValues = [];

  if (typeof input === 'string' || Array.isArray(input)) {
    rawValues.push(input);
  } else if (input && typeof input === 'object') {
    rawValues.push(
      input.url,
      input.urls,
      input.ctripUrl,
      input.ctrip_url,
      input['ctrip-url'],
      input.listUrl,
      input.listUrls,
      input.list_url,
      input['list-url'],
      input.text,
      input.inputText,
      input.input_text
    );
  }

  const flattened = rawValues.flatMap((value) => {
    if (Array.isArray(value)) {
      return value;
    }
    if (value && typeof value === 'object') {
      return Object.values(value);
    }
    return [value];
  });

  const urls = extractUrlsFromText(flattened);
  return urls.filter(isCtripHotelUrl);
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

function buildListPageUrl(rawUrl, pageNumber) {
  const normalizedUrl = cleanExtractedUrl(rawUrl);
  const page = Math.max(1, Math.trunc(Number(pageNumber) || 1));
  if (!normalizedUrl || page <= 1) {
    return normalizedUrl;
  }

  try {
    const parsed = new URL(normalizedUrl);
    const pageKeys = ['pageIndex', 'pageNo', 'pageNum', 'page', 'pageno', 'currentPage'];
    const existingKey = pageKeys.find((key) => parsed.searchParams.has(key));
    parsed.searchParams.set(existingKey || 'pageIndex', String(page));
    return parsed.toString();
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
  buildListPageUrl,
  buildMobileUrl,
  buildUrlOverridesFromTemplate,
  classifyCtripHotelUrl,
  cleanExtractedUrl,
  extractCtripUrlsFromInput,
  extractUrlsFromText,
  extractStayDates,
  isCtripHotelDetailUrl,
  isCtripHotelListUrl,
  isCtripHotelUrl,
  parseHotelIdFromUrl
};
