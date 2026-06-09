import { contextBridge, ipcRenderer } from 'electron';
import type { EneAPI } from '../shared/types/ipc';
import type { ConversationResponse } from '../shared/types/conversation';

// Renderer 向けの安全な API 公開(設計書 §4.3)。
// contextIsolation: true / sandbox: true 前提。Renderer から FS や Node へ直接触らせない。

const eneAPI: EneAPI = {
  sendMessage: (text) => ipcRenderer.invoke('ene:send-message', text),
  getCharacterInfo: () => ipcRenderer.invoke('ene:get-character-info'),
  getInitialGreeting: () => ipcRenderer.invoke('ene:get-initial-greeting'),
  hasApiKey: () => ipcRenderer.invoke('ene:has-api-key'),
  saveApiKey: (key) => ipcRenderer.invoke('ene:save-api-key', key),
  moveWindow: (x, y) => ipcRenderer.invoke('ene:move-window', x, y),
  resetWindowPosition: () => ipcRenderer.invoke('ene:reset-window-position'),
  setIgnoreMouseEvents: (ignore) => ipcRenderer.invoke('ene:set-ignore-mouse-events', ignore),
  showCharacterContextMenu: () => ipcRenderer.invoke('ene:show-character-context-menu'),
  warmCache: () => ipcRenderer.invoke('ene:warm-cache'),
  isReady: () => ipcRenderer.invoke('ene:is-ready'),
  transcribeAudio: (samples) => ipcRenderer.invoke('ene:transcribe-audio', samples),
  startVad: () => ipcRenderer.invoke('ene:vad-start'),
  sendVadFrame: (frame) => ipcRenderer.send('ene:vad-frame', frame),
  stopVad: () => ipcRenderer.send('ene:vad-stop'),
  setVadSpeaking: (speaking) => ipcRenderer.send('ene:vad-speaking', speaking),
  onVoiceState: (cb) => {
    ipcRenderer.removeAllListeners('ene:voice-state');
    ipcRenderer.on('ene:voice-state', (_event, state: 'listening' | 'recording' | 'transcribing') =>
      cb(state),
    );
  },
  onVoiceTranscript: (cb) => {
    ipcRenderer.removeAllListeners('ene:voice-transcript');
    ipcRenderer.on('ene:voice-transcript', (_event, text: string) => cb(text));
  },
  onVoiceResponse: (cb) => {
    ipcRenderer.removeAllListeners('ene:voice-response');
    ipcRenderer.on('ene:voice-response', (_event, response: ConversationResponse) => cb(response));
  },
  onVoiceBargeIn: (cb) => {
    ipcRenderer.removeAllListeners('ene:voice-barge-in');
    ipcRenderer.on('ene:voice-barge-in', () => cb());
  },
  getVoiceInputMode: () => ipcRenderer.invoke('ene:get-voice-input-mode'),
  onVoiceInputModeChanged: (cb) => {
    ipcRenderer.removeAllListeners('ene:voice-input-mode-changed');
    ipcRenderer.on('ene:voice-input-mode-changed', (_event, mode: 'push-to-talk' | 'hands-free') =>
      cb(mode),
    );
  },
  onVoiceChunk: (cb) => {
    // 二重登録防止: dev の StrictMode で effect が2回走るとリスナーが累積し、
    // 各センテンスが2回再生される。常に単一リスナーへ張り替える。
    ipcRenderer.removeAllListeners('ene:voice-chunk');
    ipcRenderer.on('ene:voice-chunk', (_event, chunk: ArrayBuffer) => cb(chunk));
  },
  onBackchannel: (cb) => {
    // 二重登録防止(StrictMode 対策)=常に単一リスナーへ張り替える。
    ipcRenderer.removeAllListeners('ene:backchannel');
    ipcRenderer.on('ene:backchannel', (_event, wav: ArrayBuffer | null) => cb(wav));
  },
  onThinkingFiller: (cb) => {
    // 思考フィラーの表示文字列(「そうね」等)。吹き出しに一時表示=応答で上書きされる。
    ipcRenderer.removeAllListeners('ene:thinking-filler');
    ipcRenderer.on('ene:thinking-filler', (_event, text: string) => cb(text));
  },
  onAppReady: (cb) => {
    // 二重登録防止(dev StrictMode で effect が2回走る対策)=常に単一リスナーへ張り替える。
    ipcRenderer.removeAllListeners('ene:app-ready');
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
