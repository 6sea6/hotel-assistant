const fs = require('fs');
const path = require('path');
const { normalizeText } = require('./utils');

function toBoolean(value, fallback = false) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = normalizeText(value).toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function resolveEdgeUserDataDir(userDataDir) {
  return path.resolve(userDataDir || path.join('state', 'edge-profile'));
}

function resolveEdgeProfileDirectory(profileDirectory) {
  return normalizeText(profileDirectory || 'Default') || 'Default';
}

function getEdgeProfilePath(userDataDir, profileDirectory) {
  return path.join(
    resolveEdgeUserDataDir(userDataDir),
    resolveEdgeProfileDirectory(profileDirectory)
  );
}

function getEdgeProfileSignalPaths(userDataDir, profileDirectory) {
  const profilePath = getEdgeProfilePath(userDataDir, profileDirectory);
  return [
    path.join(profilePath, 'Preferences'),
    path.join(profilePath, 'History'),
    path.join(profilePath, 'Cookies'),
    path.join(profilePath, 'Network', 'Cookies')
  ];
}

function getEdgeProfileCookiePaths(userDataDir, profileDirectory) {
  const profilePath = getEdgeProfilePath(userDataDir, profileDirectory);
  return [path.join(profilePath, 'Cookies'), path.join(profilePath, 'Network', 'Cookies')];
}

const CTRIP_LOGIN_COOKIE_SIGNALS = Object.freeze([
  'cticket',
  'login_uid',
  'AHeadUserInfo',
  '_udl'
]);
const EDGE_PROFILE_LOCKED_ERROR_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);

function isEdgeProfileFileLockedError(error) {
  if (!error) {
    return false;
  }
  const code = error.code ? String(error.code).toUpperCase() : '';
  const message = error.message ? String(error.message).toLowerCase() : '';
  return (
    EDGE_PROFILE_LOCKED_ERROR_CODES.has(code) ||
    message.includes('resource busy') ||
    message.includes('locked') ||
    message.includes('being used by another process')
  );
}

function inspectCtripLoginCookieSignal(userDataDir, profileDirectory) {
  const result = {
    hasCookieSignal: false,
    cookieReadBlocked: false,
    blockedPath: '',
    blockedError: ''
  };

  for (const filePath of getEdgeProfileCookiePaths(userDataDir, profileDirectory)) {
    try {
      if (!fs.existsSync(filePath) || fs.statSync(filePath).size <= 0) {
        continue;
      }
      const cookieBytes = fs.readFileSync(filePath);
      if (CTRIP_LOGIN_COOKIE_SIGNALS.some((signal) => cookieBytes.includes(signal))) {
        result.hasCookieSignal = true;
        return result;
      }
    } catch (error) {
      if (isEdgeProfileFileLockedError(error) && !result.cookieReadBlocked) {
        result.cookieReadBlocked = true;
        result.blockedPath = filePath;
        result.blockedError = error && error.message ? error.message : String(error);
      }
    }
  }

  return result;
}

function hasCtripLoginCookieSignal(userDataDir, profileDirectory) {
  return inspectCtripLoginCookieSignal(userDataDir, profileDirectory).hasCookieSignal;
}

function inspectReusableEdgeProfile(userDataDir, profileDirectory) {
  const hasBrowserProfile = getEdgeProfileSignalPaths(userDataDir, profileDirectory).some((filePath) => {
    try {
      return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
    } catch (_error) {
      return false;
    }
  });
  const cookieInspection = inspectCtripLoginCookieSignal(userDataDir, profileDirectory);
  return {
    reusable: hasBrowserProfile && cookieInspection.hasCookieSignal,
    hasBrowserProfile,
    ...cookieInspection
  };
}

function hasReusableEdgeProfile(userDataDir, profileDirectory) {
  return inspectReusableEdgeProfile(userDataDir, profileDirectory).reusable;
}

module.exports = {
  getEdgeProfileCookiePaths,
  getEdgeProfilePath,
  getEdgeProfileSignalPaths,
  hasCtripLoginCookieSignal,
  hasReusableEdgeProfile,
  inspectReusableEdgeProfile,
  isEdgeProfileFileLockedError,
  resolveEdgeProfileDirectory,
  resolveEdgeUserDataDir,
  toBoolean
};
