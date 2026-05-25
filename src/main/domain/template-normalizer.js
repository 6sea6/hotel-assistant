const { normalizeIntegerLikeValue } = require('../../shared/id-utils');

/**
 * domain: pure template normalization rules shared by repositories, services and IPC handlers.
 *
 * @typedef {import('../../shared/contracts').RawTemplateRecord} RawTemplateRecord
 * @typedef {import('../../shared/contracts').NormalizedTemplateRecord} NormalizedTemplateRecord
 */

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
 * @param {unknown} value
 * @returns {number|null}
 */
function normalizeTemplateRoomCount(value) {
  const parsed = normalizeNullableNumber(value);
  if (parsed === null) {
    return null;
  }

  return Math.max(1, Math.min(3, parsed));
}

/**
 * @param {Partial<RawTemplateRecord>} [template]
 * @param {Partial<RawTemplateRecord>} [existingTemplate]
 * @returns {NormalizedTemplateRecord}
 */
function normalizeTemplatePayload(template = {}, existingTemplate = {}) {
  const normalized = {
    ...existingTemplate,
    ...template
  };

  normalized.id = normalizeIntegerLikeValue(normalized.id) ?? normalized.id;
  normalized.name = String(normalized.name || '').trim();
  normalized.destination = String(normalized.destination || '').trim();
  normalized.check_in_date = normalized.check_in_date || null;
  normalized.check_out_date = normalized.check_out_date || null;
  normalized.room_count = normalizeTemplateRoomCount(normalized.room_count) || 2;
  normalized.created_at =
    normalized.created_at || existingTemplate.created_at || new Date().toISOString();

  return /** @type {NormalizedTemplateRecord} */ (normalized);
}

module.exports = {
  normalizeNullableNumber,
  normalizeTemplatePayload,
  normalizeTemplateRoomCount
};
