const { DEFAULT_AMAP_KEY } = require('../constants');
const { extractCityName, normalizePlaceName, normalizeText, pickFirst, toNumber } = require('../utils');
const { DEFAULT_TRANSIT_TIME, fetchTransitRoute, fetchWalkingRoute, geocodeAddress, getDefaultTransitDate } = require('./client');
const { normalizeHotelGeoForAmap, resolvePlace } = require('./place');
const { searchNearestSubwayDistanceKm } = require('./subway');

function getSegmentWalkingDistanceMeters(segment) {
  const walkingDistance = toNumber(segment && segment.walking && segment.walking.distance);
  return walkingDistance !== null ? walkingDistance : 0;
}

function getSegmentBusLines(segment) {
  return Array.isArray(segment && segment.bus && segment.bus.buslines) ? segment.bus.buslines : [];
}

function isSubwayLineName(lineName, lineType) {
  if (lineType) {
    const normalizedType = normalizeText(lineType);
    if (/地铁|轨道交通/.test(normalizedType)) return true;
    if (/公交/.test(normalizedType)) return false;
  }
  return /^地铁|^轨道交通|^\d+号线/.test(normalizeText(lineName));
}

function extractSubwayLineNames(route) {
  const segments = Array.isArray(route && route.segments) ? route.segments : [];
  const lineNames = [];

  for (const segment of segments) {
    const busLines = getSegmentBusLines(segment);
    for (const busLine of busLines) {
      const lineName = normalizeText(busLine && (busLine.name || busLine.nameZh || ''));
      const lineType = normalizeText(busLine && busLine.type);
      if (isSubwayLineName(lineName, lineType)) {
        lineNames.push(lineName);
      }
    }
  }

  return [...new Set(lineNames)];
}

function routeHasSubwaySegment(route) {
  return extractSubwayLineNames(route).length > 0;
}

function extractNearestSubwayDistanceKm(route) {
  const segments = Array.isArray(route && route.segments) ? route.segments : [];

  for (const segment of segments) {
    const busLines = getSegmentBusLines(segment);
    if (!busLines.some((line) => isSubwayLineName(line && (line.name || line.nameZh || ''), line && line.type))) {
      continue;
    }

    const walkingDistanceMeters = getSegmentWalkingDistanceMeters(segment);
    return Number((walkingDistanceMeters / 1000).toFixed(3));
  }

  return 0;
}

function formatWalkingStep(distanceMeters, prefix = '步行') {
  const numericDistance = toNumber(distanceMeters);
  if (numericDistance === null || numericDistance <= 0) {
    return '';
  }
  return `${prefix}${Math.round(numericDistance)}米`;
}

function formatBusLineStep(busLine) {
  const lineName = normalizeText(busLine && (busLine.name || busLine.nameZh || ''));
  if (!lineName) {
    return '';
  }

  const departureStop = normalizeText(busLine && busLine.departure_stop && busLine.departure_stop.name);
  const arrivalStop = normalizeText(busLine && busLine.arrival_stop && busLine.arrival_stop.name);
  const viaCount = toNumber(busLine && busLine.via_num);
  const stopRange = departureStop && arrivalStop
    ? `${departureStop} -> ${arrivalStop}`
    : pickFirst(departureStop, arrivalStop, '');
  const stopCount = viaCount !== null ? `${viaCount}站` : '';

  return normalizeText([
    `乘${lineName}`,
    stopRange ? `(${stopRange})` : '',
    stopCount
  ].filter(Boolean).join(' '));
}

function buildTransitRouteText(route) {
  const segments = Array.isArray(route && route.segments) ? route.segments : [];
  const steps = [];

  for (const segment of segments) {
    const walkingStep = formatWalkingStep(getSegmentWalkingDistanceMeters(segment));
    if (walkingStep) {
      steps.push(walkingStep);
    }

    const busLines = getSegmentBusLines(segment);
    if (busLines.length > 0) {
      const busStep = formatBusLineStep(busLines[0]);
      if (busStep) {
        steps.push(busStep);
      }
    }

    const railwayName = normalizeText(segment && segment.railway && segment.railway.name);
    if (railwayName) {
      steps.push(`乘${railwayName}`);
    }
  }

  return steps.join('\n');
}

