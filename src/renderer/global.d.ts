type ElectronAPI = import('../shared/contracts').ElectronAPI;

declare global {
  interface Window {
    electronAPI: ElectronAPI;
    __getPerfMeasures?: () => Array<{name: string; duration: number}>;
  }
}

export {};
