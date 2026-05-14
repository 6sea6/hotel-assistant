const { bd09ToGcj02, normalizeHotelGeoForAmap } = require('./amap-modules/place');
const {
  buildSubwayStationCandidates,
  normalizeSubwayStationName,
  pickNearestSubwayStation
} = require('./amap-modules/subway');
const { getTransitInfo } = require('./amap-modules/transit');

module.exports = {
  bd09ToGcj02,
  buildSubwayStationCandidates,
  getTransitInfo,
  normalizeHotelGeoForAmap,
  normalizeSubwayStationName,
  pickNearestSubwayStation
};
