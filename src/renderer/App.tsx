import React from 'react';

// task_00 の最小コンポーネント。
// 透過ウィンドウが表示されていることを目視確認できるよう、
// 中央に半透明のプレースホルダを 1 つだけ置く(周囲は透明=デスクトップが透ける)。
// キャラ表示・吹き出し・入力欄は後続タスク(task_08)で実装する。
export function App(): React.ReactElement {
  return (
    <div className="app-root">
      <div className="placeholder">ENE</div>
    </div>
  );
}
