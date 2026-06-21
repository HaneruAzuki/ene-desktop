; ENE (Project_ENE) カスタム NSIS インクルード(N-REL-2)。
; electron-builder の nsis.include から読まれ、アンインストーラへ customUnInstall マクロを差し込む。
;
; 目的: アンインストールで「再生成可能なゴミ」を残さない。最大のゴミは AivisSpeech エンジンデータ
;       (%APPDATA%\AivisSpeech-Engine ・最大 ~1.6GB)。これは electron-builder の deleteAppDataOnUninstall
;       では消えない(第三者名のディレクトリのため)。ここで明示的に除去する。
;
; ユーザーの記憶(userData = %APPDATA%\ene-desktop)は deleteAppDataOnUninstall:false で **既定保持**。
;       作り直せないプロダクトの心臓ゆえ「不具合→アンインストール→再インストール」で消してはならない。
;       完全削除はアプリ内の「完全に削除」操作で行う(再インストールで戻せるようにするため・N-REL-2)。
;
; 共存(標準版 AivisSpeech 同居)への配慮:
;   アプリは初回に、エンジンディレクトリを ENE が**専有作成した場合のみ**マーカー
;   "$APPDATA\AivisSpeech-Engine\.ene-owns-engine" を作る(engine-userdata.ts・ステージ④)。
;   - マーカーあり → ENE 専有 → ディレクトリごと削除して良い。
;   - マーカーなし → 標準版と共有 → **丸ごと削除しない**(相手のモデル/設定を壊さないため)。
;     共存時に ENE が置いた torimi(UUID)だけを個別除去する処理は、アプリが残す cleanup リストを
;     読んで消す形でステージ⑥にて精緻化する(実機 NSIS 検証が必要)。

!macro customUnInstall
  ; --- AivisSpeech エンジンデータの除去(共存セーフ) ---
  ; マーカーがある時(= ENE 専有)だけ丸ごと削除。無い時(= 共存/不明)は安全側で触らない。
  IfFileExists "$APPDATA\AivisSpeech-Engine\.ene-owns-engine" 0 +2
    RMDir /r "$APPDATA\AivisSpeech-Engine"

  ; ユーザーの記憶(%APPDATA%\ene-desktop)はここでは削除しない(既定保持・上記コメント参照)。
!macroend
