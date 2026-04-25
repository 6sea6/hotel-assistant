import { $ } from './dom-helpers.js';

let controlsInitialized = false;

function isWindowsPlatform() {
  if (window.electronAPI?.appInfo?.platform) {
    return window.electronAPI.appInfo.platform === 'win32';
  }

  return /Windows/i.test(window.navigator.userAgent);
}

function setControlsVisible(visible) {
  const controls = $('windowControls');
  if (!controls) {
    return;
  }

  controls.style.display = visible ? 'flex' : 'none';
}

function updateMaximizeState(isMaximized) {
  document.body.classList.toggle('window-maximized', Boolean(isMaximized));

  const maximizeButton = $('windowMaximizeBtn');
  if (!maximizeButton) {
    return;
  }

  const label = isMaximized ? '还原' : '最大化';
  maximizeButton.setAttribute('aria-label', label);
}

export async function initializeWindowControls() {
  if (controlsInitialized) {
    return;
  }

  const isWindows = isWindowsPlatform();
  document.body.classList.toggle('platform-windows', isWindows);

  if (!isWindows || !window.electronAPI?.getWindowState) {
    setControlsVisible(false);
    controlsInitialized = true;
    return;
  }

  setControlsVisible(true);

  try {
    const state = await window.electronAPI.getWindowState();
    updateMaximizeState(Boolean(state?.isMaximized));
  } catch (error) {
    console.error('读取窗口状态失败:', error);
  }

  if (window.electronAPI?.onWindowStateChanged) {
    window.electronAPI.onWindowStateChanged((state) => {
      updateMaximizeState(Boolean(state?.isMaximized));
    });
  }

  controlsInitialized = true;
}

export async function minimizeWindow() {
  try {
    await window.electronAPI?.minimizeWindow?.();
  } catch (error) {
    console.error('最小化窗口失败:', error);
  }
}

export async function toggleMaximizeWindow() {
  try {
    const state = await window.electronAPI?.toggleMaximizeWindow?.();
    if (state) {
      updateMaximizeState(Boolean(state.isMaximized));
    }
  } catch (error) {
    console.error('切换窗口最大化失败:', error);
  }
}

export async function closeWindow() {
  try {
    await window.electronAPI?.closeWindow?.();
  } catch (error) {
    console.error('关闭窗口失败:', error);
  }
}
