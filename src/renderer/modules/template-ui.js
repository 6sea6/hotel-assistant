/**
 * 模板管理 UI —— 模板列表展示、新建/编辑/删除、应用模板，以及模板同步事件。
 */

import {
  state,
  TEMPLATE_FILTER_BATCH_SIZE,
  setHotels,
  setTemplates,
  subscribeTemplateChanges,
  markRankingCacheDirty
} from './state.js';
import {
  $,
  escapeHtml,
  getValue,
  setValue,
  setText,
  setStyle,
  normalizeIdValue,
  getRoomCountText
} from './dom-helpers.js';
import { showNotification } from './notification.js';
import { setModalActive, resetDeleteConfirmation, startDeleteConfirmation } from './ui-utils.js';
import { isHotelInputPriorityActive } from './render-scheduler.js';
import { actions } from './actions.js';
import { refreshCustomSelects } from './custom-select.js';
import { logRendererDebug } from './debug-log.js';

/**
 * @typedef {import('../../shared/contracts').RawTemplateRecord} RawTemplateRecord
 * @typedef {import('../../shared/contracts').EntityId} EntityId
 * @typedef {object} TemplateMutationRefreshOptions
 * @property {string} [reason]
 * @property {number} [affectedHotelCount]
 * @property {boolean} [interactionFirst]
 */

const localTemplateUpdateIds = new Set();

function requestTemplateSyncedHotelRender() {
  if (typeof actions.requestHotelListRender === 'function') {
    actions.requestHotelListRender({ reason: 'template-sync', forceFull: true });
    return;
  }

  actions.renderHotelList();
}

