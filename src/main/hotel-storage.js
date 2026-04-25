const { requireSharedCompareAppModule } = require('./shared-compare-app');
const {
  compactHotels,
  expandStoredHotels
} = requireSharedCompareAppModule('hotel-groups.js');

function getExpandedHotelsFromStore(store, normalizeHotelPayload) {
  const rawHotels = store.get('hotels') || [];
  const expandedHotels = expandStoredHotels(rawHotels, normalizeHotelPayload);
  const compactedHotels = compactHotels(expandedHotels, normalizeHotelPayload);

  if (JSON.stringify(rawHotels) !== JSON.stringify(compactedHotels)) {
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
