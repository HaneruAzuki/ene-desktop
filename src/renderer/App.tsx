import React, { useEffect, useRef, useState } from 'react';
import { CharacterDisplay, type CharacterDisplayHandle } from './components/CharacterDisplay';
import { SpeechBubble } from './components/SpeechBubble';
import { InputArea } from './components/InputArea';
import { playClick } from './sound';
import { enqueueAudio, stopPlayback } from './audio-player';
import { VoiceMic } from './voice-conversation';
import { SOFA_AFTER_IDLE_MS, MOUTH_FLAP_MS, TALKING_MIN_MS, TALKING_MAX_MS } from './constants';
import type { CharacterInfo } from '../shared/types/ipc';
import type { CharacterState } from '../shared/types/animation';

// トップコンポーネント(設計書 §8 / task_13)。
// キャラ表示・吹き出し・入力欄を束ね、透明領域のクリックスルーを制御する。
// アニメ状態機械(activity/emotion/pose)を保持し、送信→考える間→口パク→idle を駆動する。
// task_17 Phase C: ハンズフリー音声会話(VAD)のトグルと、main からの音声イベントを束ねる。

function rectContains(el: HTMLElement | null, x: number, y: number): boolean {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
}

type VoiceStatus = 'listening' | 'recording' | 'transcribing';

