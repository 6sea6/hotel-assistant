/**
 * 筛选与排名 —— 宾馆列表的多条件过滤和加权评分排名。
 */

import { state, rankingCache } from './state.js';
import { getValue, idsEqual, hasDisplayValue, normalizeFilterOptionKey } from './dom-helpers.js';

export function extractDistanceNumber(distanceStr) {
  if (!distanceStr) return null;
  const match = distanceStr.match(/(\d+\.?\d*)/);
  return match ? parseFloat(match[1]) : null;
}

export function extractTimeNumber(timeStr) {
  if (!timeStr) return null;
  const match = timeStr.match(/(\d+)/);
  return match ? parseInt(match[1]) : null;
}

export function formatDistanceValue(distance, unit = '公里') {
  return hasDisplayValue(distance) ? `${String(distance).trim()} ${unit}` : '-';
}

export function formatTransportValue(time, unit = '分钟') {
  return hasDisplayValue(time) ? `${String(time).trim()} ${unit}` : '-';
}

export function formatSubwayDistanceValue(distance, unit = '公里') {
  if (!hasDisplayValue(distance)) return '-';
  const parsed = extractDistanceNumber(String(distance));
  if (parsed === 0) return '无较近地铁站';
  return `${String(distance).trim()} ${unit}`;
}

export function formatSubwayInfo(station, distance, unit = '公里') {
  const normalizedStation = hasDisplayValue(station) ? String(station).trim() : '';
  if (!hasDisplayValue(distance)) {
    return normalizedStation || '-';
  }
  const parsedDistance = extractDistanceNumber(String(distance));
  if (parsedDistance === 0) {
    return '无较近地铁站';
  }
  const distanceText = `${String(distance).trim()} ${unit}`;
  return normalizedStation ? `${normalizedStation} · ${distanceText}` : distanceText;
}

export function computeHotelsHash(hotels) {
  let hash = hotels.length;
  for (let i = 0; i < hotels.length; i++) {
    const h = hotels[i];
    hash = ((hash << 5) - hash + (h.id || 0)) | 0;
    hash = ((hash << 5) - hash + (h.daily_price || 0)) | 0;
    hash = ((hash << 5) - hash + (h.ctrip_score || 0)) | 0;
    hash = ((hash << 5) - hash + (h.is_favorite || 0)) | 0;
  }
  return hash;
}

export function applyFiltersToHotels(hotels, filters) {
  const normalizedNameFilter = normalizeFilterOptionKey(filters.name);

  return hotels.filter(hotel => {
    if (normalizedNameFilter && normalizeFilterOptionKey(hotel.name) !== normalizedNameFilter) {
      return false;
    }

    if (filters.score && hotel.ctrip_score < parseFloat(filters.score)) {
      return false;
    }

    if (filters.favorite !== undefined && filters.favorite !== '') {
      const isFavorite = hotel.is_favorite === 1;
      if (filters.favorite === '1' && !isFavorite) return false;
      if (filters.favorite === '0' && isFavorite) return false;
    }

    if (filters.template) {
      const hotelTemplateId = hotel.template_id ?? hotel.template_info?.id;
      if (hotelTemplateId == null || !idsEqual(hotelTemplateId, filters.template)) {
        return false;
      }
    }

    if (filters.transportTime && filters.transportTime !== '') {
      const maxTime = parseInt(filters.transportTime);
      const hotelTime = extractTimeNumber(hotel.transport_time);
      if (hotelTime === null || hotelTime > maxTime) {
        return false;
      }
    }

    if (filters.subwayDistance && filters.subwayDistance !== '') {
      const hotelSubwayDistance = extractDistanceNumber(hotel.subway_distance);

      if (filters.subwayDistance === 'none') {
        if (hotelSubwayDistance !== 0) {
          return false;
        }
      } else {
        const maxDistance = parseFloat(filters.subwayDistance);
        if (hotelSubwayDistance === null || hotelSubwayDistance === 0 || hotelSubwayDistance > maxDistance) {
          return false;
        }
      }
    }

    return true;
  });
}

