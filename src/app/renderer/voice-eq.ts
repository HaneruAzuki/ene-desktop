import type { EqBand } from '../../shared/types/voice';

// 声色補正 EQ の構築(renderer・Web Audio)。
//
// トリミの声を「落ち着いた低め」に整えるための音色補正。**声の高さ(F0)は一切動かさず**、
// スペクトル(明るさ/太さ)だけを BiquadFilterNode で整えるため、AivisSpeech の pitchScale を
// 強めたときのようなピッチシフト由来の劣化が出ない(§4.3 軽量=標準ノードのみ・新規依存なし)。
//
// バンド定義は voice.json(キャラ依存・§4.5)から IPC で受け取り、起動時に setEqBands で設定する。
// 応答音声(audio-player)と相槌(backchannel-player)の双方が buildEqChain を使い、声色を揃える。

let bands: EqBand[] = [];

/** 声色補正 EQ のバンドを設定する(voice.json 由来・App 起動時に1回)。再生グラフ構築前に呼ぶ。 */
export function setEqBands(next: EqBand[]): void {
  bands = Array.isArray(next) ? next : [];
}

/**
 * 現在の EQ バンドから BiquadFilterNode の直列チェーンを構築する。
 * バンドが無ければ null(=EQ なし)。返した input/output を、呼び出し側が source と destination の間に挟む。
 */
export function buildEqChain(ctx: AudioContext): { input: AudioNode; output: AudioNode } | null {
  if (bands.length === 0) return null;
  let first: BiquadFilterNode | null = null;
  let prev: BiquadFilterNode | null = null;
  for (const b of bands) {
    const node = ctx.createBiquadFilter();
    node.type = b.type; // 許可種別のみ(loader で検証済み)=BiquadFilterType の部分集合
    node.frequency.value = b.frequency;
    if (typeof b.gain === 'number') node.gain.value = b.gain;
    if (typeof b.q === 'number') node.Q.value = b.q;
    if (prev) prev.connect(node);
    first ??= node;
    prev = node;
  }
  // bands.length > 0 のため first/prev は必ず非 null。
  return { input: first as BiquadFilterNode, output: prev as BiquadFilterNode };
}
