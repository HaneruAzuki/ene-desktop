import { promises as fs, constants as fsConstants } from 'node:fs';
import { app, dialog, type BrowserWindow } from 'electron';
import { log, initLogger } from '../shared/logger';
import { getPortableDataDir, getLogsDir } from '../storage/paths';
import { isCloudSyncFolder } from '../storage/cloud-warning';
import { loadAndDecryptApiKey } from '../storage/encryption';
import { loadAppSettings } from '../storage/app-settings';
import { todayLocalYmd } from '../shared/datetime';
import { loadOrCreateActiveCharacter, markFirstLaunchCompleted } from '../character/active-character';
import { buildCharacterContext } from '../character/context-builder';
import { checkBirthday } from '../character/birthday-checker';
import { getUnextractedEntries, clearShortTerm } from '../memory/short-term';
import { extractFromShortTerm } from '../memory/extraction-trigger';
import { makeLlmComplete } from '../conversation/client';
import { openApiKeyDialog } from './api-key-dialog';
import { ensureMemoryDirectories } from './init-directories';
import { createMainWindow } from './window';
import { createTray } from './tray';
import { registerIpcHandlers, type AppRuntime } from './ipc';
import { initVoice } from './voice-runtime';
import { ensureVoiceEngine } from './voice-engine';
import { generateGreeting } from './greeting';
import {
  loadWindowPosition,
  getDefaultPosition,
  clampPositionToScreen,
  saveWindowPosition,
} from './window-position';
import type { CharacterContext, ActiveCharacter } from '../shared/types/character';

// 起動シーケンス(設計書 §7.1 の11ステップ)。
// runtime(実行時状態)を埋め、メインウィンドウを返す。

export async function runStartupSequence(
  runtime: AppRuntime,
): Promise<{ mainWindow: BrowserWindow; active: ActiveCharacter }> {
  // Step 2: app ready
  await app.whenReady();
  initLogger(getLogsDir());
  log.info('app starting');

  // Step 3: ポータブル書込チェック
  const dataDir = getPortableDataDir();
  try {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.access(dataDir, fsConstants.W_OK);
  } catch (e) {
    dialog.showErrorBox(
      '起動できません',
      `データ保存先 ${dataDir} に書き込めません。別の(書き込み可能な)場所から実行してください。`,
    );
    app.quit();
    throw e;
  }

  // Step 4: クラウド同期フォルダ警告(続行は可能)
  if (isCloudSyncFolder(dataDir)) {
    const choice = dialog.showMessageBoxSync({
      type: 'warning',
      title: 'クラウド同期フォルダの警告',
      message:
        '現在の場所はクラウド同期フォルダ(OneDrive 等)の配下です。\n' +
        'データの整合性に問題が出る可能性があります。続行しますか?',
      buttons: ['続行', '終了'],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice === 1) {
      app.quit();
      throw new Error('user quit at cloud-folder warning');
    }
  }

  // Step 4.5: 音声サイドカー(AivisSpeech)を**背景で**起動する(N-17-12)。
  // ヘルス到達まで数秒かかるため await しない(挨拶表示やウィンドウ表示をブロックしない)。
  // 既に立っていれば再利用、未配置ならテキストのみで続行。立てば後続の speak() が喋れる
  // (bundled voice.json の styleId は実エンジン値と一致するため reconcile を待つ必要はない)。
  // 初回 API キー入力ダイアログやキャラ/記憶ロードと並行して温まる。
  void ensureVoiceEngine();

  // Step 5: APIキー(無ければダイアログ。キャンセルなら終了)
  let apiKey = await loadAndDecryptApiKey();
  if (!apiKey) {
    const result = await openApiKeyDialog(undefined, (key) => {
      runtime.apiKey = key;
    });
    if (!result.ok) {
      app.quit();
      throw new Error('api key setup cancelled');
    }
    apiKey = await loadAndDecryptApiKey();
    if (!apiKey) {
      throw new Error('failed to load api key after dialog');
    }
  }
  runtime.apiKey = apiKey;

  // Step 6: active-character.json
  const active = await loadOrCreateActiveCharacter();
  log.info(`active character: ${active.characterId}`);

  // Step 7: キャラクタープロファイル(setActiveCharacterId も内部で実施)
  let charContext: CharacterContext;
  try {
    charContext = await buildCharacterContext();
  } catch (e) {
    dialog.showErrorBox(
      'キャラクター読み込みエラー',
      `${active.characterId} のプロファイルを読み込めませんでした。`,
    );
    app.quit();
    throw e;
  }

  // Step 8: 記憶ディレクトリ初期化 + 異常終了対策(残った短期記憶の抽出)
  await ensureMemoryDirectories();
  const orphaned = await getUnextractedEntries();
  if (orphaned.length > 0) {
    try {
      await extractFromShortTerm('shutdown', makeLlmComplete(apiKey));
      await clearShortTerm();
      log.info(`recovered ${orphaned.length} orphaned short-term entries`);
    } catch (e) {
      log.warn('failed to recover orphaned short-term memory', { name: (e as Error).name });
    }
  }

  // Step 9: 誕生日判定
  const today = todayLocalYmd();
  charContext = { ...charContext, birthdayHint: checkBirthday(charContext.identity, active, today) };
  runtime.charContext = charContext;

  // Step 10: 透過ウィンドウ(位置復元)+ IPC + トレイ
  const saved = await loadWindowPosition();
  const position = saved ? clampPositionToScreen(saved) : getDefaultPosition();
  const mainWindow = createMainWindow(position);
  await saveWindowPosition(position.x, position.y);
  registerIpcHandlers(mainWindow, runtime);
  createTray(mainWindow);

  // マイク入力方式(設定)を読み込む(task_17 Phase C・既定 push-to-talk)。
  runtime.voiceInputMode = (await loadAppSettings()).voiceInputMode;

  // Step 10.5: 音声を best-effort 初期化(エンジンは Step 4.5 で背景起動済み・task_17 Phase A)。
  // この時点ではまだヘルス到達前のことが多いので listStyles は失敗しうるが、その場合は
  // bundled voice.json(styleId は実値と一致)で有効化する。tts は非 null になり、
  // エンジンが立ち次第そのまま喋れる(初回メッセージまでに数秒あれば間に合う)。
  const voice = await initVoice(active.characterId);
  runtime.tts = voice?.tts ?? null;
  runtime.voiceConfig = voice?.voiceConfig ?? null;

  // Step 11: 起動挨拶を用意(Renderer が getInitialGreeting で取得・pull 方式)
  runtime.initialGreeting = generateGreeting(active, charContext);
  if (!active.firstLaunchCompleted) {
    await markFirstLaunchCompleted();
  }

  log.info('app ready');
  return { mainWindow, active };
}
