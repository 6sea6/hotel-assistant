const { ipcMain } = require('electron');
const { getHandlerRegistrations } = require('./ipc-handler-registry');
const { createServiceContainer } = require('./services');

class IPCHandlerManager {
  constructor() {
    this.services = null;
  }

  registerAllHandlers() {
    if (!this.services) {
      this.services = createServiceContainer();
    }

    const registrations = getHandlerRegistrations({
      ipcMain,
      services: this.services
    });

    registrations.forEach(({ register, context }) => {
      register(context);
    });
  }

  getServices() {
    return this.services;
  }
}

module.exports = new IPCHandlerManager();
