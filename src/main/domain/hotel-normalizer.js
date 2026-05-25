const { HOTEL_EDITABLE_FIELDS, HOTEL_SYSTEM_FIELDS } = require('../config');
const { normalizeIntegerLikeValue } = require('../../shared/id-utils');

/**
 * domain: pure hotel normalization rules shared by repositories, services and IPC handlers.
 *
 * @typedef {import('../../shared/contracts').RawHotelRecord} RawHotelRecord
 * @typedef {import('../../shared/contracts').NormalizedHotelRecord} NormalizedHotelRecord
 * @typedef {import('../../shared/contracts').TemplateInfo} TemplateInfo
 */

const HOTEL_ALLOWED_FIELD_KEYS = new Set([
  ...HOTEL_EDITABLE_FIELDS.map((field) => field.key),
  ...HOTEL_SYSTEM_FIELDS.map((field) => field.key),
  'cancel_policy',
  'window_status'
]);

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeStringNumber(value) {
  if (value === null || value === undefined || value === '') return '';
  return String(value).trim();
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function normalizeNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * @param {Partial<TemplateInfo>|null|undefined} templateInfo
 * @returns {TemplateInfo|null}
 */
function normalizeTemplateInfo(templateInfo) {
  if (!templateInfo || typeof templateInfo !== 'object' || Array.isArray(templateInfo)) {
    return null;
  }

  return {
    id: normalizeIntegerLikeValue(templateInfo.id),
    name: String(templateInfo.name || '').trim(),
    destination: String(templateInfo.destination || '').trim(),
    check_in_date: templateInfo.check_in_date || null,
    check_out_date: templateInfo.check_out_date || null,
    room_count: normalizeNullableNumber(templateInfo.room_count) || null
  };
}

/**
 * @param {Partial<RawHotelRecord>} [hotel]
 * @param {Partial<RawHotelRecord>} [existingHotel]
 * @returns {NormalizedHotelRecord}
 */
function normalizeHotelPayload(hotel = {}, existingHotel = {}) {
  const normalized = {
    ...existingHotel,
    ...hotel
  };

  normalized.id = normalizeIntegerLikeValue(normalized.id) ?? normalized.id;
  normalized.name = String(normalized.name || '').trim();
  normalized.address = String(normalized.address || '').trim();
  normalized.website = String(normalized.website || '').trim();
  normalized.destination = String(normalized.destination || '').trim();
  normalized.subway_station = String(normalized.subway_station || '').trim();
  normalized.room_type = String(normalized.room_type || '').trim();
  normalized.original_room_type = String(normalized.original_room_type || '').trim();
  normalized.notes = String(normalized.notes || '').trim();

  normalized.total_price = normalizeNullableNumber(normalized.total_price);
  normalized.daily_price = normalizeNullableNumber(normalized.daily_price);
  normalized.days = normalizeNullableNumber(normalized.days);
  normalized.ctrip_score = normalizeNullableNumber(normalized.ctrip_score);
  normalized.room_count = normalizeNullableNumber(normalized.room_count) || 1;

  normalized.distance = normalizeStringNumber(normalized.distance);
  normalized.subway_distance = normalizeStringNumber(normalized.subway_distance);
  normalized.transport_time = normalizeStringNumber(normalized.transport_time);
  normalized.bus_route = String(normalized.bus_route || '').trim();
  normalized.room_area = normalizeStringNumber(normalized.room_area);

  normalized.check_in_date = normalized.check_in_date || null;
  normalized.check_out_date = normalized.check_out_date || null;
  normalized.template_id = normalizeIntegerLikeValue(normalized.template_id);
  normalized.template_info = normalizeTemplateInfo(normalized.template_info);
  if (normalized.template_id == null && normalized.template_info?.id != null) {
    normalized.template_id = normalized.template_info.id;
  }
  normalized.is_favorite = Number(normalized.is_favorite) === 1 ? 1 : 0;

  for (const key of Object.keys(normalized)) {
    if (!HOTEL_ALLOWED_FIELD_KEYS.has(key)) {
      delete normalized[key];
    }
  }

  return /** @type {NormalizedHotelRecord} */ (normalized);
}

module.exports = {
  HOTEL_ALLOWED_FIELD_KEYS,
  normalizeHotelPayload,
  normalizeNullableNumber,
  normalizeStringNumber,
  normalizeTemplateInfo
};
