const hotelStorage = require('../hotel-storage');
const { hasNormalizedValueChanged } = require('../normalization-utils');
const { allocateUniqueId, getIdKey, idsEqual } = require('../../shared/id-utils');

/**
 * @typedef {import('../../shared/contracts').RawHotelRecord} RawHotelRecord
 * @typedef {import('../../shared/contracts').NormalizedHotelRecord} NormalizedHotelRecord
 * @typedef {import('../../shared/contracts').EntityId} EntityId
 *
 * @typedef {{get: (key: string) => unknown, set: (key: string, value: unknown) => void}} RepositoryStore
 * @typedef {(hotel?: Partial<RawHotelRecord>, existingHotel?: Partial<RawHotelRecord>) => NormalizedHotelRecord} NormalizeHotelPayload
 *
 * @typedef {object} HotelDeleteResult
 * @property {number} deletedCount
 * @property {NormalizedHotelRecord[]} hotels
 *
 * @typedef {object} HotelRepository
 * @property {() => NormalizedHotelRecord[]} getAll
 * @property {(id: EntityId) => NormalizedHotelRecord|undefined} getById
 * @property {(payload: Partial<RawHotelRecord>) => NormalizedHotelRecord} add
 * @property {(payload: Partial<RawHotelRecord>) => NormalizedHotelRecord|null} update
 * @property {(payloads: Array<Partial<RawHotelRecord>>) => NormalizedHotelRecord[]} updateMany
 * @property {(id: EntityId) => HotelDeleteResult} deleteById
 * @property {(ids: EntityId[]) => HotelDeleteResult} deleteMany
 * @property {(hotels: Array<Partial<RawHotelRecord>|NormalizedHotelRecord>) => NormalizedHotelRecord[]} replaceAll
 * @property {() => unknown[]} getCompactedForExport
 * @property {NormalizeHotelPayload} normalize
 * @property {(id: unknown) => boolean} hasValidId
 */

/**
 * @param {unknown} id
 * @returns {boolean}
 */
function hasValidId(id) {
  const idKey = getIdKey(id);
  return Boolean(idKey && idKey !== 'undefined' && idKey !== 'null');
}

/**
 * @param {{store: RepositoryStore, normalizeHotelPayload: NormalizeHotelPayload}} options
 * @returns {HotelRepository}
 */
function createHotelRepository({ store, normalizeHotelPayload }) {
  const writeAll = (hotels) => {
    hotelStorage.setExpandedHotelsToStore(store, hotels, normalizeHotelPayload);
  };

  const getAll = () => {
    const hotels = hotelStorage.getExpandedHotelsFromStore(store, normalizeHotelPayload);
    const usedIds = new Set();
    const nextIdState = { value: Date.now() };
    let shouldWriteBack = false;
    const normalizedHotels = hotels.map((hotel) => {
      const normalizedHotel = normalizeHotelPayload(hotel);
      if (hasNormalizedValueChanged(hotel, normalizedHotel)) {
        shouldWriteBack = true;
      }

      const normalizedIdKey = getIdKey(normalizedHotel.id);

      if (!normalizedIdKey || usedIds.has(normalizedIdKey)) {
        normalizedHotel.id = allocateUniqueId(normalizedHotel.id, usedIds, nextIdState);
        shouldWriteBack = true;
      } else {
        usedIds.add(normalizedIdKey);
      }

      return normalizedHotel;
    });

    if (shouldWriteBack) {
      writeAll(normalizedHotels);
    }

    return normalizedHotels;
  };

  return {
    getAll,
    getById(id) {
      return getAll().find((hotel) => idsEqual(hotel.id, id));
    },
    add(payload) {
      const hotels = getAll();
      const usedIds = new Set(hotels.map((item) => String(item.id)));
      const nextIdState = { value: Date.now() };
      const newHotel = normalizeHotelPayload({
        ...payload,
        id: allocateUniqueId(payload.id ?? null, usedIds, nextIdState),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      hotels.push(newHotel);
      writeAll(hotels);
      return newHotel;
    },
    update(payload) {
      const hotels = getAll();
      const index = hotels.findIndex((hotel) => idsEqual(hotel.id, payload.id));
      if (index === -1) {
        return null;
      }

      hotels[index] = normalizeHotelPayload(
        {
          ...payload,
          updated_at: new Date().toISOString()
        },
        hotels[index]
      );
      writeAll(hotels);
      return hotels[index];
    },
    updateMany(payloads) {
      const allHotels = getAll();
      const results = [];

      for (const payload of payloads) {
        const index = allHotels.findIndex((hotel) => idsEqual(hotel.id, payload.id));
        if (index !== -1) {
          allHotels[index] = normalizeHotelPayload(
            {
              ...payload,
              updated_at: new Date().toISOString()
            },
            allHotels[index]
          );
          results.push(allHotels[index]);
        }
      }

      writeAll(allHotels);
      return results;
    },
    deleteById(id) {
      const hotels = getAll();
      const afterHotels = hotels.filter((hotel) => !idsEqual(hotel.id, id));
      if (afterHotels.length !== hotels.length) {
        writeAll(afterHotels);
      }
      return {
        deletedCount: hotels.length - afterHotels.length,
        hotels: afterHotels
      };
    },
    deleteMany(ids) {
      const idSet = new Set(
        ids.map(getIdKey).filter((id) => id && id !== 'undefined' && id !== 'null')
      );
      const before = getAll();
      const after = before.filter((hotel) => !idSet.has(String(hotel.id)));
      if (after.length !== before.length) {
        writeAll(after);
      }
      return {
        deletedCount: before.length - after.length,
        hotels: after
      };
    },
    replaceAll(hotels) {
      const normalizedHotels = hotels.map((hotel) => normalizeHotelPayload(hotel));
      writeAll(normalizedHotels);
      return normalizedHotels;
    },
    getCompactedForExport() {
      return hotelStorage.compactHotels(getAll(), normalizeHotelPayload);
    },
    normalize: normalizeHotelPayload,
    hasValidId
  };
}

module.exports = {
  createHotelRepository,
  hasValidId
};
