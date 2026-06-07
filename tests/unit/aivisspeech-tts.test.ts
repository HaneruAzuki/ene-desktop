import { describe, it, expect } from 'vitest';
import {
  AivisSpeechTtsEngine,
  applyVoiceParams,
  parseSpeakers,
  type FetchLike,
} from '../../src/conversation/aivisspeech-tts';

// task_17:AivisSpeech(VOICEVOX互換)TTS クライアント(design-revision-voice §4.1)。

describe('applyVoiceParams', () => {
  it('定義された数値のみ反映し、pitchScale は触らない', () => {
    const q: Record<string, unknown> = { speedScale: 1.0, pitchScale: 0.0, intonationScale: 1.0 };
    applyVoiceParams(q, { styleId: 2, speedScale: 1.2, intonationScale: 1.3 });
    expect(q.speedScale).toBe(1.2);
    expect(q.intonationScale).toBe(1.3);
    expect(q.pitchScale).toBe(0.0); // 音質劣化のため不変
  });

  it('未指定パラメータは元の値を保つ', () => {
    const q: Record<string, unknown> = { speedScale: 1.0 };
    applyVoiceParams(q, { styleId: 0 });
    expect(q.speedScale).toBe(1.0);
  });
});

describe('parseSpeakers', () => {
  it('話者×スタイルを TtsStyle[] に展開する', () => {
    const data = [
      { name: 'つくよみちゃん', styles: [{ name: 'ノーマル', id: 0 }, { name: '喜び', id: 1 }] },
    ];
    expect(parseSpeakers(data)).toEqual([
      { name: 'つくよみちゃん/ノーマル', styleId: 0 },
      { name: 'つくよみちゃん/喜び', styleId: 1 },
    ]);
  });

  it('配列でない/不正な入力は空配列', () => {
    expect(parseSpeakers(null)).toEqual([]);
    expect(parseSpeakers({})).toEqual([]);
  });
});

describe('AivisSpeechTtsEngine.speak', () => {
  it('audio_query→パラメータ反映→synthesis の順で WAV を返す', async () => {
    const calls: { url: string; body?: string }[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.includes('/audio_query')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ speedScale: 1.0, pitchScale: 0.0, intonationScale: 1.0 }),
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        arrayBuffer: async () => new ArrayBuffer(8),
      };
    };

    const engine = new AivisSpeechTtsEngine('http://127.0.0.1:10101/', fetchFn);
    const buf = await engine.speak('こんにちは', { styleId: 2, speedScale: 1.2, intonationScale: 1.3 });

    expect(buf.byteLength).toBe(8);
    // audio_query は speaker と URL エンコード済みテキストを含む
    expect(calls[0].url).toBe(
      `http://127.0.0.1:10101/audio_query?speaker=2&text=${encodeURIComponent('こんにちは')}`,
    );
    // synthesis のボディに反映済み・pitchScale は不変
    const body = JSON.parse(calls[1].body ?? '{}') as Record<string, number>;
    expect(calls[1].url).toBe('http://127.0.0.1:10101/synthesis?speaker=2');
    expect(body.speedScale).toBe(1.2);
    expect(body.intonationScale).toBe(1.3);
    expect(body.pitchScale).toBe(0.0);
  });

  it('synthesis が失敗したら例外を投げる', async () => {
    const fetchFn: FetchLike = async (url) => ({
      ok: !url.includes('/synthesis'),
      status: url.includes('/synthesis') ? 500 : 200,
      json: async () => ({}),
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    const engine = new AivisSpeechTtsEngine('http://127.0.0.1:10101', fetchFn);
    await expect(engine.speak('x', { styleId: 0 })).rejects.toThrow('synthesis failed: 500');
  });
});

describe('AivisSpeechTtsEngine.listStyles', () => {
  it('/speakers を取得して TtsStyle[] を返す', async () => {
    const fetchFn: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => [{ name: 'A', styles: [{ name: 'ノーマル', id: 3 }] }],
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    const engine = new AivisSpeechTtsEngine('http://127.0.0.1:10101', fetchFn);
    expect(await engine.listStyles()).toEqual([{ name: 'A/ノーマル', styleId: 3 }]);
  });
});
