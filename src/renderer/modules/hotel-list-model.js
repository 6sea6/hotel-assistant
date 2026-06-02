/**
 * 宾馆列表数据模型 —— 统一管理可见列表、摘要和缓存命中逻辑。
 */

import { state, visibleHotelsCache, buildVisibleHotelsFiltersKey } from './state.js';
import {
  applyFiltersToHotels,
  sortHotels,
  DEFAULT_SORT_MODE,
  getVisibleHotelSummary
} from './hotel-filters.js';

export function getVisibleHotelsCacheKey(filters = state.currentFilters) {
  return buildVisibleHotelsFiltersKey(filters);
}

export function getSortedVisibleHotels() {
  const sortMode = String(state.currentFilters.sortMode || DEFAULT_SORT_MODE);
  const filtersKey = getVisibleHotelsCacheKey(state.currentFilters);

  if (
    visibleHotelsCache.data &&
    visibleHotelsCache.hotelsVersion === state.hotelsVersion &&
    visibleHotelsCache.filtersKey === filtersKey &&
    visibleHotelsCache.sortMode === sortMode
  ) {
    visibleHotelsCache.hitCount += 1;
    return visibleHotelsCache.data;
  }

  visibleHotelsCache.missCount += 1;
  const filteredHotels = applyFiltersToHotels(state.hotels, state.currentFilters);
  const sortedHotels = sortHotels(filteredHotels, sortMode);

  visibleHotelsCache.data = sortedHotels;
  visibleHotelsCache.hotelsVersion = state.hotelsVersion;
  visibleHotelsCache.filtersKey = filtersKey;
  visibleHotelsCache.sortMode = sortMode;

  return sortedHotels;
}

export function getVisibleHotelListSummary(sortedHotels = getSortedVisibleHotels()) {
  return getVisibleHotelSummary(sortedHotels);
}
