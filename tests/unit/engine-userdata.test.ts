import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import os from 'node:os';

// engine-userdata は paths.ts 経由で electron / json-store を読むため、import 解決用にモックする
// (テスト対象 planEngineUserData は純粋関数=これらは呼ばないが、モジュール読込時に必要)。
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: (): string => os.tmpdir(), getAppPath: (): string => process.cwd() },
}));
vi.mock('../../src/shared/node/json-store', () => ({ readJson: vi.fn() }));

import { planEngineUserData, type EngineUserDataInputs } from '../../src/shared/node/engine-userdata';

const APP = join('C:', 'appdata', 'AivisSpeech-Engine');
const PORT = join('C:', 'portable', 'userdata');
const UUID = 'c0d0e43a-2efb-4117-b35f-2fa4a39e2953';

function inputs(over: Partial<EngineUserDataInputs>): EngineUserDataInputs {
  return {
    appdataDir: APP,
    portableDir: PORT,
    dirExists: false,
    weOwn: false,
    sharedBertExists: false,
    modelUuid: UUID,
    ...over,
  };
}

const modelSrc = join(PORT, 'Models', `${UUID}.aivmx`);
const modelDest = join(APP, 'Models', `${UUID}.aivmx`);
const bertSrc = join(PORT, 'BertModelCaches');
const bertDest = join(APP, 'BertModelCaches');

describe('planEngineUserData (N-REL-2: %APPDATA% 直接配置)', () => {
  it('dir 無し → create-owned(専有作成・マーカー・torimi＋BERT)', () => {
    const p = planEngineUserData(inputs({ dirExists: false }));
    expect(p.mode).toBe('create-owned');
    expect(p.writeOwnsMarker).toBe(true);
    expect(p.writeCleanupList).toBe(false);
    expect(p.model).toEqual({ src: modelSrc, dest: modelDest });
    expect(p.bert).toEqual({ src: bertSrc, dest: bertDest });
  });

  it('我々のマーカー有り → ensure-owned(不足分のみ補充・マーカーは書かない)', () => {
    const p = planEngineUserData(inputs({ dirExists: true, weOwn: true }));
    expect(p.mode).toBe('ensure-owned');
    expect(p.writeOwnsMarker).toBe(false);
    expect(p.writeCleanupList).toBe(false);
    expect(p.model).not.toBeNull();
    expect(p.bert).not.toBeNull();
  });

  it('標準版同居(マーカー無し)＋BERT 無し → coexist(torimi＋BERT を足す・cleanup 記録)', () => {
    const p = planEngineUserData(inputs({ dirExists: true, weOwn: false, sharedBertExists: false }));
    expect(p.mode).toBe('coexist');
    expect(p.writeOwnsMarker).toBe(false); // 相手の dir を専有しない
    expect(p.writeCleanupList).toBe(true);
    expect(p.model).toEqual({ src: modelSrc, dest: modelDest });
    expect(p.bert).toEqual({ src: bertSrc, dest: bertDest });
  });

  it('標準版同居＋BERT 既存 → coexist(torimi のみ・BERT は相手のを再利用=null)', () => {
    const p = planEngineUserData(inputs({ dirExists: true, weOwn: false, sharedBertExists: true }));
    expect(p.mode).toBe('coexist');
    expect(p.model).not.toBeNull();
    expect(p.bert).toBeNull();
  });

  it('UUID 不明 → skip(安全側=何もしない)', () => {
    const p = planEngineUserData(inputs({ modelUuid: null }));
    expect(p.mode).toBe('skip');
    expect(p.model).toBeNull();
    expect(p.bert).toBeNull();
    expect(p.writeOwnsMarker).toBe(false);
    expect(p.writeCleanupList).toBe(false);
  });
});
