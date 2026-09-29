/**
 * 宾馆状态纯函数 —— 对 state.hotels 数组的增量操作，无副作用，可独立测试。
 */

/**
 * @typedef {{id?: any}} EntityWithOptionalId
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
 * @param {Array<EntityWithOptionalId>} hotels
 * @param {any} id
 * @returns {number}
 */
export function findHotelIndexById(hotels, id) {
  return hotels.findIndex((h) => String(h.id) === String(id));
}

/**
 * @template {EntityWithOptionalId} T
 * @param {T[]} hotels
 * @param {T} hotel
 * @returns {T[]}
 */
export function appendHotelToList(hotels, hotel) {
  return [...hotels, hotel];
}

/**
 * @template {EntityWithOptionalId} T
 * @param {T[]} hotels
 * @param {T} updatedHotel
 * @param {any} [fallbackId]
 * @returns {{list: T[], replaced: boolean}}
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
 * @template {EntityWithOptionalId} T
 * @param {T[]} hotels
 * @param {any} id
 * @returns {{list: T[], removed: boolean}}
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

/**
 * Restore a removed item without replacing unrelated concurrent changes.
 * @template {EntityWithOptionalId} T
 * @param {T[]} hotels
 * @param {T} hotel
 * @param {number} index
 * @returns {T[]}
 */
export function insertHotelAtIndex(hotels, hotel, index) {
  if (findHotelIndexById(hotels, hotel.id) >= 0) return hotels;
  const next = hotels.slice();
  const safeIndex = Math.max(0, Math.min(Number(index) || 0, next.length));
  next.splice(safeIndex, 0, hotel);
  return next;
}

/**
 * Restore selected fields on the latest record so another completed mutation is preserved.
 * @template {EntityWithOptionalId} T
 * @param {T[]} hotels
 * @param {any} id
 * @param {T} snapshot
 * @param {string[]} fields
 * @returns {T[]}
 */
export function restoreHotelFields(hotels, id, snapshot, fields) {
  const index = findHotelIndexById(hotels, id);
  if (index < 0) return hotels;
  const restored = /** @type {Record<string, any>} */ ({ ...hotels[index] });
  for (const field of fields) {
    restored[field] = snapshot[field];
  }
  const next = hotels.slice();
  next[index] = /** @type {T} */ (restored);
  return next;
}
