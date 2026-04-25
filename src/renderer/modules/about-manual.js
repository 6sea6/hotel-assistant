/**
 * 关于 & 说明书弹窗。
 */

import { $, setText, setStyle } from './dom-helpers.js';
import { setModalActive } from './ui-utils.js';

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

export function openManual() {
  setModalActive('manualModal', true);
}

export async function closeManual() {
  const checkbox = $('dontShowManualAgain');
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
