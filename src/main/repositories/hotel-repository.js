const hotelStorage = require('../hotel-storage');
const { hasNormalizedValueChanged } = require('../normalization-utils');
const { allocateUniqueId, getIdKey } = require('../../shared/id-utils');

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeBusinessKeyPart(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Build a business key string for matching a hotel across imports.
 *
 * Priority:
 * 1. website + room_type (when website is present)
 * 2. name + address + room_type (fallback)
 *
 * Room type prefers original_room_type over room_type.
 * Returns '' when no meaningful key can be built.
 *
 * @param {Partial<import('../../shared/contracts').NormalizedHotelRecord>} hotel
 * @returns {string}
 */
function buildHotelBusinessKey(hotel) {
  const roomType = normalizeBusinessKeyPart(hotel.original_room_type || hotel.room_type);
  const website = normalizeBusinessKeyPart(hotel.website);
  if (website) {
    return roomType ? `web:${website}|rt:${roomType}` : `web:${website}`;
  }
  const name = normalizeBusinessKeyPart(hotel.name);
  const address = normalizeBusinessKeyPart(hotel.address);
  if (!name && !address && !roomType) {
    return '';
  }
  return `nm:${name}|ad:${address}|rt:${roomType}`;
}

/**
 * Build a Map from business key → index for the given hotels array.
 *
 * @param {Array<Partial<import('../../shared/contracts').NormalizedHotelRecord>>} hotels
 * @returns {Map<string, number>}
 */
function createHotelBusinessKeyIndex(hotels) {
  const index = new Map();
  hotels.forEach((hotel, i) => {
    const key = buildHotelBusinessKey(hotel);
    if (key) {
      index.set(key, i);
    }
  });
  return index;
}

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
 * @property {(payloads: Array<Partial<RawHotelRecord>>) => NormalizedHotelRecord[]} addMany
 * @property {(payloads: Array<Partial<RawHotelRecord>>, options?: {matchByBusinessKey?: boolean}) => {added: NormalizedHotelRecord[], updated: NormalizedHotelRecord[], hotels: NormalizedHotelRecord[]}} upsertMany
 * @property {(id: EntityId) => HotelDeleteResult} deleteById
 * @property {(ids: EntityId[]) => HotelDeleteResult} deleteMany
 * @property {(hotels: Array<Partial<RawHotelRecord>|NormalizedHotelRecord>) => NormalizedHotelRecord[]} replaceAll
 * @property {() => unknown[]} getCompactedForExport
 * @property {() => void} flush
 * @property {() => void} invalidateCache
 * @property {NormalizeHotelPayload} normalize
 * @property {(id: unknown) => boolean} hasValidId
 * @property {() => number} getRevision
 * @property {() => {revision: number, count: number, loaded: boolean, dirty: boolean}} getMeta
 * @property {() => number} touchRevision
 *
 * @typedef {object} HotelRepositoryState
 * @property {boolean} loaded
 * @property {NormalizedHotelRecord[]} hotelsCache
 * @property {Map<string, number>} idIndex
 * @property {boolean} dirty
 * @property {ReturnType<typeof setTimeout>|null} flushTimer
 * @property {RepositoryStore|null} store
 * @property {NormalizeHotelPayload|null} normalizeHotelPayload
 * @property {number} revision
 */

/** @type {WeakMap<RepositoryStore, HotelRepositoryState>} */
const repositoryStates = new WeakMap();
/** @type {Set<HotelRepositoryState>} */
const repositoryStateSet = new Set();

/**
 * @returns {HotelRepositoryState}
 */
function createRepositoryState() {
  return {
    loaded: false,
    hotelsCache: [],
    idIndex: new Map(),
    dirty: false,
    flushTimer: null,
    store: null,
    normalizeHotelPayload: null,
    revision: 0
  };
}

/**
 * @param {RepositoryStore} store
 * @returns {HotelRepositoryState}
 */
function getRepositoryState(store) {
  let state = repositoryStates.get(store);
  if (!state) {
    state = createRepositoryState();
    repositoryStates.set(store, state);
    repositoryStateSet.add(state);
  }
  return state;
}

/**
 * @param {HotelRepositoryState} state
 * @returns {void}
 */
function clearFlushTimer(state) {
  if (state.flushTimer) {
    clearTimeout(state.flushTimer);
    state.flushTimer = null;
  }
}

/**
 * @param {HotelRepositoryState} state
 * @returns {void}
 */
function flushRepositoryState(state) {
  clearFlushTimer(state);
  if (!state.dirty || !state.store || !state.normalizeHotelPayload) {
    return;
  }

  hotelStorage.setExpandedHotelsToStore(
    state.store,
    state.hotelsCache,
    state.normalizeHotelPayload
  );
  state.dirty = false;
}

/**
 * @param {HotelRepositoryState} state
 * @returns {void}
 */
function resetRepositoryState(state) {
  clearFlushTimer(state);
  state.loaded = false;
  state.hotelsCache = [];
  state.idIndex = new Map();
  state.dirty = false;
}

/**
 * @param {HotelRepositoryState} state
 * @returns {number}
 */
function bumpRevision(state) {
  state.revision += 1;
  return state.revision;
}

/**
 * Flush pending hotel writes for a store before external export, import, or folder migration code
 * reads the persisted file directly.
 *
 * @param {RepositoryStore} store
 * @returns {void}
 */
function flushHotelRepositoryCache(store) {
  const state = repositoryStates.get(store);
  if (state) {
    flushRepositoryState(state);
  }
}

/**
 * Flush all pending hotel repository writes before the Electron app quits.
 *
 * @returns {void}
 */
function flushAllHotelRepositoryCaches() {
  repositoryStateSet.forEach((state) => {
    flushRepositoryState(state);
  });
}

/**
 * Discard cached hotels after external code has replaced the store contents or reinitialized the
 * data path. Callers should flush first when they need to preserve pending edits.
 *
 * @param {RepositoryStore} store
 * @returns {void}
 */
function resetHotelRepositoryCache(store) {
  const state = repositoryStates.get(store);
  if (state) {
    resetRepositoryState(state);
  }
}

/**
 * @param {NormalizedHotelRecord} hotel
 * @returns {NormalizedHotelRecord}
 */
function cloneHotel(hotel) {
  return { ...hotel };
}

/**
 * @param {NormalizedHotelRecord[]} hotels
 * @returns {NormalizedHotelRecord[]}
 */
function cloneHotels(hotels) {
  return hotels.map(cloneHotel);
}

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
  const state = getRepositoryState(store);
  state.store = store;
  state.normalizeHotelPayload = normalizeHotelPayload;

  const writeAll = (hotels) => {
    hotelStorage.setExpandedHotelsToStore(store, hotels, normalizeHotelPayload);
  };

  const rebuildIndex = () => {
    state.idIndex = new Map();
    state.hotelsCache.forEach((hotel, index) => {
      const idKey = getIdKey(hotel.id);
      if (idKey) {
        state.idIndex.set(idKey, index);
      }
    });
  };

  const loadOnce = () => {
    if (state.loaded) {
      return;
    }

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

    state.hotelsCache = normalizedHotels;
    rebuildIndex();
    state.loaded = true;

    if (shouldWriteBack) {
      writeAll(state.hotelsCache);
      state.dirty = false;
      bumpRevision(state);
    }
  };

  const flush = () => {
    flushRepositoryState(state);
  };

  const scheduleFlush = () => {
    state.dirty = true;
    clearFlushTimer(state);
    state.flushTimer = setTimeout(() => {
      state.flushTimer = null;
      if (state.dirty) {
        writeAll(state.hotelsCache);
        state.dirty = false;
      }
    }, 300);

    if (
      state.flushTimer &&
      typeof state.flushTimer === 'object' &&
      typeof state.flushTimer.unref === 'function'
    ) {
      state.flushTimer.unref();
    }
  };

  const getAll = () => {
    loadOnce();
    return cloneHotels(state.hotelsCache);
  };

  return {
    getAll,
    getById(id) {
      loadOnce();
      const idKey = getIdKey(id);
      const index = idKey ? state.idIndex.get(idKey) : undefined;
      return index === undefined ? undefined : cloneHotel(state.hotelsCache[index]);
    },
    add(payload) {
      loadOnce();
      const usedIds = new Set(state.hotelsCache.map((item) => getIdKey(item.id)).filter(Boolean));
      const nextIdState = { value: Date.now() };
      const newHotel = normalizeHotelPayload({
        ...payload,
        id: allocateUniqueId(payload.id ?? null, usedIds, nextIdState),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      state.hotelsCache.push(newHotel);
      rebuildIndex();
      scheduleFlush();
      bumpRevision(state);
      return cloneHotel(newHotel);
    },
    update(payload) {
      loadOnce();
      const idKey = getIdKey(payload.id);
      const index = idKey ? state.idIndex.get(idKey) : undefined;
      if (index === undefined) {
        return null;
      }

      state.hotelsCache[index] = normalizeHotelPayload(
        {
          ...payload,
          updated_at: new Date().toISOString()
        },
        state.hotelsCache[index]
      );
      rebuildIndex();
      scheduleFlush();
      bumpRevision(state);
      return cloneHotel(state.hotelsCache[index]);
    },
    updateMany(payloads) {
      loadOnce();
      const results = [];

      for (const payload of payloads) {
        const idKey = getIdKey(payload.id);
        const index = idKey ? state.idIndex.get(idKey) : undefined;
        if (index !== undefined) {
          state.hotelsCache[index] = normalizeHotelPayload(
            {
              ...payload,
              updated_at: new Date().toISOString()
            },
            state.hotelsCache[index]
          );
          results.push(cloneHotel(state.hotelsCache[index]));
        }
      }

      if (results.length > 0) {
        rebuildIndex();
        scheduleFlush();
        bumpRevision(state);
      }
      return results;
    },
    addMany(payloads) {
      if (!Array.isArray(payloads) || payloads.length === 0) {
        return [];
      }

      loadOnce();
      const usedIds = new Set(state.hotelsCache.map((item) => getIdKey(item.id)).filter(Boolean));
      const nextIdState = { value: Date.now() };
      const added = [];

      for (const payload of payloads) {
        if (!payload || typeof payload !== 'object') continue;

        const newHotel = normalizeHotelPayload({
          ...payload,
          id: allocateUniqueId(payload.id ?? null, usedIds, nextIdState),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
        state.hotelsCache.push(newHotel);
        added.push(cloneHotel(newHotel));
      }

      if (added.length > 0) {
        rebuildIndex();
        scheduleFlush();
        bumpRevision(state);
      }
      return added;
    },
    upsertMany(payloads, options = {}) {
      if (!Array.isArray(payloads) || payloads.length === 0) {
        return { added: [], updated: [], hotels: [] };
      }

      const matchByBusinessKey = options.matchByBusinessKey !== false;

      loadOnce();
      const idIndex = state.idIndex;
      const businessKeyIndex = matchByBusinessKey
        ? createHotelBusinessKeyIndex(state.hotelsCache)
        : new Map();
      const added = [];
      const updated = [];
      const usedIds = new Set(state.hotelsCache.map((item) => getIdKey(item.id)).filter(Boolean));
      const nextIdState = { value: Date.now() };
      const now = new Date().toISOString();

      for (const payload of payloads) {
        if (!payload || typeof payload !== 'object') continue;

        let matchIndex = -1;
        let matchSource = '';

        // 1. Try ID match
        const idKey = getIdKey(payload.id);
        if (idKey && idIndex.has(idKey)) {
          matchIndex = idIndex.get(idKey);
          matchSource = 'id';
        }

        // 2. Try business key match
        if (matchIndex < 0 && matchByBusinessKey) {
          const normalizedPayload = normalizeHotelPayload(payload);
          const bkey = buildHotelBusinessKey(normalizedPayload);
          if (bkey && businessKeyIndex.has(bkey)) {
            matchIndex = businessKeyIndex.get(bkey);
            matchSource = 'businessKey';
          }
        }

        if (matchIndex >= 0) {
          const existingHotel = state.hotelsCache[matchIndex];
          const nextPayload = {
            ...payload,
            // Preserve existing ID when matched by business key
            id: matchSource === 'businessKey' ? existingHotel.id : payload.id,
            created_at: existingHotel.created_at || payload.created_at || now,
            updated_at: now
          };
          state.hotelsCache[matchIndex] = normalizeHotelPayload(nextPayload, existingHotel);

          // Update business key index for the updated record
          if (matchByBusinessKey) {
            const updatedKey = buildHotelBusinessKey(state.hotelsCache[matchIndex]);
            if (updatedKey) {
              businessKeyIndex.set(updatedKey, matchIndex);
            }
          }

          updated.push(cloneHotel(state.hotelsCache[matchIndex]));
        } else {
          const newHotel = normalizeHotelPayload({
            ...payload,
            id: allocateUniqueId(payload.id ?? null, usedIds, nextIdState),
            created_at: now,
            updated_at: now
          });
          state.hotelsCache.push(newHotel);
          const newIndex = state.hotelsCache.length - 1;

          // Register in indices so subsequent payloads can match this new hotel
          const newIdKey = getIdKey(newHotel.id);
          if (newIdKey) {
            idIndex.set(newIdKey, newIndex);
          }
          if (matchByBusinessKey) {
            const newKey = buildHotelBusinessKey(newHotel);
            if (newKey) {
              businessKeyIndex.set(newKey, newIndex);
            }
          }

          added.push(cloneHotel(newHotel));
        }
      }

      if (added.length > 0 || updated.length > 0) {
        rebuildIndex();
        scheduleFlush();
        bumpRevision(state);
      }
      return { added, updated, hotels: [...added, ...updated] };
    },
    deleteById(id) {
      loadOnce();
      const idKey = getIdKey(id);
      const index = idKey ? state.idIndex.get(idKey) : undefined;
      if (index === undefined) {
        return {
          deletedCount: 0,
          hotels: cloneHotels(state.hotelsCache)
        };
      }

      state.hotelsCache.splice(index, 1);
      rebuildIndex();
      scheduleFlush();
      bumpRevision(state);
      return {
        deletedCount: 1,
        hotels: cloneHotels(state.hotelsCache)
      };
    },
    deleteMany(ids) {
      loadOnce();
      const idSet = new Set(
        ids.map(getIdKey).filter((id) => id && id !== 'undefined' && id !== 'null')
      );
      const beforeLength = state.hotelsCache.length;
      state.hotelsCache = state.hotelsCache.filter((hotel) => {
        const idKey = getIdKey(hotel.id);
        return !idKey || !idSet.has(idKey);
      });
      const deletedCount = beforeLength - state.hotelsCache.length;
      rebuildIndex();
      if (deletedCount > 0) {
        scheduleFlush();
        bumpRevision(state);
      }
      return {
        deletedCount,
        hotels: cloneHotels(state.hotelsCache)
      };
    },
    replaceAll(hotels) {
      const normalizedHotels = hotels.map((hotel) => normalizeHotelPayload(hotel));
      state.hotelsCache = normalizedHotels;
      state.loaded = true;
      rebuildIndex();
      state.dirty = true;
      flush();
      bumpRevision(state);
      return cloneHotels(state.hotelsCache);
    },
    getCompactedForExport() {
      loadOnce();
      flush();
      return hotelStorage.compactHotels(state.hotelsCache, normalizeHotelPayload);
    },
    flush,
    invalidateCache() {
      resetRepositoryState(state);
    },
    getRevision() {
      loadOnce();
      return state.revision;
    },
    getMeta() {
      loadOnce();
      return {
        revision: state.revision,
        count: state.hotelsCache.length,
        loaded: state.loaded,
        dirty: state.dirty
      };
    },
    touchRevision() {
      return bumpRevision(state);
    },
    normalize: normalizeHotelPayload,
    hasValidId
  };
}

module.exports = {
  buildHotelBusinessKey,
  createHotelBusinessKeyIndex,
  createHotelRepository,
  flushAllHotelRepositoryCaches,
  flushHotelRepositoryCache,
  resetHotelRepositoryCache,
  hasValidId
};
