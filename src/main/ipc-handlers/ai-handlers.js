function registerAiHandlers({ ipcMain, services }) {
  const getAiService = () => (
    typeof services.getAiService === 'function'
      ? services.getAiService()
      : services.aiService
  );

  ipcMain.handle('ai:config:get', () => getAiService().getProviderConfig());
  ipcMain.handle('ai:config:presets', () => getAiService().getProviderPresets());
  ipcMain.handle('ai:config:save', (event, config) => getAiService().saveProviderConfig(config));
  ipcMain.handle('ai:config:test', async (event, config) => getAiService().testConnection(config));
  ipcMain.handle('ai:chat:send', async (event, payload) => getAiService().sendChat(payload));
  ipcMain.handle('ai:task:start', async (event, payload) => getAiService().startTask(payload));
  ipcMain.handle('ai:collect:analyze', async (event, payload) => getAiService().analyzeCollection(payload));
  ipcMain.handle('ai:collect:apply-review', async (event, payload) => getAiService().applyCollectionReview(payload));
  ipcMain.handle('ai:task:cancel', () => getAiService().cancelTask());
  ipcMain.handle('ai:task:status', () => getAiService().getTaskStatus());
}

module.exports = registerAiHandlers;
