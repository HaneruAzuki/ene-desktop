import { describe, it, expect, vi } from 'vitest';
import {
  provisionVoice,
  buildVoiceConfig,
  reconcileVoiceConfig,
  type ProvisionEnv,
} from '../../src/conversation/voice-provisioner';
import type { TtsStyle } from '../../src/shared/types/voice';

// task_17:音声の自動プロビジョニング(design-revision-voice §4.3)。

/** 全ステップ成功のデフォルト環境(個別に上書きしてテスト)。 */
function makeEnv(overrides: Partial<ProvisionEnv> = {}): ProvisionEnv {
  return {
    enginePresent: async () => true,
    modelPresent: async () => true,
    downloadEngine: vi.fn(async () => {}),
    downloadModel: vi.fn(async () => {}),
    startEngine: vi.fn(async () => {}),
    waitHealthy: async () => true,
    fetchStyles: async () => [{ name: 'ノーマル', styleId: 0 }],
    writeVoiceConfig: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('provisionVoice', () => {
  it('既に揃っていれば DL を飛ばして成功する(冪等)', async () => {
    const env = makeEnv();
    const result = await provisionVoice(env);
    expect(result.ok).toBe(true);
    expect(env.downloadEngine).not.toHaveBeenCalled();
    expect(env.downloadModel).not.toHaveBeenCalled();
    expect(env.startEngine).toHaveBeenCalledOnce();
    expect(env.writeVoiceConfig).toHaveBeenCalledOnce();
  });

  it('エンジン/モデルが無ければ取得する', async () => {
    const env = makeEnv({ enginePresent: async () => false, modelPresent: async () => false });
    await provisionVoice(env);
    expect(env.downloadEngine).toHaveBeenCalledOnce();
    expect(env.downloadModel).toHaveBeenCalledOnce();
  });

  it('ヘルスチェック失敗は failedAt=health を返す', async () => {
    const env = makeEnv({ waitHealthy: async () => false });
    expect(await provisionVoice(env)).toEqual({ ok: false, failedAt: 'health' });
  });

  it('起動で例外が出たら failedAt=start を返す', async () => {
    const env = makeEnv({
      startEngine: async () => {
        throw new Error('spawn failed');
      },
    });
    expect(await provisionVoice(env)).toEqual({ ok: false, failedAt: 'start' });
  });

  it('進行通知が各ステップで呼ばれる', async () => {
    const env = makeEnv({ enginePresent: async () => false });
    const steps: string[] = [];
    await provisionVoice(env, (step, phase) => steps.push(`${step}:${phase}`));
    expect(steps).toContain('engine:start');
    expect(steps).toContain('engine:done');
    expect(steps).toContain('styles:done');
  });
});

describe('buildVoiceConfig', () => {
  it('スタイル名のヒントで emotion へ寄せ、neutral を埋める', () => {
    const styles: TtsStyle[] = [
      { name: 'つくよみ/ノーマル', styleId: 0 },
      { name: 'つくよみ/喜び', styleId: 1 },
      { name: 'つくよみ/怒り', styleId: 2 },
    ];
    const config = buildVoiceConfig(styles, 'http://127.0.0.1:10101', 'tsukuyomi');
    expect(config.styles.neutral).toEqual({ styleId: 0 });
    expect(config.styles.joy).toEqual({ styleId: 1 });
    expect(config.styles.anger).toEqual({ styleId: 2 });
    expect(config.engine).toBe('aivisspeech');
  });

  it('neutral 相当が無ければ先頭スタイルにフォールバックする', () => {
    const config = buildVoiceConfig([{ name: '未知', styleId: 5 }], 'http://x');
    expect(config.styles.neutral).toEqual({ styleId: 5 });
  });

  it('スタイルが空でも neutral=0 で成立する', () => {
    const config = buildVoiceConfig([], 'http://x');
    expect(config.styles.neutral).toEqual({ styleId: 0 });
  });
});

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
