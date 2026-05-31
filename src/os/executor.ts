import { openNotepad, openBrowser, openFolder } from './actions';
import type { OsCommand, OsCommandResult, OsCommandFailureReason } from '../shared/types/os';

// コマンド実行ディスパッチャ(設計書 §3.5)。
// ホワイトリスト方式: action は型レベルで3種類に固定され、target は検証済みのみ実行する。

// 失敗時のキャラ口調フォールバック文言(MVP はキャラ非依存・将来 identity.json へ移行余地)。
const FALLBACK_MESSAGES: Record<OsCommandFailureReason, string> = {
  invalid_action: 'それはできないみたい…',
  invalid_target: 'ちょっとそのパス、開けないんだけど…',
  path_traversal: 'そんな変なパス指定はできないわよ',
  outside_home: 'ホームフォルダの外は開けないわよ。守らなきゃいけないし。',
  non_https: 'そのURL、ちょっと開きたくないかな…',
  exec_error: 'あれ?開けなかった。なんでだろ…',
};

async function dispatch(command: OsCommand): Promise<OsCommandResult> {
  switch (command.action) {
    case 'open_notepad':
      return openNotepad();
    case 'open_browser':
      if (!command.target) return { ok: false, reason: 'invalid_target' };
      return openBrowser(command.target);
    case 'open_folder':
      if (!command.target) return { ok: false, reason: 'invalid_target' };
      return openFolder(command.target);
    default: {
      // 型レベルで網羅されるが、安全側のフォールバック
      const _exhaustive: never = command.action;
      void _exhaustive;
      return { ok: false, reason: 'invalid_action' };
    }
  }
}

export async function executeOsCommand(command: OsCommand): Promise<OsCommandResult> {
  const result = await dispatch(command);
  // 失敗時、message 未設定なら reason に応じたキャラ口調フォールバックを付与する。
  if (!result.ok && result.reason && !result.message) {
    return { ...result, message: FALLBACK_MESSAGES[result.reason] };
  }
  return result;
}
