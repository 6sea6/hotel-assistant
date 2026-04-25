/**
 * 模态框 & 按钮确认 —— 弹窗显隐控制和二次确认交互。
 */

import { $, getSelectionKey } from './dom-helpers.js';
import { state } from './state.js';
import { resumeDeferredHotelRender } from './render-scheduler.js';

export function syncModalBodyState() {
  const hasActiveModal = document.querySelector('.modal.active');
  document.body.classList.toggle('modal-open', Boolean(hasActiveModal));
}

export function setModalActive(modalId, active) {
  const modal = document.getElementById(modalId);
  if (!modal) return;

  if (active) {
    modal.classList.add('active');
    modal.style.display = 'flex';
    modal.style.zIndex = '1000';
  } else {
    modal.classList.remove('active');
    modal.style.display = '';
    modal.style.zIndex = '';
  }

  syncModalBodyState();

  if (!active && modalId === 'hotelModal') {
    resumeDeferredHotelRender();
  }
}

export function getEventButton(eventLike) {
  if (eventLike && eventLike.target && typeof eventLike.target.closest === 'function') {
    return eventLike.target.closest('button');
  }
  if (document.activeElement instanceof HTMLButtonElement) {
    return document.activeElement;
  }
  return null;
}

/* ---- 单条删除 / 通用按钮确认 ---- */

export function resetDeleteConfirmation(btn) {
  if (!btn) return;
  if (btn.dataset.confirmTimer) {
    clearTimeout(Number(btn.dataset.confirmTimer));
  }
  btn.dataset.confirming = 'false';
  btn.dataset.confirmTimer = '';
  btn.innerHTML = '<span>🗑️</span> 删除';
  btn.classList.remove('btn-confirm');
  btn.classList.add('btn-danger');
}

export function startDeleteConfirmation(btn) {
  if (!btn) return;
  resetDeleteConfirmation(btn);
  btn.dataset.confirming = 'true';
  btn.innerHTML = '<span>⚠️</span> 确认吗';
  btn.classList.remove('btn-danger');
  btn.classList.add('btn-confirm');
  const timerId = window.setTimeout(() => resetDeleteConfirmation(btn), 2200);
  btn.dataset.confirmTimer = String(timerId);
}

export function resetActionButtonConfirmation(button) {
  if (!button) return;

  if (button.dataset.confirmTimer) {
    clearTimeout(Number(button.dataset.confirmTimer));
  }

  button.dataset.confirming = 'false';
  button.dataset.confirmTimer = '';

  if (button.dataset.originalHtml) {
    button.innerHTML = button.dataset.originalHtml;
  }

  button.classList.remove('btn-confirm');
  if (button.dataset.variantClass) {
    button.classList.add(button.dataset.variantClass);
  }
}

export function startActionButtonConfirmation(button, options = {}) {
  if (!button) return;

  if (!button.dataset.originalHtml) {
    button.dataset.originalHtml = button.innerHTML;
  }

  button.dataset.variantClass = options.variantClass || 'btn-secondary';
  resetActionButtonConfirmation(button);
  button.dataset.confirming = 'true';
  button.innerHTML = options.confirmHtml || '<span>⚠️</span> 确认吗';
  button.classList.remove(button.dataset.variantClass);
  button.classList.add('btn-confirm');

  const timerId = window.setTimeout(() => resetActionButtonConfirmation(button), options.timeout || 2200);
  button.dataset.confirmTimer = String(timerId);
}

/* ---- 批量删除按钮 ---- */

export function syncBatchDeleteButton(options = {}) {
  const batchDeleteBtn = $('batchDeleteBtn');
  if (!batchDeleteBtn) return;

  const count = options.count ?? state.selectedHotels.size;
  batchDeleteBtn.disabled = Boolean(options.disabled);

  if (options.loading) {
    batchDeleteBtn.innerHTML = '<span>⏳</span> 正在删除...';
    return;
  }

  if (options.warning) {
    batchDeleteBtn.innerHTML = '<span>⚠️</span> 请先选择宾馆';
    return;
  }

  batchDeleteBtn.innerHTML = count > 0
    ? `<span>🗑️</span> 删除选中 (${count})`
    : '<span>🗑️</span> 删除选中';
}

export function resetBatchDeleteConfirmation(options = {}) {
  const batchDeleteBtn = $('batchDeleteBtn');
  if (!batchDeleteBtn) return;

  if (batchDeleteBtn.dataset.confirmTimer) {
    clearTimeout(Number(batchDeleteBtn.dataset.confirmTimer));
  }

  batchDeleteBtn.dataset.confirming = 'false';
  batchDeleteBtn.dataset.confirmTimer = '';
  batchDeleteBtn.classList.remove('btn-confirm');
  batchDeleteBtn.classList.add('btn-danger');
  syncBatchDeleteButton(options);
}

export function startBatchDeleteConfirmation() {
  const batchDeleteBtn = $('batchDeleteBtn');
  if (!batchDeleteBtn || state.selectedHotels.size === 0) return;

  resetBatchDeleteConfirmation({ count: state.selectedHotels.size });
  batchDeleteBtn.dataset.confirming = 'true';
  batchDeleteBtn.classList.remove('btn-danger');
  batchDeleteBtn.classList.add('btn-confirm');
  batchDeleteBtn.innerHTML = `<span>⚠️</span> 确认删除 (${state.selectedHotels.size})`;

  const timerId = window.setTimeout(() => {
    resetBatchDeleteConfirmation({ count: state.selectedHotels.size });
  }, 2200);
  batchDeleteBtn.dataset.confirmTimer = String(timerId);
}

/* ---- 宾馆表单弹窗焦点管理 ---- */

export function ensureHotelModalFocusable() {
  const hotelModal = $('hotelModal');
  const hotelForm = $('hotelForm');
  const nameInput = $('hotelName');
  if (!hotelModal || !hotelForm || !nameInput) return;

  hotelModal.style.zIndex = '3001';
  hotelForm.querySelectorAll('input, textarea, select').forEach(input => {
    input.disabled = false;
    input.readOnly = false;
    input.style.pointerEvents = 'auto';
    input.style.userSelect = 'text';
    input.style.opacity = '1';
  });

  try {
    nameInput.focus({ preventScroll: true });
    nameInput.select();
  } catch (error) {
    try {
      nameInput.focus();
    } catch (focusError) {}
  }
}

export function scheduleHotelModalFocus() {
  ensureHotelModalFocusable();
  requestAnimationFrame(() => ensureHotelModalFocusable());
  [80, 180, 320, 600].forEach(delay => {
    setTimeout(() => ensureHotelModalFocusable(), delay);
  });
}
