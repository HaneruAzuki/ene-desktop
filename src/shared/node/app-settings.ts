import { getAppSettingsPath } from './paths';
import { readJson, writeJson } from './json-store';
import { DEFAULT_APP_SETTINGS, type AppSettings, type IdleTalkMode } from '../types/settings';
import type { VrmDisplayParams } from '../types/vrm';

// アプリ設定の読み書き(task_17 Phase C)。平文JSON(data/config/app-settings.json)。
// 既定値とマージして返すので、ファイルが無い/一部欠落でも安全に動く。

export async function loadAppSettings(): Promise<AppSettings> {
  const data = await readJson<Partial<AppSettings>>(getAppSettingsPath());
  return { ...DEFAULT_APP_SETTINGS, ...(data ?? {}) };
}

// 設定書き込みの直列化(E2②・read-modify-write の競合防止)。各 save は「読み→patch適用→書き戻し」だが、
// 設定パネルで複数項目を素早くトグルすると read 同士が交差して**後勝ちで他項目の変更を取りこぼす**。
// 直前の書き込みの完了を待ってから次を実行する promise チェーンで直列化する(短期記憶の withWriteLock と同方針)。
let writeChain: Promise<void> = Promise.resolve();
async function updateSettings(patch: Partial<AppSettings>): Promise<void> {
  const run = writeChain.then(async () => {
    const current = await loadAppSettings();
    await writeJson(getAppSettingsPath(), { ...current, ...patch });
  });
  // 直前の成功/失敗に関わらず次へ進めるよう、チェーンは結果を握り潰して保持する(失敗で全保存が止まらない)。
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run; // 呼び出し側へは従来どおり完了/失敗を伝える。
}

/** VRM 表示パラメータのユーザー上書きを保存する(GUI スライダーの調整結果・F)。 */
export async function saveVrmDisplay(vrmDisplay: Partial<VrmDisplayParams>): Promise<void> {
  return updateSettings({ vrmDisplay });
}

/** トリミの声(出力)の音量・ミュートを保存する(UI改修 段階3)。 */
export async function saveAudioPrefs(outputVolume: number, muted: boolean): Promise<void> {
  return updateSettings({ outputVolume, muted });
}

/** 話しかけてくる頻度(自発発話・P7)を保存する(UI改修 段階6・設定パネル)。 */
export async function saveIdleTalk(idleTalk: IdleTalkMode): Promise<void> {
  return updateSettings({ idleTalk });
}

/** PC起動時の自動起動の希望値を保存する(UI改修 段階6)。本番は OS と併用、開発は表示用。 */
export async function saveAutoLaunch(autoLaunch: boolean): Promise<void> {
  return updateSettings({ autoLaunch });
}
