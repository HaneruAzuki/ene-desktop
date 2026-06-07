import { describe, it, expect, vi } from 'vitest';
import { runVoiceChat, type ModelStream } from '../../src/conversation/voice-chat';
import type { TtsEngine, TtsOptions, VoiceConfig } from '../../src/shared/types/voice';

// task_17:音声会話のストリーミング統合(C1/C2・design-revision-voice §2,§3)。

const config: VoiceConfig = {
  engine: 'aivisspeech',
  baseUrl: 'http://127.0.0.1:10101',
  styles: {
    neutral: { styleId: 0 },
    joy: { styleId: 1, intonationScale: 1.2 },
  },
};

function streamOf(deltas: string[]): ModelStream {
  return (async function* () {
    for (const d of deltas) yield d;
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

describe('runVoiceChat', () => {
  it('emotion を確定し、文単位で合成・再生する', async () => {
    const { tts, calls } = recordingTts();
    const onAudio = vi.fn();
    const onEmotion = vi.fn();

    const result = await runVoiceChat(streamOf(['[[emotion:joy]]', 'やあ。', '元気？']), {
      tts,
      voiceConfig: config,
      neverCallsSelf: ['AI'],
      onAudio,
      onEmotion,
    });

    expect(result.emotion).toBe('joy');
    expect(result.spokenText).toBe('やあ。元気？');
    expect(result.blockedBySelfCheck).toBe(false);
    expect(calls.map((c) => c.text)).toEqual(['やあ。', '元気？']);
    // joy のスタイル(styleId 1)で合成される
    expect(calls[0].opts.styleId).toBe(1);
    expect(onAudio).toHaveBeenCalledTimes(2);
    expect(onEmotion).toHaveBeenCalledTimes(1);
    expect(onEmotion).toHaveBeenCalledWith('joy');
  });

  it('自称を検知した文は発話せず、その時点で打ち切る(C2)', async () => {
    const { tts, calls } = recordingTts();
    const onAudio = vi.fn();

    const result = await runVoiceChat(
      streamOf(['[[emotion:neutral]]', '私はAIです。', 'よろしく。']),
      { tts, voiceConfig: config, neverCallsSelf: ['AI'], onAudio },
    );

    expect(result.blockedBySelfCheck).toBe(true);
    expect(result.spokenText).toBe(''); // 1文目で打ち切り=何も発話していない
    expect(calls).toHaveLength(0);
    expect(onAudio).not.toHaveBeenCalled();
  });

  it('emotion sentinel が無ければ neutral で発話する', async () => {
    const { tts, calls } = recordingTts();
    const result = await runVoiceChat(streamOf(['こんにちは。']), {
      tts,
      voiceConfig: config,
      neverCallsSelf: [],
      onAudio: () => {},
    });
    expect(result.emotion).toBe('neutral');
    expect(calls[0].opts.styleId).toBe(0);
  });

  it('末尾 os_command は喋り終わり後に command として返る', async () => {
    const { tts } = recordingTts();
    const result = await runVoiceChat(
      streamOf(['[[emotion:neutral]]開くね。[[os_command:{"action":"open_notepad"}]]']),
      { tts, voiceConfig: config, neverCallsSelf: [], onAudio: () => {} },
    );
    expect(result.spokenText).toBe('開くね。');
    expect(result.command).toEqual({ action: 'open_notepad' });
  });
});
