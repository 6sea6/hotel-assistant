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

function hasCtripLoginCookieSignal(userDataDir, profileDirectory) {
  return getEdgeProfileCookiePaths(userDataDir, profileDirectory).some((filePath) => {
    try {
      if (!fs.existsSync(filePath) || fs.statSync(filePath).size <= 0) {
        return false;
      }
      const cookieBytes = fs.readFileSync(filePath);
      return CTRIP_LOGIN_COOKIE_SIGNALS.some((signal) => cookieBytes.includes(signal));
    } catch (_error) {
      return false;
    }
  });
}

function hasReusableEdgeProfile(userDataDir, profileDirectory) {
  const hasBrowserProfile = getEdgeProfileSignalPaths(userDataDir, profileDirectory).some((filePath) => {
    try {
      return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
    } catch (_error) {
      return false;
    }
  });
  return hasBrowserProfile && hasCtripLoginCookieSignal(userDataDir, profileDirectory);
}

module.exports = {
  getEdgeProfileCookiePaths,
  getEdgeProfilePath,
  getEdgeProfileSignalPaths,
  hasCtripLoginCookieSignal,
  hasReusableEdgeProfile,
  resolveEdgeProfileDirectory,
  resolveEdgeUserDataDir,
  toBoolean
};
