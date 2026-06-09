import React, { useEffect, useRef, useState } from 'react';
import { CharacterDisplay, type CharacterDisplayHandle } from './components/CharacterDisplay';
import { SpeechBubble } from './components/SpeechBubble';
import { InputArea } from './components/InputArea';
import { playClick } from './sound';
import { enqueueAudio, stopPlayback, setPlaybackHandlers } from './audio-player';
import { playBackchannel, stopBackchannel } from './backchannel-player';
import { VoiceMic } from './voice-conversation';
import { startRecording, type Recorder } from './mic-capture';
import { SOFA_AFTER_IDLE_MS, MOUTH_FLAP_MS, TALKING_MIN_MS, TALKING_MAX_MS } from './constants';
import { STT_SAMPLE_RATE } from '../shared/constants';
import type { CharacterInfo } from '../shared/types/ipc';
import type { CharacterState } from '../shared/types/animation';
import type { VoiceInputMode } from '../shared/types/settings';
import type { ConversationResponse } from '../shared/types/conversation';

// トップコンポーネント(設計書 §8 / task_13)。
// キャラ表示・吹き出し・入力欄・統合マイクボタンを束ねる。
// task_17: マイクは「入力欄の下・中央」の単一ボタンに統合。設定(右クリックメニュー)で
//   Push-to-Talk(押している間録音) / ハンズフリー(VAD自動) を切替える。
//   ボタンは ON(リッスン中)/OFF だけ示す。状態テキストは出さない(聞き取り中はキャラは neutral)。

function rectContains(el: HTMLElement | null, x: number, y: number): boolean {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
}

/** これ未満の長さ(秒)の push-to-talk 録音は誤タップ扱いで無視する。 */
const MIN_RECORDING_SEC = 0.3;

/** 起動準備が整うまで吹き出しに出す「まだ話しかけないで」サイン(音声エンジン起動・ウォーム中)。 */
const WAIT_MESSAGE = 'ちょっと待って、…いま準備してるところ。';

