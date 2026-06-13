import React, { useEffect, useRef, useState } from 'react';
import { CharacterDisplay, type CharacterDisplayHandle } from './components/CharacterDisplay';
import { SpeechBubble } from './components/SpeechBubble';
import { InputArea } from './components/InputArea';
import { SettingsPanel } from './components/SettingsPanel';
import { ConversationLog, type LogEntry } from './components/ConversationLog';
import { ControlBar } from './components/ControlBar';
import { playClick } from './sound';
import {
  enqueueAudio,
  stopPlayback,
  setPlaybackHandlers,
  setSentenceHandler,
  getVoiceAmplitude,
  setOutputVolume as audioSetVolume,
  setMuted as audioSetMuted,
} from './audio-player';
import { playBackchannel, stopBackchannel } from './backchannel-player';
import { VoiceMic } from './voice-conversation';
import { startRecording, type Recorder } from './mic-capture';
import { useClickThrough } from './use-click-through';
import {
  SOFA_AFTER_IDLE_MS,
  MOUTH_FLAP_MS,
  TALKING_MIN_MS,
  TALKING_MAX_MS,
  LOG_PANEL_WIDTH,
  LOG_MAX_ENTRIES,
  IDLE_TURN_BACK_MS,
} from './constants';
import { STT_SAMPLE_RATE, BACKCHANNEL_NOD_STRENGTH } from '../../shared/constants';
import type { CharacterInfo } from '../../shared/types/ipc';
import type { CharacterState } from '../../shared/types/animation';
import type { ConversationResponse } from '../../shared/types/conversation';
import type { VrmRenderConfig, VrmDisplayParams } from '../../shared/types/vrm';
import type { IdleTalkMode } from '../../shared/types/settings';

// トップコンポーネント(設計書 §8 / task_13 / UI改修 2026-06)。
// キャラ表示・吹き出し・ホバーで現れる操作バー(マイク/音量/離席/設定/じゃあね)＋入力ピルを束ねる。
// マイクは単一ハイブリッド: 短タップ=ハンズフリーON/OFF、長押し=押している間 PTT。
//   ボタンは ON(リッスン中)/OFF だけ示す。状態テキストは出さない(聞き取り中はキャラは neutral)。

/** これ未満の長さ(秒)の push-to-talk 録音は誤タップ扱いで無視する。 */
const MIN_RECORDING_SEC = 0.3;

/** マイク単一ハイブリッドの判別: 押下がこの ms 未満=タップ(ハンズフリーのトグル)、以上=PTT(押している間録音)。 */
const TAP_MAX_MS = 250;

/** 「じゃあね」ポップの表示時間(ms)。これだけ見せてからトレイにしまう(UI改修 段階4)。 */
const GOODBYE_POP_MS = 600;

/** 起動準備(全サブシステムのウォーム)が整うまで出す「準備中」サイン。頭だけ覗く姿勢＋この吹き出しで示す。 */
const PREPARING_MESSAGE = 'ちょっと待って...';

