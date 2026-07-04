import { useEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { stopPlayback } from './audio-player';
import { stopBackchannel } from './backchannel-player';
import { VoiceMic } from './voice-conversation';
import { startRecording, type Recorder } from './mic-capture';
import { STT_SAMPLE_RATE } from '../../shared/constants';
import type { CharacterViewState } from '../../shared/types/animation';

// 音声入力ステートマシン(マイク単一ハイブリッド・PTT・ハンズフリー・barge-in)を App から切り出したフック。
// マイクは単一ハイブリッド: 短タップ=ハンズフリーON/OFF、長押し=押している間 PTT。
//
// 結合の整理(なぜ安全に抜けるか): ここの関数群は (a)安定参照(ref/setState セッタ/モジュール関数)か
//   (b)JSX のイベントハンドラから最新クロージャで呼ばれる、のいずれか。唯一 useEffect([]) で捕捉される
//   handleBargeIn も安定参照(ref/セッタ/モジュール関数)しか使わないため、初回クロージャ固定でも正しく動く。
//   App 側の関心(会話 respond・アイドル計時 noteActivity・吹き出し/表情)へは deps 経由で触る(疎結合)。

/** これ未満の長さ(秒)の push-to-talk 録音は誤タップ扱いで無視する。 */
const MIN_RECORDING_SEC = 0.3;

/** マイク単一ハイブリッドの判別: 押下がこの ms 未満=タップ(ハンズフリーのトグル)、以上=PTT(押している間録音)。 */
const TAP_MAX_MS = 250;

/** App から渡す依存(会話/アイドル計時/吹き出し/表情の状態は App が保持し、ここはそれを操作するだけ)。 */
export interface VoiceInputDeps {
  /** 話しかけられた=前を向く＋アイドル計時リセット。 */
  noteActivity: () => void;
  /** ユーザー発話(音声認識テキスト)に応答する共通フロー。 */
  respond: (text: string) => Promise<void>;
  /** 吹き出し文の差し替え(null で消す)。 */
  setBubble: (text: string | null) => void;
  /** キャラ状態(activity/emotion/pose)の更新。 */
  setCharState: Dispatch<SetStateAction<CharacterViewState>>;
  /** ストリーミングで「聞かせた文」を貯める ref(barge-in 時に main へ報告)。App の再生同期と共有。 */
  spokenRef: MutableRefObject<string[]>;
  /** 口パク終了タイマー ref(barge-in で talking→idle に戻すため触る)。App の応答フローと共有。 */
  talkingTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
}

export interface VoiceInput {
  handsFreeOn: boolean;
  /** ON(リッスン中)=ハンズフリー起動中 or PTT 録音中。 */
  micActive: boolean;
  micHandlers: { onMouseDown: () => void; onMouseUp: () => void; onMouseLeave: () => void };
  micTitle: string;
  /** ハンズフリーを切る(JSX のサイン/離席/じあね から)。 */
  stopHandsFree: () => void;
  /** barge-in: ENE 発話中にユーザーが話しかけたら声を即停止して聞く体勢へ。 */
  handleBargeIn: () => void;
  /** 離席に入るときに音声入力を確実に止める(ハンズフリーOFF＋PTT録音破棄)。 */
  stopForAway: () => void;
  /** ハンズフリーが現在 ON か(非同期/imperative コールバックから stale closure 無しに読む)。 */
  isHandsFree: () => boolean;
}

export function useVoiceInput(deps: VoiceInputDeps): VoiceInput {
  const [handsFreeOn, setHandsFreeOn] = useState(false); // ハンズフリーで VAD 起動中
  const [recording, setRecording] = useState(false); // push-to-talk で録音中(押下中)
  const micRef = useRef<VoiceMic | null>(null); // ハンズフリーのマイク
  const recorderRef = useRef<Recorder | null>(null); // push-to-talk の録音
  const pressHeldRef = useRef(false); // マイク押下が長押し(PTT)に確定したか
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // タップ/長押し判別タイマー
  const voiceModeRef = useRef(false); // 非同期コールバックから handsFreeOn を読む

  // アンマウント時に走らせっぱなしの判別タイマーを止める(リーク防止)。
  useEffect(() => {
    return () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    };
  }, []);

  /** barge-in: ENE 発話中にユーザーが話しかけたら、ENE の声を即停止して聞く体勢へ。 */
  function handleBargeIn(): void {
    stopPlayback();
    stopBackchannel(); // 鳴り残った相槌もダッキング(割り込み時に黙らせる)
    // Phase B: 実際に聞かせた発言(再生開始済みの文を連結)を main へ報告し、記憶を切り詰めさせる。
    window.ene.notifyBargeInHeard(deps.spokenRef.current.join(''));
    if (deps.talkingTimerRef.current) clearTimeout(deps.talkingTimerRef.current);
    deps.setCharState((s) =>
      s.activity === 'talking' ? { ...s, activity: 'idle', emotion: 'neutral' } : s,
    );
    window.ene.setVadSpeaking(false);
  }

  // --- ハンズフリー(VAD)の ON/OFF ---
  async function startHandsFree(): Promise<void> {
    deps.noteActivity(); // マイクを点ける=こちらへ向き直る
    const ok = await window.ene.startVad();
    if (!ok) {
      deps.setBubble('…ごめん、耳がまだ準備できてないみたい。');
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
      deps.setBubble('…マイクが使えないみたい。マイクの接続や設定を確認してみて?');
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
    deps.noteActivity(); // 話し始める=こちらへ向き直る
    // 録音開始の時点で Tier0 キャッシュを温める(録音→認識の間に書き込まれる・レイテンシ施策)。
    void window.ene.warmCache();
    try {
      recorderRef.current = await startRecording();
      setRecording(true);
    } catch {
      recorderRef.current = null;
      deps.setBubble('…マイクが使えないみたい。マイクの接続や設定を確認してみて?');
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
      deps.setCharState((s) => ({ ...s, activity: 'thinking', pose: 'stand' })); // 認識中は「…」
      const result = await window.ene.transcribeAudio(samples);
      if (result.ok) {
        await deps.respond(result.text);
      } else {
        deps.setBubble(result.message);
        deps.setCharState((s) => (s.activity === 'thinking' ? { ...s, activity: 'idle' } : s));
      }
    } catch {
      deps.setBubble('…うまく聞き取れなかった。もう一回試してみて?');
      deps.setCharState((s) => (s.activity === 'thinking' ? { ...s, activity: 'idle' } : s));
    }
  }

  // --- マイク単一ハイブリッド(短タップ=ハンズフリーON/OFF・長押し=押している間 PTT) ---
  // 押下時点ではタップか長押しか不明。TAP_MAX_MS 押し続けたら長押し=PTT を開始、
  // それ未満で離せばタップ=ハンズフリーをトグルする。ハンズフリーON中はタップで OFF。
  function micDown(): void {
    pressHeldRef.current = false;
    if (handsFreeOn) return; // ON 中は離した時に OFF にするだけ(長押しでも PTT に入らない)
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = setTimeout(() => {
      pressHeldRef.current = true;
      void startPtt();
    }, TAP_MAX_MS);
  }
  function micUp(): void {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (handsFreeOn) {
      stopHandsFree(); // ON 中のクリック=OFF
      return;
    }
    if (pressHeldRef.current) {
      pressHeldRef.current = false;
      void stopPtt(); // 長押し=PTT を確定(録音停止→認識)
    } else {
      void startHandsFree(); // タップ=ハンズフリー ON
    }
  }
  function micLeave(): void {
    // 押しながら外れた時: PTT 中なら確定、判別前ならキャンセル(誤操作回避)。
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (pressHeldRef.current) {
      pressHeldRef.current = false;
      void stopPtt();
    }
  }

  /** 離席に入るとき: ハンズフリー稼働中なら停止・PTT 録音中なら破棄(音声入力を確実に切る)。 */
  function stopForAway(): void {
    if (voiceModeRef.current) stopHandsFree();
    if (recorderRef.current) {
      recorderRef.current.cancel();
      recorderRef.current = null;
      setRecording(false);
    }
  }

  // ON(リッスン中)かどうか: ハンズフリー起動中 or PTT 録音中。
  const micActive = handsFreeOn || recording;
  const micHandlers = { onMouseDown: micDown, onMouseUp: micUp, onMouseLeave: micLeave };
  const micTitle = handsFreeOn
    ? '聞いてるよ(クリックで切る)'
    : 'クリックで聞く / 押している間だけ話す';

  return {
    handsFreeOn,
    micActive,
    micHandlers,
    micTitle,
    stopHandsFree,
    handleBargeIn,
    stopForAway,
    isHandsFree: () => voiceModeRef.current,
  };
}
