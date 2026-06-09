import { describe, it, expect } from 'vitest';
import { parseConversationResponse } from '../../src/conversation/response-parser';

// Claude振り仮名方式:message の青空文庫式ルビ(漢字《よみ》)から
// 表示用 message(ルビ除去)と reading(音声用・ルビ解決)を導出する。

describe('parseConversationResponse - ルビ(振り仮名)', () => {
  it('ルビが無ければ reading を付けない(message をそのまま読む)', () => {
    expect(parseConversationResponse('{"type":"chat","message":"やあ"}')).toEqual({
      type: 'chat',
      message: 'やあ',
    });
  });

  it('ルビから表示用 message と音声用 reading を導出する', () => {
    const r = parseConversationResponse(
      '{"type":"chat","message":"夏目漱石の心《こころ》を読んだ"}',
    );
    expect(r).toEqual({
      type: 'chat',
      message: '夏目漱石の心を読んだ',
      reading: '夏目漱石のこころを読んだ',
    });
  });

  it('同じ漢字を文脈で読み分ける(心=こころ/向上心=こうじょうしん)', () => {
    const r = parseConversationResponse(
      '{"type":"chat","message":"心《こころ》と向上心《こうじょうしん》","emotion":"neutral"}',
    );
    expect(r).toEqual({
      type: 'chat',
      message: '心と向上心',
      reading: 'こころとこうじょうしん',
      emotion: 'neutral',
    });
  });

  it('os_command でもルビを表示/音声へ分解する', () => {
    expect(
      parseConversationResponse(
        '{"type":"os_command","message":"今日《きょう》のメモを開くね","command":{"action":"open_notepad"}}',
      ),
    ).toEqual({
      type: 'os_command',
      message: '今日のメモを開くね',
      reading: 'きょうのメモを開くね',
      command: { action: 'open_notepad' },
    });
  });

  it('不正な JSON は null', () => {
    expect(parseConversationResponse('not json')).toBeNull();
  });
});
