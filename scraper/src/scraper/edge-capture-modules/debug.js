const fs = require('fs');
const path = require('path');
const { normalizeText } = require('../../utils');

function getEdgeDebugDir() {
  const requested = normalizeText(process.env.HOTEL_DEBUG_EDGE_CAPTURE_DIR);
  if (requested) {
    return path.resolve(requested);
  }
  if (normalizeText(process.env.HOTEL_DEBUG_EDGE_CAPTURE) === '1') {
    return path.resolve('output', 'edge-debug');
  }
  return '';
}

function isEdgeDebugLoggingEnabled() {
  return Boolean(
    normalizeText(process.env.HOTEL_DEBUG_EDGE_CAPTURE_DIR) ||
      normalizeText(process.env.HOTEL_DEBUG_EDGE_CAPTURE) === '1'
  );
}

function logEdgeDebug(...args) {
  if (!isEdgeDebugLoggingEnabled()) {
    return;
  }

  console.log(...args);
}

function writeEdgeDebugArtifact(fileName, content) {
  const debugDir = getEdgeDebugDir();
  if (!debugDir || !fileName || content === undefined || content === null) {
    return;
  }

  fs.mkdirSync(debugDir, { recursive: true });
  const targetPath = path.join(debugDir, fileName);
  const payload = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  fs.writeFileSync(targetPath, payload, 'utf8');
}

module.exports = {
  getEdgeDebugDir,
  isEdgeDebugLoggingEnabled,
  logEdgeDebug,
  writeEdgeDebugArtifact
};