function normalizeTransitRoutes(transits) {
  return transits
    .map((item) => ({
      distanceKm: toNumber(item.distance) !== null ? Number(item.distance) / 1000 : null,
      durationMinutes: toNumber(item.duration) !== null ? Math.round(Number(item.duration) / 60) : null,
      nightflag: item.nightflag,
      cost: toNumber(item.cost),
      segmentCount: Array.isArray(item.segments) ? item.segments.length : 0,
      hasSubway: routeHasSubwaySegment(item),
      subwayLineNames: extractSubwayLineNames(item),
      subwayDistanceKm: extractNearestSubwayDistanceKm(item),
      busRoute: buildTransitRouteText(item)
    }))
    .sort((left, right) => {
      if (left.hasSubway !== right.hasSubway) {
        return left.hasSubway ? -1 : 1;
      }
      const leftDuration = left.durationMinutes ?? Number.MAX_SAFE_INTEGER;
      const rightDuration = right.durationMinutes ?? Number.MAX_SAFE_INTEGER;
      if (leftDuration !== rightDuration) {
        return leftDuration - rightDuration;
      }
      if (left.segmentCount !== right.segmentCount) {
        return left.segmentCount - right.segmentCount;
      }
      const leftCost = left.cost ?? Number.MAX_SAFE_INTEGER;
      const rightCost = right.cost ?? Number.MAX_SAFE_INTEGER;
      if (leftCost !== rightCost) {
        return leftCost - rightCost;
      }
      const leftDist = left.distanceKm ?? Number.MAX_SAFE_INTEGER;
      const rightDist = right.distanceKm ?? Number.MAX_SAFE_INTEGER;
      return leftDist - rightDist;
    })[0] || null;
}

async function getTransitInfo(hotelAddress, destination, key = DEFAULT_AMAP_KEY, options = {}) {
  const hotelGeo = normalizeHotelGeoForAmap(options.hotelGeo, hotelAddress);

  const origin = hotelGeo || await geocodeAddress(hotelAddress, { key });
  const embeddedNearestSubway = hotelGeo && hotelGeo.nearestSubway ? hotelGeo.nearestSubway : null;
  const destinationCity = pickFirst(extractCityName(destination), extractCityName(origin && origin.formattedAddress), extractCityName(hotelAddress));
  const normalizedDestination = normalizePlaceName(destination);

  if (!origin) {
    return {
      origin: null,
      target: null,
      route: null,
      nearestSubway: null,
      query: {
        origin: normalizeText(hotelAddress),
        destination: normalizedDestination,
        destinationCity: destinationCity || '',
        originSource: '',
        destinationSource: ''
      }
    };
  }

  if (!normalizedDestination) {
    const nearestSubway = embeddedNearestSubway || await searchNearestSubwayDistanceKm(origin.location, key);
    return {
      origin,
      target: null,
      route: null,
      nearestSubway,
      query: {
        origin: normalizeText(hotelAddress),
        destination: '',
        destinationCity: '',
        originSource: origin.source || '',
        destinationSource: '',
        transitDate: options.date || getDefaultTransitDate(),
        transitTime: options.time || DEFAULT_TRANSIT_TIME,
        destinationSkipped: true
      }
    };
  }

  const target = await resolvePlace(normalizedDestination, {
    key,
    city: destinationCity || origin?.city || undefined
  });

  if (!target) {
    return {
      origin,
      target,
      route: null,
      nearestSubway: embeddedNearestSubway || await searchNearestSubwayDistanceKm(origin.location, key),
      query: {
        origin: normalizeText(hotelAddress),
        destination: normalizedDestination,
        destinationCity: destinationCity || '',
        originSource: origin ? origin.source : '',
        destinationSource: target ? target.source : ''
      }
    };
  }

  const [walkRoute, transitRoutes, nearestSubway] = await Promise.all([
    fetchWalkingRoute(origin.location, target.location, key),
    fetchTransitRoute(
      origin.location,
      target.location,
      origin.city || destinationCity || target.city || '',
      target.city || destinationCity || origin.city || '',
      key,
      {
        date: options.date,
        time: options.time || DEFAULT_TRANSIT_TIME
      }
    ),
    embeddedNearestSubway
      ? Promise.resolve(embeddedNearestSubway)
      : searchNearestSubwayDistanceKm(origin.location, key)
  ]);

  const busRoute = normalizeTransitRoutes(transitRoutes || []);
  const walkMinutes = walkRoute?.durationMinutes ?? Number.MAX_SAFE_INTEGER;
  const busMinutes = busRoute?.durationMinutes ?? Number.MAX_SAFE_INTEGER;
  const route = walkMinutes <= busMinutes ? walkRoute : busRoute;

  return {
    origin,
    target,
    route,
    nearestSubway,
    query: {
      origin: normalizeText(hotelAddress),
      destination: normalizedDestination,
      destinationCity: destinationCity || '',
      originSource: origin ? origin.source : '',
      destinationSource: target ? target.source : '',
      transitDate: options.date || getDefaultTransitDate(),
      transitTime: options.time || DEFAULT_TRANSIT_TIME
    }
  };
}

module.exports = {
  getTransitInfo
};
