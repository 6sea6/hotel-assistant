(function initSettingsNormalizers(root) {
  function normalizeCollectBatchConcurrency(value) {
    const concurrency = Number(value);
    return concurrency === 2 || concurrency === 3 ? concurrency : 1;
  }

  function normalizeCollectBrowser(value) {
    return String(value || '').trim() === '360' ? '360' : 'edge';
  }

  const settingsNormalizers = Object.freeze({
    normalizeCollectBatchConcurrency,
    normalizeCollectBrowser
  });

  if (typeof module === 'object' && module.exports) {
    module.exports = settingsNormalizers;
    return;
  }

  const target = /** @type {Record<string, unknown>} */ (root);
  target.HotelComparisonSettingsNormalizers = settingsNormalizers;
})(typeof globalThis !== 'undefined' ? globalThis : this);
