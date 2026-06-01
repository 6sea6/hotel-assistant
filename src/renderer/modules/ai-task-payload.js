import { state } from './state.js';
import { getValue, setChecked, setValue } from './dom-helpers.js';
import {
  extractCtripUrls,
  updateAiInputCount as updateTaskInputCount
} from './ai-task-console.js';

/**
 * @typedef {import('../../shared/contracts').AiListFilters} AiListFilters
 * @typedef {import('../../shared/contracts').AiListUrlFilters} AiListUrlFilters
 * @typedef {import('../../shared/contracts').AiTaskPayload} AiTaskPayload
 * @typedef {import('../../shared/contracts').AiTaskQueueItem} AiTaskQueueItem
 * @typedef {import('../../shared/contracts').CtripUrlFilterSettings} CtripUrlFilterSettings
 */

export function getSubmittedUrls() {
  return extractCtripUrls(getValue('aiHotelUrlInput'));
}

export function getSubmittedUrl() {
  return getSubmittedUrls()[0] || '';
}

function isCtripListUrl(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    return (
      /(^|\.)ctrip\.com$/i.test(parsed.hostname) &&
      /hotel|hotels/i.test(parsed.href) &&
      /list|hotelsearch|search|query|keyword|city|location|zone/i.test(parsed.href) &&
      !/[?&]hotel[Ii]d=\d+/.test(parsed.search) &&
      !/\/hotels\/\d+\.html/i.test(parsed.pathname)
    );
  } catch (_error) {
    return false;
  }
}

/**
 * @param {unknown} value
 * @param {{integer?: boolean, min?: number}} [options]
 * @returns {number|null}
 */
