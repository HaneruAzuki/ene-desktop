import { screen, type BrowserWindow } from 'electron';
import { getWindowPositionPath } from '../../shared/node/paths';
import { readJson, writeJson } from '../../shared/node/json-store';
import { WINDOW_WIDTH, WINDOW_HEIGHT, WINDOW_EDGE_MARGIN } from '../../shared/constants';

// ウィンドウ位置の管理(設計書 §8.1 / §8.3)。
// electron に依存しない純粋関数(計算・補正)と、electron 依存のラッパに分ける。

export interface Position {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const WINDOW_SIZE = { width: WINDOW_WIDTH, height: WINDOW_HEIGHT };

/** 作業領域の右下にウィンドウを置く既定位置を計算する(純粋関数)。 */
export function calculateDefaultPosition(workArea: Rect, winSize = WINDOW_SIZE): Position {
  return {
    x: workArea.x + workArea.width - winSize.width - WINDOW_EDGE_MARGIN,
    y: workArea.y + workArea.height - winSize.height - WINDOW_EDGE_MARGIN,
  };
}

/**
 * 位置がいずれかのディスプレイ内に収まるよう補正する(純粋関数)。
 * - 左上点を含むディスプレイがあれば、そのディスプレイ内にウィンドウ全体が収まるようクランプ。
 * - どのディスプレイにも含まれなければ(画面外/モニタ取り外し)、先頭ディスプレイの既定位置へ。
 */
export function clampToVisible(pos: Position, winSize: { width: number; height: number }, displays: Rect[]): Position {
  if (displays.length === 0) return pos;
  const containing = displays.find(
    (d) => pos.x >= d.x && pos.x < d.x + d.width && pos.y >= d.y && pos.y < d.y + d.height,
  );
  if (!containing) {
    return calculateDefaultPosition(displays[0] as Rect, winSize);
  }
  const maxX = containing.x + containing.width - winSize.width;
  const maxY = containing.y + containing.height - winSize.height;
  return {
    x: Math.min(Math.max(pos.x, containing.x), Math.max(containing.x, maxX)),
    y: Math.min(Math.max(pos.y, containing.y), Math.max(containing.y, maxY)),
  };
}

// --- electron 依存ラッパ ---

/** 主ディスプレイ右下の既定位置(electron screen 使用)。 */
export function getDefaultPosition(): Position {
  const { workArea } = screen.getPrimaryDisplay();
  return calculateDefaultPosition(workArea);
}

/** 保存位置を画面内に補正して返す(electron screen 使用)。 */
export function clampPositionToScreen(pos: Position): Position {
  const displays = screen.getAllDisplays().map((d) => d.workArea);
  return clampToVisible(pos, WINDOW_SIZE, displays);
}

export async function saveWindowPosition(x: number, y: number): Promise<void> {
  await writeJson(getWindowPositionPath(), { x, y });
}

export async function loadWindowPosition(): Promise<Position | null> {
  return readJson<Position>(getWindowPositionPath());
}

/** キャラ右クリック「位置をリセット」で呼ぶ(既定の右下へ戻す)。 */
export function resetToDefaultPosition(window: BrowserWindow): void {
  const pos = getDefaultPosition();
  window.setBounds({ x: pos.x, y: pos.y, width: WINDOW_WIDTH, height: WINDOW_HEIGHT });
  void saveWindowPosition(pos.x, pos.y);
}
