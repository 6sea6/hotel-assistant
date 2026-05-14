const { extractCityName, includesNormalizedPlace, normalizePlaceName, normalizeText, pickFirst, toNumber } = require('../utils');
const { geocodeAddress, searchPlace } = require('./client');

const X_PI = Math.PI * 3000.0 / 180.0;

function parseLocationPoint(location) {
  const [lngText, latText] = String(location || '').split(',');
  const lng = toNumber(lngText);
  const lat = toNumber(latText);
  if (lng === null || lat === null) {
    return null;
  }
  return { lng, lat };
}

function formatLocationPoint(point) {
  if (!point || point.lng === null || point.lat === null || point.lng === undefined || point.lat === undefined) {
    return '';
  }
  return `${Number(point.lng).toFixed(6)},${Number(point.lat).toFixed(6)}`;
}

function bd09ToGcj02(lng, lat) {
  const x = Number(lng) - 0.0065;
  const y = Number(lat) - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * X_PI);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * X_PI);
  return {
    lng: z * Math.cos(theta),
    lat: z * Math.sin(theta)
  };
}

function normalizeHotelGeoForAmap(hotelGeo, hotelAddress = '') {
  if (!hotelGeo || typeof hotelGeo !== 'object') {
    return null;
  }

  const fallbackPoint = toNumber(hotelGeo.lng) !== null && toNumber(hotelGeo.lat) !== null
    ? {
        lng: Number(hotelGeo.lng),
        lat: Number(hotelGeo.lat)
      }
    : null;
  const rawPoint = parseLocationPoint(hotelGeo.location) || fallbackPoint;
  const mapType = normalizeText(hotelGeo.mapType || hotelGeo.coordinateType).toLowerCase();

  if (!rawPoint && !normalizeText(hotelGeo.location)) {
    return null;
  }

  const normalizedPoint = rawPoint && mapType === 'bd'
    ? bd09ToGcj02(rawPoint.lng, rawPoint.lat)
    : rawPoint;
  const embeddedNearestSubway = normalizeText(hotelGeo && hotelGeo.nearestSubway && hotelGeo.nearestSubway.name)
    ? {
        name: normalizeText(hotelGeo.nearestSubway.name),
        distanceMeters: toNumber(hotelGeo.nearestSubway.distanceMeters),
        distanceKm: pickFirst(
          toNumber(hotelGeo.nearestSubway.distanceKm),
          toNumber(hotelGeo.nearestSubway.distanceMeters) !== null
            ? Number((Number(hotelGeo.nearestSubway.distanceMeters) / 1000).toFixed(1))
            : null
        ),
        source: normalizeText(hotelGeo.nearestSubway.source) || 'ctrip-page'
      }
    : null;

  return {
    formattedAddress: normalizeText(hotelGeo.address || hotelAddress),
    location: normalizedPoint ? formatLocationPoint(normalizedPoint) : normalizeText(hotelGeo.location),
    city: extractCityName(hotelGeo.address || hotelAddress),
    query: normalizeText(hotelGeo.location || hotelGeo.address || hotelAddress),
    source: mapType === 'bd' ? 'hotel-geo-bd09-converted' : 'hotel-geo',
    mapType,
    originalLocation: rawPoint ? formatLocationPoint(rawPoint) : normalizeText(hotelGeo.location),
    nearestSubway: embeddedNearestSubway
  };
}

function chooseBestPlaceCandidate(candidates, keyword, cityHint) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  const normalizedKeyword = normalizePlaceName(keyword);
  const normalizedCity = normalizeText(cityHint).replace(/市$/, '');

  return candidates
    .map((candidate) => {
      const haystack = normalizeText(`${candidate.name} ${candidate.formattedAddress}`);
      let score = 0;
      const exactVenueNames = ['国家会展中心(上海)', '上海国家会展中心', '国家会展中心 上海'];
      const venueSubPoiPattern = /[0-9一二三四五六七八九十]+号馆|[东南西北]门|入口|出口|停车场|F\d+/;
      if (candidate.name && includesNormalizedPlace(candidate.name, normalizedKeyword)) {
        score += 8;
      }
      if (candidate.formattedAddress && includesNormalizedPlace(candidate.formattedAddress, normalizedKeyword)) {
        score += 4;
      }
      if (normalizedCity && haystack.includes(normalizedCity)) {
        score += 3;
      }
      if (/国家会展中心/.test(normalizedKeyword) && /国家会展中心/.test(haystack)) {
        score += 4;
      }
      if (exactVenueNames.some((name) => candidate.name === name)) {
        score += 12;
      }
      if (candidate.name && venueSubPoiPattern.test(candidate.name)) {
        score -= 8;
      }
      if (candidate.formattedAddress && venueSubPoiPattern.test(candidate.formattedAddress)) {
        score -= 4;
      }
      return { candidate, score };
    })
    .sort((left, right) => right.score - left.score)[0]
    .candidate;
}

async function resolvePlace(address, options = {}) {
  const normalized = normalizePlaceName(address);
  if (!normalized) {
    return null;
  }

  const searchKeywords = [normalized];
  if (/^上海国家会展中心$/.test(normalized)) {
    searchKeywords.unshift('国家会展中心(上海)', '国家会展中心 上海');
  }

  for (const keyword of searchKeywords) {
    const candidates = await searchPlace(keyword, options);
    const chosen = chooseBestPlaceCandidate(candidates, normalized, options.city || '');
    if (chosen) {
      return chosen;
    }
  }

  return geocodeAddress(normalized, options);
}

module.exports = {
  bd09ToGcj02,
  normalizeHotelGeoForAmap,
  resolvePlace
};
