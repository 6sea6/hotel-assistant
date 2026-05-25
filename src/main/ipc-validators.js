const { isPlainObject } = require('./ipc-safe-handler');

/**
 * @typedef {import('../shared/contracts').IpcResult<unknown>} IpcResult
 */

/**
 * @param {string} error
 * @returns {IpcResult}
 */
function validationError(error) {
  return { success: false, error };
}

/**
 * @param {unknown} value
 * @param {string} [error]
 * @returns {IpcResult|null}
 */
function assertPlainObjectPayload(value, error = '无效的请求参数') {
  return isPlainObject(value) ? null : validationError(error);
}

/**
 * @param {Record<string, unknown>} payload
 * @param {string} field
 * @param {string} [error]
 * @param {{allowEmpty?: boolean}} [options]
 * @returns {IpcResult|null}
 */
function assertStringField(payload, field, error = '无效的字符串字段', options = {}) {
  const value = payload[field];
  if (typeof value !== 'string') {
    return validationError(error);
  }
  if (options.allowEmpty !== true && !value.trim()) {
    return validationError(error);
  }
  return null;
}

/**
 * @param {Record<string, unknown>} payload
 * @param {string} field
 * @param {string} [error]
 * @param {{allowEmpty?: boolean}} [options]
 * @returns {IpcResult|null}
 */
function assertOptionalStringField(payload, field, error = '无效的字符串字段', options = {}) {
  if (!Object.prototype.hasOwnProperty.call(payload, field) || payload[field] == null) {
    return null;
  }
  return assertStringField(payload, field, error, { allowEmpty: options.allowEmpty !== false });
}

/**
 * @param {Record<string, unknown>} payload
 * @param {string} field
 * @param {string} [error]
 * @param {{optional?: boolean, integer?: boolean, min?: number, max?: number}} [options]
 * @returns {IpcResult|null}
 */
function assertNumberField(payload, field, error = '无效的数字字段', options = {}) {
  const value = payload[field];
  if ((value === undefined || value === null || value === '') && options.optional) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return validationError(error);
  }
  if (options.integer && !Number.isInteger(value)) {
    return validationError(error);
  }
  if (options.min !== undefined && value < options.min) {
    return validationError(error);
  }
  if (options.max !== undefined && value > options.max) {
    return validationError(error);
  }
  return null;
}

/**
 * @param {unknown} value
 * @param {readonly unknown[]} allowedValues
 * @param {string} [error]
 * @returns {IpcResult|null}
 */
function assertAllowedValue(value, allowedValues, error = '无效的枚举值') {
  return allowedValues.includes(value) ? null : validationError(error);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isEntityId(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  return typeof value === 'string' && Boolean(value.trim());
}

/**
 * @param {unknown} value
 * @param {string} [error]
 * @returns {IpcResult|null}
 */
function assertEntityId(value, error = '无效的 ID') {
  return isEntityId(value) ? null : validationError(error);
}

/**
 * @param {unknown} value
 * @param {string} [error]
 * @returns {IpcResult|null}
 */
function assertHttpsUrl(value, error = '无效的链接') {
  if (typeof value !== 'string' || !value.trim()) {
    return validationError(error);
  }
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'https:' ? null : validationError(error);
  } catch (_error) {
    return validationError(error);
  }
}

module.exports = {
  assertAllowedValue,
  assertEntityId,
  assertHttpsUrl,
  assertNumberField,
  assertOptionalStringField,
  assertPlainObjectPayload,
  assertStringField,
  isEntityId,
  validationError
};
