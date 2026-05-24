type ElectronAPI = import('../shared/contracts').ElectronAPI;

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
