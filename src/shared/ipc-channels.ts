// IPC チャネル名の単一の真実の源(SSOT)。
//
// main(ipcMain.handle/on・webContents.send)と preload(ipcRenderer.invoke/on/send)が
// **同じ定数**を参照することで、チャネル名の綴りズレをコンパイル時に検出する。
// 生文字列を両側で手書きすると、ズレても型は通りテストも通り、その機能だけ実機で
// 無言で死ぬ(invoke が reject / イベント不達)。それを構造的に排除するための定数表。
//
// 値は `ene:<kebab-case>` 形式。新しいチャネルはここに追加してから両側で参照すること。

export const IPC = {
  API_KEY_TEST: 'ene-key:test',
  API_KEY_SAVE: 'ene-key:save',
  API_KEY_OPEN_CONSOLE: 'ene-key:open-console',
  API_KEY_CLOSE: 'ene-key:close',
  APP_READY: 'ene:app-ready',
  BACKCHANNEL: 'ene:backchannel',
  EXPORT_MEMORY: 'ene:export-memory',
  GET_AUDIO_PREFS: 'ene:get-audio-prefs',
  GET_AUTO_LAUNCH: 'ene:get-auto-launch',
  GET_CHARACTER_INFO: 'ene:get-character-info',
  GET_CHARACTER_MODEL: 'ene:get-character-model',
  GET_IDLE_TALK: 'ene:get-idle-talk',
  GET_INITIAL_GREETING: 'ene:get-initial-greeting',
  GET_OWNER_NAME: 'ene:get-owner-name',
  GET_VOICE_EQ: 'ene:get-voice-eq',
  GET_VRM_CONFIG: 'ene:get-vrm-config',
  GOODBYE: 'ene:goodbye',
  IMPORT_MEMORY: 'ene:import-memory',
  IS_READY: 'ene:is-ready',
  LISTENING: 'ene:listening',
  MOVE_WINDOW: 'ene:move-window',
  OPEN_API_KEY_DIALOG: 'ene:open-api-key-dialog',
  OPEN_CONSOLE: 'ene:open-console',
  OPEN_DATA_FOLDER: 'ene:open-data-folder',
  OPEN_INPUT_AREA: 'ene:open-input-area',
  PROACTIVE_MESSAGE: 'ene:proactive-message',
  SAVE_AUDIO_PREFS: 'ene:save-audio-prefs',
  SAVE_IDLE_TALK: 'ene:save-idle-talk',
  SEND_MESSAGE: 'ene:send-message',
  SET_AUTO_LAUNCH: 'ene:set-auto-launch',
  SET_AWAY: 'ene:set-away',
  SET_IGNORE_MOUSE_EVENTS: 'ene:set-ignore-mouse-events',
  SET_OWNER_NAME: 'ene:set-owner-name',
  SET_VRM_DISPLAY: 'ene:set-vrm-display',
  SHOW_ABOUT: 'ene:show-about',
  THINKING_FILLER: 'ene:thinking-filler',
  TRANSCRIBE_AUDIO: 'ene:transcribe-audio',
  TURN_NOD: 'ene:turn-nod',
  USER_SAID: 'ene:user-said',
  VAD_FRAME: 'ene:vad-frame',
  VAD_SPEAKING: 'ene:vad-speaking',
  VAD_START: 'ene:vad-start',
  VAD_STOP: 'ene:vad-stop',
  VOICE_BARGE_IN: 'ene:voice-barge-in',
  VOICE_CHUNK: 'ene:voice-chunk',
  VOICE_HEARD: 'ene:voice-heard',
  VOICE_RESPONSE: 'ene:voice-response',
  VOICE_STATE: 'ene:voice-state',
  VOICE_TRANSCRIPT: 'ene:voice-transcript',
  WARM_CACHE: 'ene:warm-cache',
  WINDOW_VISIBILITY: 'ene:window-visibility',
  YAWN: 'ene:yawn',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
