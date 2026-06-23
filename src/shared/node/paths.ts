import { app } from 'electron';
import path from 'node:path';
import { readJson } from './json-store';
import {
  VAD_MODEL_FILE,
  VOICE_ENGINE_DIR,
  VOICE_ENGINE_EXE,
  VOICE_ENGINE_USERDATA_DIRNAME,
  VOICE_ENGINE_PORTABLE_USERDATA,
  DEFAULT_CHARACTER_ID,
} from '../constants';

// ファイルパスの統一管理(設計書 §3.6 / §5.5)。
//
// - ポータブルデータ: exe と同じディレクトリ(本番)/ プロジェクトルート(開発)の data/
// - Electron userData(Local Storage・api-key.enc 等)も index.ts で data/app/ へ向け直す
//   (ポータブル運用=%APPDATA% に痕跡を残さない・フォルダ削除で完全に消える・§6.3)。
//
// 記憶系パスは「現在使用中キャラの characterId」に依存して動的に変わる。
// characterId の読込(active-character.json)は非同期 I/O のため、起動時に
// refreshActiveCharacterId() でモジュール内キャッシュへ反映し、getter は同期で返す。
// これにより Memory Layer 等はキャラを意識せず同期的にパスを取得できる(疎結合)。

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

// --- データ配置(N-REL-2: NSIS 化でユーザーデータと同梱アセットを分離) ---
//  - getPortableDataDir(): 同梱アセット(モデル/音声エンジン・読取専用・更新で入れ替わる)の root。
//    本番 = install dir 隣の data/。electron-updater が本体ごと入れ替えるため、ここにユーザーデータは置かない。
//  - getUserDataDir()    : ユーザーデータ(記憶/設定/APIキー/ログ・更新を跨いで残す)の root。
//    本番 = Electron userData(%APPDATA%/project-ene)。アンインストールでも既定保持(N-REL-2)。
//  dev ではどちらもプロジェクトルートの data/(従来どおり・検証容易)。

/** 同梱アセット(モデル/音声エンジン)の root。本番=install dir 隣の data/ / 開発=プロジェクトルートの data/。 */
export function getPortableDataDir(): string {
  if (app.isPackaged) return path.join(path.dirname(process.execPath), 'data');
  return path.join(process.cwd(), 'data');
}

/** ユーザーデータ(記憶/設定/APIキー/ログ)の root。本番=Electron userData(%APPDATA%/project-ene)/ 開発=プロジェクトルートの data/。 */
export function getUserDataDir(): string {
  if (app.isPackaged) return app.getPath('userData');
  return path.join(process.cwd(), 'data');
}

function getConfigDir(): string {
  return path.join(getUserDataDir(), 'config');
}

/**
 * 埋め込みモデルの置き場(data/models/)。アプリ共通(キャラ非依存)。
 * コア exe を汚さないため別ダウンロードで配置する(§4.3・design-revision-memory-v2 §1.3)。
 * data/ は .gitignore 済み＝リポジトリには含めない。
 */
export function getModelsDir(): string {
  return path.join(getPortableDataDir(), 'models');
}

/**
 * 音声サイドカー資産の置き場(data/voice/)。アプリ共通(キャラ非依存)。
 * エンジン本体は exe に同梱せず、ここへ別配置する(コア<100MB維持・§4.3・N-17-6)。
 * data/ は .gitignore 済み＝リポジトリには含めない。
 */
export function getVoiceDir(): string {
  return path.join(getPortableDataDir(), 'voice');
}

/** AivisSpeech エンジン一式(run.exe + engine_internal/ + resources/)の配置先(data/voice/engine/)。 */
export function getVoiceEngineDir(): string {
  return path.join(getVoiceDir(), VOICE_ENGINE_DIR);
}

/** data/voice/engine/run.exe(spawn 対象の実行ファイル)。 */
export function getVoiceEngineExePath(): string {
  return path.join(getVoiceEngineDir(), VOICE_ENGINE_EXE);
}

/**
 * エンジンが固定で使うデータ root(= %APPDATA%\AivisSpeech-Engine)。
 * エンジンは保存先を platformdirs(roaming)で決め打ち、変更不可(N-17-13)。index.ts は userData 等を
 * data/ へ向け直すが **appData は OS 実体(Roaming)のまま**=エンジンの実使用先と一致する。
 * 起動時にここをポータブル側へジャンクションして「一時借用」する(app.ready 後に呼ぶこと)。
 */
export function getEngineUserDataDir(): string {
  return path.join(app.getPath('appData'), VOICE_ENGINE_USERDATA_DIRNAME);
}

