import { app } from 'electron';
import path from 'node:path';
import { readJson } from './json-store';

// ファイルパスの統一管理(設計書 §3.6 / §5.5)。
//
// - ポータブルデータ: exe と同じディレクトリ(本番)/ プロジェクトルート(開発)の data/
// - マシン固定データ: %APPDATA%/ene-desktop/(app.getPath('userData'))
//
// 記憶系パスは「現在使用中キャラの characterId」に依存して動的に変わる。
// characterId の読込(active-character.json)は非同期 I/O のため、起動時に
// refreshActiveCharacterId() でモジュール内キャッシュへ反映し、getter は同期で返す。
// これにより Memory Layer 等はキャラを意識せず同期的にパスを取得できる(疎結合)。

const DEFAULT_CHARACTER_ID = 'ene';
let activeCharacterId = DEFAULT_CHARACTER_ID;

/** 現在キャッシュしている active キャラ ID を返す。 */
export function getActiveCharacterId(): string {
  return activeCharacterId;
}

/** active キャラ ID を明示的に設定する(キャラ切替時など)。 */
export function setActiveCharacterId(id: string): void {
  if (id) {
    activeCharacterId = id;
  }
}

/**
 * active-character.json を読み、characterId をキャッシュに反映する。
 * ファイルが無い・characterId が無い場合は既存のキャッシュ値を維持する。
 */
export async function refreshActiveCharacterId(): Promise<string> {
  const data = await readJson<{ characterId?: string }>(getActiveCharacterPath());
  if (data?.characterId) {
    activeCharacterId = data.characterId;
  }
  return activeCharacterId;
}

// --- ポータブルデータ ---

/** ポータブルデータのルート(本番: exe の隣 / 開発: プロジェクトルート)の data/。 */
export function getPortableDataDir(): string {
  if (app.isPackaged) {
    // 本番(exe実行時): exe と同じディレクトリの data/
    return path.join(path.dirname(process.execPath), 'data');
  }
  // 開発(npm run dev時): プロジェクトルートの data/
  return path.join(process.cwd(), 'data');
}

function getConfigDir(): string {
  return path.join(getPortableDataDir(), 'config');
}

/** data/config/active-character.json(active キャラに依存しない固定パス)。 */
export function getActiveCharacterPath(): string {
  return path.join(getConfigDir(), 'active-character.json');
}

/** data/config/window-position.json */
export function getWindowPositionPath(): string {
  return path.join(getConfigDir(), 'window-position.json');
}

/** data/logs/(アプリ動作ログ・個人情報を含めない)。 */
export function getLogsDir(): string {
  return path.join(getPortableDataDir(), 'logs');
}

// --- 記憶系(active キャラ ID に依存) ---

/** data/memory/{activeCharacterId}/ */
export function getMemoryDir(): string {
  return path.join(getPortableDataDir(), 'memory', activeCharacterId);
}

/** data/memory/{activeCharacterId}/episodic/{year}/{category}/ */
export function getEpisodicDir(year: number, category: string): string {
  return path.join(getMemoryDir(), 'episodic', String(year), category);
}

/** data/memory/{activeCharacterId}/semantic.json */
export function getSemanticPath(): string {
  return path.join(getMemoryDir(), 'semantic.json');
}

/** data/memory/{activeCharacterId}/short-term.json */
export function getShortTermPath(): string {
  return path.join(getMemoryDir(), 'short-term.json');
}

// --- 同梱キャラ定義(読み取り専用・配布物に含まれる) ---

/** 同梱キャラ定義のルート。dev/prod とも app.getAppPath() 配下の characters/。 */
export function getCharactersDir(): string {
  return path.join(app.getAppPath(), 'characters');
}

/** characters/{characterId}/ */
export function getCharacterDir(characterId: string): string {
  return path.join(getCharactersDir(), characterId);
}

/** ビルドリソース(アイコン等)のディレクトリ。app.getAppPath() 配下の resources/。 */
export function getResourcesDir(): string {
  return path.join(app.getAppPath(), 'resources');
}

/** タスクトレイ用アイコン(resources/tray-icon.png)。 */
export function getTrayIconPath(): string {
  return path.join(getResourcesDir(), 'tray-icon.png');
}

// --- マシン固定データ(暗号化 API キーの保存先) ---

/** %APPDATA%/ene-desktop/(環境問わず app.getPath('userData'))。 */
export function getMachineDataDir(): string {
  return app.getPath('userData');
}

/** %APPDATA%/ene-desktop/api-key.enc */
export function getApiKeyPath(): string {
  return path.join(getMachineDataDir(), 'api-key.enc');
}
