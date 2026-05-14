const axios = require('axios');
const { DEFAULT_AMAP_KEY } = require('../constants');
const { normalizeText, toNumber } = require('../utils');
const { fetchWalkingRoute } = require('./client');

function normalizeSubwayStationName(name) {
  return normalizeText(name)
    .replace(/\(地铁站\)/g, '地铁站')
    .replace(/地铁站([A-Z])口$/i, '地铁站')
    .replace(/地铁站出入口$/i, '地铁站')
    .trim();
}

function isStationLevelSubwayPoi(poi) {
  const type = normalizeText(poi && poi.type);
  return type.includes('地铁站;地铁站') && !type.includes('出入口');
}

function buildSubwayStationCandidates(pois) {
  if (!Array.isArray(pois) || pois.length === 0) {
    return [];
  }

  const grouped = new Map();
  for (const poi of pois) {
    const distanceMeters = toNumber(poi && poi.distance);
    const stationName = normalizeSubwayStationName(poi && poi.name);
    const poiLocation = normalizeText(poi && poi.location);
    if (distanceMeters === null || distanceMeters <= 0 || !stationName) {
      continue;
    }

    const existing = grouped.get(stationName) || {
      name: stationName,
      nearestAnyDistanceMeters: null,
      nearestAnyLocation: '',
      nearestStationDistanceMeters: null,
      nearestStationLocation: ''
    };

    if (existing.nearestAnyDistanceMeters === null || distanceMeters < existing.nearestAnyDistanceMeters) {
      existing.nearestAnyDistanceMeters = distanceMeters;
      existing.nearestAnyLocation = poiLocation;
    }
    if (
      isStationLevelSubwayPoi(poi)
      && (existing.nearestStationDistanceMeters === null || distanceMeters < existing.nearestStationDistanceMeters)
    ) {
      existing.nearestStationDistanceMeters = distanceMeters;
      existing.nearestStationLocation = poiLocation;
    }

    grouped.set(stationName, existing);
  }

  return [...grouped.values()]
    .map((item) => {
      const distanceMeters = item.nearestStationDistanceMeters ?? item.nearestAnyDistanceMeters;
      return distanceMeters === null ? null : {
        name: item.name,
        distanceMeters,
        distanceKm: Number((distanceMeters / 1000).toFixed(1)),
        stationLocation: item.nearestStationLocation || '',
        anyLocation: item.nearestAnyLocation || ''
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.distanceMeters - right.distanceMeters);
}

function pickNearestSubwayStation(pois) {
  const candidate = buildSubwayStationCandidates(pois)[0];

  return candidate ? {
    name: candidate.name,
    distanceMeters: candidate.distanceMeters,
    distanceKm: candidate.distanceKm
  } : null;
}

async function resolveNearestSubwayByWalking(originLocation, candidates, key = DEFAULT_AMAP_KEY) {
  const shortlist = Array.isArray(candidates) ? candidates.slice(0, 3) : [];
  if (!originLocation || shortlist.length === 0) {
    return null;
  }

  const walkingCandidates = (await Promise.all(shortlist.map(async (candidate) => {
    const locationsToTry = [...new Set([
      normalizeText(candidate && candidate.stationLocation),
      normalizeText(candidate && candidate.anyLocation)
    ].filter(Boolean))];

    for (const destinationLocation of locationsToTry) {
      const route = await fetchWalkingRoute(originLocation, destinationLocation, key);
      const distanceMeters = toNumber(route && route.distanceMeters);
      if (distanceMeters === null || distanceMeters <= 0) {
        continue;
      }

      return {
        name: candidate.name,
        distanceMeters,
        distanceKm: Number((distanceMeters / 1000).toFixed(1))
      };
    }

    return null;
  }))).filter(Boolean);

  if (walkingCandidates.length === 0) {
    return null;
  }

  walkingCandidates.sort((left, right) => left.distanceMeters - right.distanceMeters);
  return walkingCandidates[0];
}

async function searchNearestSubwayDistanceKm(location, key = DEFAULT_AMAP_KEY) {
  if (!location) {
    return null;
  }

  try {
    const response = await axios.get('https://restapi.amap.com/v3/place/around', {
      params: {
        key,
        location,
        types: '150500',
        radius: 10000,
        sortrule: 'distance',
        offset: 10,
        page: 1,
        extensions: 'base'
      },
      timeout: 20000
    });

    const pois = response.data && response.data.pois;
    if (!Array.isArray(pois) || pois.length === 0) {
      return null;
    }

    const subwayCandidates = buildSubwayStationCandidates(pois);
    const walkingNearest = await resolveNearestSubwayByWalking(location, subwayCandidates, key);
    return walkingNearest || pickNearestSubwayStation(pois);
  } catch (_error) {
    return null;
  }
}

module.exports = {
  buildSubwayStationCandidates,
  normalizeSubwayStationName,
  pickNearestSubwayStation,
  searchNearestSubwayDistanceKm
};
