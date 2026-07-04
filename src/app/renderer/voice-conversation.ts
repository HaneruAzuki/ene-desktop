import { VAD_FRAME_SIZE } from '../../shared/constants';
import { createMicGraph, type MicGraph } from './mic-graph';

// ハンズフリー音声会話のマイク入力(renderer・task_17 Phase C)。
//
// マイクを 16kHz で連続取得し、512サンプル/フレームを main(VAD)へ送るだけの薄い層。
// 取り込みグラフの構築/後始末は mic-graph に集約。発話の検出・区切り・文字起こしは main(vad-runtime)。
// 録音音声は外部送信せずローカル STT にのみ使う(§4.2/§7.1)。

export class VoiceMic {
  private graph: MicGraph | null = null;
  private running = false;

  get isRunning(): boolean {
    return this.running;
  }

  /** マイク開始。失敗(権限拒否等)時は例外を投げる。 */
  async start(): Promise<void> {
    if (this.running) return;
    this.graph = await createMicGraph({
      bufferSize: VAD_FRAME_SIZE,
      // AGC は音量を均して「声の勢い(強調)」を潰すため OFF(相槌の韻律型選択 Lv2 のため)。
      autoGainControl: false,
      // 512サンプル/フレームを main の VAD へ送る。
      onFrame: (frame) => window.ene.sendVadFrame(frame),
    });
    this.running = true;
  }

  stop(): void {
    this.running = false;
    this.graph?.teardown();
    this.graph = null;
  }
}
