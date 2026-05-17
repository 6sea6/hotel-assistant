const { requireSharedCompareAppModule } = require('./shared-compare-app');
const { compactHotels, expandStoredHotels } = requireSharedCompareAppModule('hotel-groups.js');
const { hasNormalizedValueChanged } = require('./normalization-utils');

function getExpandedHotelsFromStore(store, normalizeHotelPayload) {
  const rawHotels = store.get('hotels') || [];
  const expandedHotels = expandStoredHotels(rawHotels, normalizeHotelPayload);
  const compactedHotels = compactHotels(expandedHotels, normalizeHotelPayload);

  if (hasNormalizedValueChanged(rawHotels, compactedHotels)) {
    store.set('hotels', compactedHotels);
  }

  return expandedHotels;
}

function setExpandedHotelsToStore(store, hotels, normalizeHotelPayload) {
  store.set('hotels', compactHotels(hotels, normalizeHotelPayload));
}

module.exports = {
  compactHotels,
  expandStoredHotels,
  getExpandedHotelsFromStore,
  setExpandedHotelsToStore
};
