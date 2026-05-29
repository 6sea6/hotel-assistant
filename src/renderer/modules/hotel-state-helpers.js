/**
 * 宾馆状态纯函数 —— 对 state.hotels 数组的增量操作，无副作用，可独立测试。
 */

/**
 * @param {Array<{id: any}>} hotels
 * @param {any} id
 * @returns {number}
 */
export function findHotelIndexById(hotels, id) {
  return hotels.findIndex((h) => String(h.id) === String(id));
}

/**
 * @param {Array<{id: any}>} hotels
 * @param {{id: any}} hotel
 * @returns {Array}
 */
export function appendHotelToList(hotels, hotel) {
  return [...hotels, hotel];
}

/**
 * @param {Array<{id: any}>} hotels
 * @param {{id: any}} updatedHotel
 * @param {any} [fallbackId]
 * @returns {{list: Array, replaced: boolean}}
 */
export function replaceHotelInList(hotels, updatedHotel, fallbackId) {
  const targetId = updatedHotel.id ?? fallbackId;
  const idx = findHotelIndexById(hotels, targetId);
  if (idx === -1) {
    return { list: [...hotels, updatedHotel], replaced: false };
  }
  const next = hotels.slice();
  next[idx] = updatedHotel;
  return { list: next, replaced: true };
}

/**
 * @param {Array<{id: any}>} hotels
 * @param {any} id
 * @returns {{list: Array, removed: boolean}}
 */
export function removeHotelById(hotels, id) {
  const idx = findHotelIndexById(hotels, id);
  if (idx === -1) {
    return { list: hotels, removed: false };
  }
  const next = hotels.slice();
  next.splice(idx, 1);
  return { list: next, removed: true };
}
