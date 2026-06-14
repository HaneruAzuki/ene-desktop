import { useEffect, useRef, type MutableRefObject } from 'react';

// クリックスルー判定(イベント駆動・2026-06 再設計 / 旧 use-click-through.ts を置換)。
//
// 旧実装は「描画後バッファの readPixels(GPU)＋複数の矩形/中央起点＋ポーリング＋ハートビート」で
// 当たり判定を毎フレーム“導出”していたため、GPU 状態やサンプリングのズレで固着・フリップが頻発した。
// 本実装の判定根拠は2つだけ:
//   ・UI(吹き出し/バー/設定/ログ)= DOM のヒットテスト(e.target.closest('[data-interactive]'))。
//   ・トリミ本体 = 描画フレームのシルエット(VrmRenderer.isOpaqueAt・hitTestRef 経由)。
//   起点は「透過(クリックスルー)」。上記いずれかに乗った時だけ非透過へ。
//   ・forward:true により無視中でも mousemove は届き続ける ⇒ 「無視で固まって二度と復帰しない」自己ロックが
//     構造的に起きない(ハートビート等の対症療法が不要)。
//   ・ボタン押下中(=ドラッグ中)はカーソル位置に関わらず非透過を維持し、途中で透過に落ちる事故を防ぐ。
//   ・離脱検知は使わない(透明窓で mouseleave/blur が不安定)。代わりに「一定時間 操作が無ければ畳む」アイドル
//     退避(BAR_IDLE_HIDE_MS → onIdle)。窓枠に接したシルエット上から窓外へ抜けて off 評価が来ない場合も、
//     操作が止まれば確実に畳まれる(=縁取り不要)。畳む範囲(バー/入力/forceOpen)と「入力中は畳まない」判定は
//     App 側(onIdle)が行う。打鍵でもタイマーを延長するのでタイピング中は発火しない。

/** バーのちらつき防止: トリミ本体とバーの間にわずかな隙間があっても、離脱判定をこの ms だけ遅らせる。 */
const BAR_LEAVE_DELAY_MS = 120;

/**
 * バーのアイドル退避(ms)。この時間マウスが動かなければ操作バー/入力(ホバー由来)を畳む。
 * 「止まった=操作していない」ので片付ける目的に加え、シルエットが窓枠に接していてマウスが窓外へ抜け、
 * off 評価が来ないまま固着したバーも、これで自己回復する(縁取り=幾何の不感帯が不要になる)。
 * 短いほど固着が早く消えるが、ホバー中に少し止めただけでも消えやすい。1.5〜3秒が目安。
 */
const BAR_IDLE_HIDE_MS = 2000;

export function useInteractionRouting(
  setBarHovered: (hovered: boolean) => void,
  // トリミ本体の当たり判定(シルエット)。レンダラの isOpaqueAt を差した ref。矩形ではなく実輪郭で判定する。
  hitTestRef?: MutableRefObject<((x: number, y: number) => boolean) | null>,
  // アイドル(一定時間 操作なし)で呼ぶ。App 側でテキスト有無を見て、空ならバー/入力/forceOpen を畳む。
  onIdle?: () => void,
): void {
  // setter は参照が安定(useState の setter)だが、念のため ref 経由で最新を読む(effect の再実行を避ける)。
  const setBarRef = useRef(setBarHovered);
  setBarRef.current = setBarHovered;
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    let lastIgnore: boolean | null = null;
    let barLeaveTimer: ReturnType<typeof setTimeout> | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const applyIgnore = (ignore: boolean): void => {
      if (lastIgnore !== ignore) {
        lastIgnore = ignore;
        void window.ene.setIgnoreMouseEvents(ignore);
      }
    };
    const setBar = (over: boolean): void => {
      if (over) {
        if (barLeaveTimer) {
          clearTimeout(barLeaveTimer);
          barLeaveTimer = null;
        }
        setBarRef.current(true);
      } else if (!barLeaveTimer) {
        barLeaveTimer = setTimeout(() => {
          barLeaveTimer = null;
          setBarRef.current(false);
        }, BAR_LEAVE_DELAY_MS);
      }
    };

    // 起点は透過(クリックスルー)。トリミ(ヒットボックス)に乗って初めて操作可能になる。
    applyIgnore(true);

    // アイドル退避タイマー: マウス/キー操作のたびに張り直し、無操作が続いたら onIdle を呼ぶ
    //   (App 側でテキスト有無を見て、空ならバー・入力・forceOpen をまとめて畳む)。
    const armIdle = (): void => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => onIdleRef.current?.(), BAR_IDLE_HIDE_MS);
    };

    const onMove = (e: MouseEvent): void => {
      const x = e.clientX;
      const y = e.clientY;
      const btn = e.buttons;
      const t = e.target as Element | null;
      // 操作UI(吹き出し/バー/設定/ログ)は data-interactive、トリミ本体はシルエット(isOpaqueAt)で決める。
      const onIsland = !!t?.closest?.('[data-interactive]');
      const onChar = hitTestRef?.current?.(x, y) ?? false;
      const interactive = onIsland || onChar || btn !== 0; // ドラッグ中は位置に関わらず非透過
      applyIgnore(!interactive);
      // 操作バーの出現: バー上(data-hitbox)か、トリミ本体(シルエット)にカーソルがある間。
      const onBar = onChar || !!t?.closest?.('[data-hitbox]');
      setBar(onBar);

      armIdle(); // マウスが動いた=アイドルタイマーを張り直す
    };
    // 離脱は「カーソルがシルエット/UIから外れる(onMove の off 評価)」＋「アイドル退避」で畳む。
    //   document.mouseleave / window blur は透明窓で発火が不安定な上、blur は他アプリへフォーカスが移るたびに
    //   飛んで「トリミ上なのにバーが消える/操作不能」を起こすため使わない。
    window.addEventListener('mousemove', onMove);
    window.addEventListener('keydown', armIdle); // 打鍵もアイドル延長(タイピング中は発火しない)
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('keydown', armIdle);
      if (barLeaveTimer) clearTimeout(barLeaveTimer);
      if (idleTimer) clearTimeout(idleTimer);
    };
  }, [hitTestRef]);
}
