import { contextBridge, ipcRenderer } from 'electron';
import type { EneApiKeyAPI } from '../../shared/types/api-key';

// APIキーダイアログ専用の Renderer API(設計書 §3.7)。
// メインの window.ene とは別に window.eneApiKey を公開する。

const api: EneApiKeyAPI = {
  testApiKey: (key) => ipcRenderer.invoke('ene-key:test', key),
  saveApiKey: (key) => ipcRenderer.invoke('ene-key:save', key),
  openAnthropicConsole: () => ipcRenderer.invoke('ene-key:open-console'),
  closeDialog: (ok) => ipcRenderer.invoke('ene-key:close', ok),
};

contextBridge.exposeInMainWorld('eneApiKey', api);
