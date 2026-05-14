const axios = require('axios');
const { DEFAULT_AMAP_KEY } = require('../constants');
const { normalizePlaceName, toNumber } = require('../utils');

const DEFAULT_TRANSIT_TIME = '08:00';

function getDefaultTransitDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function searchPlace(keyword, options = {}) {
  const normalized = normalizePlaceName(keyword);
  if (!normalized) {
    return [];
  }

  const key = options.key || DEFAULT_AMAP_KEY;
  const response = await axios.get('https://restapi.amap.com/v3/place/text', {
    params: {
      key,
      keywords: normalized,
      city: options.city || undefined,
      citylimit: options.city ? true : undefined,
      children: 0,
      offset: 10,
      page: 1,
      extensions: 'base'
    },
    timeout: 20000
  });

  const pois = response.data && response.data.pois;
  if (!Array.isArray(pois)) {
    return [];
  }

  return pois
    .filter((poi) => poi && poi.location)
    .map((poi) => ({
      id: String(poi.id || '').trim(),
      name: String(poi.name || '').trim(),
      type: String(poi.type || '').trim(),
      address: String([poi.pname, poi.cityname, poi.adname, poi.address].filter(Boolean).join(' ')).trim(),
      formattedAddress: String([poi.pname, poi.cityname, poi.adname, poi.address].filter(Boolean).join(' ')).trim() || String(poi.name || '').trim(),
      location: poi.location,
      city: String(poi.cityname || poi.pname || '').trim(),
      query: normalized,
      source: 'place-search'
    }));
}

async function geocodeAddress(address, options = {}) {
  const normalized = normalizePlaceName(address);
  if (!normalized) {
    return null;
  }

  const key = options.key || DEFAULT_AMAP_KEY;
  const response = await axios.get('https://restapi.amap.com/v3/geocode/geo', {
    params: {
      key,
      address: normalized,
      city: options.city || undefined,
      output: 'json'
    },
    timeout: 20000
  });

  const geocodes = response.data && response.data.geocodes;
  if (!Array.isArray(geocodes) || geocodes.length === 0) {
    return null;
  }

  return {
    formattedAddress: geocodes[0].formatted_address,
    location: geocodes[0].location,
    city: geocodes[0].city || geocodes[0].province || '',
    query: normalized,
    source: 'geocode'
  };
}

async function fetchTransitRoute(originLocation, destinationLocation, city, cityd, key = DEFAULT_AMAP_KEY, options = {}) {
  const response = await axios.get('https://restapi.amap.com/v3/direction/transit/integrated', {
    params: {
      key,
      origin: originLocation,
      destination: destinationLocation,
      city,
      cityd,
      strategy: 0,
      nightflag: 0,
      date: options.date || getDefaultTransitDate(),
      time: options.time || DEFAULT_TRANSIT_TIME,
      output: 'json'
    },
    timeout: 20000
  });

  const transits = response.data && response.data.route && response.data.route.transits;
  if (!Array.isArray(transits) || transits.length === 0) {
    return null;
  }

  return transits;
}

async function fetchWalkingRoute(originLocation, destinationLocation, key = DEFAULT_AMAP_KEY) {
  const response = await axios.get('https://restapi.amap.com/v3/direction/walking', {
    params: {
      key,
      origin: originLocation,
      destination: destinationLocation,
      output: 'json'
    },
    timeout: 20000
  });

  const paths = response.data && response.data.route && response.data.route.paths;
  if (!Array.isArray(paths) || paths.length === 0) {
    return null;
  }

  const routePath = paths[0];
  const distanceMeters = toNumber(routePath.distance);
  const durationSeconds = toNumber(routePath.duration);
  const stepTexts = (Array.isArray(routePath.steps) ? routePath.steps : [])
    .map((step) => String((step && step.instruction) || '').trim())
    .filter(Boolean);

  return {
    distanceMeters,
    distanceKm: distanceMeters !== null ? Number(distanceMeters) / 1000 : null,
    durationMinutes: durationSeconds !== null ? Math.round(Number(durationSeconds) / 60) : null,
    cost: 0,
    segmentCount: 0,
    hasSubway: false,
    subwayLineNames: [],
    subwayDistanceKm: 0,
    busRoute: stepTexts.length > 0 && distanceMeters !== null ? `步行${Math.round(distanceMeters)}米` : ''
  };
}

module.exports = {
  DEFAULT_TRANSIT_TIME,
  fetchTransitRoute,
  fetchWalkingRoute,
  geocodeAddress,
  getDefaultTransitDate,
  searchPlace
};
