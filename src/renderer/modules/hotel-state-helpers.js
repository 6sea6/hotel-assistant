/**
 * 宾馆状态纯函数 —— 对 state.hotels 数组的增量操作，无副作用，可独立测试。
 */

/**
 * 校验 IPC 返回值，拦截 { success:false, error } 和 null/undefined。
 *
 * @param {any} result
 * @param {string} fallbackMessage
 * @returns {any} result 当校验通过时原样返回
 */
export function assertSavedHotelResult(result, fallbackMessage) {
  if (!result || result.success === false) {
    throw new Error(result?.error || fallbackMessage);
  }
  return result;
}

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
