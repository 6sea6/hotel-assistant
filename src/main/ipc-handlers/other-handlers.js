const { shell, BrowserWindow } = require('electron');
const { APP_CONFIG } = require('../config');

function registerOtherHandlers({ ipcMain }) {
  const getSenderWindow = (event) => BrowserWindow.fromWebContents(event.sender);

  // 打开携程
  ipcMain.handle('open:ctrip', () => {
    shell.openExternal(APP_CONFIG.EXTERNAL_LINKS.CTRIP);
    return { success: true };
  });

  // 打开飞猪
  ipcMain.handle('open:fliggy', () => {
    shell.openExternal(APP_CONFIG.EXTERNAL_LINKS.FLIGGY);
    return { success: true };
  });

  // 打开外部链接
  ipcMain.handle('open:external', (event, url) => {
    shell.openExternal(url);
    return { success: true };
  });

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