function parseOptionalNumber(value, options = {}) {
  const text = String(value || '').trim();
  if (!text) return null;
  const number = Number(text);
  if (!Number.isFinite(number)) return null;
  if (options.integer) {
    return Math.max(options.min || 1, Math.trunc(number));
  }
  return number;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function parseKeywordInput(value) {
  return String(value || '')
    .split(/[,，;；\n\r|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * @param {unknown} value
 * @param {{min?: number, allowed?: number[]}} [options]
 * @returns {number|null}
 */
function parseIntegerSetting(value, options = {}) {
  const number = parseOptionalNumber(value, {
    integer: true,
    min: options.min ?? 0
  });
  if (number === null) return null;
  if (options.allowed && !options.allowed.includes(number)) return null;
  return number;
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function parseScoreSetting(value) {
  const number = parseOptionalNumber(value);
  return [4, 4.5, 4.7].includes(number) ? number : null;
}

/**
 * @param {unknown} value
 * @returns {number|'max'|null}
 */
function parsePriceMaxSetting(value) {
  const text = String(value || '')
    .trim()
    .toLowerCase();
  if (!text) return null;
  if (text === 'max') return 'max';
  return parseIntegerSetting(text, { min: 0 });
}

/**
 * @param {CtripUrlFilterSettings} [filters]
 * @returns {CtripUrlFilterSettings}
 */
function compactActiveCtripUrlFilters(filters = {}) {
  /** @type {CtripUrlFilterSettings} */
  const active = {};
  const hasPriceMin = filters.priceMin !== null && filters.priceMin !== undefined;
  const hasPriceMax = filters.priceMax !== null && filters.priceMax !== undefined;

  if (hasPriceMin) active.priceMin = filters.priceMin;
  if (hasPriceMax) active.priceMax = filters.priceMax;
  if (Array.isArray(filters.starLevels) && filters.starLevels.length)
    active.starLevels = filters.starLevels;
  if (filters.sortMode) active.sortMode = filters.sortMode;
  if (filters.freeCancel === true) active.freeCancel = true;
  if (filters.reviewCountMin !== null && filters.reviewCountMin !== undefined)
    active.reviewCountMin = filters.reviewCountMin;
  if (filters.ctripScoreMin !== null && filters.ctripScoreMin !== undefined)
    active.ctripScoreMin = filters.ctripScoreMin;

  return active;
}

function hasActiveCtripUrlFilterSettings() {
  return Object.keys(readCtripUrlFilterSettings({ activeOnly: true })).length > 0;
}

/**
 * @param {{activeOnly?: boolean}} [options]
 * @returns {CtripUrlFilterSettings}
 */
export function readCtripUrlFilterSettings(options = {}) {
  const settings = state.settings || {};
  const starLevels = Array.isArray(settings.aiCtripStarLevels)
    ? settings.aiCtripStarLevels
    : parseKeywordInput(settings.aiCtripStarLevels);

  const filters = {
    priceMin: parseIntegerSetting(settings.aiCtripPriceMin, { min: 0 }),
    priceMax: parsePriceMaxSetting(settings.aiCtripPriceMax),
    starLevels: starLevels
      .map((item) => Number(item))
      .filter((item) => [2, 3, 4, 5].includes(item)),
    sortMode: ['popularity', 'price_low', 'review_high'].includes(settings.aiCtripSortMode)
      ? settings.aiCtripSortMode
      : null,
    freeCancel: Boolean(settings.aiCtripFreeCancel),
    reviewCountMin: parseIntegerSetting(settings.aiCtripReviewCountMin, {
      allowed: [100, 200, 500]
    }),
    ctripScoreMin: parseScoreSetting(settings.aiCtripScoreMin)
  };

  return options.activeOnly ? compactActiveCtripUrlFilters(filters) : filters;
}

function applyCtripUrlFilterSettingsToDom() {
  const settings = state.settings || {};
  setValue('aiCtripPriceMin', settings.aiCtripPriceMin ?? '');
  setValue('aiCtripPriceMax', settings.aiCtripPriceMax ?? '');
  setValue('aiCtripSortMode', settings.aiCtripSortMode || '');
  setValue('aiCtripReviewCountMin', settings.aiCtripReviewCountMin ?? '');
  setValue('aiCtripScoreMin', settings.aiCtripScoreMin ?? '');
  setChecked('aiCtripFreeCancel', Boolean(settings.aiCtripFreeCancel));

  const selected = new Set(
    (Array.isArray(settings.aiCtripStarLevels) ? settings.aiCtripStarLevels : []).map((item) =>
      String(item)
    )
  );
  document.querySelectorAll('[data-star-level]').forEach((button) => {
    const starButton = /** @type {HTMLElement} */ (button);
    const isSelected = selected.has(String(starButton.dataset.starLevel));
    starButton.classList.toggle('is-selected', isSelected);
    starButton.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  });
}

async function persistCtripUrlFilterSettingsFromParsed(parsed) {
  const known = parsed && parsed.knownSettings ? parsed.knownSettings : {};
  const detected = new Set(
    Array.isArray(parsed && parsed.detectedKnownFilterKeys) ? parsed.detectedKnownFilterKeys : []
  );
  if (!detected.size) {
    applyCtripUrlFilterSettingsToDom();
    return;
  }
  if (hasActiveCtripUrlFilterSettings()) {
    applyCtripUrlFilterSettingsToDom();
    return;
  }

  const updates = {};
  if (detected.has('priceMin')) updates.aiCtripPriceMin = known.priceMin ?? '';
  if (detected.has('priceMax')) updates.aiCtripPriceMax = known.priceMax ?? '';
  if (detected.has('starLevels'))
    updates.aiCtripStarLevels = Array.isArray(known.starLevels) ? known.starLevels : [];
  if (detected.has('sortMode')) updates.aiCtripSortMode = known.sortMode || '';
  if (detected.has('freeCancel')) updates.aiCtripFreeCancel = Boolean(known.freeCancel);
  if (detected.has('reviewCountMin')) updates.aiCtripReviewCountMin = known.reviewCountMin ?? '';
  if (detected.has('ctripScoreMin')) updates.aiCtripScoreMin = known.ctripScoreMin ?? '';

  const entries = Object.entries(updates);
  const changed = entries.filter(
    ([key, value]) => JSON.stringify(state.settings[key] ?? '') !== JSON.stringify(value)
  );
  if (!changed.length) {
    applyCtripUrlFilterSettingsToDom();
    return;
  }

  await Promise.all(changed.map(([key, value]) => window.electronAPI.setSetting(key, value)));
  entries.forEach(([key, value]) => {
    state.settings[key] = value;
  });
  applyCtripUrlFilterSettingsToDom();
}

export async function syncCtripListUrlSettingsFromInput() {
  const url = getSubmittedUrl();
  if (!url || !isCtripListUrl(url) || !window.electronAPI?.ai?.parseCtripListUrl) {
    return null;
  }
  try {
    const parsedUrl = new URL(url);
    if (!parsedUrl.searchParams.has('listFilters')) {
      return null;
    }
  } catch (_error) {
    return null;
  }

  try {
    const parsed = await window.electronAPI.ai.parseCtripListUrl(url);
    await persistCtripUrlFilterSettingsFromParsed(parsed);
    return parsed;
  } catch (error) {
    console.warn('解析携程列表页 URL 前筛失败:', error);
    return null;
  }
}

/**
 * @param {{activeOnly?: boolean, mode?: string}} [options]
 * @returns {Promise<string>}
 */
export async function syncAiCtripListUrlFromSettings(options = {}) {
  const url = getSubmittedUrl();
  const inputText = getValue('aiHotelUrlInput');
  if (!url || !isCtripListUrl(url) || !window.electronAPI?.ai?.buildCtripListUrl) {
    return url;
  }

  try {
    const nextUrl = await window.electronAPI.ai.buildCtripListUrl({
      baseUrl: url,
      settings: readCtripUrlFilterSettings({
        activeOnly: options.activeOnly || options.mode === 'activeOnly'
      })
    });
    if (nextUrl && nextUrl !== url) {
      setValue(
        'aiHotelUrlInput',
        inputText.includes(url) ? inputText.replace(url, nextUrl) : nextUrl
      );
      updateTaskInputCount();
    }
    return nextUrl || url;
  } catch (error) {
    console.warn('生成携程列表页 URL 前筛失败:', error);
    return url;
  }
}

let ctripListUrlSyncTimer = null;

export function handleAiTaskInputChange() {
  updateTaskInputCount();
  if (ctripListUrlSyncTimer) {
    clearTimeout(ctripListUrlSyncTimer);
  }
  ctripListUrlSyncTimer = setTimeout(() => {
    void syncCtripListUrlSettingsFromInput();
  }, 350);
}

/**
 * @returns {AiListFilters}
 */
export function readListFilterForm() {
  const settings = state.settings || {};
  const desiredHotelCount = parseOptionalNumber(settings.aiListDesiredHotelCount, {
    integer: true,
    min: 1
  });
  const excludeHotelTypes = parseKeywordInput(settings.aiListExcludeHotelTypes);
  /** @type {AiListFilters} */
  const listFilters = {};

  if (desiredHotelCount !== null) listFilters.desiredHotelCount = desiredHotelCount;
  if (excludeHotelTypes.length) listFilters.excludeHotelTypes = excludeHotelTypes;

  return listFilters;
}

/**
 * @returns {1|2}
 */
export function readCollectBatchConcurrency() {
  return Number(state.settings.collectBatchConcurrency) === 2 ? 2 : 1;
}

/**
 * @param {AiTaskQueueItem} task
 * @returns {AiTaskPayload}
 */
export function buildTaskPayload(task) {
  const listFilters =
    task.listFilters && typeof task.listFilters === 'object' ? task.listFilters : {};
  return {
    templateId: task.templateId,
    templateName: task.templateName || '',
    url: task.url,
    listFilters,
    listUrlFilters: task.listUrlFilters || readCtripUrlFilterSettings({ activeOnly: true }),
    desiredHotelCount: listFilters.desiredHotelCount,
    excludeHotelTypes: listFilters.excludeHotelTypes,
    amapKey: String(state.settings.amapApiKey || '').trim() || undefined,
    priceMin: task.listUrlFilters ? task.listUrlFilters.priceMin : undefined,
    priceMax: task.listUrlFilters ? task.listUrlFilters.priceMax : undefined,
    starLevels: task.listUrlFilters ? task.listUrlFilters.starLevels : undefined,
    sortMode: task.listUrlFilters ? task.listUrlFilters.sortMode : undefined,
    freeCancel: task.listUrlFilters ? task.listUrlFilters.freeCancel : undefined,
    reviewCountMin: task.listUrlFilters ? task.listUrlFilters.reviewCountMin : undefined,
    ctripScoreMin: task.listUrlFilters ? task.listUrlFilters.ctripScoreMin : undefined,
    enableCollectPerfLog: Boolean(state.settings.enableCollectPerfLog),
    batchConcurrency: readCollectBatchConcurrency()
  };
}

export function updateAiInputCount() {
  updateTaskInputCount();
}
