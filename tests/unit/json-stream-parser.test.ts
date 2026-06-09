import { describe, it, expect } from 'vitest';
import { createJsonStreamParser } from '../../src/conversation/json-stream-parser';
import type { EmotionLabel } from '../../src/shared/types/animation';
import type { OsCommand } from '../../src/shared/types/os';

// JSON応答のストリーミング解釈(C1・B-06)。

interface RunResult {
  sentences: string[];
  emotion?: EmotionLabel;
  command?: OsCommand;
}
function run(deltas: string[]): RunResult {
  const parser = createJsonStreamParser();
  const sentences: string[] = [];
  let emotion: EmotionLabel | undefined;
  for (const d of deltas) {
    const c = parser.push(d);
    if (c.emotion) emotion = c.emotion;
    sentences.push(...c.sentences);
  }
  const f = parser.flush();
  sentences.push(...f.sentences);
  return { sentences, emotion, command: f.command };
}

describe('json-stream-parser (C1)', () => {
  it('一括到着:emotion を確定し、message を文単位に割る', () => {
    const r = run(['{"type":"chat","emotion":"joy","message":"やあ。元気?"}']);
    expect(r.emotion).toBe('joy');
    expect(r.sentences).toEqual(['やあ。', '元気?']);
    expect(r.command).toBeUndefined();
  });

  it('デルタ分割でも再構成し、ルビは保持したまま文を割る', () => {
    const r = run([
      '{"type":"chat","emo',
      'tion":"neutral","mess',
      'age":"最近、夏目漱石の心《こ',
      'ころ》を読んだ。向上心《こうじょうしん》は大切。"}',
    ]);
    expect(r.emotion).toBe('neutral');
    expect(r.sentences).toEqual([
      '最近、夏目漱石の心《こころ》を読んだ。',
      '向上心《こうじょうしん》は大切。',
    ]);
  });

  it('emotion を message より前に置けば早期に確定する', () => {
    const parser = createJsonStreamParser();
    const c1 = parser.push('{"type":"chat","emotion":"surprise","message":"えっ。');
    expect(c1.emotion).toBe('surprise'); // message 本文より前に emotion 確定
    expect(c1.sentences).toEqual(['えっ。']);
  });

  it('os_command を flush で取り出す', () => {
    const r = run([
      '{"type":"os_command","message":"メモ帳を開くね。","command":{"action":"open_notepad"}}',
    ]);
    expect(r.sentences).toEqual(['メモ帳を開くね。']);
    expect(r.command).toEqual({ action: 'open_notepad' });
  });

  it('open_browser の target も取り出す', () => {
    const r = run([
      '{"type":"os_command","message":"開くね。","command":{"action":"open_browser","target":"https://example.com"}}',
    ]);
    expect(r.command).toEqual({ action: 'open_browser', target: 'https://example.com' });
  });

  it('message 内のエスケープされた引用符を解く(本文終端と誤判定しない)', () => {
    const r = run(['{"type":"chat","emotion":"neutral","message":"彼は\\"やあ\\"と言った。"}']);
    expect(r.sentences).toEqual(['彼は"やあ"と言った。']);
  });

  it('emotion 無し(任意)でも本文を割る', () => {
    const r = run(['{"type":"chat","message":"やあ。"}']);
    expect(r.emotion).toBeUndefined();
    expect(r.sentences).toEqual(['やあ。']);
  });

  it('文末記号で終わらない最終文も flush で出す', () => {
    const r = run(['{"type":"chat","message":"おやすみ"}']);
    expect(r.sentences).toEqual(['おやすみ']);
  });
});
