import type { CharacterContext } from '../../shared/types/character';
import type { TtsEngine, VoiceConfig } from '../../shared/types/voice';
import type { VoiceInputMode } from '../../shared/types/settings';

// 起動時に構築され、main 各所(ipc ハンドラ・ターンエンジン・右クリックメニュー・起動/終了シーケンス)
// から共有参照される実行時状態。型を独立モジュールに置くことで ipc.ts への逆依存(循環)を避ける。

/** 起動時に構築され、ハンドラから参照される実行時状態。 */
export interface AppRuntime {
  charContext: CharacterContext | null;
  apiKey: string | null;
  /** 起動挨拶のフォールバック(定型文・即用意)。Renderer が getInitialGreeting で1回取得する。 */
  initialGreeting: string | null;
  /**
   * オフスクリーンライフ生成(P3・LLM)。getInitialGreeting が最大 GREETING_GENERATION_TIMEOUT_MS
   * 待って、間に合えば initialGreeting を差し替える。初回起動/未設定は null。
   */
  greetingPromise?: Promise<string | null> | null;
  /** 音声合成エンジン(task_17 Phase A・未起動/未設定なら null=テキストのみ)。 */
  tts: TtsEngine | null;
  /** 音声設定(emotion→スタイル/パラメータ・null なら音声無効)。 */
  voiceConfig: VoiceConfig | null;
  /** マイク入力方式(push-to-talk / hands-free・設定で切替・task_17 Phase C)。 */
  voiceInputMode: VoiceInputMode;
  /** 起動準備(音声エンジンのヘルス到達＋埋め込みウォーム)が整ったか。renderer の「ちょっと待って」解除に使う。 */
  ready: boolean;
  /** 思考フィラー(「うーん…」)を鳴らす(熟考時・B-15連動)。registerIpcHandlers が backchannel から配線。 */
  playThinkingFiller?: () => void;
  /** 直近にユーザーとやりとりした時刻(ms・自発発話の沈黙判定 P7)。commitTurn が更新する。 */
  lastActivityMs?: number;
  /** 開発用:自発発話をゲート無視で今すぐ鳴らす(dev の右クリックメニューから・実機smoke用)。 */
  triggerIdleTalk?: () => void;
  /** 離席中か(UI改修 段階5・☕ボタン)。true の間は自発発話を止める(誰もいない椅子に話しかけない)。 */
  away?: boolean;
}