function renderAiTemplateOptionsIfAvailable() {
  if (typeof actions.renderAiTemplateOptions === 'function') {
    actions.renderAiTemplateOptions();
  }
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizeAffectedHotelCount(value) {
  const count = Number(value || 0);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

/**
 * @param {EntityId|null|undefined} templateId
 * @returns {void}
 */
function rememberLocalTemplateUpdate(templateId) {
  if (templateId === null || templateId === undefined || templateId === '') return;

  const key = String(templateId);
  localTemplateUpdateIds.add(key);
  setTimeout(() => {
    localTemplateUpdateIds.delete(key);
  }, 2500);
}

/**
 * @param {unknown} data
 * @returns {string}
 */
function getTemplateUpdateEventId(data) {
  if (!data || typeof data !== 'object') return '';
  const payload = /** @type {{templateId?: EntityId, id?: EntityId, template?: {id?: EntityId}}} */ (data);
  const value = payload.templateId ?? payload.template?.id ?? payload.id;
  return value === null || value === undefined || value === '' ? '' : String(value);
}

/**
 * @param {number|undefined} affectedHotelCount
 * @param {string} reason
 * @returns {Promise<boolean>}
 */
async function reloadHotelsForTemplateMutation(affectedHotelCount, reason) {
  if (normalizeAffectedHotelCount(affectedHotelCount) === 0) return false;

  const hotels = await actions.loadHotels({ force: true, reason });
  setHotels(hotels || []);
  markRankingCacheDirty();
  return true;
}

/**
 * @param {TemplateMutationRefreshOptions} [options]
 * @returns {Promise<void>}
 */
async function refreshTemplatesAfterMutation(options = {}) {
  const reason = options.reason || 'template-change';
  const renderHotels = await reloadHotelsForTemplateMutation(options.affectedHotelCount, reason);
  const templates = await actions.loadTemplates();
  setTemplates(templates || [], {
    reason,
    renderHotels,
    interactionFirst: options.interactionFirst ?? true
  });
}

/**
 * @param {{renderHotels?: boolean, interactionFirst?: boolean}} [event]
 * @returns {void}
 */
function handleTemplateStateChanged(event = {}) {
  updateTemplateFilter({ interactionFirst: event.interactionFirst });
  renderAiTemplateOptionsIfAvailable();
  refreshCustomSelects();
  renderTemplateList();

  if (event.renderHotels) {
    markRankingCacheDirty();
    requestTemplateSyncedHotelRender();
  }
}

subscribeTemplateChanges(handleTemplateStateChanged);

/* ---- 打开/关闭模板弹窗 ---- */

export function openTemplateManager() {
  renderTemplateList();
  setModalActive('templateModal', true);
  setStyle('templateForm', 'display', 'none');
}

export function closeTemplateModal() {
  setModalActive('templateModal', false);
}

/* ---- 渲染模板列表 ---- */

export function renderTemplateList() {
  const container = $('templateList');
  if (!container) return;

  if (state.templates.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-text">暂无模板</div>
      </div>
    `;
    return;
  }

  const getTemplateDateMeta = (template) => {
    if (template.check_in_date && template.check_out_date) {
      return `<span>📅 ${template.check_in_date} → ${template.check_out_date}</span>`;
    }
    if (template.check_in_date) {
      return `<span>📅 入住 ${template.check_in_date}</span>`;
    }
    if (template.check_out_date) {
      return `<span>🏁 离店 ${template.check_out_date}</span>`;
    }
    return '';
  };

  const buildTemplateActionButton = (label, action, templateId, extraClass = 'btn-secondary') => {
    const idAttr = escapeHtml(String(templateId));
    const actionAttr = escapeHtml(action);
    return `<button class="btn ${extraClass} btn-sm" data-action="${actionAttr}" data-id="${idAttr}">${label}</button>`;
  };

  container.innerHTML = state.templates
    .map(
      (template) => `
    <div class="template-item">
      <div class="template-info">
        <h4>${escapeHtml(template.name)}</h4>
        <div class="template-meta">
          ${template.destination ? `<span>📍 ${escapeHtml(template.destination)}</span>` : ''}
          ${getTemplateDateMeta(template)}
          ${template.room_count ? `<span>👤 ${getRoomCountText(template.room_count)}</span>` : ''}
        </div>
      </div>
      <div class="template-actions">
        ${buildTemplateActionButton('应用', 'apply-template', template.id)}
        ${buildTemplateActionButton('编辑', 'edit-template', template.id)}
        ${buildTemplateActionButton('<span>🗑️</span> 删除', 'delete-template', template.id, 'btn-danger')}
      </div>
    </div>
  `
    )
    .join('');
}

/* ---- 列表事件代理 ---- */

/**
 * @param {MouseEvent} event
 */
export function handleTemplateListClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  const actionButton = /** @type {HTMLButtonElement|null} */ (
    target?.closest('button[data-action][data-id]') || null
  );
  if (!actionButton) return;

  const action = actionButton.dataset.action;
  const id = actionButton.dataset.id;

  switch (action) {
    case 'apply-template':
      applyTemplate(id);
      return;
    case 'edit-template':
      editTemplate(id);
      return;
    case 'delete-template':
      if (actionButton.dataset.confirming === 'true') {
        resetDeleteConfirmation(actionButton);
        deleteTemplate(id);
      } else {
        startDeleteConfirmation(actionButton);
      }
      return;
    default:
      return;
  }
}

/* ---- 新建/编辑表单 ---- */

export function openAddTemplateForm() {
  setText('templateFormTitle', '新建模板');
  setValue('templateId', '');
  setValue('templateName', '');
  setValue('templateDestination', '');
  setValue('templateCheckIn', '');
  setValue('templateCheckOut', '');
  setValue('templateRoomCount', '2');
  setStyle('templateForm', 'display', 'block');
}

export function editTemplate(id) {
  const template = actions.findTemplateById(id);
  if (!template) return;

  setText('templateFormTitle', '编辑模板');
  setValue('templateId', template.id);
  setValue('templateName', template.name || '');
  setValue('templateDestination', template.destination || '');
  setValue('templateCheckIn', template.check_in_date || '');
  setValue('templateCheckOut', template.check_out_date || '');
  setValue('templateRoomCount', template.room_count || 2);
  setStyle('templateForm', 'display', 'block');
}

export function cancelTemplateForm() {
  setStyle('templateForm', 'display', 'none');
  setValue('templateId', '');
  setValue('templateName', '');
  setValue('templateDestination', '');
  setValue('templateCheckIn', '');
  setValue('templateCheckOut', '');
  setValue('templateRoomCount', '2');
}

/* ---- 保存模板 ---- */

export async function saveTemplate() {
  const id = getValue('templateId');

  /** @type {Partial<RawTemplateRecord>} */
  const template = {
    name: getValue('templateName').trim(),
    destination: getValue('templateDestination').trim(),
    check_in_date: getValue('templateCheckIn') || null,
    check_out_date: getValue('templateCheckOut') || null,
    room_count: parseInt(getValue('templateRoomCount', '2')) || 2
  };

  if (!template.name) {
    const nameInput = /** @type {HTMLInputElement|null} */ ($('templateName'));
    if (nameInput) {
      nameInput.focus();
      nameInput.style.borderColor = '#F53F3F';
      setTimeout(() => {
        nameInput.style.borderColor = '';
      }, 2000);
    }
    return;
  }

  try {
    if (id) {
      template.id = normalizeIdValue(id);
      rememberLocalTemplateUpdate(template.id);
      const result = await window.electronAPI.updateTemplateAndSync(template);

      if (result.success) {
        logRendererDebug('[保存模板] 成功，更新了', result.affectedCount, '个宾馆');
        await refreshTemplatesAfterMutation({
          reason: 'template-save',
          affectedHotelCount: result.affectedCount,
          interactionFirst: true
        });
      } else {
        throw new Error(result.error || '更新失败');
      }
    } else {
      await window.electronAPI.addTemplate(template);
      await refreshTemplatesAfterMutation({
        reason: 'template-add',
        interactionFirst: true
      });
    }

    cancelTemplateForm();
  } catch (error) {
    console.error('保存模板失败:', error);
    try {
      await refreshTemplatesAfterMutation({
        reason: 'template-save-recovery',
        interactionFirst: true
      });
    } catch (recoveryError) {
      console.error('恢复数据状态失败:', recoveryError);
    }
    showNotification(`保存模板失败: ${error.message}`, 'error');
  }
}

/* ---- 删除模板 ---- */

export async function deleteTemplate(id) {
  try {
    const result = await window.electronAPI.deleteTemplate(id);
    if (!result || !result.success) {
      throw new Error(result?.error || '删除失败');
    }

    await refreshTemplatesAfterMutation({
      reason: 'template-delete',
      affectedHotelCount: result.affectedHotelCount,
      interactionFirst: true
    });
    showNotification(
      `模板已删除${result.affectedHotelCount ? `，同步清理 ${result.affectedHotelCount} 家宾馆的模板关联` : ''}`,
      'success'
    );
  } catch (error) {
    console.error('删除模板失败:', error);
    showNotification(`删除模板失败: ${error.message || '请重试'}`, 'error');
  }
}

/* ---- 应用模板（跳转到添加宾馆弹窗） ---- */

export function applyTemplate(id) {
  const template = actions.findTemplateById(id);
  if (!template) return;
  actions.openAddHotelModal(id);
  closeTemplateModal();
}

/* ---- 侧栏模板筛选下拉 ---- */

export function updateTemplateFilter(options = {}) {
  const select = /** @type {HTMLSelectElement|null} */ (document.getElementById('filterTemplate'));
  if (!select) return;

  const currentValue = options.selectedValue ?? select.value;
  const renderVersion = ++state.templateFilterRenderVersion;
  select.innerHTML = '<option value="">全部</option>';

  if (state.templates.length === 0) {
    select.value = '';
    return;
  }

  const renderBatch = (startIndex = 0) => {
    if (renderVersion !== state.templateFilterRenderVersion) return;

    const fragment = document.createDocumentFragment();
    const endIndex = Math.min(startIndex + TEMPLATE_FILTER_BATCH_SIZE, state.templates.length);

    for (let index = startIndex; index < endIndex; index++) {
      const template = state.templates[index];
      const option = document.createElement('option');
      option.value = String(template.id ?? '');
      option.textContent = template.name;
      fragment.appendChild(option);
    }

    select.appendChild(fragment);

    if (endIndex < state.templates.length) {
      const scheduleNext = () => renderBatch(endIndex);
      if (options.interactionFirst || isHotelInputPriorityActive()) {
        setTimeout(scheduleNext, 16);
      } else {
        requestAnimationFrame(scheduleNext);
      }
      return;
    }

    if (currentValue) {
      select.value = currentValue;
    }
  };

  if (options.interactionFirst) {
    setTimeout(() => renderBatch(), 0);
    return;
  }

  renderBatch();
}

/* ---- 模板同步监听器 ---- */

export function setupTemplateSyncListener() {
  logRendererDebug('[事件监听] 设置 template:updated 监听器');
  window.electronAPI.onTemplateUpdated(async (data) => {
    try {
      const eventId = getTemplateUpdateEventId(data);
      if (eventId && localTemplateUpdateIds.has(eventId)) {
        logRendererDebug('[事件监听] 跳过本地已处理的模板同步事件:', data);
        return;
      }

      await refreshTemplatesAfterMutation({
        reason: 'template-event',
        affectedHotelCount: data?.affectedCount ?? data?.affectedHotelCount,
        interactionFirst: true
      });
      logRendererDebug('[事件监听] 模板同步完成:', data);
    } catch (error) {
      console.error('[事件监听] 模板同步后刷新失败:', error);
      showNotification('模板同步后刷新失败，请手动点击刷新按钮', 'error');
    }
  });
  logRendererDebug('[事件监听] template:updated 监听器已设置完成');
}

/* ---- 注册到 actions ---- */
actions.renderTemplateList = renderTemplateList;
actions.updateTemplateFilter = updateTemplateFilter;
