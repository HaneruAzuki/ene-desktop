import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import type { EneApiKeyAPI } from '../../shared/types/api-key';

// APIキーダイアログ専用の Renderer API(設計書 §3.7)。
// メインの window.ene とは別に window.eneApiKey を公開する。
// チャネル名は main と同じ shared/ipc-channels の定数を参照(綴りズレをコンパイル検出)。

const api: EneApiKeyAPI = {
  testApiKey: (key) => ipcRenderer.invoke(IPC.API_KEY_TEST, key),
  saveApiKey: (key) => ipcRenderer.invoke(IPC.API_KEY_SAVE, key),
  openAnthropicConsole: () => ipcRenderer.invoke(IPC.API_KEY_OPEN_CONSOLE),
  closeDialog: (ok) => ipcRenderer.invoke(IPC.API_KEY_CLOSE, ok),
};

contextBridge.exposeInMainWorld('eneApiKey', api);
