const { requireSharedCompareAppModule } = require('../shared-compare-app');
const { assertPlainObject, isPlainObject, safeHandle } = require('../ipc-safe-handler');

function registerAiHandlers({ ipcMain, services }) {
  const getAiService = () =>
    typeof services.getAiService === 'function' ? services.getAiService() : services.aiService;
  const getCtripUrlFilters = () => requireSharedCompareAppModule('ctrip-url-filters.js');

  safeHandle(ipcMain, 'ai:config:get', () => getAiService().getProviderConfig());
  safeHandle(ipcMain, 'ai:config:presets', () => getAiService().getProviderPresets());
  safeHandle(ipcMain, 'ai:config:save', (_event, config) =>
    getAiService().saveProviderConfig(assertPlainObject(config))
  );
  safeHandle(ipcMain, 'ai:config:test', (_event, config) =>
    getAiService().testConnection(assertPlainObject(config))
  );
  safeHandle(ipcMain, 'ai:chat:send', (_event, payload) => {
    if (!isPlainObject(payload)) {
      return { success: false, error: '无效的 AI 请求参数' };
    }
    return getAiService().sendChat(payload);
  });
  safeHandle(ipcMain, 'ai:task:start', (_event, payload) => {
    if (!isPlainObject(payload)) {
      return { success: false, error: '无效的 AI 请求参数' };
    }
    return getAiService().startTask(payload);
  });
  safeHandle(ipcMain, 'ai:task:refresh-data', (_event, payload) => {
    if (!isPlainObject(payload)) {
      return { success: false, error: '无效的 AI 请求参数' };
    }
    return getAiService().refreshHotelData(payload);
  });
  safeHandle(ipcMain, 'ai:task:cancel', () => getAiService().cancelTask());
  safeHandle(ipcMain, 'ai:task:status', () => getAiService().getTaskStatus());
  safeHandle(ipcMain, 'ai:ctrip-list-url:parse', (_event, url) =>
    getCtripUrlFilters().parseCtripListUrl(String(url || '').trim())
  );
  safeHandle(ipcMain, 'ai:ctrip-list-url:build', (_event, payload = {}) => {
    const payloadObject = typeof payload === 'string' ? {} : assertPlainObject(payload);
    const baseUrl =
      typeof payload === 'string'
        ? payload.trim()
        : String(payloadObject.baseUrl || payloadObject.url || '').trim();
    const settings = isPlainObject(payloadObject.settings) ? payloadObject.settings : {};
    return getCtripUrlFilters().buildCtripListUrl(baseUrl, settings);
  });
}

module.exports = registerAiHandlers;
