export function isRendererDebugLoggingEnabled() {
  const root = typeof window !== 'undefined' ? window : globalThis;
  if (root && root.HOTEL_APP_DEBUG_LOGS === true) {
    return true;
  }

  try {
    const storage = root && root.localStorage;
    return (
      storage &&
      (storage.getItem('HOTEL_APP_DEBUG_LOGS') === '1' ||
        storage.getItem('hotelAppDebugLogs') === '1')
    );
  } catch (_error) {
    return false;
  }
}

export function logRendererDebug(...args) {
  if (!isRendererDebugLoggingEnabled()) {
    return;
  }
  console.log(...args);
}
