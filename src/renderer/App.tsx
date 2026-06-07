import React, { useEffect, useRef, useState } from 'react';
import { CharacterDisplay, type CharacterDisplayHandle } from './components/CharacterDisplay';
import { SpeechBubble } from './components/SpeechBubble';
import { InputArea } from './components/InputArea';
import { playClick } from './sound';
import { enqueueAudio, stopPlayback, setPlaybackHandlers } from './audio-player';
import { VoiceMic } from './voice-conversation';
import { startRecording, type Recorder } from './mic-capture';
import { SOFA_AFTER_IDLE_MS, MOUTH_FLAP_MS, TALKING_MIN_MS, TALKING_MAX_MS } from './constants';
import { STT_SAMPLE_RATE } from '../shared/constants';
import type { CharacterInfo } from '../shared/types/ipc';
import type { CharacterState } from '../shared/types/animation';
import type { VoiceInputMode } from '../shared/types/settings';

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

export function App(): React.ReactElement | null {
  const [characterInfo, setCharacterInfo] = useState<CharacterInfo | null>(null);
  const [inputVisible, setInputVisible] = useState(false);
  const [bubble, setBubble] = useState<string | null>(null);
  const [voiceInputMode, setVoiceInputMode] = useState<VoiceInputMode>('push-to-talk');
  const [handsFreeOn, setHandsFreeOn] = useState(false); // ハンズフリーで VAD 起動中
  const [recording, setRecording] = useState(false); // push-to-talk で録音中(押下中)
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

  // ON(リッスン中)かどうか: ハンズフリーは VAD 起動中、PTT は押下中。
  const micActive = voiceInputMode === 'hands-free' ? handsFreeOn : recording;

  // 起動時に CharacterInfo / マイク入力方式を取得
  useEffect(() => {
    void window.ene.getCharacterInfo().then(setCharacterInfo);
    void window.ene.getInitialGreeting().then((greeting) => {
      if (greeting) setBubble(greeting);
    });
    void window.ene.getVoiceInputMode().then(setVoiceInputMode);
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

  // 実際の再生開始/終了に「ENE 発話中」フラグを連動(task_17 Phase C・barge-in)。
  useEffect(() => {
    setPlaybackHandlers(
      () => {
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

  /**
   * ユーザー発話(テキスト or 音声認識)に応答する共通フロー。
   * 「ENE 発話中」フラグ(barge-in 用)は実際の音声再生に連動(setPlaybackHandlers 参照)。
   */
  async function respond(text: string): Promise<void> {
    setBubble(null);
    if (talkingTimerRef.current) clearTimeout(talkingTimerRef.current);
    setCharState((s) => ({ ...s, activity: 'thinking', pose: 'stand' }));
    const response = await window.ene.sendMessage(text);
    const emotion = response.type === 'chat' ? (response.emotion ?? 'neutral') : 'neutral';
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
