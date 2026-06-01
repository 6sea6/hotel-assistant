import { state } from './state.js';
import { $, escapeHtml, getValue } from './dom-helpers.js';
import { formatAiTemplateLabel } from './ai-task-console.js';
import {
  destroyCustomSelect,
  enhanceCustomSelect,
  getCustomSelectInstance,
  refreshCustomSelect
} from './custom-select.js';

/**
 * @typedef {import('../../shared/contracts').TemplateRecord} TemplateRecord
 */

export function renderAiTemplateOptions() {
  const select = /** @type {HTMLSelectElement|null} */ ($('aiTemplateSelect'));
  if (!select) return;

  const currentValue = select.value;
  select.innerHTML =
    '<option value="">请选择模板</option>' +
    (state.templates || [])
      .map((template) => {
        const id = template.id ?? '';
        return `<option value="${escapeHtml(String(id))}">${escapeHtml(formatAiTemplateLabel(template))}</option>`;
      })
      .join('');

  if (currentValue && Array.from(select.options).some((option) => option.value === currentValue)) {
    select.value = currentValue;
  }
  refreshCustomSelect(select);
}

export function setupAiTemplatePicker() {
  if (state.aiTemplatePickerBound) return;

  const select = /** @type {HTMLSelectElement|null} */ ($('aiTemplateSelect'));
  if (!select) return;

  // 保护：如果 select 已被默认 auto 增强抢先，先销毁再用 existingElements 重新增强
  const expectedWrapper = $('aiTemplatePicker');
  const existingCtx = getCustomSelectInstance(select);
  if (existingCtx && existingCtx.wrapper !== expectedWrapper) {
    destroyCustomSelect(select);
  }

  const ctx = enhanceCustomSelect(select, {
    wrapperClass: 'ai-template-picker custom-select',
    buttonClass: 'input ai-template-picker-button custom-select-button',
    textClass: 'ai-template-picker-text custom-select-text',
    caretClass: 'ai-template-picker-caret custom-select-caret',
    menuClass: 'ai-template-picker-menu custom-select-menu',
    optionClass: 'ai-template-picker-option custom-select-option',
    existingElements: {
      wrapper: expectedWrapper,
      button: $('aiTemplatePickerButton'),
      textSpan: $('aiTemplatePickerText'),
      menu: $('aiTemplatePickerMenu')
    }
  });

  if (ctx) {
    state.aiTemplatePickerBound = true;
  }
}

/**
 * @returns {TemplateRecord|null}
 */
export function findSelectedAiTemplate() {
  const templateId = getValue('aiTemplateSelect');
  if (!templateId) {
    return null;
  }

  return (
    (state.templates || []).find((template) => String(template.id) === String(templateId)) || null
  );
}