export function App(): React.ReactElement | null {
  const [characterInfo, setCharacterInfo] = useState<CharacterInfo | null>(null);
  const [inputVisible, setInputVisible] = useState(false);
  const [bubble, setBubble] = useState<string | null>(null);
  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus | null>(null);
  const [charState, setCharState] = useState<CharacterState>({
    activity: 'idle',
    emotion: 'neutral',
    pose: 'stand',
  });

  const charRef = useRef<CharacterDisplayHandle>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const voiceToggleRef = useRef<HTMLButtonElement>(null);
  const lastIgnoreRef = useRef<boolean | null>(null);
  const talkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micRef = useRef<VoiceMic | null>(null);
  const voiceModeRef = useRef(false); // 非同期コールバックから最新の voiceMode を読むため

  // 起動時に CharacterInfo を取得
  useEffect(() => {
    void window.ene.getCharacterInfo().then(setCharacterInfo);
  }, []);

  // 起動挨拶を1回取得して吹き出しに表示(設計書 §8.7)
  useEffect(() => {
    void window.ene.getInitialGreeting().then((greeting) => {
      if (greeting) setBubble(greeting);
    });
  }, []);

  // トレイ / コンテキストメニューからのイベント
  useEffect(() => {
    window.ene.onOpenInputArea(() => openInput());
    window.ene.onResetPosition(() => {
      /* 位置リセットは main 側で実施。Renderer は特に何もしない。 */
    });
  }, []);

  // 音声応答チャンク(WAV)を受け取って逐次再生(task_17 Phase A・出力)
  useEffect(() => {
    window.ene.onVoiceChunk((chunk) => void enqueueAudio(chunk));
  }, []);

  // ハンズフリー音声会話(task_17 Phase C)。main からの状態/確定テキスト/割り込みを束ねる。
  useEffect(() => {
    window.ene.onVoiceState((state) => setVoiceStatus(state));
    window.ene.onVoiceTranscript((text) => void respond(text, true));
    window.ene.onVoiceBargeIn(() => handleBargeIn());
  }, []);

  // 入力欄を開いた瞬間に Tier0 キャッシュを温める(task_14 Phase 3・初回応答の体感を速く)。
  useEffect(() => {
    if (inputVisible) void window.ene.warmCache();
  }, [inputVisible]);

  // ESC で入力欄・吹き出しを閉じる(吹き出しが閉じたら idle へ)
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

  // 長時間 idle で寝そべり(F-ANIM-03)。activity/pose が変わるたびタイマー再設定。
  useEffect(() => {
    if (charState.activity !== 'idle' || charState.pose !== 'stand') return;
    const id = setTimeout(() => setCharState((s) => ({ ...s, pose: 'sofa' })), SOFA_AFTER_IDLE_MS);
    return () => clearTimeout(id);
  }, [charState.activity, charState.pose]);

  // クリックスルー(§8.6): キャラ不透明 OR 吹き出し OR 入力欄 OR 音声トグル のいずれかの上なら不透過。
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      const interactive =
        (charRef.current?.isOpaqueAt(e.clientX, e.clientY) ?? true) ||
        rectContains(bubbleRef.current, e.clientX, e.clientY) ||
        rectContains(inputRef.current, e.clientX, e.clientY) ||
        rectContains(voiceToggleRef.current, e.clientX, e.clientY);
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
   * viaVoice=true(ハンズフリー)のときは、ENE 発話中フラグを main へ伝え、
   * barge-in 検出のデバウンスを厳しめに切替える(エコー誤割り込みの抑制)。
   */
  async function respond(text: string, viaVoice: boolean): Promise<void> {
    setBubble(null);
    if (talkingTimerRef.current) clearTimeout(talkingTimerRef.current);
    setCharState((s) => ({ ...s, activity: 'thinking', pose: 'stand' }));
    const response = await window.ene.sendMessage(text);
    const emotion = response.type === 'chat' ? (response.emotion ?? 'neutral') : 'neutral';
    setCharState((s) => ({ ...s, activity: 'talking', emotion, pose: 'stand' }));
    setBubble(response.message);
    if (viaVoice && voiceModeRef.current) window.ene.setVadSpeaking(true);

    // 口パクはメッセージ長に比例した時間だけ。話し終えたら idle へ戻し口を閉じる。
    const talkMs = Math.min(
      TALKING_MAX_MS,
      Math.max(TALKING_MIN_MS, response.message.length * MOUTH_FLAP_MS),
    );
    talkingTimerRef.current = setTimeout(() => {
      setCharState((s) => (s.activity === 'talking' ? { ...s, activity: 'idle' } : s));
      if (viaVoice && voiceModeRef.current) window.ene.setVadSpeaking(false); // 聞き取りに戻る
    }, talkMs);
  }

  async function handleSubmit(text: string): Promise<void> {
    playClick();
    setInputVisible(false);
    await respond(text, false);
  }

  /** barge-in: ENE 発話中にユーザーが話しかけたら、ENE の声を即停止して聞く体勢へ。 */
  function handleBargeIn(): void {
    stopPlayback();
    if (talkingTimerRef.current) clearTimeout(talkingTimerRef.current);
    setCharState((s) => (s.activity === 'talking' ? { ...s, activity: 'idle' } : s));
    window.ene.setVadSpeaking(false);
  }

  /** ハンズフリー音声会話の ON/OFF。 */
  async function toggleVoiceMode(): Promise<void> {
    if (voiceMode) {
      micRef.current?.stop();
      window.ene.stopVad();
      window.ene.setVadSpeaking(false);
      voiceModeRef.current = false;
      setVoiceMode(false);
      setVoiceStatus(null);
      return;
    }
    const ok = await window.ene.startVad();
    if (!ok) {
      setBubble('…ごめん、耳がまだ準備できてないみたい。');
      return;
    }
    try {
      micRef.current ??= new VoiceMic();
      await micRef.current.start();
      voiceModeRef.current = true;
      setVoiceMode(true);
    } catch {
      window.ene.stopVad();
      setBubble('…マイクが使えないみたい。マイクの接続や設定を確認してみて?');
    }
  }

  if (!characterInfo) return null;

  const statusLabel =
    voiceStatus === 'recording' ? '…' : voiceStatus === 'transcribing' ? '考え中' : '聞いてるよ';

  return (
    <div className="app">
      <button
        ref={voiceToggleRef}
        className={`voice-toggle${voiceMode ? ' voice-toggle--on' : ''}`}
        onClick={() => void toggleVoiceMode()}
        title={
          voiceMode
            ? 'ハンズフリー音声会話: ON(クリックでOFF)'
            : 'ハンズフリー音声会話: OFF(クリックでON)'
        }
        aria-label="ハンズフリー音声会話の切替"
      >
        {voiceMode ? '🎧' : '🎙️'}
      </button>
      {voiceMode && <div className="voice-status">{statusLabel}</div>}

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
        <InputArea
          ref={inputRef}
          onSubmit={handleSubmit}
          onClose={() => setInputVisible(false)}
          onNotice={(m) => setBubble(m)}
        />
      )}
    </div>
  );
}
