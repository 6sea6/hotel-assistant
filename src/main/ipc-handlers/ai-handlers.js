const { requireSharedCompareAppModule } = require('../shared-compare-app');
const { assertPlainObject, isPlainObject, safeHandle } = require('../ipc-safe-handler');
const {
  assertHttpsUrl,
  assertNumberField,
  assertOptionalStringField,
  assertPlainObjectPayload,
  validationError
} = require('../ipc-validators');

const AI_REQUEST_ERROR = '无效的 AI 请求参数';
const CTRIP_LIST_URL_ERROR = '无效的携程列表页链接';
const CTRIP_LIST_URL_PAYLOAD_ERROR = '无效的携程列表页参数';

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * @param {Record<string, unknown>} payload
 * @param {string} field
 * @returns {import('../../shared/contracts').IpcResult<unknown>|null}
 */
function assertOptionalStringArrayField(payload, field) {
  if (!Object.prototype.hasOwnProperty.call(payload, field) || payload[field] == null) {
    return null;
  }
  return isStringArray(payload[field]) ? null : validationError(AI_REQUEST_ERROR);
}

/**
 * @param {Record<string, unknown>} filters
 * @returns {import('../../shared/contracts').IpcResult<unknown>|null}
 */
function validateAiListFilters(filters) {
  const payloadError = assertPlainObjectPayload(filters, AI_REQUEST_ERROR);
  if (payloadError) return payloadError;
  const desiredCountError = assertNumberField(filters, 'desiredHotelCount', AI_REQUEST_ERROR, {
    optional: true,
    integer: true,
    min: 1
  });
  if (desiredCountError) return desiredCountError;
  return assertOptionalStringArrayField(filters, 'excludeHotelTypes');
}

/**
 * @param {Record<string, unknown>} filters
 * @param {string} errorMessage
 * @returns {import('../../shared/contracts').IpcResult<unknown>|null}
 */
function validateCtripUrlFilterSettings(filters, errorMessage) {
  const payloadError = assertPlainObjectPayload(filters, errorMessage);
  if (payloadError) return payloadError;
  for (const field of ['priceMin', 'reviewCountMin', 'ctripScoreMin']) {
    const numberError = assertNumberField(filters, field, errorMessage, { optional: true, min: 0 });
    if (numberError) return numberError;
  }
  if (
    Object.prototype.hasOwnProperty.call(filters, 'priceMax') &&
    filters.priceMax !== null &&
    filters.priceMax !== 'max' &&
    (typeof filters.priceMax !== 'number' || !Number.isFinite(filters.priceMax))
  ) {
    return validationError(errorMessage);
  }
  if (
    Object.prototype.hasOwnProperty.call(filters, 'starLevels') &&
    filters.starLevels != null &&
    (!Array.isArray(filters.starLevels) ||
      filters.starLevels.some((item) => typeof item !== 'number' || !Number.isFinite(item)))
  ) {
    return validationError(errorMessage);
  }
  if (
    Object.prototype.hasOwnProperty.call(filters, 'sortMode') &&
    filters.sortMode !== null &&
    typeof filters.sortMode !== 'string'
  ) {
    return validationError(errorMessage);
  }
  if (
    Object.prototype.hasOwnProperty.call(filters, 'freeCancel') &&
    filters.freeCancel !== undefined &&
    typeof filters.freeCancel !== 'boolean'
  ) {
    return validationError(errorMessage);
  }
  return null;
}

/**
 * @param {unknown} payload
 * @returns {import('../../shared/contracts').IpcResult<unknown>|null}
 */
