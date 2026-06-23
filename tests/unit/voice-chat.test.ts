import { describe, it, expect, vi } from 'vitest';
import { speakChunks, type SpeakChunk } from '../../src/voice/voice-chat';
import type { TtsEngine, TtsOptions, VoiceConfig } from '../../src/shared/types/voice';

// 音声合成の唯一の消費器 speakChunks(C2 自称検知・ルビ読み下し・文単位合成・中断)の検証。
// 文ソースの生成(JSON ストリームパース/文分割)は json-stream-parser / sentence-splitter 側で別途テスト。

const config: VoiceConfig = {
  engine: 'aivisspeech',
  baseUrl: 'http://127.0.0.1:10101',
  styles: {
    neutral: { styleId: 0 },
    joy: { styleId: 1, intonationScale: 1.2 },
  },
};

/** SpeakChunk 配列を AsyncIterable<SpeakChunk> へ(ソースのスタブ)。 */
function sourceOf(chunks: SpeakChunk[]): AsyncIterable<SpeakChunk> {
  return (async function* () {
    for (const c of chunks) yield c;
  })();
}

/** speak した文と opts を記録する TTS モック。 */
function recordingTts(): { tts: TtsEngine; calls: { text: string; opts: TtsOptions }[] } {
  const calls: { text: string; opts: TtsOptions }[] = [];
  const tts: TtsEngine = {
    speak: async (text, opts) => {
      calls.push({ text, opts });
      return new ArrayBuffer(text.length);
    },
    listStyles: async () => [],
  };
  return { tts, calls };
}

describe('speakChunks', () => {
  it('emotion を確定し、文単位で合成・送出する', async () => {
    const { tts, calls } = recordingTts();
    const onAudio = vi.fn();
    const onEmotion = vi.fn();

    const r = await speakChunks(sourceOf([{ emotion: 'joy', sentences: ['やあ。', '元気？'] }]), {
      tts,
      voiceConfig: config,
      neverCallsSelf: ['AI'],
      onAudio,
      onEmotion,
    });

    expect(r.emotion).toBe('joy');
    expect(r.spokenText).toBe('やあ。元気？');
    expect(r.blockedBySelfCheck).toBe(false);
    expect(r.aborted).toBe(false);
    expect(calls.map((c) => c.text)).toEqual(['やあ。', '元気？']);
    expect(calls[0].opts.styleId).toBe(1); // joy のスタイル(styleId 1)
    expect(onAudio).toHaveBeenCalledTimes(2);
    expect(onEmotion).toHaveBeenCalledTimes(1);
    expect(onEmotion).toHaveBeenCalledWith('joy');
  });

  it('複数チャンクをまたいで発話し、最初の emotion だけを採用する(ストリーミング相当)', async () => {
    const { tts, calls } = recordingTts();
    const onEmotion = vi.fn();
    const r = await speakChunks(
      sourceOf([{ emotion: 'joy', sentences: ['やあ。'] }, { sentences: ['元気？'] }]),
      { tts, voiceConfig: config, neverCallsSelf: [], onAudio: () => {}, onEmotion },
    );
    expect(calls.map((c) => c.text)).toEqual(['やあ。', '元気？']);
    expect(r.emotion).toBe('joy');
    expect(onEmotion).toHaveBeenCalledTimes(1); // 2チャンク目に emotion 未指定でも再発火しない
  });

  it('自称を検知した文は発話せず、その時点で打ち切る(C2)', async () => {
    const { tts, calls } = recordingTts();
    const onAudio = vi.fn();

    const r = await speakChunks(sourceOf([{ emotion: 'neutral', sentences: ['私はAIです。', 'よろしく。'] }]), {
      tts,
      voiceConfig: config,
      neverCallsSelf: ['AI'],
      onAudio,
    });

    expect(r.blockedBySelfCheck).toBe(true);
    expect(r.spokenText).toBe(''); // 1文目で打ち切り=何も発話していない
    expect(calls).toHaveLength(0);
    expect(onAudio).not.toHaveBeenCalled();
  });

  it('emotion 指定が無ければ neutral で発話する', async () => {
    const { tts, calls } = recordingTts();
    const r = await speakChunks(sourceOf([{ sentences: ['こんにちは。'] }]), {
      tts,
      voiceConfig: config,
      neverCallsSelf: [],
      onAudio: () => {},
    });
    expect(r.emotion).toBe('neutral');
    expect(calls[0].opts.styleId).toBe(0);
  });

  it('ルビ(漢字《よみ》)を音声は読み下し・記録は除去する', async () => {
    const { tts, calls } = recordingTts();
    const r = await speakChunks(sourceOf([{ sentences: ['心《こころ》を読んだ。'] }]), {
      tts,
      voiceConfig: config,
      neverCallsSelf: [],
      onAudio: () => {},
    });
    expect(calls.map((c) => c.text)).toEqual(['こころを読んだ。']); // TTS は読み下し
    expect(r.spokenText).toBe('心を読んだ。'); // 記録はルビ除去
  });

  it('中断(signal.aborted)なら合成せず aborted=true で返す', async () => {
    const { tts, calls } = recordingTts();
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await speakChunks(sourceOf([{ sentences: ['出ないはず。'] }]), {
      tts,
      voiceConfig: config,
      neverCallsSelf: [],
      onAudio: () => {},
      signal: ctrl.signal,
    });
    expect(r.aborted).toBe(true);
    expect(calls).toHaveLength(0);
  });
});
