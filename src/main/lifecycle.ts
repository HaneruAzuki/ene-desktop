import { promises as fs, constants as fsConstants } from 'node:fs';
import { app, dialog, type BrowserWindow } from 'electron';
import { log, initLogger } from '../shared/logger';
import { getPortableDataDir, getLogsDir } from '../storage/paths';
import { isCloudSyncFolder } from '../storage/cloud-warning';
import { loadAndDecryptApiKey } from '../storage/encryption';
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

  // Step 11: 起動挨拶を用意(Renderer が getInitialGreeting で取得・pull 方式)
  runtime.initialGreeting = generateGreeting(active, charContext);
  if (!active.firstLaunchCompleted) {
    await markFirstLaunchCompleted();
  }

  log.info('app ready');
  return { mainWindow, active };
}
