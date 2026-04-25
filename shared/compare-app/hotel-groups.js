const SHARED_HOTEL_FIELDS = [
  'name',
  'address',
  'website',
  'check_in_date',
  'check_out_date',
  'days',
  'ctrip_score',
  'destination',
  'distance',
  'subway_station',
  'subway_distance',
  'transport_time',
  'bus_route',
  'template_id',
  'template_info'
];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value) {
  if (Array.isArray(value) || isPlainObject(value)) {
    return JSON.parse(JSON.stringify(value));
  }

  return value;
}

function isGroupedHotelEntry(entry) {
  return isPlainObject(entry) && isPlainObject(entry.shared) && Array.isArray(entry.rooms);
}

function splitHotelRecord(hotel) {
  const shared = {};
  const room = {};

  Object.entries(hotel || {}).forEach(([key, value]) => {
    if (SHARED_HOTEL_FIELDS.includes(key)) {
      shared[key] = cloneValue(value);
    } else {
      room[key] = cloneValue(value);
    }
  });

  return { shared, room };
}

function buildGroupKey(shared) {
  return JSON.stringify(
    SHARED_HOTEL_FIELDS.map((field) => {
      const value = shared[field];
      return isPlainObject(value) || Array.isArray(value)
        ? JSON.stringify(value)
        : (value ?? null);
    })
  );
}

function normalizeHotelRecord(normalizeHotelPayload, hotel) {
  return typeof normalizeHotelPayload === 'function'
    ? normalizeHotelPayload(hotel)
    : hotel;
}

function expandStoredHotels(rawHotels = [], normalizeHotelPayload) {
  if (!Array.isArray(rawHotels)) {
    return [];
  }

  const expandedHotels = [];

  rawHotels.forEach((entry) => {
    if (isGroupedHotelEntry(entry)) {
      const shared = entry.shared || {};

      (entry.rooms || []).forEach((room) => {
        if (!isPlainObject(room)) {
          return;
        }

        expandedHotels.push(normalizeHotelRecord(normalizeHotelPayload, {
          ...shared,
          ...room
        }));
      });

      return;
    }

    if (isPlainObject(entry)) {
      expandedHotels.push(normalizeHotelRecord(normalizeHotelPayload, entry));
    }
  });

  return expandedHotels;
}

function compactHotels(hotels = [], normalizeHotelPayload) {
  if (!Array.isArray(hotels) || hotels.length === 0) {
    return [];
  }

  const grouped = new Map();
  const orderedGroups = [];

  hotels.forEach((hotel) => {
    const normalizedHotel = normalizeHotelRecord(normalizeHotelPayload, hotel);
    const { shared, room } = splitHotelRecord(normalizedHotel);
    const groupKey = buildGroupKey(shared);

    if (!grouped.has(groupKey)) {
      const groupEntry = {
        shared,
        rooms: []
      };

      grouped.set(groupKey, groupEntry);
      orderedGroups.push(groupEntry);
    }

    grouped.get(groupKey).rooms.push(room);
  });

  return orderedGroups;
}

module.exports = {
  SHARED_HOTEL_FIELDS,
  buildGroupKey,
  cloneValue,
  compactHotels,
  expandStoredHotels,
  isGroupedHotelEntry,
  isPlainObject,
  splitHotelRecord
};
