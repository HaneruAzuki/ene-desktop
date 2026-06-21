import { promises as fs } from 'node:fs';
import { existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '../logger';
import { getEngineUserDataDir, getPortableEngineUserDataDir } from './paths';
import {
  VOICE_ENGINE_MODELS_SUBDIR,
  VOICE_ENGINE_BERT_SUBDIR,
  VOICE_ENGINE_DEAD_PROXY,
} from '../constants';

// 音声エンジンのポータブル化＋完全オフライン化(N-17-13・実機 spike 検証済)。
//
// 課題: AivisSpeech エンジンは保存先 %APPDATA%\AivisSpeech-Engine を固定する(フラグ/設定/環境変数で
//   変えられない)。さらに起動のたびに AivisHub(api.aivis-project.com)へ接続を試み(既定モデルDL・
//   強制削除ルール・テレメトリ)、BERT を HuggingFace から実行時DLする。素のままでは「ローカル完結・
//   フォルダ削除で痕跡ゼロ・外部送信は Claude のみ」(§4.2/§4.3/§6.3)を破る。
//
// 対処(2軸):
//   1) 置き場: 起動時に %APPDATA%\AivisSpeech-Engine を**ポータブル data/voice/userdata へジャンクション**
//      (一時借用)し、終了時に外す。正常終了で %APPDATA% に痕跡ゼロ。標準版 AivisSpeech が同居する場合は
//      全体ジャンクション不可なので、torimi だけ `<uuid>.aivmx` を**ハードリンク**で持ち込み、BERT は相手の
//      再利用 or サブディレクトリ・ジャンクションで賄う(相手のモデル/設定は無改変)。
//   2) 通信: 子プロセスへ**死んだ proxy**＋offline フラグを渡し、エンジンの全 outbound を端末内で失敗させる。
//
// 設計: 純粋な判断(planEngineUserData)と副作用(prepare/cleanup)を分離し、判断を単体テスト対象にする
//   (N-17-12 の decideEngineAction/waitHealthy と同方針)。

// ジャンクション/ハードリンクは「リンクのみ」を消す。再帰削除は実体(ポータブル側/相手データ)へ
// 追従して破壊するため厳禁(spike で確認した Windows の地雷)。

export interface EngineUserDataInputs {
  /** %APPDATA%\AivisSpeech-Engine。 */
  appdataDir: string;
  /** data/voice/userdata(同梱 torimi＋BERT)。 */
  portableDir: string;
  /** appdataDir が存在するか。 */
  exists: boolean;
  /** appdataDir が我々の張ったジャンクションか(=前回起動の残骸)。 */
  isOurJunction: boolean;
  /** torimi の AIVM UUID(voice.json 由来)。共存時の配置に必要。null なら共存配置をしない。 */
  modelUuid: string | null;
  /** 共存時、相手の BertModelCaches が既に存在するか(あれば再利用=何も置かない)。 */
  sharedBertExists: boolean;
}

export type EngineUserDataMode = 'borrow' | 'coexist' | 'skip';

export interface EngineUserDataPlan {
  mode: EngineUserDataMode;
  /** 起動前に外す前回の残骸ジャンクション(リンクのみ)。 */
  staleJunctionToRemove: string | null;
  /** borrow: %APPDATA% 全体をポータブルへ向けるジャンクション。 */
  appdataJunction: { link: string; target: string } | null;
  /** coexist: torimi を相手 Models へ持ち込むハードリンク。 */
  modelHardlink: { link: string; source: string } | null;
  /** coexist: BERT をポータブルへ向けるサブディレクトリ・ジャンクション(相手に無い時のみ)。 */
  bertJunction: { link: string; target: string } | null;
}

/**
 * 状態から「何をするか」を決める(純粋・副作用なし)。
 * - 標準版なし(or 我々の残骸のみ) → borrow: 全体を一時借用。
 * - 標準版あり(実ディレクトリが占有) → coexist: torimi だけ持ち込む(UUID 不明なら skip=安全側)。
 */
export function planEngineUserData(i: EngineUserDataInputs): EngineUserDataPlan {
  const stale = i.isOurJunction ? i.appdataDir : null;
  // 「他者が占有」= 実在し、かつ我々のジャンクションでない(=標準版 AivisSpeech の実ディレクトリ)。
  const occupiedByOther = i.exists && !i.isOurJunction;

  if (!occupiedByOther) {
    return {
      mode: 'borrow',
      staleJunctionToRemove: stale,
      appdataJunction: { link: i.appdataDir, target: i.portableDir },
      modelHardlink: null,
      bertJunction: null,
    };
  }

  // 共存: 相手のデータ root は触れない。torimi だけ持ち込む。UUID が無ければ何もしない。
  if (!i.modelUuid) {
    return { mode: 'skip', staleJunctionToRemove: stale, appdataJunction: null, modelHardlink: null, bertJunction: null };
  }
  const modelsDir = join(i.appdataDir, VOICE_ENGINE_MODELS_SUBDIR);
  const bertDir = join(i.appdataDir, VOICE_ENGINE_BERT_SUBDIR);
  return {
    mode: 'coexist',
    staleJunctionToRemove: stale,
    appdataJunction: null,
    modelHardlink: {
      link: join(modelsDir, `${i.modelUuid}.aivmx`),
      source: join(i.portableDir, VOICE_ENGINE_MODELS_SUBDIR, `${i.modelUuid}.aivmx`),
    },
    // 相手が BERT を持っていれば再利用(何も置かない)。無ければポータブルの BERT を junction で見せる。
    bertJunction: i.sharedBertExists
      ? null
      : { link: bertDir, target: join(i.portableDir, VOICE_ENGINE_BERT_SUBDIR) },
  };
}

/** 終了時に外すリンクの記録(prepare が返し、cleanup が消費する)。 */
export interface EngineUserDataHandle {
  /** リンクのみ rmdir するジャンクション。 */
  junctionsToRemove: string[];
  /** unlink するハードリンク。 */
  hardlinksToRemove: string[];
}

function isJunction(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/** ジャンクションの「リンクのみ」を削除する(中身=向き先へ追従しない)。冪等。 */
async function removeLinkOnly(p: string): Promise<void> {
  try {
    if (existsSync(p)) await fs.rmdir(p);
  } catch (e) {
    log.warn('engine-userdata: rmdir(link) failed', { name: (e as Error).name });
  }
}

async function gatherInputs(modelUuid: string | null): Promise<EngineUserDataInputs> {
  const appdataDir = getEngineUserDataDir();
  const portableDir = getPortableEngineUserDataDir();
  const exists = existsSync(appdataDir);
  return {
    appdataDir,
    portableDir,
    exists,
    isOurJunction: exists && isJunction(appdataDir),
    modelUuid,
    sharedBertExists: existsSync(join(appdataDir, VOICE_ENGINE_BERT_SUBDIR)),
  };
}

/**
 * エンジン起動前にデータ root を用意する(一時借用 or 共存配置)。spawn の前に必ず呼ぶ。
 * best-effort: 失敗しても投げない(音声はベストエフォート・呼び出し側はそのまま起動を試み、
 * 立たなければテキストのみへフォールバックする)。返り値は終了時に cleanup へ渡す。
 */
export async function prepareEngineUserData(modelUuid: string | null): Promise<EngineUserDataHandle> {
  const handle: EngineUserDataHandle = { junctionsToRemove: [], hardlinksToRemove: [] };
  try {
    const plan = planEngineUserData(await gatherInputs(modelUuid));

    if (plan.staleJunctionToRemove) {
      await removeLinkOnly(plan.staleJunctionToRemove);
      log.info('engine-userdata: removed stale junction from a previous run (self-heal)');
    }

    if (plan.appdataJunction) {
      // 同梱物が未配置でもジャンクション先(空 dir)は作る=エンジンは起動し、声が出ないだけ。
      await fs.mkdir(plan.appdataJunction.target, { recursive: true });
      await fs.symlink(plan.appdataJunction.target, plan.appdataJunction.link, 'junction');
      handle.junctionsToRemove.push(plan.appdataJunction.link);
      log.info('engine-userdata: borrowing %APPDATA% engine dir via junction');
    }

    if (plan.bertJunction) {
      await fs.symlink(plan.bertJunction.target, plan.bertJunction.link, 'junction');
      handle.junctionsToRemove.push(plan.bertJunction.link);
      log.info('engine-userdata: coexist BERT via subdir junction');
    }

    if (plan.modelHardlink) {
      await placeCoexistModel(plan.modelHardlink, handle);
    }
  } catch (e) {
    log.warn('engine-userdata: prepare failed (continuing best-effort)', { name: (e as Error).name });
  }
  return handle;
}

/** 共存時、torimi を相手 Models へハードリンク(同一ボリューム・管理者不要)。別ボリュームはコピー。 */
async function placeCoexistModel(
  link: { link: string; source: string },
  handle: EngineUserDataHandle,
): Promise<void> {
  if (!existsSync(link.source)) {
    log.warn('engine-userdata: portable model missing; coexist model not placed');
    return;
  }
  // 同 UUID(我々の残骸/同名)が既にあれば外してから張り直す(冪等)。UUID は torimi 固有=我々の物。
  if (existsSync(link.link)) {
    try {
      await fs.unlink(link.link);
    } catch {
      /* best-effort */
    }
  }
  try {
    await fs.link(link.source, link.link); // ハードリンク=実体複製なし・即時
  } catch {
    await fs.copyFile(link.source, link.link); // 別ボリューム等はコピーにフォールバック
  }
  handle.hardlinksToRemove.push(link.link);
  log.info('engine-userdata: coexist model placed (hardlink/copy)');
}

/**
 * 終了時に、用意したリンク/ハードリンクだけを外す(向き先=ポータブル側/相手データは消さない)。冪等。
 * ハードリンク→ジャンクションの順(ハードリンクは中身を残し名前だけ消える)。
 */
export async function cleanupEngineUserData(handle: EngineUserDataHandle): Promise<void> {
  for (const link of handle.hardlinksToRemove) {
    try {
      if (existsSync(link)) await fs.unlink(link);
    } catch (e) {
      log.warn('engine-userdata: unlink(hardlink) failed', { name: (e as Error).name });
    }
  }
  for (const link of handle.junctionsToRemove) {
    await removeLinkOnly(link);
  }
}

/**
 * エンジン子プロセスに渡す環境(完全オフライン化)。
 * - 死んだ proxy: エンジンの全 outbound(AivisHub の既定モデルDL/強制削除ルール/テレメトリ)を
 *   端末内で connection refused にする。ローカル合成(127.0.0.1)は NO_PROXY で除外。
 * - HF_HUB_OFFLINE / TRANSFORMERS_OFFLINE: BERT を HuggingFace から取りに行かせない(同梱を使う)。
 * httpx/requests が proxy/offline を尊重することを spike で実証済(全 AivisHub 通信が ConnectError)。
 */
export function engineOfflineEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HTTP_PROXY: VOICE_ENGINE_DEAD_PROXY,
    HTTPS_PROXY: VOICE_ENGINE_DEAD_PROXY,
    http_proxy: VOICE_ENGINE_DEAD_PROXY,
    https_proxy: VOICE_ENGINE_DEAD_PROXY,
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost',
    HF_HUB_OFFLINE: '1',
    TRANSFORMERS_OFFLINE: '1',
  };
}