export function rankHotels(hotels) {
  if (hotels.length === 0) return [];

  const weights = state.rankingMode === 'manual' ? {
    price: parseFloat(getValue('weightPrice', 0.25)),
    score: parseFloat(getValue('weightScore', 0.35)),
    distance: parseFloat(getValue('weightDistance', 0.2)),
    transport: parseFloat(getValue('weightTransport', 0.2))
  } : {
    price: parseFloat(state.settings.weight_price || 0.25),
    score: parseFloat(state.settings.weight_score || 0.35),
    distance: parseFloat(state.settings.weight_distance || 0.2),
    transport: parseFloat(state.settings.weight_transport || 0.2)
  };

  const weightsKey = `${weights.price}-${weights.score}-${weights.distance}-${weights.transport}`;
  const filtersKey = state.currentFilters.name || '';
  const hotelsHash = computeHotelsHash(hotels);

  if (rankingCache.data &&
      rankingCache.hotelsHash === hotelsHash &&
      rankingCache.filters === filtersKey &&
      rankingCache.weights === weightsKey) {
    return rankingCache.data;
  }

  let maxPrice = 0, minPrice = Infinity;
  let maxDistance = 0, minDistance = Infinity;
  let maxTime = 0, minTime = Infinity;

  for (let i = 0; i < hotels.length; i++) {
    const hotel = hotels[i];
    if (hotel.daily_price) {
      maxPrice = Math.max(maxPrice, hotel.daily_price);
      minPrice = Math.min(minPrice, hotel.daily_price);
    }
    if (hotel.distance) {
      const dist = extractDistanceNumber(hotel.distance);
      if (dist !== null) {
        maxDistance = Math.max(maxDistance, dist);
        minDistance = Math.min(minDistance, dist);
      }
    }
    if (hotel.transport_time) {
      const time = extractTimeNumber(hotel.transport_time);
      if (time !== null) {
        maxTime = Math.max(maxTime, time);
        minTime = Math.min(minTime, time);
      }
    }
  }

  const priceRange = maxPrice - minPrice;
  const distanceRange = maxDistance - minDistance;
  const timeRange = maxTime - minTime;

  const scoredHotels = hotels.map(hotel => {
    let score = 0;

    if (hotel.daily_price && priceRange > 0) {
      score += (1 - (hotel.daily_price - minPrice) / priceRange) * weights.price;
    }

    if (hotel.ctrip_score) {
      score += (hotel.ctrip_score / 5) * weights.score;
    }

    if (hotel.distance && distanceRange > 0) {
      const distance = extractDistanceNumber(hotel.distance);
      if (distance !== null) {
        score += (1 - (distance - minDistance) / distanceRange) * weights.distance;
      }
    }

    if (hotel.transport_time && timeRange > 0) {
      const time = extractTimeNumber(hotel.transport_time);
      if (time !== null) {
        score += (1 - (time - minTime) / timeRange) * weights.transport;
      }
    }

    return { ...hotel, score };
  });

  const result = scoredHotels.sort((a, b) => b.score - a.score);

  rankingCache.data = result;
  rankingCache.hotelsHash = hotelsHash;
  rankingCache.filters = filtersKey;
  rankingCache.weights = weightsKey;

  return result;
}

export function getVisibleHotelSummary(sourceHotels = []) {
  const hotelKeys = new Set();
  const roomTypeKeys = new Set();

  sourceHotels.forEach((hotel, index) => {
    const hotelNameKey = normalizeFilterOptionKey(hotel?.name);
    const hotelIdentity = hotelNameKey || `hotel:${String(hotel?.id ?? index)}`;

    hotelKeys.add(hotelIdentity);

    const roomTypeKey = normalizeFilterOptionKey(hotel?.original_room_type)
      || normalizeFilterOptionKey(hotel?.room_type);

    if (roomTypeKey) {
      roomTypeKeys.add(`${hotelIdentity}::${roomTypeKey}`);
      return;
    }

    roomTypeKeys.add(`room:${String(hotel?.id ?? index)}`);
  });

  return {
    hotelCount: hotelKeys.size,
    roomTypeCount: roomTypeKeys.size
  };
}
