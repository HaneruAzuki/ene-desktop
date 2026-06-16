/* eslint-disable max-lines -- 音声入力ステートマシンは use-voice-input.ts、設定群は use-ene-settings.ts へ分離済。
   残るは IPC 購読群(useEneEvents 候補)・起動ゲート・会話フロー。さらなる分解は実機 smoke 検証つきで段階的に行う(§8.5)。 */
import React, { useEffect, useRef, useState } from 'react';
import { CharacterDisplay } from './components/CharacterDisplay';
import { SpeechBubble } from './components/SpeechBubble';
import { InputArea, type InputAreaHandle } from './components/InputArea';
import { SettingsPanel } from './components/SettingsPanel';
import { ControlBar } from './components/ControlBar';
import { playClick } from './sound';
import {
  enqueueAudio,
  setPlaybackHandlers,
  setSentenceHandler,
  getVoiceAmplitude,
  isPlaying,
} from './audio-player';
import { playBackchannel, stopBackchannel } from './backchannel-player';
import { setEqBands } from './voice-eq';
import { useInteractionRouting } from './use-interaction-routing';
import { useEneSettings } from './use-ene-settings';
import { useVoiceInput } from './use-voice-input';
import {
  SOFA_AFTER_IDLE_MS,
  MOUTH_FLAP_MS,
  TALKING_MIN_MS,
  TALKING_MAX_MS,
  IDLE_TURN_BACK_MS,
  THINKING_WATCHDOG_MS,
} from './constants';
import { BACKCHANNEL_NOD_STRENGTH } from '../../shared/constants';
import type { CharacterInfo } from '../../shared/types/ipc';
import type { CharacterState } from '../../shared/types/animation';
import type { ConversationResponse } from '../../shared/types/conversation';
import type { VrmRenderConfig, VrmDisplayParams } from '../../shared/types/vrm';

