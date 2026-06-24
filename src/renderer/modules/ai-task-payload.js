import { state } from './state.js';
import { getValue, setChecked, setValue } from './dom-helpers.js';
import { extractCtripUrls, updateAiInputCount as updateTaskInputCount } from './ai-task-console.js';
import '../../shared/settings-normalizers.js';

const { normalizeCollectBatchConcurrency, normalizeCollectBrowser } =
  globalThis.HotelComparisonSettingsNormalizers;

/**
 * @typedef {import('../../shared/contracts').AiListFilters} AiListFilters
 * @typedef {import('../../shared/contracts').AiListUrlFilters} AiListUrlFilters
 * @typedef {import('../../shared/contracts').AiTaskPayload} AiTaskPayload
 * @typedef {import('../../shared/contracts').AiTaskQueueItem} AiTaskQueueItem
 * @typedef {import('../../shared/contracts').CtripUrlFilterSettings} CtripUrlFilterSettings
 * @typedef {import('../../shared/contracts').TemplateRecord} TemplateRecord
 */

export function getSubmittedUrls() {
  return extractCtripUrls(getValue('aiHotelUrlInput'));
}

export function getSubmittedUrl() {
  return getSubmittedUrls()[0] || '';
}

function hasSubmittedHttpUrl() {
  return /https?:\/\/\S+/i.test(getValue('aiHotelUrlInput'));
}

export function detectSubmittedTaskInput() {
  const rawInput = getValue('aiHotelUrlInput').trim();
  if (!rawInput) {
    return {
      inputMode: 'empty',
      rawInput,
      url: '',
      addressQuery: ''
    };
  }

  if (hasSubmittedHttpUrl()) {
    return {
      inputMode: 'url',
      rawInput,
      url: getSubmittedUrl(),
      addressQuery: ''
    };
  }

  return {
    inputMode: 'address',
    rawInput,
    url: '',
    addressQuery: rawInput
  };
}

function getCurrentAiSearchMode() {
  const input = detectSubmittedTaskInput();
  return input.inputMode === 'url' ? 'url' : 'address';
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
 * @returns {string[]}
 */
function parseSelectionSetting(value) {
  const values = Array.isArray(value) ? value : parseKeywordInput(value);
  const seen = new Set();
  return values
    .map((item) => String(item || '').trim())
    .filter((item) => item && !seen.has(item) && seen.add(item));
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

function parseDateOnlyMs(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  const date = new Date(ms);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return ms;
}

/**
 * @param {TemplateRecord|null|undefined} template
 * @returns {number|null}
 */
export function getTemplateStayDays(template) {
  const checkInMs = parseDateOnlyMs(template && template.check_in_date);
  const checkOutMs = parseDateOnlyMs(template && template.check_out_date);
  if (checkInMs === null || checkOutMs === null || checkOutMs <= checkInMs) {
    return null;
  }
  const days = Math.round((checkOutMs - checkInMs) / 86400000);
  return days > 0 ? days : null;
}

function multiplyPriceByFactor(value, factor) {
  return typeof value === 'number' && Number.isFinite(value) ? value * factor : value;
}

/**
 * @param {TemplateRecord|null|undefined} template
 * @returns {number|null}
 */
function getTemplateRoomCount(template) {
  const roomCount = parseOptionalNumber(template && template.room_count, {
    integer: true,
    min: 1
  });
  return roomCount && roomCount > 0 ? roomCount : null;
}

/**
 * @param {TemplateRecord|null|undefined} template
 * @returns {number|null}
 */
function getTemplateStayPriceMultiplier(template) {
  const days = getTemplateStayDays(template);
  const roomCount = getTemplateRoomCount(template);
  return days && roomCount ? days * roomCount : null;
}

/**
 * 前筛界面输入的是每日人均价；携程 URL 价格筛选仍接收入住总价。
 *
 * @param {CtripUrlFilterSettings} filters
 * @param {TemplateRecord|null|undefined} template
 * @returns {CtripUrlFilterSettings}
 */
export function convertPerPersonDailyPriceFiltersToStayTotal(filters = {}, template = null) {
  const multiplier = getTemplateStayPriceMultiplier(template);
  if (!multiplier) {
    return { ...filters };
  }

  return {
    ...filters,
    priceMin: multiplyPriceByFactor(filters.priceMin, multiplier),
    priceMax: multiplyPriceByFactor(filters.priceMax, multiplier)
  };
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
  if (Array.isArray(filters.accommodationTypes) && filters.accommodationTypes.length) {
    active.accommodationTypeMode =
      filters.accommodationTypeMode === 'exclude' ? 'exclude' : 'include';
    active.accommodationTypes = filters.accommodationTypes;
  }
  if (Array.isArray(filters.roomTypes) && filters.roomTypes.length)
    active.roomTypes = filters.roomTypes;
  if (Array.isArray(filters.roomFeatures) && filters.roomFeatures.length)
    active.roomFeatures = filters.roomFeatures;
  if (Array.isArray(filters.featureThemes) && filters.featureThemes.length)
    active.featureThemes = filters.featureThemes;

  return active;
}

/**
 * @template {Record<string, unknown>} T
 * @param {T} payload
 * @returns {Partial<T>}
 */
function omitUndefinedFields(payload) {
  return /** @type {Partial<T>} */ (
    Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined))
  );
}

