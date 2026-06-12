import { describe, it, expect } from 'vitest';
import { reconcileVoiceConfig } from '../../src/voice/voice-provisioner';
import type { TtsStyle } from '../../src/shared/types/voice';

// task_17:音声の自動プロビジョニング(design-revision-voice §4.3)。

describe('reconcileVoiceConfig', () => {
  const bundled = {
    engine: 'aivisspeech',
    baseUrl: 'http://127.0.0.1:10101',
    model: 'torimi',
    styles: { neutral: { styleId: 0, speedScale: 1.0, intonationScale: 1.0 } },
  };

  it('固定パラメータを保持しつつ styleId を実値へ差し替える(HANDOFF 注意1)', () => {
    const styles: TtsStyle[] = [{ name: '魚川トリミ/ノーマル', styleId: 3 }];
    const c = reconcileVoiceConfig(bundled, styles);
    // speedScale/intonationScale は同梱を保持・styleId だけ 3 へ
    expect(c.styles.neutral).toEqual({ styleId: 3, speedScale: 1.0, intonationScale: 1.0 });
  });

  it('一致するスタイルが無ければ先頭 styleId にフォールバック', () => {
    const c = reconcileVoiceConfig(bundled, [{ name: '別キャラ/うた', styleId: 7 }]);
    expect(c.styles.neutral?.styleId).toBe(7);
  });
});
