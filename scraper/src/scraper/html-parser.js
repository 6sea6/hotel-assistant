const {
  DESKTOP_HEADERS,
  MOBILE_HEADERS,
  fetchHtml,
  loadHtmlFromFile,
  saveHtmlSnapshot
} = require('./html-parser-modules/html-io');
const {
  extractEmbeddedObject,
  extractJsonBlock,
  safeJsonParse
} = require('./html-parser-modules/embedded-json');
const {
  extractGeoInfoFromHtml,
  extractHotelMetaFromHtml,
  extractHotelScoreFromHtml
} = require('./html-parser-modules/hotel-meta');
const {
  extractExcludedPricesFromSnippet,
  extractRelevantPricesFromSnippet,
  findRoomBlocksFromHtml,
  findRoomBlocksFromStructuredText,
  inferOccupancy
} = require('./html-parser-modules/room-block-parser');

module.exports = {
  DESKTOP_HEADERS,
  MOBILE_HEADERS,
  extractEmbeddedObject,
  extractExcludedPricesFromSnippet,
  extractGeoInfoFromHtml,
  extractHotelMetaFromHtml,
  extractHotelScoreFromHtml,
  extractJsonBlock,
  extractRelevantPricesFromSnippet,
  fetchHtml,
  findRoomBlocksFromHtml,
  findRoomBlocksFromStructuredText,
  inferOccupancy,
  loadHtmlFromFile,
  safeJsonParse,
  saveHtmlSnapshot
};
