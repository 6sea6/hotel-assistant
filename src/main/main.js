const { app } = require('electron');
const { APP_CONFIG } = require('./config');

if (process.platform === 'win32' && app.isPackaged && typeof app.setAppUserModelId === 'function') {
  app.setAppUserModelId(APP_CONFIG.APP_USER_MODEL_ID);
}

app.commandLine.appendSwitch('lang', 'zh-CN');
app.commandLine.appendSwitch('accept-lang', 'zh-CN,zh');

process.on('uncaughtException', (error) => {
  console.error('[main] 未捕获异常:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[main] 未处理 Promise 拒绝:', reason);
});

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    try {
      const windowManager = require('./window-manager');
      const mainWindow = windowManager.getMainWindow();
      if (!mainWindow) return;

      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      if (!mainWindow.isVisible()) {
        mainWindow.show();
      }
      mainWindow.focus();
    } catch (error) {
      console.error('[main] 处理二次启动失败:', error);
    }
  });

  async function bootstrapApp() {
    const MenuManager = require('./menu-manager');
    const ipcHandlerManager = require('./ipc-handler-manager');
    ipcHandlerManager.registerAllHandlers();
    const services = ipcHandlerManager.getServices();
    const { bundleService, windowService } = services;

    bundleService.ensureBootstrapResources();

    const mainWindow = windowService.createWindow();

    const menuManager = new MenuManager(windowService);
    setImmediate(() => menuManager.createMenu());

    const schedulePostStartupTasks = () => {
      bundleService.scheduleSetup(120);
    };

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.once('ready-to-show', schedulePostStartupTasks);
    } else {
      setImmediate(schedulePostStartupTasks);
    }

    app.on('activate', () => {
      windowService.handleActivate();
    });
  }

  app.whenReady().then(bootstrapApp).catch((error) => {
    console.error('[main] 应用初始化失败:', error);
    app.quit();
  });
}

// 所有窗口关闭事件
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
