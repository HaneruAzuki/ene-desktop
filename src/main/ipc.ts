import { ipcMain, type BrowserWindow } from 'electron';
import { promises as fs } from 'node:fs';
import { nowLocalIso } from '../shared/datetime';
import { log } from '../shared/logger';
import { WINDOW_WIDTH, WINDOW_HEIGHT } from '../shared/constants';
import { appendShortTerm } from '../memory/short-term';
import { buildMemoryContext } from '../memory/context-builder';
import { extractFromShortTerm } from '../memory/extraction-trigger';
import { classifyTopic } from '../router/router';
import { chat, makeLlmComplete } from '../conversation/client';
import { executeOsCommand } from '../os/executor';
import { isApiKeyAvailable, encryptAndSaveApiKey } from '../storage/encryption';
import { saveWindowPosition, resetToDefaultPosition } from './window-position';
import { showCharacterContextMenu } from './character-context-menu';
import type { CharacterContext } from '../shared/types/character';
import type { ConversationResponse } from '../shared/types/conversation';
import type { CharacterInfo } from '../shared/types/ipc';

// IPC ハンドラ集約(設計書 §4)。
// すべての業務ロジックは main 側。Renderer は IPC 経由でのみ呼ぶ(API キーも漏らさない)。

/** 起動時に構築され、ハンドラから参照される実行時状態。task_10 で完全に組み立てる。 */
export interface AppRuntime {
  charContext: CharacterContext | null;
  apiKey: string | null;
}

const NOT_READY: ConversationResponse = {
  type: 'chat',
  message: '…ちょっと待ってね、まだ準備ができてないみたい。',
};

// ドラッグ中の move-window で位置保存を毎フレーム書かないようデバウンスする。
const POSITION_SAVE_DEBOUNCE_MS = 400;
let positionSaveTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedSavePosition(x: number, y: number): void {
  if (positionSaveTimer) clearTimeout(positionSaveTimer);
  positionSaveTimer = setTimeout(() => {
    void saveWindowPosition(x, y);
  }, POSITION_SAVE_DEBOUNCE_MS);
}

/** portrait.png を data URL 化する(CSP 準拠で Renderer に渡すため)。 */
async function readPortraitDataUrl(portraitPath: string): Promise<string> {
  try {
    const buf = await fs.readFile(portraitPath);
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return '';
  }
}

const ERROR_RESPONSE: ConversationResponse = {
  type: 'chat',
  message: '…ごめん、なんか調子悪いみたい。もう一回試してみて?',
};

// send-message の統合フロー(設計書 §4.2 / task_07 §7)。
async function handleSendMessage(text: string, runtime: AppRuntime): Promise<ConversationResponse> {
  const { charContext, apiKey } = runtime;
  if (!charContext || !apiKey) {
    return NOT_READY;
  }

  // 短期記憶 overflow 時の抽出(Claude 呼び出しを注入)。Memory 層は Claude を直接知らない。
  const onOverflow = (): Promise<void> => extractFromShortTerm('overflow', makeLlmComplete(apiKey));

  // 1. user を短期記憶へ
  await appendShortTerm({ role: 'user', text, timestamp: nowLocalIso(), extracted: false }, onOverflow);

  // 2. トピック判定(失敗しても fallback で続行)
  const routerResult = await classifyTopic(text, charContext.knowledgeDomains, apiKey);

  // 3. 記憶コンテキスト(matchedTopic をタグに使った簡易検索・MVP)
  const memoryContext = await buildMemoryContext({
    tags: routerResult.matchedTopic ? [routerResult.matchedTopic] : undefined,
    limit: 5,
  });

  // 4. 本会話(4層防御込み)
  const response = await chat(text, charContext, memoryContext, routerResult, apiKey);

  // 5. assistant を短期記憶へ
  await appendShortTerm(
    { role: 'assistant', text: response.message, timestamp: nowLocalIso(), extracted: false },
    onOverflow,
  );

  // 6. OS コマンドなら実行(失敗時はキャラ口調フォールバックに差し替え)
  if (response.type === 'os_command') {
    const osResult = await executeOsCommand(response.command);
    if (!osResult.ok && osResult.message) {
      return { type: 'chat', message: osResult.message };
    }
  }

  return response;
}

export function registerIpcHandlers(mainWindow: BrowserWindow, runtime: AppRuntime): void {
  ipcMain.handle('ene:send-message', async (_event, text: string): Promise<ConversationResponse> => {
    try {
      return await handleSendMessage(text, runtime);
    } catch (err) {
      // IPC ハンドラから例外を漏らさない(Renderer をクラッシュさせない)。
      log.error('send-message handler failed', { name: (err as Error).name });
      return ERROR_RESPONSE;
    }
  });

  ipcMain.handle('ene:get-character-info', async (): Promise<CharacterInfo> => {
    if (runtime.charContext) {
      return {
        name: runtime.charContext.identity.name,
        portraitUrl: await readPortraitDataUrl(runtime.charContext.portraitPath),
      };
    }
    return { name: 'ENE', portraitUrl: '' };
  });

  ipcMain.handle('ene:has-api-key', async (): Promise<boolean> => isApiKeyAvailable());

  ipcMain.handle('ene:save-api-key', async (_event, key: string): Promise<void> => {
    // 形式検証・疎通テストはダイアログ側(task_09)で行う。ここは保存のみ。
    await encryptAndSaveApiKey(key);
    runtime.apiKey = key;
  });

  ipcMain.handle('ene:move-window', async (_event, x: number, y: number): Promise<void> => {
    mainWindow.setBounds({ x, y, width: WINDOW_WIDTH, height: WINDOW_HEIGHT });
    // ドラッグ中の連続呼び出しに備え、保存はデバウンスする。
    debouncedSavePosition(x, y);
  });

  ipcMain.handle('ene:reset-window-position', async (): Promise<void> => {
    resetToDefaultPosition(mainWindow);
  });

  ipcMain.handle('ene:set-ignore-mouse-events', async (_event, ignore: boolean): Promise<void> => {
    mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
  });

  ipcMain.handle('ene:show-character-context-menu', async (): Promise<void> => {
    showCharacterContextMenu(mainWindow);
  });
}
