const { contextBridge, ipcRenderer } = require('electron');
const { APP_CONFIG } = require('./config');

const invokeCache = new Map();
const CACHE_TTL = 2000;
const MAX_CACHE_SIZE = 50;
const CACHED_CHANNELS = new Set([
  'hotel:getById',
  'template:getAll',
  'settings:get',
  'settings:getAll'
]);

const cleanExpiredCache = () => {
  const now = Date.now();
  for (const [key, value] of invokeCache.entries()) {
    if (now - value.time > CACHE_TTL) {
      invokeCache.delete(key);
    }
  }
};

setInterval(cleanExpiredCache, 5000);

const getCacheKeyFragment = (value) => {
  if (value === null || value === undefined) {
    return String(value);
  }

  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
    return `${valueType}:${value}`;
  }

  try {
    return `json:${JSON.stringify(value)}`;
  } catch (error) {
    return `fallback:${Object.prototype.toString.call(value)}`;
  }
};

const buildCacheKey = (channel, args) => `${channel}:${args.map(getCacheKeyFragment).join('|')}`;

const shouldCacheChannel = (channel) => CACHED_CHANNELS.has(channel);

const cachedInvoke = async (channel, ...args) => {
  const cacheKey = buildCacheKey(channel, args);
  const cached = invokeCache.get(cacheKey);
  
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return cached.data;
  }

  let result;
  try {
    result = await ipcRenderer.invoke(channel, ...args);
  } catch (error) {
    console.error(`[preload] IPC 调用失败: ${channel}`, error);
    throw error;
  }

  if (shouldCacheChannel(channel)) {
    if (invokeCache.size >= MAX_CACHE_SIZE) {
      const firstKey = invokeCache.keys().next().value;
      invokeCache.delete(firstKey);
    }
    invokeCache.set(cacheKey, { data: result, time: Date.now() });
  }
  
  return result;
};

const invalidateCache = (pattern) => {
  for (const key of invokeCache.keys()) {
    if (key.includes(pattern)) {
      invokeCache.delete(key);
    }
  }
};

const batchOperations = {
  async updateMultipleHotels(hotels) {
    const result = await ipcRenderer.invoke('hotel:updateMultiple', hotels);
    invalidateCache('hotel');
    return result;
  }
};

contextBridge.exposeInMainWorld('electronAPI', {
  appInfo: {
    name: APP_CONFIG.NAME,
    version: APP_CONFIG.VERSION,
    releaseDate: APP_CONFIG.RELEASE_DATE,
    author: APP_CONFIG.AUTHOR,
    platform: process.platform
  },

  // 宾馆操作
  addHotel: async (hotel) => {
    invalidateCache('hotel');
    return ipcRenderer.invoke('hotel:add', hotel);
  },
  updateHotel: async (hotel) => {
    invalidateCache('hotel');
    return ipcRenderer.invoke('hotel:update', hotel);
  },
  deleteHotel: async (id) => {
    invalidateCache('hotel');
    return ipcRenderer.invoke('hotel:delete', id);
  },
  deleteMultipleHotels: async (ids) => {
    invalidateCache('hotel');
    return ipcRenderer.invoke('hotel:deleteMultiple', ids);
  },
  getAllHotels: () => ipcRenderer.invoke('hotel:getAll'),
  getHotelById: (id) => cachedInvoke('hotel:getById', id),
  updateMultipleHotels: batchOperations.updateMultipleHotels,

  // 模板操作
  addTemplate: async (template) => {
    invalidateCache('template');
    return ipcRenderer.invoke('template:add', template);
  },
  updateTemplate: async (template) => {
    invalidateCache('template');
    return ipcRenderer.invoke('template:update', template);
  },
  updateTemplateAndSync: async (template) => {
    invalidateCache('template');
    invalidateCache('hotel');
    const result = await ipcRenderer.invoke('template:updateAndSync', template);
    if (!result || !result.success) {
      throw new Error(result ? result.error : '未知错误');
    }
    return result;
  },
  deleteTemplate: async (id) => {
    invalidateCache('template');
    invalidateCache('hotel');
    return ipcRenderer.invoke('template:delete', id);
  },
  getAllTemplates: () => cachedInvoke('template:getAll'),

  getSetting: (key) => ipcRenderer.invoke('settings:get', key),
  setSetting: async (key, value) => {
    invalidateCache('settings');
    return ipcRenderer.invoke('settings:set', key, value);
  },
  applyThemeAppearance: (theme) => ipcRenderer.invoke('settings:applyThemeAppearance', theme),
  getAllSettings: () => cachedInvoke('settings:getAll'),
  getAppIconState: () => ipcRenderer.invoke('settings:getIconState'),
  chooseAppIcon: async () => {
    invalidateCache('settings');
    return ipcRenderer.invoke('settings:chooseAppIcon');
  },
  resetAppIcon: async () => {
    invalidateCache('settings');
    return ipcRenderer.invoke('settings:resetAppIcon');
  },
  resetAllSettings: async () => {
    invalidateCache('');
    return ipcRenderer.invoke('settings:resetAll');
  },

  exportData: () => ipcRenderer.invoke('data:export'),
  importData: async (mode = 'replace') => {
    invalidateCache('');
    return ipcRenderer.invoke('data:import', mode);
  },
  exportRankingImage: (imageBuffer) => ipcRenderer.invoke('ranking:exportImage', imageBuffer),
  openCtrip: () => ipcRenderer.invoke('open:ctrip'),
  openFliggy: () => ipcRenderer.invoke('open:fliggy'),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),

  getDataPath: () => ipcRenderer.invoke('data:getPath'),
  showDataInFolder: () => ipcRenderer.invoke('data:showInFolder'),
  changeDataPath: async () => {
    invalidateCache('');
    return ipcRenderer.invoke('data:changePath');
  },

  batch: batchOperations,

  onMenuExportData: (callback) => {
    ipcRenderer.on('menu-export-data', callback);
  },
  onMenuImportData: (callback) => {
    ipcRenderer.on('menu-import-data', callback);
  },

  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggleMaximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  getWindowState: () => ipcRenderer.invoke('window:getState'),
  onWindowStateChanged: (callback) => {
    ipcRenderer.on('window:stateChanged', (event, state) => callback(state));
  },

  // AI提示词相关
  getPrompt: (type) => ipcRenderer.invoke('prompt:get', type),
  savePrompt: (type, content) => ipcRenderer.invoke('prompt:save', type, content),
  
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },

  invalidateRendererCache: (pattern = '') => {
    invalidateCache(pattern);
  },

  // 事件监听
  onTemplateUpdated: (callback) => {
    ipcRenderer.on('template:updated', (event, data) => callback(data));
  }
});
