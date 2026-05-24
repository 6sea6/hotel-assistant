/**
 * 关于 & 说明书弹窗。
 */

import { $, setText, setStyle } from './dom-helpers.js';
import { setModalActive } from './ui-utils.js';

let manualContentLoaded = false;

const MANUAL_FALLBACK_HTML = `
  <div class="manual-load-error">
    <h3>说明书加载失败</h3>
    <p>未能读取本地说明书资源，请关闭弹窗后重试，或检查应用文件是否完整。</p>
  </div>
`;

export function applyAppMetadata() {
  const appInfo = window.electronAPI?.appInfo;
  if (!appInfo) return;

  const versionText = appInfo.version ? `v${appInfo.version}` : '';
  if (versionText) {
    setText('aboutVersionText', versionText);
    setText('manualVersionText', versionText);
  }
  if (appInfo.releaseDate) {
    setText('aboutUpdateDateText', appInfo.releaseDate);
  }
}

export function openAbout() {
  setModalActive('aboutModal', true);
}

export function closeAbout() {
  setModalActive('aboutModal', false);
}

async function loadManualContent() {
  const container = $('manualContent');
  if (!container || manualContentLoaded) return;

  container.innerHTML = '<div class="manual-loading">正在加载说明书...</div>';

  try {
    const content = await window.electronAPI.getManualContent();
    if (!content || !content.trim()) {
      throw new Error('说明书内容为空');
    }
    container.innerHTML = content;
    manualContentLoaded = true;
    applyAppMetadata();
  } catch (error) {
    console.error('加载说明书失败:', error);
    container.innerHTML = MANUAL_FALLBACK_HTML;
  }
}

export async function checkAndShowManual() {
  try {
    const showManual = await window.electronAPI.getSetting('showManualOnStartup');
    if (showManual === false) {
      setStyle('manualFooter', 'display', 'none');
      return;
    }
    setStyle('manualFooter', 'display', 'flex');
    openManual();
  } catch (error) {
    console.error('检查说明书设置失败:', error);
    openManual();
  }
}

export async function openManual() {
  setModalActive('manualModal', true);
  await loadManualContent();
}

export async function closeManual() {
  const checkbox = /** @type {HTMLInputElement|null} */ ($('dontShowManualAgain'));
  if (checkbox && checkbox.checked) {
    try {
      const result = await window.electronAPI.setSetting('showManualOnStartup', false);
      console.log('说明书设置已保存:', result);
      const savedValue = await window.electronAPI.getSetting('showManualOnStartup');
      console.log('验证保存的值:', savedValue);
    } catch (error) {
      console.error('保存说明书设置失败:', error);
    }
  }
  setModalActive('manualModal', false);
}
