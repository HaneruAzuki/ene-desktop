import { type BrowserWindow } from 'electron';
import { performance } from 'node:perf_hooks';
import { nowLocalIso, todayLocalYmd } from '../../shared/datetime';
import { log } from '../../shared/logger';
import { VOICE_STREAMING_ENABLED_ENV, TWO_TIER_ENABLED_ENV } from '../../shared/constants';
import { appendShortTerm } from '../../memory/short-term';
import { buildConversationMemory } from '../../memory/context-builder';
import { requestExtraction, enforceShortTermCap } from '../../memory/extraction-scheduler';
import { classifyTopicLocal } from '../../knowledge/local-classifier';
import { chat, makeLlmComplete, MODEL_SONNET, MODEL_HAIKU } from '../../conversation/client';
import { chooseModelTier } from '../../conversation/model-selector';
import { shouldPlayThinkingFiller } from '../../voice/thinking-filler';
import { executeOsCommand } from './os/executor';
import {
  recordBirthdayCelebrated,
  recordConversationTurn,
  recordUserBirthdayCelebrated,
  loadOrCreateActiveCharacter,
} from '../../character/active-character';
import { getSemantic } from '../../memory/semantic';
import { isUserBirthdayToday } from '../../memory/user-birthday';
import { handleApiAuthError } from './api-key-auto-recovery';
import { speakResponse, streamVoiceChat } from './voice-runtime';
import type { ConversationResponse } from '../../shared/types/conversation';
import type { EmotionLabel } from '../../shared/types/animation';
import type { AppRuntime } from './app-runtime';

// ターンエンジン(1ターンの司令塔)。send-message オーケストレーションの中核を ipc 配線から分離する。
//   generateResponse(副作用なし=投機可)→ commitTurn(副作用)→ handleSendMessage(直列の統合フロー)。
// IPC 登録(registerIpcHandlers)は ipc.ts。コアレッシング音声経路は VoiceTurnCoordinator が
// generateResponse/commitTurn を別途駆動する(ipc.ts で配線)。

const NOT_READY: ConversationResponse = {
  type: 'chat',
  message: '…ちょっと待ってね、まだ準備ができてないみたい。',
};

/** テキスト経路など「中断しない」呼び出し用の never-abort シグナル。 */
const NEVER_ABORT = new AbortController();
const NOOP = (): void => {};

/**
 * 応答を**生成**する(副作用なし=投機実行・中断に耐える)。記憶構築・ローカル判別・モデル選択・生成のみ。
 * 記憶書き込み等の副作用は commitTurn(生成完了かつ非キャンセル時)で行う=投機が捨てられても短期記憶を汚さない。
 *  - signal: 中断(コアレッシングの投機キャンセル)。abort されたら例外を投げて上位に破棄させる。
 *  - onFirstAudio: 第一声(=コミット点)の通知。
 *  - opts.playFiller: 思考フィラーを鳴らすか(投機経路では false=コミット前のちらつき回避)。
 */
export async function generateResponse(
  text: string,
  runtime: AppRuntime,
  mainWindow: BrowserWindow,
  signal: AbortSignal,
  onFirstAudio: () => void,
  opts: { playFiller: boolean },
): Promise<{ response: ConversationResponse; audioStreamed: boolean } | null> {
  const { charContext, apiKey } = runtime;
  if (!charContext || !apiKey) return null;

  const onAuthError = (error: unknown): void => {
    void handleApiAuthError(error, mainWindow, (key) => {
      runtime.apiKey = key;
    });
  };

  const t0 = performance.now();
  // 記憶コンテキスト構築(全件横断想起・心/開示バイアス)＋ローカル判別(B-15・ネットワーク0往復)。
  //   query 埋め込みは直後の判別と共有(B-14a)。失敗は medium に倒し会話を止めない。
  const memoryContext = await buildConversationMemory({ text, limit: 5 });
  const routerResult = await classifyTopicLocal(text, charContext.knowledgeDomains);
  const tMem1 = performance.now();

  // 二段生成(B-15b・**既定オン**・ENE_TWO_TIER=0 で無効化): 雑談=Haiku/難題=Sonnet。迷ったら Sonnet。
  // 既定ON はユーザ試聴判定の結果(2026-06-13・キャラ一貫性OKを確認)。
  const twoTier = process.env[TWO_TIER_ENABLED_ENV] !== '0';
  const tier = twoTier ? chooseModelTier(routerResult, text) : 'sonnet';
  const model = tier === 'haiku' ? MODEL_HAIKU : MODEL_SONNET;

  // 思考フィラー(設計憲法・問いの性質で判定)。投機経路では出さない(コミット前のちらつき回避・opts.playFiller)。
  if (opts.playFiller && shouldPlayThinkingFiller(routerResult, text)) runtime.playThinkingFiller?.();

  // 本会話。音声があれば**既定でストリーミング**(文単位で第一声を早める・B-06)。ENE_VOICE_STREAMING=0 で無効化。
  // 失敗時は非ストリーミングへフォールバック。既定ON はユーザ試聴判定の結果(2026-06-13)。
  const { tts, voiceConfig } = runtime;
  const streamingOn =
    Boolean(tts && voiceConfig) && process.env[VOICE_STREAMING_ENABLED_ENV] !== '0';
  let response: ConversationResponse;
  let audioStreamed = false;
  if (streamingOn && tts && voiceConfig) {
    try {
      response = await streamVoiceChat(
        text, charContext, memoryContext, routerResult, apiKey, model, tts, voiceConfig, mainWindow,
        signal, onFirstAudio,
      );
      audioStreamed = true; // ストリーミング中に音声は送出済み
    } catch (e) {
      if (signal.aborted) throw e; // 中断は破棄のため上位(coordinator)へ伝える(フォールバックしない)
      log.warn('voice streaming failed; falling back to non-streaming', { name: (e as Error).name });
      response = await chat(text, charContext, memoryContext, routerResult, apiKey, { onAuthError }, model);
    }
  } else {
    response = await chat(text, charContext, memoryContext, routerResult, apiKey, { onAuthError }, model);
  }

  // 計測ログ(ms のみ・§6.2)。total=生成全体 / mem+router=記憶＋判別 / response=Claude 往復。
  log.info(
    `turn latency: total=${Math.round(performance.now() - t0)}ms ` +
      `mem+router=${Math.round(tMem1 - t0)}ms response=${Math.round(performance.now() - tMem1)}ms` +
      (streamingOn ? ' (streaming)' : '') +
      (twoTier ? ` model=${tier}` : ''),
  );
  return { response, audioStreamed };
}