export function App(): React.ReactElement | null {
  const [characterInfo, setCharacterInfo] = useState<CharacterInfo | null>(null);
  const [bubble, setBubble] = useState<string | null>(null);
  // 起動ウォーム中=入力を受け付けない「準備中」(頭だけ下から覗く＋「ちょっと待って...」吹き出し)。
  //   全サブシステムが立ったら(markReady)解除し、通常姿勢へ起き上がって挨拶する(2026-06-14)。
  const [preparing, setPreparing] = useState(true);
  // 操作オーバーレイ(UI改修 2026-06・docs/ui-design.md): キャラにホバー中 / 明示展開中(トレイ等)/
  //   入力欄フォーカス中 / マイク稼働中 のいずれかで表示。離脱で即消す(透明余白には置かない)。
  const [inZone, setInZone] = useState(false); // 操作ゾーン(下部の固定矩形)内にマウスがあるか(案A・段階5 修正)
  const [forceOpen, setForceOpen] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [volume, setVolume] = useState(1); // トリミの声(出力)の音量 0〜1(段階3)
  const [muted, setMuted] = useState(false);
  const [goodbyePop, setGoodbyePop] = useState(false); // 「じゃあね」ポップ表示中(段階4)
  const [away, setAway] = useState(false); // 離席中(段階5)
  const [handsFreeOn, setHandsFreeOn] = useState(false); // ハンズフリーで VAD 起動中
  const [recording, setRecording] = useState(false); // push-to-talk で録音中(押下中)
  const [nodKey, setNodKey] = useState(0); // うなずき(増えるたびに1回うなずく・task_18)
  const [nodStrength, setNodStrength] = useState(1); // うなずきの深さ(相槌=1.0 / ターン終端=発話長で出し分け)
  const [yawnKey, setYawnKey] = useState(0); // あくび(増えるたびに1回・長時間傾聴・listening-mode)
  const [isListening, setIsListening] = useState(false); // 傾聴モード中(少し首をかしげる・listening-mode)
  const [charState, setCharState] = useState<CharacterState>({
    activity: 'idle',
    emotion: 'neutral',
    pose: 'stand',
  });
  // VRM 表示(F・3D化)。config/model が揃えば VRM、欠ければ PNG フォールバック。
  const [vrmConfig, setVrmConfig] = useState<VrmRenderConfig | null>(null);
  const [vrmModel, setVrmModel] = useState<ArrayBuffer | null>(null);
  const [vrmDisplay, setVrmDisplay] = useState<VrmDisplayParams | null>(null);
  const [visible, setVisible] = useState(true); // ウィンドウ可視性(非表示で VRM 描画停止)
  const [showSettings, setShowSettings] = useState(false); // 統合設定パネル(段階6)
  const [idleTalk, setIdleTalk] = useState<IdleTalkMode>('low'); // 話しかけてくる頻度(段階6)
  const [autoLaunch, setAutoLaunch] = useState(false); // PC起動時に自動起動(段階6)
  const [logOpen, setLogOpen] = useState(false); // 会話ログ(ウィンドウ横拡張・VTuber風)
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]); // 直近のやりとり(セッション内のみ)
  const [idleBack, setIdleBack] = useState(false); // 会話が途切れて退屈→後ろ向き(話しかけで前へ・見た目だけ)

  const charRef = useRef<CharacterDisplayHandle>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const vrmPanelRef = useRef<HTMLDivElement>(null);
  const logToggleRef = useRef<HTMLButtonElement>(null);
  const logPanelRef = useRef<HTMLDivElement>(null);
  const warmedRef = useRef(false); // 入力フォーカス時のキャッシュウォームを一度だけ発火
  const vrmSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const talkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTurnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // 後ろ向きまでのアイドル計時
  const micRef = useRef<VoiceMic | null>(null); // ハンズフリーのマイク
  const recorderRef = useRef<Recorder | null>(null); // push-to-talk の録音
  const pressHeldRef = useRef(false); // マイク押下が長押し(PTT)に確定したか
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // タップ/長押し判別タイマー
  const voiceModeRef = useRef(false); // 非同期コールバックから handsFreeOn を読む
  // ストリーミング音声で「再生開始済み=聞かせた文」を貯める(Phase A: 再生同期の吹き出し)。
  // 先頭文(index=0)でリセットし、文が再生されるたび追記する。
  const spokenRef = useRef<string[]>([]);
  const readyRef = useRef(false); // 起動準備完了(多重通知の冪等化)
  const interactedRef = useRef(false); // 既にユーザーが会話を始めたか(準備完了後の挨拶差し替え判定)
  const preparingRef = useRef(true); // 準備中フラグ(コールバックから読む・preparing state と同期)

  // ON(リッスン中)かどうか: ハンズフリー起動中 or PTT 録音中。
  const micActive = handsFreeOn || recording;

  // 起動時に CharacterInfo を取得 ＋ 起動準備の状態を反映。
  // 準備が整うまでは挨拶を出さず「ちょっと待って、」を表示する(整い次第・挨拶へ差し替え)。
  useEffect(() => {
    void window.ene.getCharacterInfo().then(setCharacterInfo);
    void window.ene.isReady().then((r) => {
      if (r) markReady();
      // 未完了なら preparing(初期 true)のまま=頭だけ覗く＋「ちょっと待って...」で待つ。
    });
  }, []);

  // 準備完了の通知(push)。pull(isReady)との競合は readyRef で冪等化する。
  useEffect(() => {
    window.ene.onAppReady(() => markReady());
  }, []);

  // VRM 表示(F): 設定とモデルを取得(両方揃えば VRM、欠ければ PNG フォールバック)。
  useEffect(() => {
    void window.ene.getVrmConfig().then((cfg) => {
      setVrmConfig(cfg);
      if (cfg) setVrmDisplay(cfg.display);
    });
    void window.ene.getCharacterModel().then(setVrmModel);
  }, []);

  // 音量・ミュート設定を読み込み、audio-player へ適用(段階3)。
  useEffect(() => {
    void window.ene.getAudioPrefs().then(({ volume: v, muted: m }) => {
      setVolume(v);
      setMuted(m);
      audioSetVolume(v);
      audioSetMuted(m);
    });
  }, []);

  // 話しかけてくる頻度を読み込み(段階6・設定パネルの初期表示用)。
  useEffect(() => {
    void window.ene.getIdleTalk().then(setIdleTalk);
  }, []);

  // 自動起動の状態を読み込み(段階6・設定パネルの初期表示用)。
  useEffect(() => {
    void window.ene.getAutoLaunch().then(setAutoLaunch);
  }, []);

  // ユーザー発話(ハンズフリー音声・コアレッシング含む)を会話ログへ＋アイドル計時リセット(表示専用イベント)。
  useEffect(() => {
    window.ene.onUserSaid((text) => {
      pushLog('user', text);
      noteActivity();
    });
  }, []);

  // 会話が途切れて IDLE_TURN_BACK_MS 経つとトリミは後ろを向く(話しかけ/クリックで前へ・見た目だけ)。起動時から計時。
  useEffect(() => {
    noteActivity();
    return () => {
      if (idleTurnTimerRef.current) clearTimeout(idleTurnTimerRef.current);
    };
  }, []);

  // ウィンドウ可視性 → VRM 描画の停止/再開(§3.6・軽量原則 柱4)。
  useEffect(() => {
    window.ene.onWindowVisibility(setVisible);
    const onVis = (): void => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // トレイ / コンテキストメニューからのイベント(入力欄を開く)。
  useEffect(() => {
    window.ene.onOpenInputArea(() => openInput());
  }, []);

  // 音声応答チャンク(WAV＋任意で文テキスト/通し番号)を逐次再生(task_17 Phase A)。
  useEffect(() => {
    window.ene.onVoiceChunk((chunk) => void enqueueAudio(chunk.wav, chunk.text, chunk.index));
  }, []);

  // 文の再生開始に同期して吹き出しを1文ずつ伸ばす(Phase A・ストリーミング音声のみ)。
  // 先頭文(index=0)で貯めをリセット。barge-in 時はここまで貯まった分が「聞かせた発言」になる。
  useEffect(() => {
    setSentenceHandler((text, index) => {
      if (index === 0) spokenRef.current = [];
      spokenRef.current.push(text);
      setBubble(spokenRef.current.join(''));
      setCharState((s) => (s.activity === 'talking' ? s : { ...s, activity: 'talking', pose: 'stand' }));
    });
  }, []);

  // 相槌(聞くターン・task_18 Phase B): WAV があれば即時再生＋必ずうなずく(音声未準備でもうなずきは出す)。
  useEffect(() => {
    window.ene.onBackchannel((wav) => {
      if (wav) void playBackchannel(wav);
      setNodStrength(BACKCHANNEL_NOD_STRENGTH); // 相槌のうなずきは控えめ(ターン終端の浅い側と同程度)
      setNodKey((k) => k + 1);
    });
  }, []);

  // ターン終端うなずき(2026-06-12): 無音窓終端で1回うなずき、ターン受け取りを視覚で示す(音は鳴らさない)。
  //   深さ(strength)は発話の長さで出し分け(main 側で算出)=短い発話は軽く・長い発話は重め。
  useEffect(() => {
    window.ene.onTurnNod((strength) => {
      setNodStrength(strength);
      setNodKey((k) => k + 1);
    });
  }, []);

  // あくび(長時間傾聴の情緒ビート・listening-mode): main が ene:yawn を送ったら1回あくび。
  useEffect(() => {
    window.ene.onYawn(() => setYawnKey((k) => k + 1));
  }, []);

  // 傾聴モードの出入り(listening-mode): 入室で少し首をかしげ、退室で戻す。
  useEffect(() => {
    window.ene.onListening((on) => setIsListening(on));
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
    // 吹き出しは文の再生に同期して伸ばす(setSentenceHandler)ので、ここでは**全文をセットしない**(表情/口パクのみ)。
    window.ene.onVoiceResponse((response) => applyResponseUI(response, false));
    // 自発発話(P7): main がアイドル判定で生成した一言を吹き出し/表情へ反映する(音声なし v1=全文表示)。
    window.ene.onProactiveMessage((response) => applyResponseUI(response, true));
    window.ene.onVoiceBargeIn(() => handleBargeIn());
  }, []);

  // アンマウント時に走らせっぱなしのタイマーを止める(口パク終了の talkingTimer・VRM 保存デバウンスの
  // vrmSaveTimer)。アンマウント後の setState/IPC を防ぐ(リーク防止)。
  useEffect(() => {
    return () => {
      if (talkingTimerRef.current) clearTimeout(talkingTimerRef.current);
      if (vrmSaveTimerRef.current) clearTimeout(vrmSaveTimerRef.current);
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      if (audioSaveTimerRef.current) clearTimeout(audioSaveTimerRef.current);
    };
  }, []);

  /** 入力が始まった時、未ウォームなら Tier0 キャッシュを一度だけ温める(task_14 Phase 3・UI改修でフォーカス起点に変更)。 */
  function warmCacheOnce(): void {
    if (warmedRef.current) return;
    warmedRef.current = true;
    void window.ene.warmCache();
  }

  // ESC で入力欄・吹き出しを閉じる
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setForceOpen(false);
        setShowSettings(false);
        dismissBubble();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // 設定パネルはパネル外クリック(入力欄・キャラ含む)/ウィンドウブラーで閉じる(段階6・×だけに頼らない)。
  useEffect(() => {
    if (!showSettings) return;
    const onDown = (e: MouseEvent): void => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (vrmPanelRef.current?.contains(t)) return; // パネル内 → 保持
      if (t.closest('.control-row')) return; // 操作バーのボタン(⚙トグル含む)はそのボタン側に委ねる
      setShowSettings(false);
    };
    const onBlur = (): void => setShowSettings(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('blur', onBlur);
    };
  }, [showSettings]);

  // 長時間 idle で寝そべり(F-ANIM-03)。
  useEffect(() => {
    if (charState.activity !== 'idle' || charState.pose !== 'stand') return;
    const id = setTimeout(() => setCharState((s) => ({ ...s, pose: 'sofa' })), SOFA_AFTER_IDLE_MS);
    return () => clearTimeout(id);
  }, [charState.activity, charState.pose]);

  // 操作バーの表示/非表示は「バーの実矩形(=ボタンの両端)＋余白」で判定する(キャラ形状に依存しない＝固着しない・
  //   絶対pxでなくバー基準=ウィンドウ幅やバー幅が変わっても追従・案A/B 段階5 修正)。
  //   バーが出ている間: その矩形＋余白(上方向は音量ノブのポップを含む)で「畳むか」を決める。
  //   バー未表示時(通常のアイドル): 持ち上げ用トリガはウィンドウ相対(下部中央)。
  useEffect(() => {
    const MARGIN_X = 10; // 左右の許容(バー端＋少し)。これを超えて左右に外れると畳む。
    const MARGIN_TOP = 130; // 上方向(音量ノブのポップを含む)
    const MARGIN_BOTTOM = 12;
    const onMove = (e: MouseEvent): void => {
      const x = e.clientX;
      const y = e.clientY;
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (x < 0 || x >= w || y < 0 || y >= h) {
        setInZone(false);
        return;
      }
      const el = overlayRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        setInZone(
          x >= r.left - MARGIN_X &&
            x < r.right + MARGIN_X &&
            y >= r.top - MARGIN_TOP &&
            y < r.bottom + MARGIN_BOTTOM,
        );
      } else {
        // バー未表示=持ち上げ用トリガ(ウィンドウ相対の下部中央)。バー矩形より小さくしてフリップ防止。
        setInZone(y >= h * 0.68 && Math.abs(x - w / 2) <= w * 0.34);
      }
    };
    const onLeave = (): void => setInZone(false);
    window.addEventListener('mousemove', onMove);
    document.addEventListener('mouseleave', onLeave);
    window.addEventListener('blur', onLeave);
    return () => {
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('blur', onLeave);
    };
  }, []);

  // クリックスルー(§8.6): キャラ不透明や各 UI 要素の上なら不透過、それ以外は下の窓へ通す。
  // 当たり判定の配線(rAF 間引き含む)は専用フックへ分離(振る舞い不変)。
  useClickThrough({ charRef, bubbleRef, overlayRef, vrmPanelRef, logToggleRef, logPanelRef });

  // 【開発用】数字キー 1〜6 で表情を強制切替し、VRM の表情レンダリングを会話なしで単体確認する。
  // dev ビルドのみ有効(本番では無効・キーマップは neutral/joy/anger/sorrow/surprise/embarrassed)。
  useEffect(() => {
    const isDev = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
    if (!isDev) return;
    const map: Record<string, CharacterState['emotion']> = {
      '1': 'neutral',
      '2': 'joy',
      '3': 'anger',
      '4': 'sorrow',
      '5': 'surprise',
      '6': 'embarrassed',
    };
    const h = (e: KeyboardEvent): void => {
      const em = map[e.key];
      if (em) setCharState((s) => ({ ...s, emotion: em }));
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  /** 吹き出しを閉じ、talking 中なら idle に戻す。 */
  function dismissBubble(): void {
    setBubble(null);
    setCharState((s) => (s.activity === 'talking' ? { ...s, activity: 'idle', emotion: 'neutral' } : s));
  }

  /** 会話アクティビティを記録: トリミを前へ向け、IDLE_TURN_BACK_MS 後に後ろを向くタイマーを張り直す(見た目だけ)。 */
  function noteActivity(): void {
    setIdleBack(false);
    if (idleTurnTimerRef.current) clearTimeout(idleTurnTimerRef.current);
    idleTurnTimerRef.current = setTimeout(() => setIdleBack(true), IDLE_TURN_BACK_MS);
  }

  /** 入力欄を開く(操作=起き上がる・クリック音)。クリック=こちらに気づく→前を向く。 */
  function openInput(): void {
    if (preparingRef.current) return; // 準備中は入力を受け付けない(ユーザー操作は ready 後)
    playClick();
    noteActivity();
    setForceOpen(true); // 操作オーバーレイを明示展開し入力欄へフォーカス(トレイ/コンテキストメニュー起点)
    setCharState((s) => ({ ...s, pose: 'stand' }));
  }

  /** 起動挨拶を1回取得して吹き出しに出す(pull・取得後 main 側でクリア)。 */
  async function showGreeting(): Promise<void> {
    const greeting = await window.ene.getInitialGreeting();
    if (greeting) {
      setBubble(greeting);
      pushLog('torimi', greeting); // 起動挨拶も会話ログへ(他の発話経路と揃える=ログが空のまま残らない)
    }
  }

  /** 起動準備が整った時の処理(pull/push どちらから来ても冪等)。 */
  function markReady(): void {
    if (readyRef.current) return;
    readyRef.current = true;
    preparingRef.current = false;
    setPreparing(false); // 「ちょっと待って...」＋頭だけ覗く を解除し、通常姿勢へすっと起き上がる
    // まだ会話していなければ挨拶へ(準備中は入力を受け付けないので、通常ここは未会話)。
    if (!interactedRef.current) void showGreeting();
  }

  /**
   * ユーザー発話(テキスト or 音声認識)に応答する共通フロー。
   * 「ENE 発話中」フラグ(barge-in 用)は実際の音声再生に連動(setPlaybackHandlers 参照)。
   */
  async function respond(text: string): Promise<void> {
    interactedRef.current = true; // 会話開始 → 準備完了後に挨拶で上書きしない
    noteActivity(); // 話しかけられた=前を向く＋アイドル計時リセット
    setBubble(null);
    if (talkingTimerRef.current) clearTimeout(talkingTimerRef.current);
    setCharState((s) => ({ ...s, activity: 'thinking', pose: 'stand' }));
    const response = await window.ene.sendMessage(text);
    applyResponseUI(response);
  }

  /**
   * 確定応答を UI(吹き出し/表情/口パク)へ反映する。
   * テキスト/非コアレッシング音声は respond() から(setBubbleToo=true=全文表示)、
   * コアレッシング音声は onVoiceResponse から(setBubbleToo=false=吹き出しは文の再生に同期させる)呼ぶ。
   */
  function applyResponseUI(response: ConversationResponse, setBubbleToo = true): void {
    interactedRef.current = true;
    pushLog('torimi', response.message);
    const emotion = response.type === 'chat' ? (response.emotion ?? 'neutral') : 'neutral';
    if (talkingTimerRef.current) clearTimeout(talkingTimerRef.current);
    setCharState((s) => ({ ...s, activity: 'talking', emotion, pose: 'stand' }));
    if (setBubbleToo) setBubble(response.message);

    const talkMs = Math.min(
      TALKING_MAX_MS,
      Math.max(TALKING_MIN_MS, response.message.length * MOUTH_FLAP_MS),
    );
    talkingTimerRef.current = setTimeout(() => {
      setCharState((s) => (s.activity === 'talking' ? { ...s, activity: 'idle', emotion: 'neutral' } : s));
    }, talkMs);
  }

  async function handleSubmit(text: string): Promise<void> {
    playClick();
    setForceOpen(false);
    pushLog('user', text);
    await respond(text);
  }

  /** barge-in: ENE 発話中にユーザーが話しかけたら、ENE の声を即停止して聞く体勢へ。 */
  function handleBargeIn(): void {
    stopPlayback();
    stopBackchannel(); // 鳴り残った相槌もダッキング(割り込み時に黙らせる)
    // Phase B: 実際に聞かせた発言(再生開始済みの文を連結)を main へ報告し、記憶を切り詰めさせる。
    window.ene.notifyBargeInHeard(spokenRef.current.join(''));
    if (talkingTimerRef.current) clearTimeout(talkingTimerRef.current);
    setCharState((s) => (s.activity === 'talking' ? { ...s, activity: 'idle', emotion: 'neutral' } : s));
    window.ene.setVadSpeaking(false);
  }

  // --- ハンズフリー(VAD)の ON/OFF ---
  async function startHandsFree(): Promise<void> {
    noteActivity(); // マイクを点ける=こちらへ向き直る
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
    noteActivity(); // 話し始める=こちらへ向き直る
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
      if (result.ok) {
        pushLog('user', result.text);
        await respond(result.text);
      } else {
        setBubble(result.message);
        setCharState((s) => (s.activity === 'thinking' ? { ...s, activity: 'idle' } : s));
      }
    } catch {
      setBubble('…うまく聞き取れなかった。もう一回試してみて?');
      setCharState((s) => (s.activity === 'thinking' ? { ...s, activity: 'idle' } : s));
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

  /** VRM 表示パラメータの変更(即時反映＋デバウンスして data/config へ保存)。 */
  function handleVrmDisplayChange(d: VrmDisplayParams): void {
    setVrmDisplay(d);
    if (vrmSaveTimerRef.current) clearTimeout(vrmSaveTimerRef.current);
    vrmSaveTimerRef.current = setTimeout(() => void window.ene.setVrmDisplay(d), 400);
  }

  /** 話しかけてくる頻度の変更(段階6)。即時反映＋保存。 */
  function handleIdleTalkChange(mode: IdleTalkMode): void {
    setIdleTalk(mode);
    void window.ene.saveIdleTalk(mode);
  }

  /** 自動起動の切替(段階6)。即時反映＋保存(本番は OS のスタートアップにも反映)。 */
  function handleAutoLaunchChange(on: boolean): void {
    setAutoLaunch(on);
    void window.ene.setAutoLaunch(on);
  }

  /** 会話ログへ1件追記(直近 LOG_MAX_ENTRIES 件だけ保持・セッション内のみ)。 */
  function pushLog(role: 'user' | 'torimi', text: string): void {
    const t = text.trim();
    if (!t) return;
    setLogEntries((prev) => [...prev, { role, text: t }].slice(-LOG_MAX_ENTRIES));
  }

  /** 会話ログの開閉(ウィンドウ横拡張・VTuber風)。main にウィンドウ幅の伸縮を依頼。 */
  function toggleLog(): void {
    const next = !logOpen;
    setLogOpen(next);
    window.ene.setLogExpanded(next, LOG_PANEL_WIDTH);
  }

  /** 音量・ミュートの保存(デバウンス・段階3)。 */
  function persistAudio(v: number, m: boolean): void {
    if (audioSaveTimerRef.current) clearTimeout(audioSaveTimerRef.current);
    audioSaveTimerRef.current = setTimeout(() => void window.ene.saveAudioPrefs(v, m), 400);
  }
  /** ミュート切替(段階3)。即時に audio-player へ反映＋デバウンス保存。 */
  function handleToggleMute(): void {
    const m = !muted;
    setMuted(m);
    audioSetMuted(m);
    persistAudio(volume, m);
  }
  /** 音量変更(段階3・スライダー)。動かしたらミュート解除。即時反映＋デバウンス保存。 */
  function handleVolume(v: number): void {
    setVolume(v);
    audioSetVolume(v);
    if (muted) {
      setMuted(false);
      audioSetMuted(false);
    }
    persistAudio(v, false);
  }

  /** じゃあね(段階4): ポップを一瞬見せてからタスクバーへ最小化。マイクは念のため切る。 */
  function handleGoodbye(): void {
    if (handsFreeOn) stopHandsFree();
    setGoodbyePop(true);
    setTimeout(() => {
      void window.ene.goodbye();
      setGoodbyePop(false); // 再表示時に残らないようリセット
    }, GOODBYE_POP_MS);
  }

  /** 離席(段階5): トグル。離席に入る時はマイクを必ず切る。main へ通知して自発発話も止める。 */
  function handleAway(): void {
    const next = !away;
    setAway(next);
    window.ene.setAway(next);
    noteActivity(); // 手動トグル=操作=アイドル計時リセット(離席復帰時に自動後ろ向きを確実に解除)
    if (next) {
      // 離席に入る=マイクを確実に切る(ハンズフリー稼働中なら停止・PTT 録音中なら破棄)。
      if (voiceModeRef.current) stopHandsFree();
      if (recorderRef.current) {
        recorderRef.current.cancel();
        recorderRef.current = null;
        setRecording(false);
      }
    }
  }

  if (!characterInfo) return null;

  // マイクは単一ハイブリッド: 短タップ=ハンズフリーON/OFF、長押し=押している間 PTT。
  const micHandlers = { onMouseDown: micDown, onMouseUp: micUp, onMouseLeave: micLeave };
  const micTitle = handsFreeOn
    ? '聞いてるよ(クリックで切る)'
    : 'クリックで聞く / 押している間だけ話す';

  // フルバーを出す条件=下部ゾーン内 or 明示展開 or 入力中(案A・段階5 修正)。離席は常にサインのみ。
  const showFull = forceOpen || inputFocused || inZone;

  return (
    <div className={`app${logOpen ? ' app--log-open' : ''}`}>
      {/* トリミ本体＋彼女のUIは常に左260pxの「ステージ」に閉じ込める(会話ログ展開時も隠さない・VTuber風)。 */}
      <div className="stage">
      {/* 考える間(thinking)の演出。専用スプライトが無いので「…」で示す(F-ANIM-04)。 */}
      {charState.activity === 'thinking' && <div className="bubble bubble--thinking">…</div>}
      {/* 準備中(起動ウォーム中)=頭だけ覗く姿勢に添える「ちょっと待って...」(非操作・ready で消える)。 */}
      {preparing && <div className="bubble bubble--preparing">{PREPARING_MESSAGE}</div>}
      {bubble !== null && (
        <SpeechBubble ref={bubbleRef} message={bubble} onClose={dismissBubble} />
      )}
      <CharacterDisplay
        ref={charRef}
        portraitUrl={characterInfo.portraitUrl}
        animation={characterInfo.animation}
        state={charState}
        nodKey={nodKey}
        nodStrength={nodStrength}
        yawnKey={yawnKey}
        listening={isListening}
        onClick={openInput}
        vrmConfig={vrmConfig}
        vrmModel={vrmModel}
        vrmDisplay={vrmDisplay ?? undefined}
        amplitudeProvider={getVoiceAmplitude}
        visible={visible}
        away={away || idleBack}
        preparing={preparing}
      />
      {/* 操作オーバーレイ(UI改修 2026-06・docs/ui-design.md §1/§2/§3)。
          キャラ下部(胸元の不透明部)にホバーで重ねて出す。離脱で即アンマウント(透明余白には置かない
          =手を伸ばす途中で消えない)。入力中/明示展開中は離れても保持する。
          マイクON 中はホバーを外すと、操作バーの代わりに最小の常駐サイン(緑「聞いてるよ」)を残す。
          段階2: マイクは単一ハイブリッド配線。音量/離席/じゃあねは段階3/5/4 で実装。 */}
      {!preparing && (showFull || micActive || away) && (
        <div className="control-overlay" ref={overlayRef}>
          {away ? (
            // 離席中はホバーでも操作バーを出さず、戻る用の最小サインのみ(クリックで戻る)。
            <button
              className="away-indicator"
              onClick={handleAway}
              title="離席中(クリックで戻る)"
              aria-label="離席を解除"
            >
              <span className="mic-indicator__dot">☕</span>
              <span className="mic-indicator__label">離席中</span>
            </button>
          ) : showFull ? (
            <>
              <ControlBar
                micActive={micActive}
                micHandlers={micHandlers}
                micTitle={micTitle}
                volume={volume}
                muted={muted}
                onToggleMute={handleToggleMute}
                onVolume={handleVolume}
                away={away}
                onAway={handleAway}
                onSettings={() => setShowSettings((v) => !v)}
                onGoodbye={handleGoodbye}
              />
              <InputArea
                autoFocus={forceOpen}
                onSubmit={handleSubmit}
                onClose={() => setForceOpen(false)}
                onActivate={warmCacheOnce}
                onFocusChange={setInputFocused}
              />
            </>
          ) : micActive ? (
            // マイクON だがホバー外: 最小の常駐サイン(クリックで切る)。
            <button
              className="mic-indicator"
              onClick={() => void stopHandsFree()}
              title="聞いてるよ(クリックで切る)"
              aria-label="音声入力をオフ"
            >
              <span className="mic-indicator__dot">🎙️</span>
              <span className="mic-indicator__label">聞いてるよ</span>
            </button>
          ) : null}
        </div>
      )}
      {/* 「じゃあね」ポップ(段階4): トレイにしまう前に一瞬見せる演出。 */}
      {goodbyePop && <div className="goodbye-pop">＼じゃあね／</div>}
      {/* 統合設定パネル(段階6・⚙)。話しかけ頻度＋見た目(VRM)＋APIキー/クレジット。
          パネル外クリックで閉じる(上の useEffect)。ref はクリックスルー判定用(開いている間インタラクティブに保つ)。 */}
      {showSettings && (
        <SettingsPanel
          ref={vrmPanelRef}
          idleTalk={idleTalk}
          onIdleTalkChange={handleIdleTalkChange}
          autoLaunch={autoLaunch}
          onAutoLaunchChange={handleAutoLaunchChange}
          vrmDisplay={vrmConfig && vrmDisplay ? vrmDisplay : undefined}
          onVrmChange={handleVrmDisplayChange}
          onApiKey={() => void window.ene.openApiKeyDialog()}
          onAbout={() => void window.ene.showAbout()}
          onOpenDataFolder={() => void window.ene.openDataFolder()}
          onConsole={() => void window.ene.openConsole()}
          onClose={() => setShowSettings(false)}
        />
      )}
      {/* 会話ログのトグル(»/«)。ステージ右端の中央に常駐(透明・ホバーで濃く)。 */}
      <button
        className="log-toggle"
        ref={logToggleRef}
        onClick={toggleLog}
        title={logOpen ? '会話ログを閉じる' : '会話ログを開く'}
        aria-label="会話ログ"
      >
        {logOpen ? '«' : '»'}
      </button>
      </div>
      {/* 会話ログ(VTuber風・ウィンドウを右に広げた時のみ表示)。 */}
      {logOpen && <ConversationLog ref={logPanelRef} entries={logEntries} />}
    </div>
  );
}
