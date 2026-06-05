const { DEFAULT_AMAP_KEY } = require('../constants');
const { get } = require('../http-client');
const { normalizePlaceName, toNumber } = require('../utils');

const DEFAULT_TRANSIT_TIME = '08:00';
const AMAP_TIMEOUT_MS = 20000;
const AMAP_RETRIES = 1;
const AMAP_MAX_CONCURRENT_REQUESTS = 3;

let activeAmapRequests = 0;
const amapRequestQueue = [];

function runWithAmapConcurrencyLimit(task) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      activeAmapRequests += 1;
      try {
        resolve(await task());
      } catch (error) {
        reject(error);
      } finally {
        activeAmapRequests -= 1;
        const next = amapRequestQueue.shift();
        if (next) {
          next();
        }
      }
    };

    if (activeAmapRequests < AMAP_MAX_CONCURRENT_REQUESTS) {
      run();
    } else {
      amapRequestQueue.push(run);
    }
  });
}

async function fetchAmapJson(url, params) {
  const response = await runWithAmapConcurrencyLimit(() =>
    get(url, {
      params,
      timeoutMs: AMAP_TIMEOUT_MS,
      retries: AMAP_RETRIES,
      retryDelayMs: 300,
      responseType: 'json',
      headers: {
        accept: 'application/json'
      }
    })
  );
  return response.data;
}

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
  const data = await fetchAmapJson('https://restapi.amap.com/v3/place/text', {
    key,
    keywords: normalized,
    city: options.city || undefined,
    citylimit: options.city ? true : undefined,
    children: 0,
    offset: 10,
    page: 1,
    extensions: 'base'
  });

  const pois = data && data.pois;
  if (!Array.isArray(pois)) {
    return [];
  }

  return pois
    .filter((poi) => poi && poi.location)
    .map((poi) => ({
      id: String(poi.id || '').trim(),
      name: String(poi.name || '').trim(),
      type: String(poi.type || '').trim(),
      address: String(
        [poi.pname, poi.cityname, poi.adname, poi.address].filter(Boolean).join(' ')
      ).trim(),
      formattedAddress:
        String(
          [poi.pname, poi.cityname, poi.adname, poi.address].filter(Boolean).join(' ')
        ).trim() || String(poi.name || '').trim(),
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
  const data = await fetchAmapJson('https://restapi.amap.com/v3/geocode/geo', {
    key,
    address: normalized,
    city: options.city || undefined,
    output: 'json'
  });

  const geocodes = data && data.geocodes;
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

async function fetchTransitRoute(
  originLocation,
  destinationLocation,
  city,
  cityd,
  key = DEFAULT_AMAP_KEY,
  options = {}
) {
  const data = await fetchAmapJson('https://restapi.amap.com/v3/direction/transit/integrated', {
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
  });

  const transits = data && data.route && data.route.transits;
  if (!Array.isArray(transits) || transits.length === 0) {
    return null;
  }

  return transits;
}

async function fetchWalkingRoute(originLocation, destinationLocation, key = DEFAULT_AMAP_KEY) {
  const data = await fetchAmapJson('https://restapi.amap.com/v3/direction/walking', {
    key,
    origin: originLocation,
    destination: destinationLocation,
    output: 'json'
  });

  const paths = data && data.route && data.route.paths;
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
    busRoute:
      stepTexts.length > 0 && distanceMeters !== null ? `步行${Math.round(distanceMeters)}米` : ''
  };
}

module.exports = {
  AMAP_MAX_CONCURRENT_REQUESTS,
  DEFAULT_TRANSIT_TIME,
  fetchTransitRoute,
  fetchWalkingRoute,
  geocodeAddress,
  getDefaultTransitDate,
  searchPlace
};
