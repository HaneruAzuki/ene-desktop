import { contextBridge, ipcRenderer } from 'electron';
import type { EneAPI, VoiceChunk } from '../../shared/types/ipc';
import type { ConversationResponse } from '../../shared/types/conversation';

// Renderer 向けの安全な API 公開(設計書 §4.3)。
// contextIsolation: true / sandbox: true 前提。Renderer から FS や Node へ直接触らせない。

const eneAPI: EneAPI = {
  sendMessage: (text) => ipcRenderer.invoke('ene:send-message', text),
  getCharacterInfo: () => ipcRenderer.invoke('ene:get-character-info'),
  getVrmConfig: () => ipcRenderer.invoke('ene:get-vrm-config'),
  getCharacterModel: () => ipcRenderer.invoke('ene:get-character-model'),
  setVrmDisplay: (display) => ipcRenderer.invoke('ene:set-vrm-display', display),
  onWindowVisibility: (cb) => {
    // 二重登録防止(StrictMode 対策)=常に単一リスナーへ張り替える。
    ipcRenderer.removeAllListeners('ene:window-visibility');
    ipcRenderer.on('ene:window-visibility', (_event, visible: boolean) => cb(visible));
  },
  getInitialGreeting: () => ipcRenderer.invoke('ene:get-initial-greeting'),
  moveWindow: (x, y) => ipcRenderer.invoke('ene:move-window', x, y),
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
  onProactiveMessage: (cb) => {
    // 自発発話(P7)。二重登録防止で単一リスナーへ張り替える。
    ipcRenderer.removeAllListeners('ene:proactive-message');
    ipcRenderer.on('ene:proactive-message', (_event, response: ConversationResponse) => cb(response));
  },
  onVoiceBargeIn: (cb) => {
    ipcRenderer.removeAllListeners('ene:voice-barge-in');
    ipcRenderer.on('ene:voice-barge-in', () => cb());
  },
  notifyBargeInHeard: (text) => ipcRenderer.send('ene:voice-heard', text),
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
    ipcRenderer.on('ene:voice-chunk', (_event, chunk: VoiceChunk) => cb(chunk));
  },
  onBackchannel: (cb) => {
    // 二重登録防止(StrictMode 対策)=常に単一リスナーへ張り替える。
    ipcRenderer.removeAllListeners('ene:backchannel');
    ipcRenderer.on('ene:backchannel', (_event, wav: ArrayBuffer | null) => cb(wav));
  },
  onTurnNod: (cb) => {
    // ターン終端うなずき(無音窓終端で1回・深さ=発話長)。二重登録防止で単一リスナーへ張り替える。
    ipcRenderer.removeAllListeners('ene:turn-nod');
    ipcRenderer.on('ene:turn-nod', (_event, strength: number) => cb(strength));
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
  onOpenInputArea: (cb) => {
    // 二重登録防止(StrictMode 対策)=常に単一リスナーへ張り替える。
    ipcRenderer.removeAllListeners('ene:open-input-area');
    ipcRenderer.on('ene:open-input-area', () => cb());
  },
};

contextBridge.exposeInMainWorld('ene', eneAPI);
