import { app } from 'electron';

// 多重起動防止(設計書 §7.1 ステップ1)。
// app.requestSingleInstanceLock() の薄いラッパ。
// 取得失敗(既に別プロセスが起動中)の場合 false を返す。
// 呼出側は false なら app.quit() で静かに終了する。

/**
 * 単一インスタンスロックの取得を試みる。
 * @returns 取得できれば true、既に他プロセスが保持していれば false
 */
export function acquireSingleInstanceLock(): boolean {
  return app.requestSingleInstanceLock();
}
