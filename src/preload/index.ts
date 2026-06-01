import { contextBridge, ipcRenderer } from 'electron';
import type { EneAPI } from '../shared/types/ipc';

// Renderer 向けの安全な API 公開(設計書 §4.3)。
// contextIsolation: true / sandbox: true 前提。Renderer から FS や Node へ直接触らせない。

const eneAPI: EneAPI = {
  sendMessage: (text) => ipcRenderer.invoke('ene:send-message', text),
  getCharacterInfo: () => ipcRenderer.invoke('ene:get-character-info'),
  hasApiKey: () => ipcRenderer.invoke('ene:has-api-key'),
  saveApiKey: (key) => ipcRenderer.invoke('ene:save-api-key', key),
  moveWindow: (x, y) => ipcRenderer.invoke('ene:move-window', x, y),
  resetWindowPosition: () => ipcRenderer.invoke('ene:reset-window-position'),
  setIgnoreMouseEvents: (ignore) => ipcRenderer.invoke('ene:set-ignore-mouse-events', ignore),
  showCharacterContextMenu: () => ipcRenderer.invoke('ene:show-character-context-menu'),
  onAppReady: (cb) => {
    ipcRenderer.on('ene:app-ready', () => cb());
  },
  onError: (cb) => {
    ipcRenderer.on('ene:error', (_event, error: string) => cb(error));
  },
  onOpenInputArea: (cb) => {
    ipcRenderer.on('ene:open-input-area', () => cb());
  },
  onResetPosition: (cb) => {
    ipcRenderer.on('ene:reset-position', () => cb());
  },
};

contextBridge.exposeInMainWorld('ene', eneAPI);
