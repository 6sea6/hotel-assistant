function registerPromptHandlers({ ipcMain, services }) {
  const { promptService } = services;

  // 获取AI提示词
  ipcMain.handle('prompt:get', (event, type) => {
    return promptService.loadPrompt(type);
  });

  // 保存AI提示词
  ipcMain.handle('prompt:save', (event, type, content) => {
    return promptService.savePrompt(type, content);
  });
}

module.exports = registerPromptHandlers;
