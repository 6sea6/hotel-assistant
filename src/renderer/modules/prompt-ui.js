/**
 * AI 提示词管理 —— 加载、展示、编辑、保存、复制提示词内容。
 */

import { state, PROMPT_TITLES } from './state.js';
import { $, setText, setStyle } from './dom-helpers.js';
import { showNotification } from './notification.js';
import { setModalActive, getEventButton } from './ui-utils.js';

/* ---- 提示词数据 ---- */

let currentPromptType = '';
let isPromptEditing = false;
let promptContentBackup = '';
const customPromptContent = {
  protective: null,
  guide: null,
  optimize: null
};

async function loadCustomPrompts() {
  try {
    const [protective, guide, optimize] = await Promise.all([
      window.electronAPI.getPrompt('protective'),
      window.electronAPI.getPrompt('guide'),
      window.electronAPI.getPrompt('optimize')
    ]);
    if (protective && protective.content) customPromptContent.protective = protective.content;
    if (guide && guide.content) customPromptContent.guide = guide.content;
    if (optimize && optimize.content) customPromptContent.optimize = optimize.content;
  } catch (e) {
    console.error('加载自定义提示词失败:', e);
  }
}

/* ---- 打开/关闭 ---- */

export function openAIPrompts() {
  setModalActive('aiPromptsModal', true);
}

export function closeAIPrompts() {
  setModalActive('aiPromptsModal', false);
}

export async function openPromptContent(type) {
  currentPromptType = type;
  isPromptEditing = false;

  await loadCustomPrompts();

  const titleEl = $('promptContentTitle');
  const textEl = $('promptContentText');
  const editBtnEl = $('promptEditBtn');
  const editTextEl = $('promptEditText');
  const saveBtnEl = $('promptSaveBtn');

  if (!titleEl || !textEl || !editBtnEl || !editTextEl || !saveBtnEl) {
    console.error('[openPromptContent] 关键DOM元素未找到');
    return;
  }

  titleEl.textContent = PROMPT_TITLES[type] || '提示词内容';
  textEl.value = customPromptContent[type] || '提示词加载失败，请稍后重试。';
  textEl.readOnly = true;
  editBtnEl.textContent = '✏️';
  editTextEl.textContent = '编辑';
  saveBtnEl.style.display = 'none';

  closeAIPrompts();
  setModalActive('promptContentModal', true);
}

export function closePromptContent() {
  setModalActive('promptContentModal', false);
  isPromptEditing = false;
  setStyle('promptSaveBtn', 'display', 'none');
}

/* ---- 编辑与保存 ---- */

export function togglePromptEdit() {
  const textEl = $('promptContentText');
  const editBtnEl = $('promptEditBtn');
  const editTextEl = $('promptEditText');
  const saveBtnEl = $('promptSaveBtn');
  if (!textEl || !editBtnEl || !editTextEl || !saveBtnEl) return;

  if (!isPromptEditing) {
    isPromptEditing = true;
    textEl.readOnly = false;
    promptContentBackup = textEl.value;
    editBtnEl.textContent = '❌';
    editTextEl.textContent = '取消';
    saveBtnEl.style.display = 'inline-flex';
    textEl.focus();
  } else {
    isPromptEditing = false;
    textEl.readOnly = true;
    textEl.value = promptContentBackup;
    editBtnEl.textContent = '✏️';
    editTextEl.textContent = '编辑';
    saveBtnEl.style.display = 'none';
  }
}

export async function savePromptContent() {
  const textEl = $('promptContentText');
  if (!textEl) return;

  const content = textEl.value;
  const saveBtn = $('promptSaveBtn') || getEventButton(window.event);

  if (!content.trim()) {
    showNotification('提示词内容不能为空', 'warning');
    return;
  }

  try {
    const result = await window.electronAPI.savePrompt(currentPromptType, content);

    if (result.success) {
      customPromptContent[currentPromptType] = content;
      isPromptEditing = false;
      textEl.readOnly = true;
      setText('promptEditBtn', '✏️');
      setText('promptEditText', '编辑');

      if (saveBtn) {
        saveBtn.innerHTML = '<span>✅</span> 已保存';
        saveBtn.classList.remove('btn-accent');
        saveBtn.classList.add('btn-confirm');
        setTimeout(() => {
          saveBtn.style.display = 'none';
          saveBtn.innerHTML = '<span>💾</span> 保存';
          saveBtn.classList.remove('btn-confirm');
          saveBtn.classList.add('btn-accent');
        }, 1500);
      }
    } else {
      showNotification('保存失败，请重试', 'error');
    }
  } catch (e) {
    console.error('保存提示词失败:', e);
    showNotification('保存失败，请重试', 'error');
  }
}

/* ---- 复制 ---- */

function showCopySuccess(btn) {
  if (!btn) {
    showNotification('已复制到剪贴板', 'success');
    return;
  }
  const originalText = btn.innerHTML;
  btn.innerHTML = '<span>✅</span> 已复制';
  btn.classList.add('btn-confirm');
  btn.disabled = true;
  setTimeout(() => {
    btn.innerHTML = originalText;
    btn.classList.remove('btn-confirm');
    btn.disabled = false;
  }, 2000);
}

export async function copyPromptContent() {
  const textEl = $('promptContentText');
  if (!textEl) return;

  const content = textEl.value;
  const copyBtn = getEventButton(window.event);

  try {
    await navigator.clipboard.writeText(content);
    showCopySuccess(copyBtn);
  } catch (err) {
    textEl.select();
    document.execCommand('copy');
    showCopySuccess(copyBtn);
  }
}
