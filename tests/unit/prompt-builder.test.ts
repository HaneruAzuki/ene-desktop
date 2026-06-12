import { describe, it, expect } from 'vitest';
import { buildPrompt, buildTier0 } from '../../src/conversation/prompt-builder';
import { makeCharContext, makeMemoryContext, makeRouterResult, systemText, lastUserText } from './fixtures';

// task_14: system は Tier ブロック配列。Tier0(人格/出力形式/自称制約)は system、
// 揮発物(episodic/behavior/誕生日)は現在の user ターン本文へ移動した。

describe('buildPrompt (設計書 §3.4 / task_14 Tier 構成)', () => {
  it('system(Tier0)に neverCallsSelf の語を含む', () => {
    const p = buildPrompt(makeCharContext(), makeMemoryContext(), makeRouterResult(), 'こんにちは');
    expect(systemText(p)).toContain('AI');
    expect(systemText(p)).toContain('アシスタント');
  });

  it('system 先頭ブロックは cacheable(Tier0)', () => {
    const p = buildPrompt(makeCharContext(), makeMemoryContext(), makeRouterResult(), 'x');
    expect(p.system[0]?.cacheable).toBe(true);
    // semantic ブロックは準不変=非キャッシュ
    expect(p.system[1]?.cacheable).toBeFalsy();
  });

  it('messages の最後は現在の user 入力(Prefill は使わない=現行モデル非対応)', () => {
    const p = buildPrompt(makeCharContext(), makeMemoryContext(), makeRouterResult(), 'こんにちは');
    const last = p.messages[p.messages.length - 1];
    expect(last?.role).toBe('user');
    expect(last?.content).toContain('こんにちは');
  });

  it('few-shot 例と現在の入力が messages に含まれる', () => {
    const p = buildPrompt(makeCharContext(), makeMemoryContext(), makeRouterResult(), 'いまの質問');
    expect(p.messages.some((m) => m.content.includes('ふん、教えてあげるわよ'))).toBe(true);
    expect(p.messages.some((m) => m.role === 'user' && m.content.includes('いまの質問'))).toBe(true);
  });

  it('few-shot/短期記憶の assistant ターンは JSON 形式で提示される', () => {
    const mc = makeMemoryContext({
      shortTerm: [
        { role: 'user', text: '過去の質問', timestamp: 't1', extracted: true },
        { role: 'assistant', text: '過去の返答', timestamp: 't2', extracted: true },
      ],
    });
    const p = buildPrompt(makeCharContext(), mc, makeRouterResult(), 'x');
    const fewshotAssistant = p.messages.find((m) => m.content.includes('ふん、教えてあげるわよ'));
    expect(fewshotAssistant?.content).toContain('"type":"chat"');
    const stAssistant = p.messages.find((m) => m.content.includes('過去の返答'));
    expect(stAssistant?.content).toContain('"type":"chat"');
    const stUser = p.messages.find((m) => m.role === 'user' && m.content.includes('過去の質問'));
    expect(stUser?.content).not.toContain('"type":"chat"');
  });

  it('出力形式(os_command 仕様)が system(Tier0)に含まれる', () => {
    const p = buildPrompt(makeCharContext(), makeMemoryContext(), makeRouterResult(), 'x');
    expect(systemText(p)).toContain('os_command');
    expect(systemText(p)).toContain('open_notepad');
    expect(systemText(p)).toContain('open_browser');
    expect(systemText(p)).toContain('open_folder');
  });

  it('routerResult.behavior は揮発物として現 user ターンに同梱(system には出さない)', () => {
    const p = buildPrompt(makeCharContext(), makeMemoryContext(), makeRouterResult({ behavior: '特別な振る舞い' }), 'x');
    expect(lastUserText(p)).toContain('特別な振る舞い');
    expect(systemText(p)).not.toContain('特別な振る舞い');
  });

  it('episodic も現 user ターンに同梱される', () => {
    const mc = makeMemoryContext({
      relevantEpisodic: [
        { date: '2026-05-10T00:00:00+09:00', topic: 't', summary: '過去にラーメンの話をした', importance: 3, category: 'general' },
      ],
    });
    const p = buildPrompt(makeCharContext(), mc, makeRouterResult(), 'x');
    expect(lastUserText(p)).toContain('過去にラーメンの話をした');
  });

  it('canon(self)と user 記憶は別セクションに分けて提示される(provenance 混同防止)', () => {
    const mc = makeMemoryContext({
      relevantEpisodic: [
        // canon = キャラ自身の友達
        { date: '2018-06-25T00:00:00+09:00', topic: '友達', summary: '美月は初めての友達', importance: 5, category: 'friendship', provenance: 'self' },
        // user = 相手の知人(混同してはいけない)
        { date: '2025-11-02T00:00:00+09:00', topic: '相手の話', summary: '相手は鈴木のことが好きだと打ち明けた', importance: 3, category: 'relationship', provenance: 'user' },
      ],
    });
    const text = lastUserText(buildPrompt(makeCharContext(), mc, makeRouterResult(), 'x'));
    // 2セクションの見出しが両方ある
    expect(text).toContain('あなた自身の思い出');
    expect(text).toContain('相手について覚えていること');
    // canon の美月は「あなた自身」側、鈴木は「相手について」側に出る(順序で領域を確認)
    const selfIdx = text.indexOf('あなた自身の思い出');
    const userIdx = text.indexOf('相手について覚えていること');
    const mizukiIdx = text.indexOf('美月は初めての友達');
    const suzukiIdx = text.indexOf('相手は鈴木のことが好き');
    expect(selfIdx).toBeLessThan(mizukiIdx);
    expect(mizukiIdx).toBeLessThan(userIdx); // 美月は user セクションより前(=self セクション内)
    expect(userIdx).toBeLessThan(suzukiIdx); // 鈴木は user セクション内
  });

  it('連続する同一 role を作らない(交互列を保つ)', () => {
    const mc = makeMemoryContext({
      shortTerm: [{ role: 'user', text: '直前のユーザー発話', timestamp: 't', extracted: false }],
    });
    const p = buildPrompt(makeCharContext(), mc, makeRouterResult(), '新しい質問');
    for (let i = 1; i < p.messages.length; i++) {
      expect(p.messages[i]?.role).not.toBe(p.messages[i - 1]?.role);
    }
    expect(p.messages[0]?.role).toBe('user');
  });

  it('現ターンの直前メッセージが履歴キャッシュ境界(cacheable)になる', () => {
    const p = buildPrompt(makeCharContext(), makeMemoryContext(), makeRouterResult(), 'x');
    const boundary = p.messages[p.messages.length - 2];
    expect(boundary?.cacheable).toBe(true);
    // 現ターン(末尾)自身は揮発=非キャッシュ
    expect(p.messages[p.messages.length - 1]?.cacheable).toBeFalsy();
  });

  it('誕生日(today)なら誕生日情報と祝福例が現 user ターンに含まれる', () => {
    const p = buildPrompt(
      makeCharContext({ birthdayHint: 'today' }),
      makeMemoryContext(),
      makeRouterResult(),
      'x',
    );
    expect(lastUserText(p)).toContain('誕生日');
    expect(lastUserText(p)).toContain('べ、別に嬉しくない');
  });

  it('ウォーム用 buildTier0 は本会話の system[0](Tier0)とバイト同一', () => {
    // Phase 3 のクリック起点ウォームが本会話と同じキャッシュを温めるための不変条件。
    const cc = makeCharContext();
    const p = buildPrompt(cc, makeMemoryContext(), makeRouterResult(), 'x');
    expect(buildTier0(cc)).toEqual(p.system[0]);
  });

  it('同一入力で Tier0 はバイト同一(キャッシュ前提の不変性)', () => {
    const a = buildPrompt(makeCharContext(), makeMemoryContext(), makeRouterResult({ behavior: 'X' }), '質問1');
    const b = buildPrompt(makeCharContext(), makeMemoryContext(), makeRouterResult({ behavior: 'Y' }), '質問2');
    // behavior も入力も違うが Tier0(先頭ブロック)は変わらない
    expect(a.system[0]?.text).toBe(b.system[0]?.text);
  });

  // --- P2: ふるまいの規範(Tier0・cacheable) ---
  it('規範(閉世界・反同調・聞き取り自覚など)が system(Tier0)に含まれる', () => {
    const p = buildPrompt(makeCharContext(), makeMemoryContext(), makeRouterResult(), 'x');
    const sys = systemText(p);
    expect(sys).toContain('ふるまいの規範');
    expect(sys).toContain('覚えていること'); // 閉世界規範
    expect(sys).toContain('調子を合わせ'); // 反同調規範
    // 規範は cacheable な Tier0 に入る(揮発ターンではない)。
    expect(p.system[0]?.cacheable).toBe(true);
    expect(lastUserText(p)).not.toContain('ふるまいの規範');
  });

  // --- P5: 長期記憶の名前読み・誕生日 ---
  it('名前の読みがあればルビ付きで、誕生日があれば semantic に出る', () => {
    const mc = makeMemoryContext({
      semantic: { version: 1, userName: '優希', userNameReading: 'ゆうき', userBirthday: { month: 6, day: 12 } },
    });
    const sys = systemText(buildPrompt(makeCharContext(), mc, makeRouterResult(), 'x'));
    expect(sys).toContain('優希《ゆうき》');
    expect(sys).toContain('6月12日');
  });

  // --- P1/P4/P5/P7: moment(いま/気にかけ/まだ知らないこと/誕生日/有限性) ---
  it('moment の各要素が現 user ターンに整形される', () => {
    const mc = makeMemoryContext({
      moment: {
        nowIso: '2026-06-13T23:40:00+09:00',
        timeOfDay: '深夜',
        elapsedLabel: '3日ぶり',
        openLoops: ['面接の結果待ち'],
        knowledgeGaps: ['相手の名前'],
        userBirthdayToday: true,
        finitenessHint: '(いまは夜遅い時間。)',
      },
    });
    const text = lastUserText(buildPrompt(makeCharContext(), mc, makeRouterResult(), 'x'));
    expect(text).toContain('# いま');
    expect(text).toContain('深夜');
    expect(text).toContain('3日ぶり');
    expect(text).toContain('気にかけていること');
    expect(text).toContain('面接の結果待ち');
    expect(text).toContain('まだ知らないこと');
    expect(text).toContain('相手の名前');
    expect(text).toContain('相手の誕生日'); // userBirthdayToday
    expect(text).toContain('夜遅い時間'); // finitenessHint
    // moment はキャッシュ境界より後ろ=system(Tier0)を汚さない。
    expect(systemText(buildPrompt(makeCharContext(), mc, makeRouterResult(), 'x'))).not.toContain('# いま');
  });

  it('moment 未指定でも従来どおり動く(後方互換)', () => {
    const p = buildPrompt(makeCharContext(), makeMemoryContext(), makeRouterResult(), 'x');
    expect(lastUserText(p)).not.toContain('# いま');
  });
});
