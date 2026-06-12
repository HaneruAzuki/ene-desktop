// UI 効果音(task_13・F-ANIM-10)。外部音源を同梱せず Web Audio で合成する。
// 将来 CC0 等の "かわいい" サンプルへ差し替える場合のみ resources/sounds/ を新設(出典記録)。

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  // AudioContext は遅延生成(ユーザー操作後に作る=自動再生ポリシー回避)。1つを使い回す。
  if (ctx) return ctx;
  try {
    ctx = new AudioContext();
    return ctx;
  } catch {
    return null; // 非対応環境でも会話を妨げない
  }
}

/** 短いブリップ(クリック音)を鳴らす。入力欄オープン・送信時など。 */
export function playClick(): void {
  const audio = getContext();
  if (!audio) return;
  try {
    const now = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    // 軽い "ポッ" :高めの周波数を一瞬だけ。
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.05);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.01); // 立ち上がり
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12); // 減衰
    osc.connect(gain).connect(audio.destination);
    osc.start(now);
    osc.stop(now + 0.13);
  } catch {
    // 失敗しても無視(音は補助的)
  }
}
