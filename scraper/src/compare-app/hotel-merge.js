const {
  cloneValue,
  compactHotels,
  expandStoredHotels,
  isGroupedHotelEntry,
  isPlainObject,
  splitHotelRecord
} = require('./shared-module').requireSharedCompareAppModule('hotel-groups.js');
const { normalizeText } = require('../utils');
const {
  getCompareAppStorePath,
  loadCompareAppStore,
  saveCompareAppStore
} = require('./store-repository');

const COMPARE_APP_HOTEL_ALLOWED_KEYS = new Set([
  'id',
  'name',
  'address',
  'website',
  'total_price',
  'daily_price',
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
  'room_type',
  'original_room_type',
  'room_count',
  'room_area',
  'notes',
  'is_favorite',
  'template_id',
  'template_info',
  'created_at',
  'updated_at',
  'cancel_policy',
  'window_status'
]);

function sanitizeHotelRecordForStore(hotelRecord) {
  if (!isPlainObject(hotelRecord)) {
    return hotelRecord;
  }

  const sanitizedRecord = {};
  for (const key of Object.keys(hotelRecord)) {
    if (COMPARE_APP_HOTEL_ALLOWED_KEYS.has(key)) {
      sanitizedRecord[key] = hotelRecord[key];
    }
  }

  return sanitizedRecord;
}

function getExpandedHotels(store) {
  const rawHotels = Array.isArray(store.hotels) ? store.hotels : [];
  const expandedHotels = expandStoredHotels(rawHotels);
  const compactedHotels = compactHotels(expandedHotels);

  if (JSON.stringify(rawHotels) !== JSON.stringify(compactedHotels)) {
    store.hotels = compactedHotels;
  }

  return expandedHotels;
}

function setExpandedHotels(store, hotels) {
  store.hotels = compactHotels(hotels);
}

function findTemplateInStore(store, templateId, templateName) {
  const templates = Array.isArray(store.templates) ? store.templates : [];

  if (templateId !== null && templateId !== undefined && templateId !== '') {
    return templates.find((item) => String(item.id) === String(templateId)) || null;
  }

  const normalizedTemplateName = normalizeText(templateName);
  if (!normalizedTemplateName) {
    return null;
  }

  return templates.find((item) => normalizeText(item.name) === normalizedTemplateName) || null;
}

function buildTemplateInfo(template) {
  if (!template) {
    return null;
  }

  return {
    id: template.id,
    name: template.name,
    destination: template.destination,
    check_in_date: template.check_in_date,
    check_out_date: template.check_out_date,
    room_count: template.room_count
  };
}

function findExistingHotelIndex(hotels, hotelRecord) {
  return hotels.findIndex((item) => {
    const sameWebsite =
      normalizeText(item.website) &&
      normalizeText(item.website) === normalizeText(hotelRecord.website);
    const sameName = normalizeText(item.name) === normalizeText(hotelRecord.name);
    const sameTemplate = String(item.template_id ?? '') === String(hotelRecord.template_id ?? '');
    const sameDates =
      normalizeText(item.check_in_date) === normalizeText(hotelRecord.check_in_date) &&
      normalizeText(item.check_out_date) === normalizeText(hotelRecord.check_out_date);
    const sameRoomType = normalizeText(item.room_type) === normalizeText(hotelRecord.room_type);
    const sameOriginalRoomType =
      normalizeText(item.original_room_type || item.room_type) ===
      normalizeText(hotelRecord.original_room_type || hotelRecord.room_type);

    return (
      (sameWebsite || (sameName && sameDates && sameTemplate)) &&
      sameRoomType &&
      sameOriginalRoomType
    );
  });
}

function isSameHotelGroup(existingHotel, hotelRecord) {
  const sameWebsite =
    normalizeText(existingHotel.website) &&
    normalizeText(existingHotel.website) === normalizeText(hotelRecord.website);
  const sameName = normalizeText(existingHotel.name) === normalizeText(hotelRecord.name);
  const sameTemplate =
    String(existingHotel.template_id ?? '') === String(hotelRecord.template_id ?? '');
  const sameDates =
    normalizeText(existingHotel.check_in_date) === normalizeText(hotelRecord.check_in_date) &&
    normalizeText(existingHotel.check_out_date) === normalizeText(hotelRecord.check_out_date);

  return sameWebsite || (sameName && sameDates && sameTemplate);
}