/**
 * 確定(コミット)。副作用=記憶書き込み/OSコマンド実行/誕生日記録/非ストリーミング発話。
 * **生成完了かつ非キャンセル時のみ**呼ぶ(投機が捨てられたら呼ばない=短期記憶を汚さない)。
 */
export async function commitTurn(
  text: string,
  response: ConversationResponse,
  audioStreamed: boolean,
  runtime: AppRuntime,
  mainWindow: BrowserWindow,
): Promise<ConversationResponse> {
  const speakOut = (spokenText: string, emo: EmotionLabel): void => {
    const { tts, voiceConfig } = runtime;
    if (tts && voiceConfig) void speakResponse(spokenText, emo, tts, voiceConfig, mainWindow);
  };

  // 1. user を短期記憶へ ＋ 関係の事実を記録(ターンが確定したら=コミット時・task_16)。
  await appendShortTerm({ role: 'user', text, timestamp: nowLocalIso(), extracted: false });
  await recordConversationTurn();
  runtime.lastActivityMs = Date.now(); // 自発発話の沈黙判定(P7)。直近のやりとり時刻を更新。

  // 5. assistant を短期記憶へ
  await appendShortTerm({ role: 'assistant', text: response.message, timestamp: nowLocalIso(), extracted: false });

  // 5b/5c. 短期上限の死守＋記憶抽出(背景・await しない)。apiKey はコミット時点で存在する。
  const { apiKey } = runtime;
  if (apiKey) {
    await enforceShortTermCap(makeLlmComplete(apiKey));
    requestExtraction(makeLlmComplete(apiKey));
  }

  // 6. OS コマンドなら実行(失敗時はキャラ口調フォールバックに差し替え＋エラー発話)。
  if (response.type === 'os_command') {
    const osResult = await executeOsCommand(response.command);
    if (!osResult.ok && osResult.message) {
      speakOut(osResult.message, 'neutral');
      return { type: 'chat', message: osResult.message };
    }
  }

  // 7. 誕生日当日に「おめでとう」等で触れられたら、祝われた事実を記録(設計書 §3.1 / §5.4)。
  if (runtime.charContext?.birthdayHint === 'today') {
    // 検出語は identity.json に外出し(§4.5・ハードコード禁止)。未定義なら祝い検出はしない。
    const keywords = runtime.charContext.identity.birthday?.congratsKeywords ?? [];
    if (keywords.some((w) => text.includes(w))) {
      await recordBirthdayCelebrated(todayLocalYmd().year);
    }
  }

  // 7b. 相手(ユーザー)の誕生日当日なら、祝った事実を記録する(P5・当日中の祝い直し防止)。
  //     誕生日ヒントは当日の最初のターンの揮発文脈に載る(=ここで祝う)。記録後は当年は再注入しない。
  //     best-effort:失敗しても会話に影響させない。userBirthday 未設定なら何もしない(短絡)。
  try {
    const semantic = await getSemantic();
    if (semantic.userBirthday) {
      const active = await loadOrCreateActiveCharacter();
      const today = todayLocalYmd();
      if (isUserBirthdayToday(semantic.userBirthday, active, today)) {
        await recordUserBirthdayCelebrated(today.year);
      }
    }
  } catch {
    // 記録失敗は無視(次ターンで再試行される)。
  }

  // 8. 非ストリーミング経路のみ、ここで確定応答を喋る(ストリーミングは送出済み・読みはルビ解決済)。
  if (!audioStreamed) {
    const emo: EmotionLabel = response.type === 'chat' ? (response.emotion ?? 'neutral') : 'neutral';
    speakOut(response.reading ?? response.message, emo);
  }
  return response;
}

// send-message の統合フロー(テキスト入力／非コアレッシングの音声経路・設計書 §4.2 / task_07 §7)。
// 生成→コミットを直列に行う(中断なし)。コアレッシング音声経路は VoiceTurnCoordinator が別途駆動する。
export async function handleSendMessage(
  text: string,
  runtime: AppRuntime,
  mainWindow: BrowserWindow,
): Promise<ConversationResponse> {
  if (!runtime.charContext || !runtime.apiKey) return NOT_READY;
  const gen = await generateResponse(text, runtime, mainWindow, NEVER_ABORT.signal, NOOP, { playFiller: true });
  if (!gen) return NOT_READY;
  return commitTurn(text, gen.response, gen.audioStreamed, runtime, mainWindow);
}
