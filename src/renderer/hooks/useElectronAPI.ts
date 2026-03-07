import type { ElectronAPI } from '../types/index';

export function useElectronAPI(): ElectronAPI {
  return window.electronAPI;
}
