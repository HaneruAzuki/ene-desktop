import { describe, it, expect, vi } from 'vitest';

// loadBackchannelPool(I/O)だけをモックし、コントローラの「準備→発火→送信」配線を検証する。
// タイミング判定は backchannel-engine.test、語選択は backchannel-pool.test で個別に検証済み。
vi.mock('../../src/character/backchannel-loader', () => ({
  loadBackchannelPool: vi.fn(async () => ({
    version: 1,
    cues: { continuer: ['うん', 'うんうん'] },
  })),
}));
// 永続化(Lv2b)は実ファイルI/Oなのでモック(テストを hermetic に保つ)。
vi.mock('../../src/storage/backchannel-calibration', () => ({
  loadBackchannelCalibration: vi.fn(async () => null),
  saveBackchannelCalibration: vi.fn(async () => {}),
}));

import { BackchannelController } from '../../src/main/backchannel-controller';
import type { TtsEngine, VoiceConfig } from '../../src/shared/types/voice';

const VOICE: VoiceConfig = { engine: 'test', baseUrl: 'x', styles: { neutral: { styleId: 0 } } };

/** 合成テキストを「wav:<text>」のバイト列として返す擬似 TTS。 */
function fakeTts(): TtsEngine {
  return {
    speak: async (text: string): Promise<ArrayBuffer> => {
      const u8 = new TextEncoder().encode(`wav:${text}`);
      const ab = new ArrayBuffer(u8.byteLength);
      new Uint8Array(ab).set(u8);
      return ab;
    },
    listStyles: async () => [],
  };
}

function feed(c: BackchannelController, prob: number, n: number): void {
  for (let i = 0; i < n; i++) c.onFrame(prob);
}

function makeController(
  getTts: () => TtsEngine | null,
  sent: (ArrayBuffer | null)[],
): BackchannelController {
  return new BackchannelController({
    characterId: 'ene',
    getTts,
    getVoiceConfig: () => VOICE,
    send: (wav) => sent.push(wav),
    rng: () => 0, // continuer[0]='うん' を選ぶ
  });
}

describe('BackchannelController (task_18 Phase B)', () => {
  it('prepare 後、十分な発話＋言いよどみで合成済みWAVを送る', async () => {
    const sent: (ArrayBuffer | null)[] = [];
    const c = makeController(() => fakeTts(), sent);
    await c.prepare();
    feed(c, 0.9, 80); // 持続発話(> minSpeech 2000ms)
    feed(c, 0.0, 16); // 言いよどみ(> pauseTrigger 400ms) → 発火
    expect(sent.length).toBeGreaterThanOrEqual(1);
    const first = sent[0];
    expect(first && new TextDecoder().decode(new Uint8Array(first))).toBe('wav:うん');
  });

  it('TTS が無くてもタイミングは動く(WAV=null=うなずきのみ・音声は任意)', async () => {
    const sent: (ArrayBuffer | null)[] = [];
    const c = makeController(() => null, sent);
    await c.prepare();
    feed(c, 0.9, 80);
    feed(c, 0.0, 16);
    expect(sent.length).toBeGreaterThanOrEqual(1); // うなずきのために発火はする
    expect(sent[0]).toBeNull(); // ただし音声は無し
  });

  it('reset 後は発話を 0 から数え直す(不十分なら打たない)', async () => {
    const sent: (ArrayBuffer | null)[] = [];
    const c = makeController(() => fakeTts(), sent);
    await c.prepare();
    feed(c, 0.9, 20); // 不十分(640ms)
    c.reset();
    feed(c, 0.9, 20); // reset 後また不十分
    feed(c, 0.0, 12);
    expect(sent).toEqual([]);
  });
});
