/**
 * 酒店列表渲染决策 —— 判断一次列表变更是否必须全量重排。
 *
 * 这里保持纯函数，具体 DOM patch 和调度仍放在 hotel-list.js。
 */

/**
 * @typedef {'full'|'patch'} HotelListRenderMode
 * @typedef {object} HotelListRenderRequest
 * @property {string} [reason]
 * @property {Array<string|number|null|undefined>|Set<string|number|null|undefined>} [changedIds]
 * @property {boolean} [forceFull]
 * @property {boolean} [renderScheduled]
 * @property {boolean} [hasPendingRenderResume]
 * @typedef {object} HotelListRenderDecision
 * @property {HotelListRenderMode} mode
 * @property {string[]} changedIds
 * @property {string} reason
 */

const FULL_RERENDER_REASONS = new Set([
  'filter-change',
  'sort-change',
  'hotel-add',
  'batch-delete',
  'template-sync',
  'view-mode-change',
  'data-reload',
  'settings-change',
  'rule-delete',
  'fallback'
]);

const PATCHABLE_REASONS = new Set(['favorite', 'hotel-update', 'hotel-delete']);

/**
 * @param {string|null|undefined} reason
 * @returns {boolean}
 */
export function shouldFullRerender(reason) {
  const normalizedReason = String(reason || '').trim();
  if (!normalizedReason) return true;
  if (PATCHABLE_REASONS.has(normalizedReason)) return false;
  return FULL_RERENDER_REASONS.has(normalizedReason) || !PATCHABLE_REASONS.has(normalizedReason);
}

/**
 * @param {HotelListRenderRequest['changedIds']} changedIds
 * @returns {string[]}
 */
export function normalizeChangedIds(changedIds) {
  const source = changedIds instanceof Set ? Array.from(changedIds) : changedIds;
  if (!Array.isArray(source)) return [];

  const result = [];
  const seen = new Set();
  for (const id of source) {
    const value = String(id ?? '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

/**
 * @param {HotelListRenderRequest} request
 * @returns {HotelListRenderDecision}
 */
export function getHotelListRenderDecision(request = {}) {
  const reason = String(request.reason || 'fallback').trim() || 'fallback';
  const changedIds = normalizeChangedIds(request.changedIds);
  const mustFullRender =
    Boolean(request.forceFull) ||
    Boolean(request.renderScheduled) ||
    Boolean(request.hasPendingRenderResume) ||
    shouldFullRerender(reason) ||
    changedIds.length === 0;

  return {
    mode: mustFullRender ? 'full' : 'patch',
    changedIds,
    reason
  };
}
