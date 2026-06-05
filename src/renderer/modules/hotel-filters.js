/**
 * 筛选与排序 —— 宾馆列表的多条件过滤和显式排序逻辑。
 */

import { idsEqual, hasDisplayValue, normalizeFilterOptionKey } from './dom-helpers.js';

/**
 * @typedef {import('../../shared/contracts').NormalizedHotelRecord} NormalizedHotelRecord
 * @typedef {Record<string, string|number|boolean|null|undefined>} HotelFilters
 */

/**
 * @param {string|null|undefined} distanceStr
 * @returns {number|null}
 */
export function extractDistanceNumber(distanceStr) {
  if (!distanceStr) return null;
  const match = String(distanceStr).match(/(\d+\.?\d*)/);
  return match ? parseFloat(match[1]) : null;
}

/**
 * @param {string|null|undefined} timeStr
 * @returns {number|null}
 */
export function extractTimeNumber(timeStr) {
  if (!timeStr) return null;
  const match = String(timeStr).match(/(\d+)/);
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

/**
 * @param {NormalizedHotelRecord[]} hotels
 * @param {HotelFilters} filters
 * @returns {NormalizedHotelRecord[]}
 */
export function applyFiltersToHotels(hotels, filters) {
  const normalizedNameFilter = normalizeFilterOptionKey(filters.name);

  return hotels.filter((hotel) => {
    const derived = hotel._derived;

    if (normalizedNameFilter) {
      const hotelNameKey = derived?.nameKey ?? normalizeFilterOptionKey(hotel.name);
      if (hotelNameKey !== normalizedNameFilter) return false;
    }

    if (filters.score && filters.score !== '') {
      const minScore = parseFloat(String(filters.score));
      if (Number.isFinite(minScore)) {
        const hotelScore = derived?.scoreNumber ?? (Number.isFinite(Number(hotel.ctrip_score)) && Number(hotel.ctrip_score) > 0 ? Number(hotel.ctrip_score) : null);
        if (hotelScore === null || hotelScore < minScore) {
          return false;
        }
      }
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
      const maxTime = parseInt(String(filters.transportTime));
      const hotelTime = derived?.transportTimeNumber ?? extractTimeNumber(hotel.transport_time);
      if (hotelTime === null || hotelTime > maxTime) {
        return false;
      }
    }

    if (filters.subwayDistance && filters.subwayDistance !== '') {
      const hotelSubwayDistance = derived?.subwayDistanceNumber ?? extractDistanceNumber(hotel.subway_distance);

      if (filters.subwayDistance === 'none') {
        if (hotelSubwayDistance !== 0) {
          return false;
        }
      } else {
        const maxDistance = parseFloat(String(filters.subwayDistance));
        if (
          hotelSubwayDistance === null ||
          hotelSubwayDistance === 0 ||
          hotelSubwayDistance > maxDistance
        ) {
          return false;
        }
      }
    }

    return true;
  });
}

export const DEFAULT_SORT_MODE = 'review_high';

/**
 * @param {NormalizedHotelRecord[]} hotels
 * @returns {{hotel: NormalizedHotelRecord, index: number}[]}
 */
function withOriginalIndex(hotels) {
  return hotels.map((hotel, index) => ({ hotel, index }));
}

/**
 * @param {number|null|undefined} aValue
 * @param {number|null|undefined} bValue
 * @param {'asc'|'desc'} [direction]
 * @returns {number}
 */
function compareMissingLast(aValue, bValue, direction = 'asc') {
  const aMissing = aValue === null || aValue === undefined || Number.isNaN(aValue);
  const bMissing = bValue === null || bValue === undefined || Number.isNaN(bValue);

  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;

  return direction === 'desc' ? bValue - aValue : aValue - bValue;
}

/**
 * @param {NormalizedHotelRecord} hotel
 * @returns {number|null}
 */
function getTotalPriceNumber(hotel) {
  if (hotel._derived) return hotel._derived.totalPriceNumber;
  const value = Number(hotel.total_price);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * @param {NormalizedHotelRecord} hotel
 * @returns {number|null}
 */
function getScoreNumber(hotel) {
  if (hotel._derived) return hotel._derived.scoreNumber;
  const value = Number(hotel.ctrip_score);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * @param {NormalizedHotelRecord} hotel
 * @returns {number|null}
 */
function getDistanceNumberForSort(hotel) {
  if (hotel._derived) return hotel._derived.distanceNumber;
  const value = extractDistanceNumber(hotel.distance);
  return Number.isFinite(value) ? value : null;
}

/**
 * 统一排序函数，列表渲染和导出排名图片复用。
 * @param {NormalizedHotelRecord[]} hotels
 * @param {string} [sortMode]
 * @returns {NormalizedHotelRecord[]}
 */
export function sortHotels(hotels = [], sortMode = DEFAULT_SORT_MODE) {
  const mode = sortMode || DEFAULT_SORT_MODE;

  return withOriginalIndex(hotels)
    .sort((a, b) => {
      let result = 0;

      switch (mode) {
        case 'price_low':
          result = compareMissingLast(getTotalPriceNumber(a.hotel), getTotalPriceNumber(b.hotel), 'asc');
          break;
        case 'price_high':
          result = compareMissingLast(getTotalPriceNumber(a.hotel), getTotalPriceNumber(b.hotel), 'desc');
          break;
        case 'distance_near':
          result = compareMissingLast(getDistanceNumberForSort(a.hotel), getDistanceNumberForSort(b.hotel), 'asc');
          break;
        case 'review_high':
        default:
          result = compareMissingLast(getScoreNumber(a.hotel), getScoreNumber(b.hotel), 'desc');
          break;
      }

      if (result !== 0) return result;

      const priceTieBreak = compareMissingLast(
        getTotalPriceNumber(a.hotel),
        getTotalPriceNumber(b.hotel),
        'asc'
      );
      if (priceTieBreak !== 0) return priceTieBreak;

      return a.index - b.index;
    })
    .map((item) => item.hotel);
}

/**
 * @param {NormalizedHotelRecord[]} [sourceHotels]
 * @returns {{hotelCount: number, roomTypeCount: number}}
 */
export function getVisibleHotelSummary(sourceHotels = []) {
  const hotelKeys = new Set();
  const roomTypeKeys = new Set();

  sourceHotels.forEach((hotel, index) => {
    const derived = hotel?._derived;
    const hotelIdentity = derived?.hotelIdentityKey
      ?? (normalizeFilterOptionKey(hotel?.name) || `hotel:${String(hotel?.id ?? index)}`);

    hotelKeys.add(hotelIdentity);

    const roomTypeKey =
      derived?.originalRoomTypeKey
      || derived?.roomTypeKey
      || normalizeFilterOptionKey(hotel?.original_room_type)
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
