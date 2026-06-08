import { getBackchannelCalibrationPath } from './paths';
import { readJson, writeJson } from './json-store';
import { log } from '../shared/logger';
import type { BackchannelCalibration } from '../shared/types/backchannel';

// 相槌の音響キャリブレーション学習値の永続化(task_18 Lv2b)。
// data/config/backchannel-calibration.json(平文JSON・§6.1)。継続利用で賢くするための学習値であり、
// 感情・好感度などの状態ではない(§5.3 非抵触)。値の検証は engine.loadCalibration 側で防御する。

/** 保存済みの学習値を読む。無ければ/壊れていれば null。 */
export async function loadBackchannelCalibration(): Promise<BackchannelCalibration | null> {
  try {
    return await readJson<BackchannelCalibration>(getBackchannelCalibrationPath());
  } catch (e) {
    log.warn(`backchannel calibration load failed: ${(e as Error).name}`);
    return null;
  }
}

/** 学習値を保存する(best-effort・失敗しても会話に影響させない)。 */
export async function saveBackchannelCalibration(c: BackchannelCalibration): Promise<void> {
  try {
    await writeJson(getBackchannelCalibrationPath(), c);
  } catch (e) {
    log.warn(`backchannel calibration save failed: ${(e as Error).name}`);
  }
}