export function App(): React.ReactElement | null {
  const [characterInfo, setCharacterInfo] = useState<CharacterInfo | null>(null);
  const [inputVisible, setInputVisible] = useState(false);
  const [bubble, setBubble] = useState<string | null>(null);
  const [voiceInputMode, setVoiceInputMode] = useState<VoiceInputMode>('push-to-talk');
  const [handsFreeOn, setHandsFreeOn] = useState(false); // ハンズフリーで VAD 起動中
  const [recording, setRecording] = useState(false); // push-to-talk で録音中(押下中)
  const [nodKey, setNodKey] = useState(0); // 相槌のうなずき(増えるたびに1回うなずく・task_18)
  const [charState, setCharState] = useState<CharacterState>({
    activity: 'idle',
    emotion: 'neutral',
    pose: 'stand',
  });

  const charRef = useRef<CharacterDisplayHandle>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const micButtonRef = useRef<HTMLButtonElement>(null);
  const lastIgnoreRef = useRef<boolean | null>(null);
  const talkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micRef = useRef<VoiceMic | null>(null); // ハンズフリーのマイク
  const recorderRef = useRef<Recorder | null>(null); // push-to-talk の録音
  const voiceModeRef = useRef(false); // 非同期コールバックから handsFreeOn を読む
  const readyRef = useRef(false); // 起動準備完了(多重通知の冪等化)
  const interactedRef = useRef(false); // 既にユーザーが会話を始めたか(準備完了後の挨拶差し替え判定)

  // ON(リッスン中)かどうか: ハンズフリーは VAD 起動中、PTT は押下中。
  const micActive = voiceInputMode === 'hands-free' ? handsFreeOn : recording;

  // 起動時に CharacterInfo / マイク入力方式を取得 ＋ 起動準備の状態を反映。
  // 準備が整うまでは挨拶を出さず「ちょっと待って、」を表示する(整い次第・挨拶へ差し替え)。
  useEffect(() => {
    void window.ene.getCharacterInfo().then(setCharacterInfo);
    void window.ene.getVoiceInputMode().then(setVoiceInputMode);
    void window.ene.isReady().then((r) => {
      if (r) markReady();
      else if (!readyRef.current && !interactedRef.current) setBubble(WAIT_MESSAGE);
    });
  }, []);

  // 準備完了の通知(push)。pull(isReady)との競合は readyRef で冪等化する。
  useEffect(() => {
    window.ene.onAppReady(() => markReady());
  }, []);

  // トレイ / コンテキストメニューからのイベント＋マイク入力方式の変更通知
  useEffect(() => {
    window.ene.onOpenInputArea(() => openInput());
    window.ene.onResetPosition(() => {
      /* 位置リセットは main 側で実施。 */
    });
    window.ene.onVoiceInputModeChanged((mode) => applyVoiceInputMode(mode));
  }, []);

  // 音声応答チャンク(WAV)を逐次再生(task_17 Phase A)
  useEffect(() => {
    window.ene.onVoiceChunk((chunk) => void enqueueAudio(chunk));
  }, []);

  // 相槌(聞くターン・task_18 Phase B): WAV があれば即時再生＋必ずうなずく(音声未準備でもうなずきは出す)。
  useEffect(() => {
    window.ene.onBackchannel((wav) => {
      if (wav) void playBackchannel(wav);
      setNodKey((k) => k + 1);
    });
  }, []);

  // 思考フィラー(熟考の入り・Phase C): 吹き出しに「考えている」文字列を一時表示。
  // 応答が来たら setBubble(response.message) で上書きされる(=一瞬の"間"の見える化)。
  useEffect(() => {
    window.ene.onThinkingFiller((text) => setBubble(text));
  }, []);

  // 実際の再生開始/終了に「ENE 発話中」フラグを連動(task_17 Phase C・barge-in)。
  useEffect(() => {
    setPlaybackHandlers(
      () => {
        // 応答が鳴り始めた瞬間=鳴り残った相槌をダッキング(停止)して声の重なりを防ぐ。
        stopBackchannel();
        if (voiceModeRef.current) window.ene.setVadSpeaking(true);
      },
      () => {
        if (voiceModeRef.current) window.ene.setVadSpeaking(false);
      },
    );
  }, []);

  // ハンズフリー: main からの状態/確定テキスト/割り込み。
  // 状態テキストは出さず、考え中(transcribing)だけ吹き出し「…」で示す(聞き取り中は neutral)。
  useEffect(() => {
    window.ene.onVoiceState((state) => {
      if (state === 'transcribing') {
        setCharState((s) => ({ ...s, activity: 'thinking', pose: 'stand' }));
      } else if (state === 'listening') {
        // 空認識などで聞き取りに戻った時、考え中を解除して neutral へ。
        setCharState((s) => (s.activity === 'thinking' ? { ...s, activity: 'idle' } : s));
      }
      // 'recording'(ユーザー発話中)は何もしない=キャラは neutral のまま。
    });
    window.ene.onVoiceTranscript((text) => void respond(text));
    // コアレッシング(ENE_COALESCE)時は main で生成が完結し、確定応答だけが届く(投機キャンセルは届かない)。
    // 既に「考え中(transcribing)」は onVoiceState で表示済み・音声は ene:voice-chunk で再生済み。
    window.ene.onVoiceResponse((response) => applyResponseUI(response));
    window.ene.onVoiceBargeIn(() => handleBargeIn());
  }, []);

  // 入力欄を開いた瞬間に Tier0 キャッシュを温める(task_14 Phase 3)。
  useEffect(() => {
    if (inputVisible) void window.ene.warmCache();
  }, [inputVisible]);

  // ESC で入力欄・吹き出しを閉じる
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setInputVisible(false);
        dismissBubble();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // 長時間 idle で寝そべり(F-ANIM-03)。
  useEffect(() => {
    if (charState.activity !== 'idle' || charState.pose !== 'stand') return;
    const id = setTimeout(() => setCharState((s) => ({ ...s, pose: 'sofa' })), SOFA_AFTER_IDLE_MS);
    return () => clearTimeout(id);
  }, [charState.activity, charState.pose]);

  // クリックスルー(§8.6): キャラ不透明 OR 吹き出し OR 入力欄 OR マイクボタン の上なら不透過。
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      const interactive =
        (charRef.current?.isOpaqueAt(e.clientX, e.clientY) ?? true) ||
        rectContains(bubbleRef.current, e.clientX, e.clientY) ||
        rectContains(inputRef.current, e.clientX, e.clientY) ||
        rectContains(micButtonRef.current, e.clientX, e.clientY);
      const ignore = !interactive;
      if (lastIgnoreRef.current !== ignore) {
        lastIgnoreRef.current = ignore;
        void window.ene.setIgnoreMouseEvents(ignore);
      }
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  /** 吹き出しを閉じ、talking 中なら idle に戻す。 */
  function dismissBubble(): void {
    setBubble(null);
    setCharState((s) => (s.activity === 'talking' ? { ...s, activity: 'idle' } : s));
  }

  /** 入力欄を開く(操作=起き上がる・クリック音)。 */
  function openInput(): void {
    playClick();
    setInputVisible(true);
    setCharState((s) => ({ ...s, pose: 'stand' }));
  }

  /** 起動挨拶を1回取得して吹き出しに出す(pull・取得後 main 側でクリア)。 */
  async function showGreeting(): Promise<void> {
    const greeting = await window.ene.getInitialGreeting();
    if (greeting) setBubble(greeting);
  }

  /** 起動準備が整った時の処理(pull/push どちらから来ても冪等)。 */
  function markReady(): void {
    if (readyRef.current) return;
    readyRef.current = true;
    if (!interactedRef.current) {
      // 「ちょっと待って、」を挨拶へ差し替える(まだ会話していない場合のみ)。
      void showGreeting();
    } else {
      // 既に会話中なら、待ちメッセージが残っていれば消すだけ。
      setBubble((b) => (b === WAIT_MESSAGE ? null : b));
    }
  }

  /**
   * ユーザー発話(テキスト or 音声認識)に応答する共通フロー。
   * 「ENE 発話中」フラグ(barge-in 用)は実際の音声再生に連動(setPlaybackHandlers 参照)。
   */
  async function respond(text: string): Promise<void> {
    interactedRef.current = true; // 会話開始 → 準備完了後に挨拶で上書きしない
    setBubble(null);
    if (talkingTimerRef.current) clearTimeout(talkingTimerRef.current);
    setCharState((s) => ({ ...s, activity: 'thinking', pose: 'stand' }));
    const response = await window.ene.sendMessage(text);
    applyResponseUI(response);
  }

  /**
   * 確定応答を UI(吹き出し/表情/口パク)へ反映する。
   * テキスト/非コアレッシング音声は respond() から、コアレッシング音声は onVoiceResponse から呼ぶ
   * (生成は main 側で完結し、ここは表示だけ)。
   */
  function applyResponseUI(response: ConversationResponse): void {
    interactedRef.current = true;
    const emotion = response.type === 'chat' ? (response.emotion ?? 'neutral') : 'neutral';
    if (talkingTimerRef.current) clearTimeout(talkingTimerRef.current);
    setCharState((s) => ({ ...s, activity: 'talking', emotion, pose: 'stand' }));
    setBubble(response.message);

    const talkMs = Math.min(
      TALKING_MAX_MS,
      Math.max(TALKING_MIN_MS, response.message.length * MOUTH_FLAP_MS),
    );
    talkingTimerRef.current = setTimeout(() => {
      setCharState((s) => (s.activity === 'talking' ? { ...s, activity: 'idle' } : s));
    }, talkMs);
  }

  async function handleSubmit(text: string): Promise<void> {
    playClick();
    setInputVisible(false);
    await respond(text);
  }

  /** barge-in: ENE 発話中にユーザーが話しかけたら、ENE の声を即停止して聞く体勢へ。 */
  function handleBargeIn(): void {
    stopPlayback();
    stopBackchannel(); // 鳴り残った相槌もダッキング(割り込み時に黙らせる)
    if (talkingTimerRef.current) clearTimeout(talkingTimerRef.current);
    setCharState((s) => (s.activity === 'talking' ? { ...s, activity: 'idle' } : s));
    window.ene.setVadSpeaking(false);
  }

  // --- ハンズフリー(VAD)の ON/OFF ---
  async function startHandsFree(): Promise<void> {
    const ok = await window.ene.startVad();
    if (!ok) {
      setBubble('…ごめん、耳がまだ準備できてないみたい。');
      return;
    }
    // 聞き取り開始の時点で Tier0 キャッシュを温める(ハンズフリーは入力欄を開かないため・レイテンシ施策)。
    void window.ene.warmCache();
    try {
      micRef.current ??= new VoiceMic();
      await micRef.current.start();
      voiceModeRef.current = true;
      setHandsFreeOn(true);
    } catch {
      window.ene.stopVad();
      setBubble('…マイクが使えないみたい。マイクの接続や設定を確認してみて?');
    }
  }
  function stopHandsFree(): void {
    micRef.current?.stop();
    window.ene.stopVad();
    window.ene.setVadSpeaking(false);
    voiceModeRef.current = false;
    setHandsFreeOn(false);
  }

  // --- push-to-talk(押している間だけ録音) ---
  async function startPtt(): Promise<void> {
    if (recording) return;
    // 録音開始の時点で Tier0 キャッシュを温める(録音→認識の間に書き込まれる・レイテンシ施策)。
    void window.ene.warmCache();
    try {
      recorderRef.current = await startRecording();
      setRecording(true);
    } catch {
      recorderRef.current = null;
      setBubble('…マイクが使えないみたい。マイクの接続や設定を確認してみて?');
    }
  }
  async function stopPtt(): Promise<void> {
    const rec = recorderRef.current;
    if (!rec || !recording) return;
    recorderRef.current = null;
    setRecording(false);
    try {
      const samples = await rec.stop();
      if (samples.length < STT_SAMPLE_RATE * MIN_RECORDING_SEC) return; // 短すぎ=無視
      setCharState((s) => ({ ...s, activity: 'thinking', pose: 'stand' })); // 認識中は「…」
      const result = await window.ene.transcribeAudio(samples);
      if (result.ok) await respond(result.text);
      else {
        setBubble(result.message);
        setCharState((s) => (s.activity === 'thinking' ? { ...s, activity: 'idle' } : s));
      }
    } catch {
      setBubble('…うまく聞き取れなかった。もう一回試してみて?');
      setCharState((s) => (s.activity === 'thinking' ? { ...s, activity: 'idle' } : s));
    }
  }

  /** 設定でマイク入力方式が変わった時の適用(別方式へ移る前に現方式を止める)。 */
  function applyVoiceInputMode(mode: VoiceInputMode): void {
    if (mode !== 'hands-free' && voiceModeRef.current) stopHandsFree();
    if (mode !== 'push-to-talk' && recorderRef.current) {
      recorderRef.current.cancel();
      recorderRef.current = null;
      setRecording(false);
    }
    setVoiceInputMode(mode);
  }

  if (!characterInfo) return null;

  // マイクボタンの操作は方式で異なる。ハンズフリー=クリックでトグル、PTT=押している間だけ。
  const micHandlers =
    voiceInputMode === 'hands-free'
      ? { onClick: () => void (handsFreeOn ? stopHandsFree() : startHandsFree()) }
      : {
          onMouseDown: () => void startPtt(),
          onMouseUp: () => void stopPtt(),
          onMouseLeave: () => void stopPtt(),
        };
  const micTitle =
    voiceInputMode === 'hands-free'
      ? handsFreeOn
        ? 'ハンズフリー: ON(クリックで OFF)'
        : 'ハンズフリー: OFF(クリックで ON)'
      : '押している間だけ録音(離すと認識)';

  return (
    <div className="app">
      {/* 考える間(thinking)の演出。専用スプライトが無いので「…」で示す(F-ANIM-04)。 */}
      {charState.activity === 'thinking' && <div className="bubble bubble--thinking">…</div>}
      {bubble !== null && (
        <SpeechBubble ref={bubbleRef} message={bubble} onClose={dismissBubble} />
      )}
      <CharacterDisplay
        ref={charRef}
        portraitUrl={characterInfo.portraitUrl}
        animation={characterInfo.animation}
        state={charState}
        nodKey={nodKey}
        onClick={openInput}
      />
      {inputVisible && (
        <InputArea ref={inputRef} onSubmit={handleSubmit} onClose={() => setInputVisible(false)} />
      )}
      {/* 統合マイクボタン(入力欄の下・中央・大きめ)。ON=リッスン中で点灯。 */}
      <button
        ref={micButtonRef}
        className={`mic-main${micActive ? ' mic-main--on' : ''}`}
        title={micTitle}
        aria-label="音声入力"
        {...micHandlers}
      >
        🎙️
      </button>
    </div>
  );
}