/**
 * @param {{activeOnly?: boolean, template?: TemplateRecord|null}} [options]
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
    ctripScoreMin: parseScoreSetting(settings.aiCtripScoreMin),
    accommodationTypeMode:
      String(settings.aiCtripAccommodationTypeMode || '').trim() === 'exclude'
        ? 'exclude'
        : 'include',
    accommodationTypes: parseSelectionSetting(settings.aiCtripAccommodationTypes),
    roomTypes: parseSelectionSetting(settings.aiCtripRoomTypes),
    roomFeatures: parseSelectionSetting(settings.aiCtripRoomFeatures),
    featureThemes: parseSelectionSetting(settings.aiCtripFeatureThemes)
  };
  const resolvedFilters = convertPerPersonDailyPriceFiltersToStayTotal(filters, options.template);

  return options.activeOnly ? compactActiveCtripUrlFilters(resolvedFilters) : resolvedFilters;
}

function applyChoiceButtonsToDom(settingKey, values = []) {
  const selected = new Set((Array.isArray(values) ? values : []).map((item) => String(item)));
  document
    .querySelectorAll(`[data-setting-key="${settingKey}"][data-option-value]`)
    .forEach((button) => {
      const optionButton = /** @type {HTMLElement} */ (button);
      const isSelected = selected.has(String(optionButton.dataset.optionValue || ''));
      optionButton.classList.toggle('is-selected', isSelected);
      optionButton.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    });
}

function applyAccommodationModeToDom(mode) {
  const normalizedMode = mode === 'exclude' ? 'exclude' : 'include';
  document.querySelectorAll('[data-accommodation-type-mode]').forEach((button) => {
    const modeButton = /** @type {HTMLElement} */ (button);
    const isSelected = modeButton.dataset.accommodationTypeMode === normalizedMode;
    modeButton.classList.toggle('is-selected', isSelected);
    modeButton.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  });
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
  applyAccommodationModeToDom(settings.aiCtripAccommodationTypeMode);
  applyChoiceButtonsToDom('aiCtripAccommodationTypes', settings.aiCtripAccommodationTypes);
  applyChoiceButtonsToDom('aiCtripRoomTypes', settings.aiCtripRoomTypes);
  applyChoiceButtonsToDom('aiCtripRoomFeatures', settings.aiCtripRoomFeatures);
  applyChoiceButtonsToDom('aiCtripFeatureThemes', settings.aiCtripFeatureThemes);
}

function keepCtripUrlFilterSettingsFromDom() {
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
    keepCtripUrlFilterSettingsFromDom();
    return parsed;
  } catch (error) {
    console.warn('解析携程列表页 URL 前筛失败:', error);
    return null;
  }
}

/**
 * @param {{activeOnly?: boolean, mode?: string, template?: TemplateRecord|null}} [options]
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
        activeOnly: options.activeOnly || options.mode === 'activeOnly',
        template: options.template
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
  if (getCurrentAiSearchMode() === 'address') {
    return;
  }
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
  /** @type {AiListFilters} */
  const listFilters = {};

  if (desiredHotelCount !== null) listFilters.desiredHotelCount = desiredHotelCount;

  return listFilters;
}

/**
 * @returns {1|2|3}
 */
export function readCollectBatchConcurrency() {
  return normalizeCollectBatchConcurrency(state.settings.collectBatchConcurrency);
}

/**
 * @returns {'edge'|'360'}
 */
export function readCollectBrowser() {
  return normalizeCollectBrowser(state.settings.collectBrowser);
}

/**
 * @param {AiTaskQueueItem} task
 * @returns {AiTaskPayload}
 */
export function buildTaskPayload(task) {
  const listFilters =
    task.listFilters && typeof task.listFilters === 'object' ? task.listFilters : {};
  const listUrlFilters =
    task.listUrlFilters ||
    readCtripUrlFilterSettings({ activeOnly: true, template: task.template });
  const inputMode = task.inputMode === 'address' ? 'address' : 'url';
  return omitUndefinedFields({
    templateId: task.templateId,
    templateName: task.templateName || '',
    inputMode: inputMode === 'address' ? inputMode : undefined,
    addressQuery: inputMode === 'address' ? task.addressQuery : undefined,
    url: inputMode === 'address' ? undefined : task.url,
    listFilters,
    listUrlFilters,
    desiredHotelCount: listFilters.desiredHotelCount,
    amapKey: String(state.settings.amapApiKey || '').trim() || undefined,
    priceMin: listUrlFilters ? listUrlFilters.priceMin : undefined,
    priceMax: listUrlFilters ? listUrlFilters.priceMax : undefined,
    starLevels: listUrlFilters ? listUrlFilters.starLevels : undefined,
    sortMode: listUrlFilters ? listUrlFilters.sortMode : undefined,
    freeCancel: listUrlFilters ? listUrlFilters.freeCancel : undefined,
    reviewCountMin: listUrlFilters ? listUrlFilters.reviewCountMin : undefined,
    ctripScoreMin: listUrlFilters ? listUrlFilters.ctripScoreMin : undefined,
    accommodationTypeMode: listUrlFilters ? listUrlFilters.accommodationTypeMode : undefined,
    accommodationTypes: listUrlFilters ? listUrlFilters.accommodationTypes : undefined,
    roomTypes: listUrlFilters ? listUrlFilters.roomTypes : undefined,
    roomFeatures: listUrlFilters ? listUrlFilters.roomFeatures : undefined,
    featureThemes: listUrlFilters ? listUrlFilters.featureThemes : undefined,
    enableCollectPerfLog: Boolean(state.settings.enableCollectPerfLog),
    collectBrowser: readCollectBrowser(),
    batchConcurrency: readCollectBatchConcurrency()
  });
}

export function updateAiInputCount() {
  updateTaskInputCount();
}
