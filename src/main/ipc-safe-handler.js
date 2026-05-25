/**
 * @typedef {Pick<import('electron').IpcMain, 'handle'>} IpcMainHandleRegistry
 * @typedef {import('electron').IpcMainInvokeEvent} IpcMainInvokeEvent
 * @typedef {import('../shared/contracts').IpcResult<unknown>} IpcResult
 *
 * @typedef {object} SafeHandleOptions
 * @property {boolean} [requireTrustedSender]
 * @property {string} [fallbackError]
 * @property {boolean} [passthroughErrors]
 * @property {string} [logPrefix]
 *
 * @callback SafeIpcHandler
 * @param {IpcMainInvokeEvent} event
 * @param {...unknown} args
 * @returns {unknown|Promise<unknown>}
 */

function getSenderUrl(event) {
  const frameUrl = event?.senderFrame?.url;
  if (typeof frameUrl === 'string' && frameUrl) {
    return frameUrl;
  }

  const getURL = event?.sender?.getURL;
  if (typeof getURL === 'function') {
    try {
      return String(getURL.call(event.sender) || '');
    } catch (_error) {
      return '';
    }
  }

  return '';
}

/**
 * Trust only renderer frames that expose an explicit local app URL.
 *
 * @param {Partial<IpcMainInvokeEvent>|null|undefined} event
 * @returns {boolean}
 */
function isTrustedSender(event) {
  const senderUrl = getSenderUrl(event);
  if (!senderUrl) {
    return false;
  }

  let parsed;
  try {
    parsed = new URL(senderUrl);
  } catch (_error) {
    return false;
  }

  return parsed.protocol === 'file:' || parsed.protocol === 'app:';
}

/**
 * @param {unknown} error
 * @param {string} [fallbackMessage]
 * @returns {string}
 */
function toErrorMessage(error, fallbackMessage = '未知错误') {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }
  if (
    error &&
    typeof error === 'object' &&
    typeof (/** @type {{message?: unknown}} */ (error).message) === 'string' &&
    /** @type {{message: string}} */ (error).message.trim()
  ) {
    return /** @type {{message: string}} */ (error).message.trim();
  }
  return fallbackMessage;
}

/**
 * @param {unknown} error
 * @param {string} [fallbackMessage]
 * @returns {IpcResult}
 */
function normalizeIpcError(error, fallbackMessage = '未知错误') {
  return {
    success: false,
    error: toErrorMessage(error, fallbackMessage)
  };
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * @param {unknown} value
 * @param {Record<string, unknown>} [fallback]
 * @returns {Record<string, unknown>}
 */
function assertPlainObject(value, fallback = {}) {
  return isPlainObject(value) ? value : fallback;
}

/**
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
function assertString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

/**
 * Register an IPC handler with sender validation and stable error conversion.
 * Successful handler results are returned unchanged to preserve existing IPC
 * contracts.
 *
 * @param {IpcMainHandleRegistry} ipcMain
 * @param {string} channel
 * @param {SafeIpcHandler} handler
 * @param {SafeHandleOptions} [options]
 * @returns {void}
 */
function safeHandle(ipcMain, channel, handler, options = {}) {
  const requireTrustedSender = options.requireTrustedSender !== false;

  ipcMain.handle(channel, (event, ...args) => {
    try {
      if (requireTrustedSender && !isTrustedSender(event)) {
        return normalizeIpcError('非法 IPC 来源');
      }

      const result = handler(event, ...args);
      if (result && typeof (/** @type {{then?: unknown}} */ (result).then) === 'function') {
        return Promise.resolve(result).catch((error) => {
          if (options.passthroughErrors) {
            throw error;
          }
          if (options.logPrefix) {
            console.error(`[${options.logPrefix}]`, error);
          }
          return normalizeIpcError(error, options.fallbackError);
        });
      }
      return result;
    } catch (error) {
      if (options.passthroughErrors) {
        throw error;
      }
      if (options.logPrefix) {
        console.error(`[${options.logPrefix}]`, error);
      }
      return normalizeIpcError(error, options.fallbackError);
    }
  });
}

module.exports = {
  assertPlainObject,
  assertString,
  isPlainObject,
  isTrustedSender,
  normalizeIpcError,
  safeHandle,
  toErrorMessage
};
