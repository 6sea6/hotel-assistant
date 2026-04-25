const { Menu, dialog } = require('electron');
const { APP_CONFIG } = require('./config');

class MenuManager {
  constructor(windowManager) {
    this.windowManager = windowManager;
  }

  createMenu() {
    const template = [
      {
        label: '文件',
        submenu: [
          {
            label: '导出数据',
            click: () => {
              const mainWindow = this.windowManager.getMainWindow();
              if (mainWindow) {
                mainWindow.webContents.send('menu-export-data');
              }
            }
          },
          {
            label: '导入数据',
            click: () => {
              const mainWindow = this.windowManager.getMainWindow();
              if (mainWindow) {
                mainWindow.webContents.send('menu-import-data');
              }
            }
          },
          { type: 'separator' },
          {
            label: '退出',
            accelerator: 'Alt+F4',
            click: () => require('electron').app.quit()
          }
        ]
      },
      {
        label: '编辑',
        submenu: [
          { label: '撤销', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
          { label: '重做', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
          { type: 'separator' },
          { label: '剪切', accelerator: 'CmdOrCtrl+X', role: 'cut' },
          { label: '复制', accelerator: 'CmdOrCtrl+C', role: 'copy' },
          { label: '粘贴', accelerator: 'CmdOrCtrl+V', role: 'paste' },
          { label: '全选', accelerator: 'CmdOrCtrl+A', role: 'selectAll' }
        ]
      },
      {
        label: '视图',
        submenu: [
          { label: '重新加载', accelerator: 'CmdOrCtrl+R', role: 'reload' },
          { label: '强制重新加载', accelerator: 'CmdOrCtrl+Shift+R', role: 'forceReload' },
          { type: 'separator' },
          { label: '实际大小', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
          { label: '放大', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
          { label: '缩小', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
          { type: 'separator' },
          { label: '全屏', accelerator: 'F11', role: 'togglefullscreen' },
          { label: '开发者工具', accelerator: 'F12', role: 'toggleDevTools' }
        ]
      },
      {
        label: '窗口',
        submenu: [
          { label: '最小化', accelerator: 'CmdOrCtrl+M', role: 'minimize' },
          { label: '关闭', accelerator: 'CmdOrCtrl+W', role: 'close' }
        ]
      },
      {
        label: '帮助',
        submenu: [
          {
            label: '关于',
            click: () => {
              const mainWindow = this.windowManager.getMainWindow();
              if (mainWindow) {
                dialog.showMessageBox(mainWindow, {
                  type: 'info',
                  title: `关于${APP_CONFIG.NAME}`,
                  message: `${APP_CONFIG.NAME} v${APP_CONFIG.VERSION}`,
                    detail: `更新时间: ${APP_CONFIG.RELEASE_DATE}\n作者: ${APP_CONFIG.AUTHOR}\n\n感谢: WorkBuddy、Trae、GitHub Copilot、Codex\n特别感谢: Asagiri、墨离\n\n一个现代化的宾馆比较工具。`
                });
              }
            }
          }
        ]
      }
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));

    const mainWindow = this.windowManager.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed() && process.platform === 'win32') {
      mainWindow.setMenuBarVisibility(false);
      mainWindow.autoHideMenuBar = true;
    }
  }
}

module.exports = MenuManager;
