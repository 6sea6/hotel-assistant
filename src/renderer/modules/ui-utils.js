/**
 * 模态框 & 按钮确认 —— 弹窗显隐控制和二次确认交互。
 */

import { $ } from './dom-helpers.js';
import { state } from './state.js';
import { resumeDeferredHotelRender } from './render-scheduler.js';
import { ensureModalTemplateMounted } from './modal-templates.js';

const MODAL_FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

const modalFocusState = new Map();

function clearModalZIndexOverride(modal) {
  if (modal.style && typeof modal.style.removeProperty === 'function') {
    modal.style.removeProperty('z-index');
  }
}

function ensureModalContentFocusable(modal) {
  const content = modal.querySelector('.modal-content') || modal;
  if (!content.getAttribute('tabindex')) {
    content.setAttribute('tabindex', '-1');
  }
  return content;
}

function ensureModalLabel(modal) {
  if (modal.getAttribute('aria-labelledby')) return;

  const title = modal.querySelector('.modal-header h2');
  if (!title) return;

  if (!title.id) {
    title.id = `${modal.id || 'appModal'}Title`;
  }
  modal.setAttribute('aria-labelledby', title.id);
}

function prepareModalAccessibility(modal) {
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.removeAttribute('aria-hidden');
  ensureModalLabel(modal);
  ensureModalContentFocusable(modal);
}

function isFocusableElement(element) {
  if (!element || typeof element.focus !== 'function') return false;
  if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
  if (element.disabled || element.getAttribute('disabled') !== null) return false;

  const tagName = String(element.tagName || '').toLowerCase();
  const nativeFocusable = ['a', 'button', 'input', 'select', 'textarea'].includes(tagName);
  const tabIndex = element.getAttribute('tabindex');
  return nativeFocusable || (tabIndex !== null && Number(tabIndex) >= 0);
}

function getFocusableElements(modal) {
  return Array.from(modal.querySelectorAll(MODAL_FOCUSABLE_SELECTOR)).filter(isFocusableElement);
}

function focusElement(element) {
  if (!element || typeof element.focus !== 'function') return false;

  try {
    element.focus({ preventScroll: true });
    return true;
  } catch (error) {
    try {
      element.focus();
      return true;
    } catch (focusError) {
      return false;
    }
  }
}

function getInitialModalFocusTarget(modal) {
  return getFocusableElements(modal)[0] || ensureModalContentFocusable(modal);
}

function getRestorableActiveElement(modal) {
  const activeElement = /** @type {HTMLElement|null} */ (document.activeElement);
  if (!activeElement || activeElement === document.body || modal.contains(activeElement)) {
    return null;
  }
  return typeof activeElement.focus === 'function' ? activeElement : null;
}

function createModalFocusTrap(modal) {
  return (event) => {
    if (event.key !== 'Tab') return;

    const focusableElements = getFocusableElements(modal);
    if (focusableElements.length === 0) {
      event.preventDefault();
      focusElement(ensureModalContentFocusable(modal));
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement;

    if (event.shiftKey) {
      if (activeElement === firstElement || !modal.contains(activeElement)) {
        event.preventDefault();
        focusElement(lastElement);
      }
      return;
    }

    if (activeElement === lastElement) {
      event.preventDefault();
      focusElement(firstElement);
    }
  };
}

function activateModalFocus(modal) {
  const modalId = modal.id || '';
  const existingState = modalFocusState.get(modalId);
  if (existingState?.keydownHandler) {
    modal.removeEventListener('keydown', existingState.keydownHandler);
  }

  const keydownHandler = createModalFocusTrap(modal);
  modal.addEventListener('keydown', keydownHandler);
  modalFocusState.set(modalId, {
    keydownHandler,
    previousFocus: existingState?.previousFocus || getRestorableActiveElement(modal)
  });

  focusElement(getInitialModalFocusTarget(modal));
}

function deactivateModalFocus(modal) {
  const modalId = modal.id || '';
  const focusState = modalFocusState.get(modalId);
  if (focusState?.keydownHandler) {
    modal.removeEventListener('keydown', focusState.keydownHandler);
  }
  modalFocusState.delete(modalId);
  modal.setAttribute('aria-hidden', 'true');

  if (
    focusState?.previousFocus &&
    (!('isConnected' in focusState.previousFocus) || focusState.previousFocus.isConnected !== false)
  ) {
    focusElement(focusState.previousFocus);
  }
}

export function syncModalBodyState() {
  const hasActiveModal = document.querySelector('.modal.active');
  document.body.classList.toggle('modal-open', Boolean(hasActiveModal));
}

export function setModalActive(modalId, active) {
  const modal =
    document.getElementById(modalId) || (active ? ensureModalTemplateMounted(modalId) : null);
  if (!modal) return;

  if (active) {
    prepareModalAccessibility(modal);
    modal.classList.add('active');
    modal.style.display = 'flex';
    clearModalZIndexOverride(modal);
    activateModalFocus(modal);
  } else {
    deactivateModalFocus(modal);
    modal.classList.remove('active');
    modal.style.display = '';
    clearModalZIndexOverride(modal);
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

  const timerId = window.setTimeout(
    () => resetActionButtonConfirmation(button),
    options.timeout || 2200
  );
  button.dataset.confirmTimer = String(timerId);
}

/* ---- 批量删除按钮 ---- */

export function syncBatchDeleteButton(options = {}) {
  const batchDeleteBtn = /** @type {HTMLButtonElement|null} */ ($('batchDeleteBtn'));
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

  batchDeleteBtn.innerHTML =
    count > 0 ? `<span>🗑️</span> 删除选中 (${count})` : '<span>🗑️</span> 删除选中';
}

export function resetBatchDeleteConfirmation(options = {}) {
  const batchDeleteBtn = /** @type {HTMLButtonElement|null} */ ($('batchDeleteBtn'));
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
  const batchDeleteBtn = /** @type {HTMLButtonElement|null} */ ($('batchDeleteBtn'));
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
  const hotelForm = /** @type {HTMLFormElement|null} */ ($('hotelForm'));
  const nameInput = /** @type {HTMLInputElement|null} */ ($('hotelName'));
  if (!hotelModal || !hotelForm || !nameInput) return;

  const inputs = /** @type {NodeListOf<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>} */ (
    hotelForm.querySelectorAll('input, textarea, select')
  );
  inputs.forEach((input) => {
    input.disabled = false;
    /** @type {any} */ (input).readOnly = false;
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
  [80, 180, 320, 600].forEach((delay) => {
    setTimeout(() => ensureHotelModalFocusable(), delay);
  });
}
