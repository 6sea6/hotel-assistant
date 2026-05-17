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

function hasReusableEdgeProfile(userDataDir, profileDirectory) {
  return getEdgeProfileSignalPaths(userDataDir, profileDirectory).some((filePath) => {
    try {
      return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
    } catch (_error) {
      return false;
    }
  });
}

module.exports = {
  getEdgeProfilePath,
  getEdgeProfileSignalPaths,
  hasReusableEdgeProfile,
  resolveEdgeProfileDirectory,
  resolveEdgeUserDataDir,
  toBoolean
};
