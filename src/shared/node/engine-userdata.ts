import { promises as fs } from 'node:fs';
import { existsSync, lstatSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { log } from '../logger';
import { getEngineUserDataDir, getPortableEngineUserDataDir } from './paths';
import {
  VOICE_ENGINE_MODELS_SUBDIR,
  VOICE_ENGINE_BERT_SUBDIR,
  VOICE_ENGINE_DEAD_PROXY,
} from '../constants';

// 音声エンジンのポータブル化＋完全オフライン化(N-17-13 / N-REL-2・実機 spike 検証済)。
//
// 課題: AivisSpeech エンジンは保存先 %APPDATA%\AivisSpeech-Engine を固定する(フラグ/設定/環境変数で
//   変えられない)。さらに起動のたびに AivisHub(api.aivis-project.com)へ接続を試み(既定モデルDL・
//   強制削除ルール・テレメトリ)、BERT を HuggingFace から実行時DLする。
//
// 対処(NSIS 配布・N-REL-2):
//   1) 置き場: 起動時に同梱の torimi＋BERT を %APPDATA%\AivisSpeech-Engine へ**直接配置**する。
//      同一ボリュームは**ハードリンク**(実体複製なし・即時)、別ボリュームはコピー。いずれも place-if-missing で冪等。
//      ジャンクションは廃止(NSIS で原目的=無痕跡/可搬 が消え、脆い機構を公開物に残さない)。除去は installer.nsh:
//      - 専有作成(標準版 AivisSpeech 無し)時はマーカー .ene-owns-engine を書く → アンインストールで dir ごと削除。
//      - 共存(標準版あり)時は torimi(<uuid>.aivmx)だけ足し、置いたファイルを .ene-cleanup に記録(相手は無改変)。
//   2) 通信: 子プロセスへ**死んだ proxy**＋offline フラグを渡し、エンジンの全 outbound を端末内で失敗させる。
//
// 設計: 純粋な判断(planEngineUserData)と副作用(prepareEngineUserData)を分離し、判断を単体テスト対象にする。
//
// ⚠️ マーカー名は installer.nsh(アンインストールフック)と**文字列一致**で連携する(下記 const)。変更時は両方直す。

/** 専有作成マーカー。これがあれば %APPDATA% のエンジン dir は ENE 専有=アンインストールで dir ごと削除可。 */
export const ENGINE_OWNS_MARKER = '.ene-owns-engine';
/** 共存時に ENE が置いたファイル一覧(相対パス・改行区切り)。アンインストール時に個別削除する。 */
export const ENGINE_CLEANUP_LIST = '.ene-cleanup';

export type EngineUserDataMode = 'create-owned' | 'ensure-owned' | 'coexist' | 'skip';

export interface EngineUserDataInputs {
  /** %APPDATA%\AivisSpeech-Engine。 */
  appdataDir: string;
  /** 同梱元 data/voice/userdata。 */
  portableDir: string;
  /** appdataDir が存在するか。 */
  dirExists: boolean;
  /** .ene-owns-engine マーカーがあるか(= ENE が専有作成済)。 */
  weOwn: boolean;
  /** BertModelCaches が既存か(共存時=再利用して BERT を置かない)。 */
  sharedBertExists: boolean;
  /** torimi の AIVM UUID(voice.json 由来)。null なら配置しない。 */
  modelUuid: string | null;
}

export interface EngineUserDataPlan {
  mode: EngineUserDataMode;
  writeOwnsMarker: boolean;
  writeCleanupList: boolean;
  /** torimi の配置(src=同梱元 / dest=%APPDATA% 側)。place-if-missing。 */
  model: { src: string; dest: string } | null;
  /** BERT の配置(共存で相手にあれば null=再利用)。 */
  bert: { src: string; dest: string } | null;
}

/**
 * 状態から配置内容を決める(純粋・副作用なし)。
 * - dir 無し → create-owned(専有作成・マーカーを書く・torimi＋BERT)
 * - dir 有り＆我々のマーカー有り → ensure-owned(不足分のみ補う)
 * - dir 有り＆マーカー無し → coexist(標準版同居・torimi だけ足す・BERT は相手にあれば再利用)
 * - UUID 不明 → skip(安全側=何もしない)
 */
export function planEngineUserData(i: EngineUserDataInputs): EngineUserDataPlan {
  if (!i.modelUuid) {
    return { mode: 'skip', writeOwnsMarker: false, writeCleanupList: false, model: null, bert: null };
  }
  const model = {
    src: join(i.portableDir, VOICE_ENGINE_MODELS_SUBDIR, `${i.modelUuid}.aivmx`),
    dest: join(i.appdataDir, VOICE_ENGINE_MODELS_SUBDIR, `${i.modelUuid}.aivmx`),
  };
  const bert = {
    src: join(i.portableDir, VOICE_ENGINE_BERT_SUBDIR),
    dest: join(i.appdataDir, VOICE_ENGINE_BERT_SUBDIR),
  };
  if (!i.dirExists) {
    return { mode: 'create-owned', writeOwnsMarker: true, writeCleanupList: false, model, bert };
  }
  if (i.weOwn) {
    return { mode: 'ensure-owned', writeOwnsMarker: false, writeCleanupList: false, model, bert };
  }
  return {
    mode: 'coexist',
    writeOwnsMarker: false,
    writeCleanupList: true,
    model,
    bert: i.sharedBertExists ? null : bert,
  };
}

function isJunction(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

async function gatherInputs(modelUuid: string | null): Promise<EngineUserDataInputs> {
  const appdataDir = getEngineUserDataDir();
  const portableDir = getPortableEngineUserDataDir();
  const dirExists = existsSync(appdataDir);
  return {
    appdataDir,
    portableDir,
    dirExists,
    weOwn: existsSync(join(appdataDir, ENGINE_OWNS_MARKER)),
    sharedBertExists: existsSync(join(appdataDir, VOICE_ENGINE_BERT_SUBDIR)),
    modelUuid,
  };
}

/** ファイルをハードリンク(同一ボリューム=複製なし・即時)。別ボリュームはコピーにフォールバック。 */
async function linkOrCopyFile(src: string, dest: string): Promise<void> {
  try {
    await fs.link(src, dest);
  } catch {
    await fs.copyFile(src, dest);
  }
}

/** ディレクトリツリーを再帰的にハードリンク(各ファイル)。別ボリュームは各ファイルをコピー。 */
async function linkOrCopyTree(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    if (entry.isDirectory()) await linkOrCopyTree(s, d);
    else await linkOrCopyFile(s, d);
  }
}

/** src を dest へ配置(place-if-missing)。配置したら true。既存/ src 無しは false。 */
async function placeAsset(src: string, dest: string): Promise<boolean> {
  if (existsSync(dest)) return false; // 冪等: 既にあれば触らない
  if (!existsSync(src)) {
    log.warn('engine-userdata: bundled asset missing', { name: src });
    return false;
  }
  await fs.mkdir(dirname(dest), { recursive: true });
  if (lstatSync(src).isDirectory()) await linkOrCopyTree(src, dest);
  else await linkOrCopyFile(src, dest);
  return true;
}

/**
 * エンジン起動前に、同梱の torimi＋BERT を %APPDATA%\AivisSpeech-Engine へ配置する(spawn 前に必ず呼ぶ)。
 * best-effort: 失敗しても投げない(未配置でもエンジンは起動し、声が出ないだけ=テキストへフォールバック)。
 * 配置は永続(per-exit cleanup は廃止)。除去はアンインストール時に installer.nsh が行う。
 */
export async function prepareEngineUserData(modelUuid: string | null): Promise<void> {
  try {
    const inputs = await gatherInputs(modelUuid);

    // 旧版(ジャンクション era)の残骸があれば外す(直接配置への移行の自己修復・リンクのみ除去)。
    if (inputs.dirExists && isJunction(inputs.appdataDir)) {
      try {
        await fs.rmdir(inputs.appdataDir);
      } catch {
        /* best-effort */
      }
      inputs.dirExists = false;
      inputs.weOwn = false;
      inputs.sharedBertExists = false;
      log.info('engine-userdata: removed legacy junction (migrating to direct placement)');
    }

    const plan = planEngineUserData(inputs);
    if (plan.mode === 'skip') {
      log.warn('engine-userdata: model uuid unknown; placement skipped');
      return;
    }
    await fs.mkdir(inputs.appdataDir, { recursive: true });

    const placed: string[] = [];
    if (plan.model && (await placeAsset(plan.model.src, plan.model.dest))) {
      placed.push(relative(inputs.appdataDir, plan.model.dest));
    }
    if (plan.bert && (await placeAsset(plan.bert.src, plan.bert.dest))) {
      placed.push(relative(inputs.appdataDir, plan.bert.dest));
    }

    if (plan.writeOwnsMarker) {
      await fs.writeFile(join(inputs.appdataDir, ENGINE_OWNS_MARKER), '');
    }
    if (plan.writeCleanupList && plan.model) {
      // 共存: ENE が置いたファイル(torimi ＋ 置いた場合の BERT)を記録 → アンインストール時に installer.nsh が
      // 1行ずつ読んで個別削除する(相手の標準版 AivisSpeech のファイルは触らない)。
      // エンコーディングは UTF-16LE + BOM:electron-builder の NSIS は Unicode ビルドで、FileRead は BOM から
      // 文字コードを判定するため(UTF-8 だと化ける)。相対パスは Windows の "\" 区切り=NSIS と一致。CRLF 区切り。
      const managed = [relative(inputs.appdataDir, plan.model.dest)];
      if (plan.bert) managed.push(relative(inputs.appdataDir, plan.bert.dest));
      // 先頭に BOM(U+FEFF)を付け 'utf16le' で書くと UTF-16LE+BOM になる(Node は utf16le で BOM を自動付与しない)。
      const body = '﻿' + managed.join('\r\n') + '\r\n';
      await fs.writeFile(join(inputs.appdataDir, ENGINE_CLEANUP_LIST), body, 'utf16le');
    }
    log.info(`engine-userdata: ready (${plan.mode}; placed ${placed.length} item(s))`);
  } catch (e) {
    log.warn('engine-userdata: prepare failed (continuing best-effort)', { name: (e as Error).name });
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
