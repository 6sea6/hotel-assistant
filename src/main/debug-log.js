function isMainDebugLoggingEnabled() {
  return process.env.HOTEL_APP_DEBUG_LOGS === '1';
}

function logMainDebug(...args) {
  if (!isMainDebugLoggingEnabled()) {
    return;
  }

  console.log(...args);
}

module.exports = {
  isMainDebugLoggingEnabled,
  logMainDebug
};
