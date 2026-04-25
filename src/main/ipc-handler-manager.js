const { ipcMain } = require('electron');
const { getHandlerRegistrations } = require('./ipc-handler-registry');
const { createServiceContainer } = require('./services');

class IPCHandlerManager {
  constructor() {
    this.cache = null;
    this.services = null;
  }

  registerAllHandlers() {
    const { DataCache } = require('./utils');

    if (!this.cache) {
      this.cache = new DataCache();
    }

    if (!this.services) {
      this.services = createServiceContainer({ cache: this.cache });
    } else {
      this.services.cache = this.cache;
    }

    const registrations = getHandlerRegistrations({
      ipcMain,
      cache: this.cache,
      services: this.services
    });

    registrations.forEach(({ register, context }) => {
      register(context);
    });
  }

  getCache() {
    return this.cache;
  }

  getServices() {
    return this.services;
  }
}

module.exports = new IPCHandlerManager();
