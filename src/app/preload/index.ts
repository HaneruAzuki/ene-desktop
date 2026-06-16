import { contextBridge, ipcRenderer } from 'electron';
import type { EneAPI, VoiceChunk } from '../../shared/types/ipc';
import type { ConversationResponse } from '../../shared/types/conversation';
import { IPC } from '../../shared/ipc-channels';

// Renderer 向けの安全な API 公開(設計書 §4.3)。
// contextIsolation: true / sandbox: true 前提。Renderer から FS や Node へ直接触らせない。

const eneAPI: EneAPI = {
  sendMessage: (text) => ipcRenderer.invoke(IPC.SEND_MESSAGE, text),
  getCharacterInfo: () => ipcRenderer.invoke(IPC.GET_CHARACTER_INFO),
  getVrmConfig: () => ipcRenderer.invoke(IPC.GET_VRM_CONFIG),
  getCharacterModel: () => ipcRenderer.invoke(IPC.GET_CHARACTER_MODEL),
  setVrmDisplay: (display) => ipcRenderer.invoke(IPC.SET_VRM_DISPLAY, display),
  getAudioPrefs: () => ipcRenderer.invoke(IPC.GET_AUDIO_PREFS),
  saveAudioPrefs: (volume, muted) => ipcRenderer.invoke(IPC.SAVE_AUDIO_PREFS, volume, muted),
  getVoiceEq: () => ipcRenderer.invoke(IPC.GET_VOICE_EQ),
  goodbye: () => ipcRenderer.invoke(IPC.GOODBYE),
  setAway: (away) => ipcRenderer.send(IPC.SET_AWAY, away),
  getIdleTalk: () => ipcRenderer.invoke(IPC.GET_IDLE_TALK),
  saveIdleTalk: (mode) => ipcRenderer.invoke(IPC.SAVE_IDLE_TALK, mode),
  openApiKeyDialog: () => ipcRenderer.invoke(IPC.OPEN_API_KEY_DIALOG),
  showAbout: () => ipcRenderer.invoke(IPC.SHOW_ABOUT),
  openDataFolder: () => ipcRenderer.invoke(IPC.OPEN_DATA_FOLDER),
  openConsole: () => ipcRenderer.invoke(IPC.OPEN_CONSOLE),
  getAutoLaunch: () => ipcRenderer.invoke(IPC.GET_AUTO_LAUNCH),
  setAutoLaunch: (on) => ipcRenderer.invoke(IPC.SET_AUTO_LAUNCH, on),
  getOwnerName: () => ipcRenderer.invoke(IPC.GET_OWNER_NAME),
  setOwnerName: (name, reading) => ipcRenderer.invoke(IPC.SET_OWNER_NAME, name, reading),
  setLogExpanded: (expanded, panelWidth) =>
    ipcRenderer.send(IPC.SET_LOG_EXPANDED, expanded, panelWidth),
  onUserSaid: (cb) => {
    ipcRenderer.removeAllListeners(IPC.USER_SAID);
    ipcRenderer.on(IPC.USER_SAID, (_event, text: string) => cb(text));
  },
  onWindowVisibility: (cb) => {
    // 二重登録防止(StrictMode 対策)=常に単一リスナーへ張り替える。
    ipcRenderer.removeAllListeners(IPC.WINDOW_VISIBILITY);
    ipcRenderer.on(IPC.WINDOW_VISIBILITY, (_event, visible: boolean) => cb(visible));
  },
  getInitialGreeting: () => ipcRenderer.invoke(IPC.GET_INITIAL_GREETING),
  moveWindow: (x, y) => ipcRenderer.invoke(IPC.MOVE_WINDOW, x, y),
  setIgnoreMouseEvents: (ignore) => ipcRenderer.invoke(IPC.SET_IGNORE_MOUSE_EVENTS, ignore),
  showCharacterContextMenu: () => ipcRenderer.invoke(IPC.SHOW_CHARACTER_CONTEXT_MENU),
  warmCache: () => ipcRenderer.invoke(IPC.WARM_CACHE),
  isReady: () => ipcRenderer.invoke(IPC.IS_READY),
  transcribeAudio: (samples) => ipcRenderer.invoke(IPC.TRANSCRIBE_AUDIO, samples),
  startVad: () => ipcRenderer.invoke(IPC.VAD_START),
  sendVadFrame: (frame) => ipcRenderer.send(IPC.VAD_FRAME, frame),
  stopVad: () => ipcRenderer.send(IPC.VAD_STOP),
  setVadSpeaking: (speaking) => ipcRenderer.send(IPC.VAD_SPEAKING, speaking),
  onVoiceState: (cb) => {
    ipcRenderer.removeAllListeners(IPC.VOICE_STATE);
    ipcRenderer.on(IPC.VOICE_STATE, (_event, state: 'listening' | 'recording' | 'transcribing') =>
      cb(state),
    );
  },
  onVoiceTranscript: (cb) => {
    ipcRenderer.removeAllListeners(IPC.VOICE_TRANSCRIPT);
    ipcRenderer.on(IPC.VOICE_TRANSCRIPT, (_event, text: string) => cb(text));
  },
  onVoiceResponse: (cb) => {
    ipcRenderer.removeAllListeners(IPC.VOICE_RESPONSE);
    ipcRenderer.on(IPC.VOICE_RESPONSE, (_event, response: ConversationResponse) => cb(response));
  },
  onProactiveMessage: (cb) => {
    // 自発発話(P7)。二重登録防止で単一リスナーへ張り替える。
    ipcRenderer.removeAllListeners(IPC.PROACTIVE_MESSAGE);
    ipcRenderer.on(IPC.PROACTIVE_MESSAGE, (_event, response: ConversationResponse) =>
      cb(response),
    );
  },
  onVoiceBargeIn: (cb) => {
    ipcRenderer.removeAllListeners(IPC.VOICE_BARGE_IN);
    ipcRenderer.on(IPC.VOICE_BARGE_IN, () => cb());
  },
  notifyBargeInHeard: (text) => ipcRenderer.send(IPC.VOICE_HEARD, text),
  onVoiceChunk: (cb) => {
    // 二重登録防止: dev の StrictMode で effect が2回走るとリスナーが累積し、
    // 各センテンスが2回再生される。常に単一リスナーへ張り替える。
    ipcRenderer.removeAllListeners(IPC.VOICE_CHUNK);
    ipcRenderer.on(IPC.VOICE_CHUNK, (_event, chunk: VoiceChunk) => cb(chunk));
  },
  onBackchannel: (cb) => {
    // 二重登録防止(StrictMode 対策)=常に単一リスナーへ張り替える。
    ipcRenderer.removeAllListeners(IPC.BACKCHANNEL);
    ipcRenderer.on(IPC.BACKCHANNEL, (_event, wav: ArrayBuffer | null) => cb(wav));
  },
  onTurnNod: (cb) => {
    // ターン終端うなずき(無音窓終端で1回・深さ=発話長)。二重登録防止で単一リスナーへ張り替える。
    ipcRenderer.removeAllListeners(IPC.TURN_NOD);
    ipcRenderer.on(IPC.TURN_NOD, (_event, strength: number) => cb(strength));
  },
  onYawn: (cb) => {
    // あくび(長時間傾聴の情緒ビート・listening-mode)。二重登録防止で単一リスナーへ張り替える。
    ipcRenderer.removeAllListeners(IPC.YAWN);
    ipcRenderer.on(IPC.YAWN, () => cb());
  },
  onListening: (cb) => {
    // 傾聴モードの出入り(少し首をかしげる)。二重登録防止で単一リスナーへ張り替える。
    ipcRenderer.removeAllListeners(IPC.LISTENING);
    ipcRenderer.on(IPC.LISTENING, (_event, on: boolean) => cb(on));
  },
  onThinkingFiller: (cb) => {
    // 思考フィラーの表示文字列(「そうね」等)。吹き出しに一時表示=応答で上書きされる。
    ipcRenderer.removeAllListeners(IPC.THINKING_FILLER);
    ipcRenderer.on(IPC.THINKING_FILLER, (_event, text: string) => cb(text));
  },
  onAppReady: (cb) => {
    // 二重登録防止(dev StrictMode で effect が2回走る対策)=常に単一リスナーへ張り替える。
    ipcRenderer.removeAllListeners(IPC.APP_READY);
    ipcRenderer.on(IPC.APP_READY, () => cb());
  },
  onOpenInputArea: (cb) => {
    // 二重登録防止(StrictMode 対策)=常に単一リスナーへ張り替える。
    ipcRenderer.removeAllListeners(IPC.OPEN_INPUT_AREA);
    ipcRenderer.on(IPC.OPEN_INPUT_AREA, () => cb());
  },
};

contextBridge.exposeInMainWorld('ene', eneAPI);
