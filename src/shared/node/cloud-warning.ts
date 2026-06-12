// クラウド同期フォルダ警告(設計書 §7.1 ステップ4)。
//
// data/ がクラウド同期フォルダ配下にあると、同期競合でファイル破損のリスクがある。
// 起動時にパスをチェックし、該当する場合は警告ダイアログを表示する(続行は可能)。

// 検知対象のフォルダ名(代表的なクラウド同期サービス)。
const CLOUD_SYNC_MARKERS: readonly string[] = [
  'OneDrive',
  'Dropbox',
  'Google Drive',
  'iCloud',
  'Box Sync',
];

/**
 * dataDir のパスにクラウド同期フォルダ名が含まれるかを判定する。
 * 大文字小文字は区別しない(パス表記の揺れに対応)。
 */
export function isCloudSyncFolder(dataDir: string): boolean {
  const lower = dataDir.toLowerCase();
  return CLOUD_SYNC_MARKERS.some((marker) => lower.includes(marker.toLowerCase()));
}
