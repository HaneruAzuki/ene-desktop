import { STT_SAMPLE_RATE, VAD_FRAME_SIZE } from '../../shared/constants';

// ハンズフリー音声会話のマイク入力(renderer・task_17 Phase C)。
//
// マイクを 16kHz で連続取得し、512サンプル/フレームを main(VAD)へ送るだけの薄い層。
// 発話の検出・区切り・文字起こしは main 側(vad-runtime)。再生は audio-player。
// 録音音声は外部送信せずローカル STT にのみ使う(§4.2/§7.1)。
//
// echoCancellation を有効化(barge-in 時に ENE 自身の声=TTS がマイクに回り込み
// VAD を誤発火させるのを抑える。実機での効きは要検証・ヘッドホンで確実回避)。

export class VoiceMic {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private mute: GainNode | null = null;
  private running = false;

  get isRunning(): boolean {
    return this.running;
  }

  /** マイク開始。失敗(権限拒否等)時は例外を投げる。 */
  async start(): Promise<void> {
    if (this.running) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        // AGC は音量を均して「声の勢い(強調)」を潰すため OFF(相槌の韻律型選択 Lv2 のため)。
        // echoCancellation/noiseSuppression は維持(barge-in エコー対策)。
        autoGainControl: false,
      },
    });
    this.ctx = new AudioContext({ sampleRate: STT_SAMPLE_RATE });
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.processor = this.ctx.createScriptProcessor(VAD_FRAME_SIZE, 1, 1);
    // onaudioprocess を発火させるにはグラフを destination まで繋ぐ必要があるが、
    // そのまま繋ぐとマイク音がスピーカーへ回り込む。gain=0 のノードで無音化する。
    this.mute = this.ctx.createGain();
    this.mute.gain.value = 0;
    this.processor.onaudioprocess = (e: AudioProcessingEvent): void => {
      // 512サンプル/フレームをコピーして main の VAD へ送る(内部バッファは使い回されるため)。
      window.ene.sendVadFrame(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    this.source.connect(this.processor);
    this.processor.connect(this.mute);
    this.mute.connect(this.ctx.destination);
    this.running = true;
  }

  stop(): void {
    this.running = false;
    if (this.processor) {
      this.processor.onaudioprocess = null;
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.mute) {
      this.mute.disconnect();
      this.mute = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