function findExistingHotelGroupIndex(groupedHotels, shared) {
  return groupedHotels.findIndex((entry) => isSameHotelGroup(entry.shared || {}, shared || {}));
}

function mergeHotelRecord(existingHotel, nextHotel) {
  return sanitizeHotelRecordForStore({
    ...existingHotel,
    ...nextHotel,
    id: existingHotel.id,
    created_at: existingHotel.created_at || nextHotel.created_at,
    is_favorite: existingHotel.is_favorite ?? nextHotel.is_favorite
  });
}

function mergeHotelGroup(existingGroup, nextGroup) {
  const mergedShared = existingGroup
    ? {
        ...(existingGroup.shared || {}),
        ...(nextGroup.shared || {})
      }
    : cloneValue(nextGroup.shared || {});
  const sanitizedMergedShared = sanitizeHotelRecordForStore(mergedShared);
  const mergedHotels = existingGroup
    ? expandStoredHotels([existingGroup]).map((hotel) => ({
        ...sanitizeHotelRecordForStore(cloneValue(sanitizedMergedShared)),
        ...sanitizeHotelRecordForStore(splitHotelRecord(hotel).room)
      }))
    : [];
  const operations = [];

  (Array.isArray(nextGroup.rooms) ? nextGroup.rooms : []).filter(isPlainObject).forEach((room) => {
    const nextHotel = sanitizeHotelRecordForStore({
      ...cloneValue(sanitizedMergedShared),
      ...cloneValue(room)
    });
    const existingIndex = findExistingHotelIndex(mergedHotels, nextHotel);
    if (existingIndex < 0) {
      mergedHotels.push(nextHotel);
      operations.push('inserted');
      return;
    }

    mergedHotels[existingIndex] = mergeHotelRecord(mergedHotels[existingIndex], nextHotel);
    operations.push('updated');
  });

  const compactedGroups = compactHotels(mergedHotels);
  return {
    mergedGroup: compactedGroups[0] || {
      shared: cloneValue(sanitizedMergedShared),
      rooms: []
    },
    operations
  };
}

function replaceHotelsToStore(hotelRecords, options = {}) {
  const incomingGroups = compactHotels(
    expandStoredHotels(Array.isArray(hotelRecords) ? hotelRecords.filter(Boolean) : []).map(
      (hotelRecord) => sanitizeHotelRecordForStore(hotelRecord)
    )
  );
  if (incomingGroups.length === 0) {
    return [];
  }

  const store = loadCompareAppStore(options);
  const groupedHotels = compactHotels(getExpandedHotels(store));
  const storePath = getCompareAppStorePath(options);
  const results = [];

  for (const incomingGroup of incomingGroups) {
    const existingGroupIndex = findExistingHotelGroupIndex(
      groupedHotels,
      incomingGroup.shared || {}
    );
    const { mergedGroup, operations } = mergeHotelGroup(
      existingGroupIndex >= 0 ? groupedHotels[existingGroupIndex] : null,
      incomingGroup
    );

    if (existingGroupIndex >= 0) {
      groupedHotels[existingGroupIndex] = mergedGroup;
    } else {
      groupedHotels.push(mergedGroup);
    }

    const totalHotels = expandStoredHotels(groupedHotels).length;
    for (const operation of operations) {
      results.push({
        storePath,
        totalHotels,
        operation
      });
    }
  }

  store.hotels = groupedHotels;
  saveCompareAppStore(store, options);
  return results;
}

