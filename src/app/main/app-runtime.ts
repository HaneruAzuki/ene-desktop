import type { CharacterContext } from '../../shared/types/character';
import type { TtsEngine, VoiceConfig } from '../../shared/types/voice';
import type { VoiceInputMode } from '../../shared/types/settings';

// 起動時に構築され、main 各所(ipc ハンドラ・ターンエンジン・右クリックメニュー・起動/終了シーケンス)
// から共有参照される実行時状態。型を独立モジュールに置くことで ipc.ts への逆依存(循環)を避ける。

/** 起動時に構築され、ハンドラから参照される実行時状態。 */
export interface AppRuntime {
  charContext: CharacterContext | null;
  apiKey: string | null;
  /** 起動挨拶(Renderer が getInitialGreeting で1回取得する)。 */
  initialGreeting: string | null;
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
}
