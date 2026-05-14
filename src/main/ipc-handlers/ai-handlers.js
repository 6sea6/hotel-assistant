function registerAiHandlers({ ipcMain, services }) {
  const { aiService } = services;

  ipcMain.handle('ai:config:get', () => aiService.getProviderConfig());
  ipcMain.handle('ai:config:presets', () => aiService.getProviderPresets());
  ipcMain.handle('ai:config:save', (event, config) => aiService.saveProviderConfig(config));
  ipcMain.handle('ai:config:test', async (event, config) => aiService.testConnection(config));
  ipcMain.handle('ai:chat:send', async (event, payload) => aiService.sendChat(payload));
  ipcMain.handle('ai:task:start', async (event, payload) => aiService.startTask(payload));
  ipcMain.handle('ai:collect:analyze', async (event, payload) => aiService.analyzeCollection(payload));
  ipcMain.handle('ai:collect:apply-review', async (event, payload) => aiService.applyCollectionReview(payload));
  ipcMain.handle('ai:task:cancel', () => aiService.cancelTask());
  ipcMain.handle('ai:task:status', () => aiService.getTaskStatus());
}

module.exports = registerAiHandlers;
