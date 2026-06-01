const {
  EDGE_CDP_SHORT_TIMEOUT_MS,
  buildCdpSendOptions
} = require('./edge-retry-policy');

const EDGE_BLOCKED_RESOURCE_PATTERNS = [
  '*://*/*.png*',
  '*://*/*.jpg*',
  '*://*/*.jpeg*',
  '*://*/*.gif*',
  '*://*/*.webp*',
  '*://*/*.avif*',
  '*://*/*.ico*',
  '*://*/*.woff*',
  '*://*/*.woff2*',
  '*://*/*.ttf*',
  '*://*/*.otf*',
  '*://*/*.eot*',
  '*://*/*.mp4*',
  '*://*/*.webm*',
  '*://*/*.mov*',
  '*://*/*.m3u8*'
];

function getEdgeBlockedResourcePatterns() {
  return [...EDGE_BLOCKED_RESOURCE_PATTERNS];
}

async function configureEdgeStaticResourceBlocking(connection, sessionId, options = {}) {
  if (!connection || typeof connection.send !== 'function' || !sessionId) {
    return { enabled: false, blockedPatternCount: 0, reason: 'missing_cdp_session' };
  }
  if (options.blockStaticResources === false || options.disableStaticResourceBlocking === true) {
    return { enabled: false, blockedPatternCount: 0, reason: 'disabled_by_option' };
  }

  const urls = getEdgeBlockedResourcePatterns();
  try {
    await connection.send(
      'Network.setBlockedURLs',
      { urls },
      sessionId,
      buildCdpSendOptions(options.signal || null, EDGE_CDP_SHORT_TIMEOUT_MS)
    );
    return { enabled: true, blockedPatternCount: urls.length, reason: '' };
  } catch (error) {
    return {
      enabled: false,
      blockedPatternCount: urls.length,
      reason: 'cdp_set_blocked_urls_failed',
      errorMessage: error && error.message ? error.message : String(error)
    };
  }
}

module.exports = {
  configureEdgeStaticResourceBlocking,
  getEdgeBlockedResourcePatterns
};
