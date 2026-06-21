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
    exists: false,
    isOurJunction: false,
    modelUuid: UUID,
    sharedBertExists: false,
    ...over,
  };
}

describe('planEngineUserData', () => {
  it('標準版なし(dir 不在)→ borrow: 全体を一時借用する', () => {
    const plan = planEngineUserData(inputs({ exists: false }));
    expect(plan.mode).toBe('borrow');
    expect(plan.appdataJunction).toEqual({ link: APP, target: PORT });
    expect(plan.modelHardlink).toBeNull();
    expect(plan.bertJunction).toBeNull();
    expect(plan.staleJunctionToRemove).toBeNull();
  });

  it('前回の残骸(我々のジャンクション)→ borrow＋起動前に外す', () => {
    const plan = planEngineUserData(inputs({ exists: true, isOurJunction: true }));
    expect(plan.mode).toBe('borrow');
    expect(plan.staleJunctionToRemove).toBe(APP);
    expect(plan.appdataJunction).toEqual({ link: APP, target: PORT });
  });

  it('標準版あり(実dir が占有)＋BERT 不在 → coexist: torimi ハードリンク＋BERT サブdir junction', () => {
    const plan = planEngineUserData(inputs({ exists: true, isOurJunction: false, sharedBertExists: false }));
    expect(plan.mode).toBe('coexist');
    expect(plan.appdataJunction).toBeNull(); // 相手の dir を占有しない
    expect(plan.modelHardlink).toEqual({
      link: join(APP, 'Models', `${UUID}.aivmx`),
      source: join(PORT, 'Models', `${UUID}.aivmx`),
    });
    expect(plan.bertJunction).toEqual({ link: join(APP, 'BertModelCaches'), target: join(PORT, 'BertModelCaches') });
  });

  it('標準版あり＋BERT 既存 → 相手の BERT を再利用(bertJunction を作らない)', () => {
    const plan = planEngineUserData(inputs({ exists: true, isOurJunction: false, sharedBertExists: true }));
    expect(plan.mode).toBe('coexist');
    expect(plan.modelHardlink).not.toBeNull();
    expect(plan.bertJunction).toBeNull();
  });

  it('標準版あり＋UUID 不明 → skip(安全側=相手に何も持ち込まない)', () => {
    const plan = planEngineUserData(inputs({ exists: true, isOurJunction: false, modelUuid: null }));
    expect(plan.mode).toBe('skip');
    expect(plan.appdataJunction).toBeNull();
    expect(plan.modelHardlink).toBeNull();
    expect(plan.bertJunction).toBeNull();
  });

  it('共存判定: 実dir 占有でも、それが我々のジャンクションなら borrow(=自分の残骸は他者でない)', () => {
    const plan = planEngineUserData(inputs({ exists: true, isOurJunction: true, modelUuid: UUID }));
    expect(plan.mode).toBe('borrow');
  });
});