// トップコンポーネント(設計書 §8 / task_13 / UI改修 2026-06)。
// キャラ表示・吹き出し・ホバーで現れる操作バー(マイク/音量/離席/設定/じゃあね)＋入力ピルを束ねる。
// マイクは単一ハイブリッド: 短タップ=ハンズフリーON/OFF、長押し=押している間 PTT。
//   ボタンは ON(リッスン中)/OFF だけ示す。状態テキストは出さない(聞き取り中はキャラは neutral)。

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
  const [barHovered, setBarHovered] = useState(false); // トリミ(ヒットボックス)/操作バー上にマウスがあるか(イベント駆動)
  const [forceOpen, setForceOpen] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [goodbyePop, setGoodbyePop] = useState(false); // 「じゃあね」ポップ表示中(段階4)
  const [away, setAway] = useState(false); // 離席中(段階5)
  const [nodKey, setNodKey] = useState(0); // うなずき(増えるたびに1回うなずく・task_18)
  const [nodStrength, setNodStrength] = useState(1); // うなずきの深さ(相槌=1.0 / ターン終端=発話長で出し分け)
  const [yawnKey, setYawnKey] = useState(0); // あくび(増えるたびに1回・長時間傾聴・listening-mode)
  const [isListening, setIsListening] = useState(false); // 傾聴モード中(少し首をかしげる・listening-mode)
  const [charState, setCharState] = useState<CharacterState>({
    activity: 'idle',
    emotion: 'neutral',
    pose: 'stand',
  });
  // VRM 表示(F・3D化)。config/model が揃えば VRM 描画。欠け/読込失敗時は代替表示を持たず一言メッセージのみ。
  const [vrmConfig, setVrmConfig] = useState<VrmRenderConfig | null>(null);
  const [vrmModel, setVrmModel] = useState<ArrayBuffer | null>(null);
  const [vrmDisplay, setVrmDisplay] = useState<VrmDisplayParams | null>(null);
  const [visible, setVisible] = useState(true); // ウィンドウ可視性(非表示で VRM 描画停止)
  const [showSettings, setShowSettings] = useState(false); // 統合設定パネル(段階6)
  const [idleBack, setIdleBack] = useState(false); // 会話が途切れて退屈→後ろ向き(話しかけで前へ・見た目だけ)
  // ユーザー設定(音量/ミュート・話しかけ頻度・自動起動・主人の呼び方)は専用フックへ集約(会話/マイクと疎結合)。
  const settings = useEneSettings();

  const vrmPanelRef = useRef<HTMLDivElement>(null); // 設定パネル(パネル外クリック判定で使用)
  // トリミ本体のクリックスルー判定(シルエット)。CharacterDisplay がレンダラの isOpaqueAt を差し込む。
  const charHitTestRef = useRef<((x: number, y: number) => boolean) | null>(null);
  const inputApiRef = useRef<InputAreaHandle>(null); // 入力欄の blur / 空判定(アイドル退避で使用)
  const warmedRef = useRef(false); // 入力フォーカス時のキャッシュウォームを一度だけ発火
  const vrmSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const talkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTurnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // 後ろ向きまでのアイドル計時
  const goodbyeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // 「じゃあね」ポップ→最小化の遅延
  // ストリーミング音声で「再生開始済み=聞かせた文」を貯める(Phase A: 再生同期の吹き出し)。
  // 先頭文(index=0)でリセットし、文が再生されるたび追記する。
  const spokenRef = useRef<string[]>([]);
  const readyRef = useRef(false); // 起動準備完了(多重通知の冪等化)
  const interactedRef = useRef(false); // 既にユーザーが会話を始めたか(準備完了後の挨拶差し替え判定)
  const preparingRef = useRef(true); // 準備中フラグ(コールバックから読む・preparing state と同期)

  // 音声入力ステートマシン(マイク/PTT/ハンズフリー/barge-in)は専用フックへ集約(会話/アイドル計時とは deps で疎結合)。
  // respond/noteActivity は関数宣言ゆえ巻き上げられ、ここで参照しても定義順の問題は無い。
  const voice = useVoiceInput({ noteActivity, respond, setBubble, setCharState, spokenRef, talkingTimerRef });

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

  // VRM 表示(F): 設定とモデルを取得(両方揃えば VRM 描画。欠け/失敗時は一言メッセージのみ=立ち絵フォールバック廃止)。
  useEffect(() => {
    void window.ene.getVrmConfig().then((cfg) => {
      setVrmConfig(cfg);
      if (cfg) setVrmDisplay(cfg.display);
    });
    void window.ene.getCharacterModel().then(setVrmModel);
  }, []);

  // 声色補正 EQ(voice.json 由来)を再生グラフへ適用する。再生グラフは初回再生時に遅延構築されるため、
  // ユーザー操作より前のマウント時に設定しておけば確実に間に合う(以後は変更しない)。
  useEffect(() => {
    void window.ene.getVoiceEq().then(setEqBands);
  }, []);

  // ユーザー発話(ハンズフリー音声・コアレッシング含む)でアイドル計時をリセットする
  //   (話しかけられた=前を向く)。コアレッシング音声経路では応答時に noteActivity を通らないため、
  //   ユーザー発話を拾うこのイベントが「前を向く」唯一のトリガーになる。
  useEffect(() => {
    window.ene.onUserSaid(() => noteActivity());
  }, []);

  // 会話が途切れて IDLE_TURN_BACK_MS 経つとトリミは後ろを向く(話しかけ/クリックで前へ・見た目だけ)。起動時から計時。
  useEffect(() => {
    noteActivity();
    return () => {
      if (idleTurnTimerRef.current) clearTimeout(idleTurnTimerRef.current);
    };
  }, []);

  // ウィンドウ可視性 → VRM 描画の停止/再開(§3.6・軽量原則 柱4)。
  // 2つの独立信号——main の hide/minimize/show/restore(意図的な表示操作)と renderer の
  // visibilitychange(最小化/隠蔽=Chromium の可視性)——を **last-write-wins で奪い合わせず**、
  // 両者の AND から visible を一意に導出する(C3・SSOT)。どちらかが「隠れている」と言えば描画を止める
  // =取りこぼし無し・競合無し・occlusion 停止も維持。クロージャを単一の recompute で畳む(真実点=導出結果ひとつ)。
  useEffect(() => {
    let windowVisible = true; // main 駆動(hide/minimize=false / show/restore=true)
    let docVisible = !document.hidden; // renderer 駆動(最小化/隠蔽で hidden=true)
    const recompute = (): void => setVisible(windowVisible && docVisible);
    window.ene.onWindowVisibility((v) => {
      windowVisible = v;
      recompute();
    });
    const onVis = (): void => {
      docVisible = !document.hidden;
      recompute();
    };
    document.addEventListener('visibilitychange', onVis);
    recompute(); // 初期状態を一度同期
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
      setCharState((s) =>
        s.activity === 'talking' ? s : { ...s, activity: 'talking', pose: 'stand' },
      );
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
        if (voice.isHandsFree()) window.ene.setVadSpeaking(true);
      },
      () => {
        if (voice.isHandsFree()) window.ene.setVadSpeaking(false);
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
    window.ene.onVoiceBargeIn(() => voice.handleBargeIn());
  }, []);

  // アンマウント時に走らせっぱなしのタイマーを止める(口パク終了の talkingTimer・VRM 保存デバウンスの
  // vrmSaveTimer)。アンマウント後の setState/IPC を防ぐ(リーク防止)。
  useEffect(() => {
    return () => {
      if (talkingTimerRef.current) clearTimeout(talkingTimerRef.current);
      if (vrmSaveTimerRef.current) clearTimeout(vrmSaveTimerRef.current);
      if (goodbyeTimerRef.current) clearTimeout(goodbyeTimerRef.current);
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

  // 考え中(thinking)の最終安全網(N-LAT-10)。第一声が出れば setSentenceHandler / applyResponseUI が
  //   activity を talking に変える=この effect は解除される。THINKING_WATCHDOG_MS を過ぎても考え中のまま=
  //   生成がハング/失敗して応答も解除合図も来なかった異常。考え中を idle へ戻し、トリミ口調で一言詫びる
  //   (永久フリーズ→強制終了を防ぐ・経路に依らない単一の不変条件)。
  useEffect(() => {
    if (charState.activity !== 'thinking') return;
    const id = setTimeout(() => {
      setCharState((s) =>
        s.activity === 'thinking' ? { ...s, activity: 'idle', emotion: 'neutral' } : s,
      );
      setBubble('…ごめん、ちょっと言葉に詰まっちゃった。もう一回言ってくれる?');
    }, THINKING_WATCHDOG_MS);
    return () => clearTimeout(id);
  }, [charState.activity]);

  // アイドル退避(2026-06): 一定時間 操作が無ければ、操作バー・入力・forceOpen をまとめて畳む。
  //   ただし入力欄にテキストがある時は畳まない(打ちかけを失わない)。空/未フォーカスなら blur して畳む。
  function handleIdle(): void {
    if (inputApiRef.current && !inputApiRef.current.isEmpty()) return; // 入力中(テキストあり)は保持
    inputApiRef.current?.blur(); // フォーカスを外す → onFocusChange(false) → inputFocused=false
    setForceOpen(false);
    setBarHovered(false);
  }

  // クリックスルー＋操作バーの出現判定(イベント駆動・2026-06 再設計)。
  //   カーソルがトリミ(シルエット)/各UI(data-interactive)の上か"だけ"で透過/非透過を決める。
  //   無操作が続いたら handleIdle で畳む(離脱イベントには依存しない)。
  useInteractionRouting(setBarHovered, charHitTestRef, handleIdle);

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
    setCharState((s) =>
      s.activity === 'talking' ? { ...s, activity: 'idle', emotion: 'neutral' } : s,
    );
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
    if (greeting) setBubble(greeting);
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
    // 中断(barge-in / 新ターンによる supersede)で破棄されたターンは null=UI へ反映しない(遅延応答無視)。
    if (response) applyResponseUI(response);
  }

  /**
   * 確定応答を UI(吹き出し/表情/口パク)へ反映する。
   * テキスト/非コアレッシング音声は respond() から(setBubbleToo=true=全文表示)、
   * コアレッシング音声は onVoiceResponse から(setBubbleToo=false=吹き出しは文の再生に同期させる)呼ぶ。
   */
  function applyResponseUI(response: ConversationResponse, setBubbleToo = true): void {
    interactedRef.current = true;
    const emotion = response.type === 'chat' ? (response.emotion ?? 'neutral') : 'neutral';
    if (talkingTimerRef.current) clearTimeout(talkingTimerRef.current);
    setCharState((s) => ({ ...s, activity: 'talking', emotion, pose: 'stand' }));
    // 吹き出しの全文表示は非ストリーミング(全文を一度に出す)用。spokenRef はここで触らない:
    // ストリーミングでは setSentenceHandler が再生に同期して積むので、ここで種を置くと再生中の残り文が
    // 後から push されて「1,2,3,2,3」と重複する。非ストリーミングの barge-in は heardText 空→A3 ガードが全文保持。
    if (setBubbleToo) setBubble(response.message);

    const talkMs = Math.min(
      TALKING_MAX_MS,
      Math.max(TALKING_MIN_MS, response.message.length * MOUTH_FLAP_MS),
    );
    talkingTimerRef.current = setTimeout(() => {
      setCharState((s) =>
        s.activity === 'talking' ? { ...s, activity: 'idle', emotion: 'neutral' } : s,
      );
    }, talkMs);
  }

  async function handleSubmit(text: string): Promise<void> {
    playClick();
    setForceOpen(false);
    // 喋っている最中の送信=割り込み(現在の発話を止め、進行中の生成を畳んでから新ターンへ・#8 統一 barge-in)。
    if (isPlaying()) voice.handleBargeIn();
    await respond(text);
  }

  /** VRM 表示パラメータの変更(即時反映＋デバウンスして data/config へ保存)。 */
  function handleVrmDisplayChange(d: VrmDisplayParams): void {
    setVrmDisplay(d);
    if (vrmSaveTimerRef.current) clearTimeout(vrmSaveTimerRef.current);
    vrmSaveTimerRef.current = setTimeout(() => void window.ene.setVrmDisplay(d), 400);
  }

  /** じゃあね(段階4): ポップを一瞬見せてからタスクバーへ最小化。マイクは念のため切る。 */
  function handleGoodbye(): void {
    if (voice.handsFreeOn) voice.stopHandsFree();
    setGoodbyePop(true);
    // 連打でタイマーが多重化しないよう、前回分を破棄してから張り直す(ref 保持でアンマウント時も解放できる)。
    if (goodbyeTimerRef.current) clearTimeout(goodbyeTimerRef.current);
    goodbyeTimerRef.current = setTimeout(() => {
      goodbyeTimerRef.current = null;
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
    // 離席に入る=マイクを確実に切る(ハンズフリー稼働中なら停止・PTT 録音中なら破棄)。
    if (next) voice.stopForAway();
  }

  if (!characterInfo) return null;

  // フルバーを出す条件=下部ゾーン内 or 明示展開 or 入力中(案A・段階5 修正)。離席は常にサインのみ。
  const showFull = forceOpen || inputFocused || barHovered;

  return (
    <div className="app">
      {/* トリミ本体＋彼女のUIを載せる「ステージ」(ウィンドウ幅 260px)。 */}
      <div className="stage">
        {/* 考える間(thinking)の演出。専用スプライトが無いので「…」で示す(F-ANIM-04)。 */}
        {charState.activity === 'thinking' && <div className="bubble bubble--thinking">…</div>}
        {/* 準備中(起動ウォーム中)=頭だけ覗く姿勢に添える「ちょっと待って...」(非操作・ready で消える)。 */}
        {preparing && <div className="bubble bubble--preparing">{PREPARING_MESSAGE}</div>}
        {bubble !== null && (
          // 吹き出し(閉じるボタンを持つ操作対象)。display:contents の枠で data-interactive を付け、
          // クリックスルー判定(closest)で「不透過」に倒す(レイアウトは枠なしと同じ)。
          <div data-interactive style={{ display: 'contents' }}>
            <SpeechBubble message={bubble} onClose={dismissBubble} />
          </div>
        )}
        <CharacterDisplay
          hitTestRef={charHitTestRef}
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
        {!preparing && (showFull || voice.micActive || away) && (
          <div className="control-overlay" data-interactive data-hitbox>
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
                  micActive={voice.micActive}
                  micHandlers={voice.micHandlers}
                  micTitle={voice.micTitle}
                  volume={settings.volume}
                  muted={settings.muted}
                  onToggleMute={settings.toggleMute}
                  onVolume={settings.setVolumeValue}
                  away={away}
                  onAway={handleAway}
                  onSettings={() => setShowSettings((v) => !v)}
                  onGoodbye={handleGoodbye}
                />
                <InputArea
                  ref={inputApiRef}
                  autoFocus={forceOpen}
                  onSubmit={handleSubmit}
                  onClose={() => setForceOpen(false)}
                  onActivate={warmCacheOnce}
                  onFocusChange={setInputFocused}
                />
              </>
            ) : voice.micActive ? (
              // マイクON だがホバー外: 最小の常駐サイン(クリックで切る)。
              <button
                className="mic-indicator"
                onClick={() => void voice.stopHandsFree()}
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
          // 設定パネル(操作対象)。display:contents の枠で data-interactive を付ける(ref はパネル外クリック判定用に維持)。
          <div data-interactive style={{ display: 'contents' }}>
            <SettingsPanel
              ref={vrmPanelRef}
              ownerName={settings.ownerName}
              ownerReading={settings.ownerReading}
              onOwnerNameSave={settings.saveOwnerName}
              idleTalk={settings.idleTalk}
              onIdleTalkChange={settings.setIdleTalkMode}
              autoLaunch={settings.autoLaunch}
              onAutoLaunchChange={settings.setAutoLaunchOn}
              vrmDisplay={vrmConfig && vrmDisplay ? vrmDisplay : undefined}
              onVrmChange={handleVrmDisplayChange}
              onApiKey={() => void window.ene.openApiKeyDialog()}
              onAbout={() => void window.ene.showAbout()}
              onOpenDataFolder={() => void window.ene.openDataFolder()}
              onConsole={() => void window.ene.openConsole()}
              onClose={() => setShowSettings(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
