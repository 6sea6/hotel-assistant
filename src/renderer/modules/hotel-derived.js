/**
 * 宾馆派生字段缓存 —— 预解析筛选/排序/统计所需的数值和 key，避免重复计算。
 *
 * _derived 仅存在于渲染进程 state.hotels 中，不写入主进程 store。
 */

/**
 * @typedef {import('../../shared/contracts').NormalizedHotelRecord} NormalizedHotelRecord
 */

/**
 * @param {string|null|undefined} distanceStr
 * @returns {number|null}
 */
function extractDistanceNumber(distanceStr) {
  if (!distanceStr) return null;
  const match = String(distanceStr).match(/(\d+\.?\d*)/);
  return match ? parseFloat(match[1]) : null;
}

/**
 * @param {string|null|undefined} timeStr
 * @returns {number|null}
 */
function extractTimeNumber(timeStr) {
  if (!timeStr) return null;
  const match = String(timeStr).match(/(\d+)/);
  return match ? parseInt(match[1]) : null;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeFilterOptionKey(value) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('zh-CN');
}

/**
 * @typedef {object} DerivedFields
 * @property {string} nameKey
 * @property {number|null} totalPriceNumber
 * @property {number|null} dailyPriceNumber
 * @property {number|null} scoreNumber
 * @property {number|null} distanceNumber
 * @property {number|null} subwayDistanceNumber
 * @property {number|null} transportTimeNumber
 * @property {string} roomTypeKey
 * @property {string} originalRoomTypeKey
 * @property {string} hotelIdentityKey
 */

/**
 * 从单条宾馆记录构建派生字段，纯计算无副作用。
 *
 * @param {NormalizedHotelRecord} hotel
 * @returns {DerivedFields}
 */
export function buildHotelDerivedFields(hotel) {
  const nameKey = normalizeFilterOptionKey(hotel.name);
  const hotelIdentity = nameKey || `hotel:${String(hotel?.id ?? '')}`;

  return {
    nameKey,
    totalPriceNumber: parsePositiveNumber(hotel.total_price),
    dailyPriceNumber: parsePositiveNumber(hotel.daily_price),
    scoreNumber: parsePositiveNumber(hotel.ctrip_score),
    distanceNumber: extractDistanceNumber(hotel.distance),
    subwayDistanceNumber: extractDistanceNumber(hotel.subway_distance),
    transportTimeNumber: extractTimeNumber(hotel.transport_time),
    roomTypeKey: normalizeFilterOptionKey(hotel.room_type),
    originalRoomTypeKey: normalizeFilterOptionKey(hotel.original_room_type),
    hotelIdentityKey: hotelIdentity
  };
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function parsePositiveNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

/**
 * 为单条宾馆附加 _derived 字段，返回浅拷贝，不修改原对象。
 *
 * @param {NormalizedHotelRecord} hotel
 * @returns {NormalizedHotelRecord & {_derived: DerivedFields}}
 */
export function attachDerivedFieldsToHotel(hotel) {
  return { ...hotel, _derived: buildHotelDerivedFields(hotel) };
}

/**
 * 批量附加 _derived 字段。
 *
 * @param {NormalizedHotelRecord[]} hotels
 * @returns {Array<NormalizedHotelRecord & {_derived: DerivedFields}>}
 */
export function attachDerivedFields(hotels) {
  return hotels.map(attachDerivedFieldsToHotel);
}

/**
 * 移除单条宾馆的 _derived 字段，返回浅拷贝。
 *
 * @param {NormalizedHotelRecord & {_derived?: DerivedFields}} hotel
 * @returns {NormalizedHotelRecord}
 */
export function stripDerivedFieldsFromHotel(hotel) {
  if (!hotel || !hotel._derived) return hotel;
  const { _derived, ...rest } = hotel;
  return rest;
}

/**
 * 批量移除 _derived 字段。
 *
 * @param {Array<NormalizedHotelRecord & {_derived?: DerivedFields}>} hotels
 * @returns {NormalizedHotelRecord[]}
 */
export function stripDerivedFields(hotels) {
  return hotels.map(stripDerivedFieldsFromHotel);
}
