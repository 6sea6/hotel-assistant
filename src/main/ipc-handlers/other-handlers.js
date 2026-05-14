const fs = require('fs');
const { APP_CONFIG, getPaths } = require('../config');

const ALLOWED_EXTERNAL_HOSTS = new Set([
  'ctrip.com',
  'www.ctrip.com',
  'hotels.ctrip.com',
  'm.ctrip.com',
  'fliggy.com',
  'www.fliggy.com'
]);

function parseAllowedExternalUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch (_error) {
    return null;
  }

  if (parsed.protocol !== 'https:') return null;
  if (!ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname.toLowerCase())) return null;
  return parsed;
}

function isAllowedExternalUrl(rawUrl) {
  return Boolean(parseAllowedExternalUrl(rawUrl));
}

async function openAllowedExternalUrl(shell, rawUrl) {
  const parsed = parseAllowedExternalUrl(rawUrl);
  if (!parsed) {
    return {
      success: false,
      error: '不允许打开该外部链接'
    };
  }

  await shell.openExternal(parsed.href);
  return { success: true };
}

function registerOtherHandlers({ ipcMain }) {
  const { shell, BrowserWindow } = require('electron');
  const getSenderWindow = (event) => BrowserWindow.fromWebContents(event.sender);

  ipcMain.handle('manual:getContent', () => fs.readFileSync(getPaths().RENDERER_MANUAL, 'utf8'));

  // 打开携程
  ipcMain.handle('open:ctrip', () => openAllowedExternalUrl(shell, APP_CONFIG.EXTERNAL_LINKS.CTRIP));

  // 打开飞猪
  ipcMain.handle('open:fliggy', () => openAllowedExternalUrl(shell, APP_CONFIG.EXTERNAL_LINKS.FLIGGY));

  // 打开外部链接
  ipcMain.handle('open:external', (_event, url) => openAllowedExternalUrl(shell, url));

  ipcMain.handle('window:minimize', (event) => {
    const currentWindow = getSenderWindow(event);
    if (currentWindow && !currentWindow.isDestroyed()) {
      currentWindow.minimize();
    }
    return { success: true };
  });

  ipcMain.handle('window:toggleMaximize', (event) => {
    const currentWindow = getSenderWindow(event);
    if (!currentWindow || currentWindow.isDestroyed()) {
      return { success: false, isMaximized: false };
    }

    if (currentWindow.isMaximized()) {
      currentWindow.unmaximize();
    } else {
      currentWindow.maximize();
    }

    return {
      success: true,
      isMaximized: currentWindow.isMaximized()
    };
  });

  ipcMain.handle('window:close', (event) => {
    const currentWindow = getSenderWindow(event);
    if (currentWindow && !currentWindow.isDestroyed()) {
      currentWindow.close();
    }
    return { success: true };
  });

  ipcMain.handle('window:getState', (event) => {
    const currentWindow = getSenderWindow(event);
    return {
      success: true,
      isMaximized: Boolean(currentWindow && !currentWindow.isDestroyed() && currentWindow.isMaximized())
    };
  });
}

module.exports = registerOtherHandlers;
module.exports.isAllowedExternalUrl = isAllowedExternalUrl;
module.exports.openAllowedExternalUrl = openAllowedExternalUrl;
