/**
 * DOM 辅助工具 —— 封装常用的 DOM 查询、取值、设值和 HTML 转义操作。
 */

const escapeHtmlCache = new Map();
const ESCAPE_CACHE_MAX_SIZE = 500;

/**
 * @param {string} id
 * @returns {HTMLElement|null}
 */
export const $ = (id) => document.getElementById(id);

/**
 * @param {string} id
 * @param {string} [defaultValue]
 * @returns {string}
 */
export const getValue = (id, defaultValue = '') => {
  const el = /** @type {HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement|null} */ ($(id));
  return el ? el.value : defaultValue;
};

/**
 * @param {string} id
 * @param {unknown} value
 */
export const setValue = (id, value) => {
  const el = /** @type {HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement|null} */ ($(id));
  if (el) el.value = /** @type {string} */ (value);
};

/**
 * @param {string} id
 * @returns {boolean}
 */
export const getChecked = (id) => {
  const el = /** @type {HTMLInputElement|null} */ ($(id));
  return el ? el.checked : false;
};

/**
 * @param {string} id
 * @param {boolean} checked
 */
export const setChecked = (id, checked) => {
  const el = /** @type {HTMLInputElement|null} */ ($(id));
  if (el) el.checked = checked;
};

/**
 * @param {string} id
 * @param {string} text
 */
export const setText = (id, text) => {
  const el = $(id);
  if (el) el.textContent = text;
};

/**
 * @param {string} id
 * @param {string} html
 */
export const setHtml = (id, html) => {
  const el = $(id);
  if (el) el.innerHTML = html;
};

/**
 * @param {string} id
 * @param {string} event
 * @param {(event: Event) => void} handler
 */
export const addEvent = (id, event, handler) => {
  const el = $(id);
  if (el) el.addEventListener(event, handler);
};

/**
 * @param {string} id
 * @param {string} className
 */
export const addClass = (id, className) => {
  const el = $(id);
  if (el) el.classList.add(className);
};

/**
 * @param {string} id
 * @param {string} className
 */
export const removeClass = (id, className) => {
  const el = $(id);
  if (el) el.classList.remove(className);
};

/**
 * @param {string} id
 * @param {keyof CSSStyleDeclaration} property
 * @param {string} value
 */
export const setStyle = (id, property, value) => {
  const el = $(id);
  if (el) {
    const style = /** @type {any} */ (el.style);
    style[property] = value;
  }
};

/**
 * @param {unknown} text
 * @returns {string}
 */
export function escapeHtml(text) {
  const normalizedText = text === null || text === undefined ? '' : String(text);
  if (normalizedText === '') return '';
  if (escapeHtmlCache.has(normalizedText)) {
    return escapeHtmlCache.get(normalizedText);
  }
  const div = document.createElement('div');
  div.textContent = normalizedText;
  const result = div.innerHTML;
  if (escapeHtmlCache.size >= ESCAPE_CACHE_MAX_SIZE) {
    const firstKey = escapeHtmlCache.keys().next().value;
    escapeHtmlCache.delete(firstKey);
  }
  escapeHtmlCache.set(normalizedText, result);
  return result;
}

export function escapeHtmlWithLineBreaks(text) {
  return escapeHtml(text).replace(/\r?\n/g, '<br>');
}

export function idsEqual(left, right) {
  return String(left) === String(right);
}

export function normalizeIdValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalizedText = String(value).trim();
  if (normalizedText === '') return null;
  return /^-?\d+$/.test(normalizedText) ? Number(normalizedText) : normalizedText;
}

export function getSelectionKey(id) {
  return String(id);
}

export function hasDisplayValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

export function formatDateChinese(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${year}年${month}月${day}日`;
}

export function getRoomCountText(count) {
  if (!count) return '-';
  return `${count}人`;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeFilterOptionKey(value) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('zh-CN');
}