function validateAiTaskPayload(payload) {
  const payloadError = assertPlainObjectPayload(payload, AI_REQUEST_ERROR);
  if (payloadError) return payloadError;
  const taskPayload = /** @type {Record<string, unknown>} */ (payload);

  const stringFields = ['url', 'text', 'inputText', 'templateId', 'templateName', 'amapKey'];
  for (const field of stringFields) {
    const fieldError = assertOptionalStringField(taskPayload, field, AI_REQUEST_ERROR);
    if (fieldError) return fieldError;
  }
  if (
    Object.prototype.hasOwnProperty.call(taskPayload, 'urls') &&
    taskPayload.urls != null &&
    typeof taskPayload.urls !== 'string' &&
    !isStringArray(taskPayload.urls)
  ) {
    return validationError(AI_REQUEST_ERROR);
  }
  for (const field of ['targetCount', 'desiredHotelCount', 'maxCandidatesPerPage']) {
    const numberError = assertNumberField(taskPayload, field, AI_REQUEST_ERROR, {
      optional: true,
      integer: true,
      min: 1
    });
    if (numberError) return numberError;
  }
  const concurrencyError = assertNumberField(taskPayload, 'batchConcurrency', AI_REQUEST_ERROR, {
    optional: true,
    integer: true,
    min: 1,
    max: 2
  });
  if (concurrencyError) return concurrencyError;
  for (const field of ['priceMin', 'reviewCountMin', 'ctripScoreMin']) {
    const numberError = assertNumberField(taskPayload, field, AI_REQUEST_ERROR, {
      optional: true,
      min: 0
    });
    if (numberError) return numberError;
  }
  if (
    Object.prototype.hasOwnProperty.call(taskPayload, 'priceMax') &&
    taskPayload.priceMax !== null &&
    taskPayload.priceMax !== 'max' &&
    (typeof taskPayload.priceMax !== 'number' || !Number.isFinite(taskPayload.priceMax))
  ) {
    return validationError(AI_REQUEST_ERROR);
  }
  if (
    Object.prototype.hasOwnProperty.call(taskPayload, 'freeCancel') &&
    taskPayload.freeCancel !== undefined &&
    typeof taskPayload.freeCancel !== 'boolean'
  ) {
    return validationError(AI_REQUEST_ERROR);
  }
  const excludeHotelTypesError = assertOptionalStringArrayField(taskPayload, 'excludeHotelTypes');
  if (excludeHotelTypesError) return excludeHotelTypesError;
  if (
    Object.prototype.hasOwnProperty.call(taskPayload, 'starLevels') &&
    taskPayload.starLevels != null &&
    (!Array.isArray(taskPayload.starLevels) ||
      taskPayload.starLevels.some((item) => typeof item !== 'number' || !Number.isFinite(item)))
  ) {
    return validationError(AI_REQUEST_ERROR);
  }
  if (
    Object.prototype.hasOwnProperty.call(taskPayload, 'sortMode') &&
    taskPayload.sortMode !== null &&
    typeof taskPayload.sortMode !== 'string'
  ) {
    return validationError(AI_REQUEST_ERROR);
  }
  if (
    Object.prototype.hasOwnProperty.call(taskPayload, 'listFilters') &&
    taskPayload.listFilters != null
  ) {
    const listFilterError = validateAiListFilters(
      /** @type {Record<string, unknown>} */ (taskPayload.listFilters)
    );
    if (listFilterError) return listFilterError;
  }
  if (
    Object.prototype.hasOwnProperty.call(taskPayload, 'listUrlFilters') &&
    taskPayload.listUrlFilters != null
  ) {
    const listUrlFilterError = validateCtripUrlFilterSettings(
      /** @type {Record<string, unknown>} */ (taskPayload.listUrlFilters),
      AI_REQUEST_ERROR
    );
    if (listUrlFilterError) return listUrlFilterError;
  }
  return null;
}

function registerAiHandlers({ ipcMain, services }) {
  const getAiService = () =>
    typeof services.getAiService === 'function' ? services.getAiService() : services.aiService;
  const getCtripUrlFilters = () => requireSharedCompareAppModule('ctrip-url-filters.js');

  safeHandle(ipcMain, 'ai:config:get', () => getAiService().getProviderConfig());
  safeHandle(ipcMain, 'ai:config:presets', () => getAiService().getProviderPresets());
  safeHandle(ipcMain, 'ai:config:save', (_event, config) =>
    getAiService().saveProviderConfig(assertPlainObject(config))
  );
  safeHandle(ipcMain, 'ai:config:test', (_event, config) =>
    getAiService().testConnection(assertPlainObject(config))
  );
  safeHandle(ipcMain, 'ai:chat:send', (_event, payload) => {
    if (!isPlainObject(payload)) {
      return { success: false, error: '无效的 AI 请求参数' };
    }
    return getAiService().sendChat(payload);
  });
  safeHandle(ipcMain, 'ai:task:start', (_event, payload) => {
    const payloadError = validateAiTaskPayload(payload);
    if (payloadError) return payloadError;
    return getAiService().startTask(payload);
  });
  safeHandle(ipcMain, 'ai:task:refresh-data', (_event, payload) => {
    if (!isPlainObject(payload)) {
      return { success: false, error: '无效的 AI 请求参数' };
    }
    return getAiService().refreshHotelData(payload);
  });
  safeHandle(ipcMain, 'ai:task:cancel', () => getAiService().cancelTask());
  safeHandle(ipcMain, 'ai:task:status', () => getAiService().getTaskStatus());
  safeHandle(ipcMain, 'ai:ctrip-list-url:parse', (_event, url) => {
    const urlError = assertHttpsUrl(url, CTRIP_LIST_URL_ERROR);
    if (urlError) return urlError;
    return getCtripUrlFilters().parseCtripListUrl(String(url).trim());
  });
  safeHandle(ipcMain, 'ai:ctrip-list-url:build', (_event, payload = {}) => {
    if (typeof payload !== 'string') {
      const payloadError = assertPlainObjectPayload(payload, CTRIP_LIST_URL_PAYLOAD_ERROR);
      if (payloadError) return payloadError;
    }
    const payloadObject = typeof payload === 'string' ? {} : assertPlainObject(payload);
    const baseUrl =
      typeof payload === 'string'
        ? payload.trim()
        : String(payloadObject.baseUrl || payloadObject.url || '').trim();
    const urlError = assertHttpsUrl(baseUrl, CTRIP_LIST_URL_ERROR);
    if (urlError) return urlError;
    const settings = isPlainObject(payloadObject.settings) ? payloadObject.settings : {};
    if (Object.prototype.hasOwnProperty.call(payloadObject, 'settings')) {
      const settingsError = validateCtripUrlFilterSettings(
        /** @type {Record<string, unknown>} */ (payloadObject.settings),
        CTRIP_LIST_URL_PAYLOAD_ERROR
      );
      if (settingsError) return settingsError;
    }
    return getCtripUrlFilters().buildCtripListUrl(baseUrl, settings);
  });
}

module.exports = registerAiHandlers;