function overwriteHotelsToStore(hotelRecords, options = {}) {
  const incomingGroups = compactHotels(
    expandStoredHotels(Array.isArray(hotelRecords) ? hotelRecords.filter(Boolean) : []).map(
      (hotelRecord) => sanitizeHotelRecordForStore(hotelRecord)
    )
  );
  if (incomingGroups.length === 0) {
    return [];
  }

  const store = loadCompareAppStore(options);
  const groupedHotels = compactHotels(getExpandedHotels(store));
  const storePath = getCompareAppStorePath(options);
  const results = [];

  for (const incomingGroup of incomingGroups) {
    const existingGroupIndex = findExistingHotelGroupIndex(
      groupedHotels,
      incomingGroup.shared || {}
    );
    const sanitizedGroup = {
      shared: sanitizeHotelRecordForStore(incomingGroup.shared || {}),
      rooms: (Array.isArray(incomingGroup.rooms) ? incomingGroup.rooms : [])
        .filter(isPlainObject)
        .map((room) => sanitizeHotelRecordForStore(room))
    };

    if (existingGroupIndex >= 0) {
      groupedHotels[existingGroupIndex] = sanitizedGroup;
    } else {
      groupedHotels.push(sanitizedGroup);
    }

    const totalHotels = expandStoredHotels(groupedHotels).length;
    for (const room of sanitizedGroup.rooms) {
      results.push({
        storePath,
        totalHotels,
        operation: existingGroupIndex >= 0 ? 'replaced' : 'inserted',
        roomType: room.room_type || ''
      });
    }
  }

  store.hotels = groupedHotels;
  saveCompareAppStore(store, options);
  return results;
}

function appendHotelToStore(hotelRecord, options = {}) {
  const expandedHotelRecord = isGroupedHotelEntry(hotelRecord)
    ? expandStoredHotels([hotelRecord])[0] || null
    : hotelRecord;
  const normalizedHotelRecord = sanitizeHotelRecordForStore(expandedHotelRecord);
  if (!normalizedHotelRecord) {
    return {
      storePath: getCompareAppStorePath(options),
      totalHotels: 0,
      operation: 'skipped'
    };
  }

  const store = loadCompareAppStore(options);
  const hotels = getExpandedHotels(store);
  const existingIndex = findExistingHotelIndex(hotels, normalizedHotelRecord);

  if (existingIndex >= 0) {
    hotels[existingIndex] = mergeHotelRecord(hotels[existingIndex], normalizedHotelRecord);
  } else {
    hotels.push(normalizedHotelRecord);
  }

  setExpandedHotels(store, hotels);
  saveCompareAppStore(store, options);
  return {
    storePath: getCompareAppStorePath(options),
    totalHotels: hotels.length,
    operation: existingIndex >= 0 ? 'updated' : 'inserted'
  };
}

function appendHotelsToStore(hotelRecords, options = {}) {
  if (options.overwriteExistingGroup) {
    return overwriteHotelsToStore(hotelRecords, options);
  }

  if (options.replaceExistingGroup) {
    return replaceHotelsToStore(hotelRecords, options);
  }

  const records = expandStoredHotels(
    Array.isArray(hotelRecords) ? hotelRecords.filter(Boolean) : []
  ).map((hotelRecord) => sanitizeHotelRecordForStore(hotelRecord));
  if (records.length === 0) {
    return [];
  }

  const store = loadCompareAppStore(options);
  const hotels = getExpandedHotels(store);
  const storePath = getCompareAppStorePath(options);
  const results = [];

  for (const hotelRecord of records) {
    const existingIndex = findExistingHotelIndex(hotels, hotelRecord);

    if (existingIndex >= 0) {
      hotels[existingIndex] = mergeHotelRecord(hotels[existingIndex], hotelRecord);
    } else {
      hotels.push(hotelRecord);
    }

    results.push({
      storePath,
      totalHotels: hotels.length,
      operation: existingIndex >= 0 ? 'updated' : 'inserted'
    });
  }

  setExpandedHotels(store, hotels);
  saveCompareAppStore(store, options);
  return results;
}

module.exports = {
  appendHotelsToStore,
  appendHotelToStore,
  buildTemplateInfo,
  findTemplateInStore,
  sanitizeHotelRecordForStore
};
