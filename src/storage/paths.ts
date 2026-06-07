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
    // portable exe は自己展開されて %TEMP% から実行されるため、process.execPath は
    // 一時ディレクトリを指す。電子-builder の portable ターゲットは元の exe の場所を
    // PORTABLE_EXECUTABLE_DIR で渡すので、それを優先する(無ければ execPath の隣)。
    const baseDir = process.env['PORTABLE_EXECUTABLE_DIR'] ?? path.dirname(process.execPath);
    return path.join(baseDir, 'data');
  }
  // 開発(npm run dev時): プロジェクトルートの data/
  return path.join(process.cwd(), 'data');
}

function getConfigDir(): string {
  return path.join(getPortableDataDir(), 'config');
}

/**
 * 埋め込みモデルの置き場(data/models/)。アプリ共通(キャラ非依存)。
 * コア exe を汚さないため別ダウンロードで配置する(§4.3・design-revision-memory-v2 §1.3)。
 * data/ は .gitignore 済み＝リポジトリには含めない。
 */
export function getModelsDir(): string {
  return path.join(getPortableDataDir(), 'models');
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

// --- 派生キャッシュ(真実の源ではない・JSON から再生成可能・design-revision-memory-v2 §1.3) ---

/** data/memory/{activeCharacterId}/index/(逆引き・ベクトル索引の置き場)。 */
export function getMemoryIndexDir(): string {
  return path.join(getMemoryDir(), 'index');
}

/** data/memory/{activeCharacterId}/index/inverted.json(entity/keyword 逆引き)。 */
export function getInvertedIndexPath(): string {
  return path.join(getMemoryIndexDir(), 'inverted.json');
}

/** data/memory/{activeCharacterId}/index/vectors.json(意味検索ベクトル・Phase B)。 */
export function getVectorIndexPath(): string {
  return path.join(getMemoryIndexDir(), 'vectors.json');
}

/** data/memory/{activeCharacterId}/relationships/(人物 gist・予約)。 */
export function getRelationshipsDir(): string {
  return path.join(getMemoryDir(), 'relationships');
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

/** characters/{characterId}/life-memory.json(人生記憶 canon・読取専用・task_16)。 */
export function getLifeMemoryPath(characterId: string): string {
  return path.join(getCharacterDir(characterId), 'life-memory.json');
}

/** characters/{characterId}/current-state.json(現在状態・任意・task_16)。 */
export function getCurrentStatePath(characterId: string): string {
  return path.join(getCharacterDir(characterId), 'current-state.json');
}

/** characters/{characterId}/animation.json(アニメ定義・任意・task_13)。 */
export function getAnimationPath(characterId: string): string {
  return path.join(getCharacterDir(characterId), 'animation.json');
}

/** characters/{characterId}/{file}(スプライト等・animation.json の frames が指す実ファイル)。 */
export function getCharacterAssetPath(characterId: string, file: string): string {
  return path.join(getCharacterDir(characterId), file);
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
