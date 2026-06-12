import { getAppSettingsPath } from './paths';
import { readJson, writeJson } from './json-store';
import { DEFAULT_APP_SETTINGS, type AppSettings, type VoiceInputMode } from '../types/settings';
import type { VrmDisplayParams } from '../types/vrm';

// アプリ設定の読み書き(task_17 Phase C)。平文JSON(data/config/app-settings.json)。
// 既定値とマージして返すので、ファイルが無い/一部欠落でも安全に動く。

export async function loadAppSettings(): Promise<AppSettings> {
  const data = await readJson<Partial<AppSettings>>(getAppSettingsPath());
  return { ...DEFAULT_APP_SETTINGS, ...(data ?? {}) };
}

export async function saveVoiceInputMode(mode: VoiceInputMode): Promise<void> {
  const current = await loadAppSettings();
  await writeJson(getAppSettingsPath(), { ...current, voiceInputMode: mode });
}

/** VRM 表示パラメータのユーザー上書きを保存する(GUI スライダーの調整結果・F)。 */
export async function saveVrmDisplay(vrmDisplay: Partial<VrmDisplayParams>): Promise<void> {
  const current = await loadAppSettings();
  await writeJson(getAppSettingsPath(), { ...current, vrmDisplay });
}