/** ポータブル側のエンジンデータ root(data/voice/userdata・同梱 torimi＋BERT・一時ジャンクションの向き先)。 */
export function getPortableEngineUserDataDir(): string {
  return path.join(getVoiceDir(), VOICE_ENGINE_PORTABLE_USERDATA);
}

/** data/config/active-character.json(active キャラに依存しない固定パス)。 */
export function getActiveCharacterPath(): string {
  return path.join(getConfigDir(), 'active-character.json');
}

/** data/config/window-position.json */
export function getWindowPositionPath(): string {
  return path.join(getConfigDir(), 'window-position.json');
}

/** data/config/app-settings.json(マイク入力方式などのユーザー設定・task_17 Phase C)。 */
export function getAppSettingsPath(): string {
  return path.join(getConfigDir(), 'app-settings.json');
}

/** ユーザーデータ root/logs/(アプリ動作ログ・個人情報を含めない)。 */
export function getLogsDir(): string {
  return path.join(getUserDataDir(), 'logs');
}

// --- 記憶系(active キャラ ID に依存) ---

/** {userData}/memory/{activeCharacterId}/ */
export function getMemoryDir(): string {
  return path.join(getUserDataDir(), 'memory', activeCharacterId);
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

/** data/memory/{activeCharacterId}/consolidation-state.json(忘却機構の最終実行記録・§11.6)。 */
export function getConsolidationStatePath(): string {
  return path.join(getMemoryDir(), 'consolidation-state.json');
}

/** data/memory/{activeCharacterId}/open-loop-state.json(気にかけ注入のクールダウン記録・P4・派生状態)。 */
export function getOpenLoopStatePath(): string {
  return path.join(getMemoryDir(), 'open-loop-state.json');
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

// --- 同梱キャラ定義(読み取り専用・配布物に含まれる) ---

/** 同梱キャラ定義ディレクトリ。dev/prod とも app.getAppPath() 直下の {characterId}/。 */
export function getCharacterDir(characterId: string): string {
  return path.join(app.getAppPath(), characterId);
}

/** {characterId}/life-memory.json(人生記憶 canon・読取専用・task_16)。 */
export function getLifeMemoryPath(characterId: string): string {
  return path.join(getCharacterDir(characterId), 'life-memory.json');
}

/** {characterId}/current-state.json(現在状態・任意・task_16)。 */
export function getCurrentStatePath(characterId: string): string {
  return path.join(getCharacterDir(characterId), 'current-state.json');
}

/** {characterId}/off-screen-life/(画面の外の暮らしの季節パック・常緑年・読取専用)。 */
export function getOffscreenLifeDir(characterId: string): string {
  return path.join(getCharacterDir(characterId), 'off-screen-life');
}

/** {characterId}/voice.json(音声設定・emotion→スタイル/パラメータ・任意・task_17)。 */
export function getVoiceConfigPath(characterId: string): string {
  return path.join(getCharacterDir(characterId), 'voice.json');
}

/** {characterId}/vrm.json(VRM 表示設定・emotion→表情/初期パラメータ・任意・F)。 */
export function getVrmConfigPath(characterId: string): string {
  return path.join(getCharacterDir(characterId), 'vrm.json');
}

/** {characterId}/backchannels.json(相槌の語彙・任意・task_18)。 */
export function getBackchannelPoolPath(characterId: string): string {
  return path.join(getCharacterDir(characterId), 'backchannels.json');
}

/** {characterId}/{file}(キャラ同梱アセットの実ファイル。例: VRM モデル本体を vrm-loader が読む)。 */
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

/** Silero VAD モデル(resources/silero_vad.onnx・配布物に同梱・task_17 Phase C)。 */
export function getVadModelPath(): string {
  // silero_vad.onnx は asarUnpack 済み(electron-builder.yml)。ネイティブ onnxruntime は asar 内を
  // 直接開けないため、packaged では app.asar ではなく app.asar.unpacked 側の実ファイルを指す
  // (app.getAppPath() は packaged で …/resources/app.asar を返す)。dev はその名を含まないので no-op。
  return path
    .join(getResourcesDir(), VAD_MODEL_FILE)
    .replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
}

// --- Electron userData(暗号化 API キーの保存先) ---

/**
 * マシン固定データ(暗号化 API キー)の保存先 = ユーザーデータ root(getUserDataDir())。
 * 本番 = Electron userData(%APPDATA%/project-ene)。DPAPI 暗号ゆえ別PCでは復号不可=再入力(§6.3)。
 */
export function getMachineDataDir(): string {
  return getUserDataDir();
}

/** api-key.enc(ユーザーデータ root 直下・DPAPI 暗号・別PCでは再入力)。 */
export function getApiKeyPath(): string {
  return path.join(getMachineDataDir(), 'api-key.enc');
}
