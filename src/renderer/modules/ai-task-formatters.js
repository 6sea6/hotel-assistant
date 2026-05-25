/**
 * Pure formatting and URL extraction helpers for the AI task console.
 *
 * @typedef {import('../../shared/contracts').TemplateRecord} TemplateRecord
 */

/** @type {Record<string, string>} */
export const TOOL_LABELS = {
  get_task_status: '获取任务状态',
  list_templates: '读取模板列表',
  get_settings: '读取比较助手设置',
  collect_and_write_ctrip_hotel: '采集携程酒店页面',
  refresh_existing_ctrip_hotels: '更新已有宾馆数据',
  open_visible_edge_login: '打开 Edge 登录准备窗口',
  prepare_edge: '准备 Edge 登录态',
  calculate_traffic: '计算交通与地铁信息',
  write_result: '回写采集结果'
};

// Duplicated from src/shared/url-constants.js — renderer uses ESM, cannot import CJS.
export const TRAILING_URL_PUNCTUATION = /[)\]}>，。；;、！？!?.,]+$/;
export const INLINE_URL_TEXT_SEPARATOR = /[,，。；;、！？!?](?=[\u4e00-\u9fff])/;

/**
 * @param {string|number|Date|null|undefined} value
 * @returns {string}
 */
export function formatAiTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

/**
 * @param {Partial<TemplateRecord>} [template]
 * @returns {string}
 */
export function formatAiTemplateLabel(template = {}) {
  const id = template.id ?? '';
  const labelParts = [
    template.name || `模板 ${id}`,
    template.destination,
    template.check_in_date && template.check_out_date
      ? `${template.check_in_date} 至 ${template.check_out_date}`
      : '',
    template.room_count ? `${template.room_count}人` : ''
  ].filter(Boolean);
  return labelParts.join(' · ');
}

/**
 * @param {unknown} text
 * @returns {string}
 */
export function extractCtripUrl(text) {
  return extractCtripUrls(text)[0] || '';
}

/**
 * @param {unknown} text
 * @returns {string[]}
 */
export function extractCtripUrls(text) {
  const seen = new Set();
  const matches = String(text || '').match(/https?:\/\/[^\s"'<>]+/gi) || [];
  return matches
    .map((match) => {
      let cleaned = match.replace(/&amp;/g, '&').trim();
      const inlineTextIndex = cleaned.search(INLINE_URL_TEXT_SEPARATOR);
      if (inlineTextIndex > 0) {
        cleaned = cleaned.slice(0, inlineTextIndex);
      }
      while (TRAILING_URL_PUNCTUATION.test(cleaned)) {
        cleaned = cleaned.replace(TRAILING_URL_PUNCTUATION, '');
      }
      return cleaned;
    })
    .filter((url) => {
      if (!url || seen.has(url)) return false;
      try {
        const parsed = new URL(url);
        const hostAllowed = /(^|\.)ctrip\.com$/i.test(parsed.hostname);
        const hotelPage = /hotel|hotels/i.test(parsed.href);
        if (!hostAllowed || !hotelPage) return false;
        seen.add(url);
        return true;
      } catch (_error) {
        return false;
      }
    });
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function formatCurrency(value) {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return `¥${number.toFixed(number % 1 === 0 ? 0 : 2)}`;
}

/**
 * @param {string} toolName
 * @returns {string}
 */
export function getReadableToolLabel(toolName) {
  if (!toolName) return '';
  return TOOL_LABELS[toolName] || `正在执行：${toolName}`;
}
