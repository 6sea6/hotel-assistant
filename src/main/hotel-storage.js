const { requireSharedCompareAppModule } = require('./shared-compare-app');
const { hasNormalizedValueChanged } = require('./normalization-utils');

/**
 * @typedef {import('../shared/contracts').RawHotelRecord} RawHotelRecord
 * @typedef {import('../shared/contracts').NormalizedHotelRecord} NormalizedHotelRecord
 */

/**
 * @typedef {(hotel?: Partial<RawHotelRecord>, existingHotel?: Partial<RawHotelRecord>) => NormalizedHotelRecord} NormalizeHotelPayload
 */

/**
 * @typedef {{get: (key: string) => unknown, set: (key: string, value: unknown) => void}} HotelStore
 */

/**
 * @typedef {{shared: Partial<NormalizedHotelRecord>, rooms: Array<Partial<NormalizedHotelRecord>>}} CompactHotelGroup
 */

/** @type {{
 *   compactHotels: (hotels?: Array<Partial<RawHotelRecord>|NormalizedHotelRecord>, normalizeHotelPayload?: NormalizeHotelPayload) => CompactHotelGroup[],
 *   expandStoredHotels: (rawHotels?: unknown, normalizeHotelPayload?: NormalizeHotelPayload) => NormalizedHotelRecord[]
 * }} */
const hotelGroups = requireSharedCompareAppModule('hotel-groups.js');
const { compactHotels, expandStoredHotels } = hotelGroups;

/**
 * @param {HotelStore} store
 * @param {NormalizeHotelPayload} normalizeHotelPayload
 * @returns {NormalizedHotelRecord[]}
 */
function getExpandedHotelsFromStore(store, normalizeHotelPayload) {
  const rawHotels = store.get('hotels') || [];
  const expandedHotels = expandStoredHotels(rawHotels, normalizeHotelPayload);
  const compactedHotels = compactHotels(expandedHotels, normalizeHotelPayload);

  if (hasNormalizedValueChanged(rawHotels, compactedHotels)) {
    store.set('hotels', compactedHotels);
  }

  return expandedHotels;
}

/**
 * @param {HotelStore} store
 * @param {NormalizedHotelRecord[]} hotels
 * @param {NormalizeHotelPayload} normalizeHotelPayload
 * @returns {void}
 */
function setExpandedHotelsToStore(store, hotels, normalizeHotelPayload) {
  store.set('hotels', compactHotels(hotels, normalizeHotelPayload));
}

module.exports = {
  compactHotels,
  expandStoredHotels,
  getExpandedHotelsFromStore,
  setExpandedHotelsToStore
};
