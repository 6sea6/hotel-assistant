/**
 * DOM 辅助工具 —— 封装常用的 DOM 查询、取值、设值和 HTML 转义操作。
 */

const escapeHtmlCache = new Map();
const ESCAPE_CACHE_MAX_SIZE = 500;

export const $ = (id) => document.getElementById(id);

export const getValue = (id, defaultValue = '') => {
  const el = $(id);
  return el ? el.value : defaultValue;
};

export const setValue = (id, value) => {
  const el = $(id);
  if (el) el.value = value;
};

export const getChecked = (id) => {
  const el = $(id);
  return el ? el.checked : false;
};

export const setChecked = (id, checked) => {
  const el = $(id);
  if (el) el.checked = checked;
};

export const setText = (id, text) => {
  const el = $(id);
  if (el) el.textContent = text;
};

export const setHtml = (id, html) => {
  const el = $(id);
  if (el) el.innerHTML = html;
};

export const addEvent = (id, event, handler) => {
  const el = $(id);
  if (el) el.addEventListener(event, handler);
};

export const addClass = (id, className) => {
  const el = $(id);
  if (el) el.classList.add(className);
};

export const removeClass = (id, className) => {
  const el = $(id);
  if (el) el.classList.remove(className);
};

export const setStyle = (id, property, value) => {
  const el = $(id);
  if (el) el.style[property] = value;
};

export function escapeHtml(text) {
  if (!text) return '';
  if (escapeHtmlCache.has(text)) {
    return escapeHtmlCache.get(text);
  }
  const div = document.createElement('div');
  div.textContent = text;
  const result = div.innerHTML;
  if (escapeHtmlCache.size >= ESCAPE_CACHE_MAX_SIZE) {
    const firstKey = escapeHtmlCache.keys().next().value;
    escapeHtmlCache.delete(firstKey);
  }
  escapeHtmlCache.set(text, result);
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

export function normalizeFilterOptionKey(value) {
  return String(value ?? '').trim().toLocaleLowerCase('zh-CN');
}
