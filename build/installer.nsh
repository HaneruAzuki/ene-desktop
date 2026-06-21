; ENE (Project_ENE) カスタム NSIS インクルード(N-REL-2)。
; electron-builder の nsis.include から読まれ、アンインストーラへ customUnInstall マクロを差し込む。
;
; 目的: アンインストールで「再生成可能なゴミ」を残さない。最大のゴミは AivisSpeech エンジンデータ
;       (%APPDATA%\AivisSpeech-Engine ・最大 ~1.6GB)。これは electron-builder の deleteAppDataOnUninstall
;       では消えない(第三者名のディレクトリのため)。ここで明示的に除去する。
;
; ユーザーの記憶(userData = %APPDATA%\project-ene)は deleteAppDataOnUninstall:false で **既定保持**。
;       作り直せないプロダクトの心臓ゆえ「不具合→アンインストール→再インストール」で消してはならない。
;       完全削除はアプリ内の「完全に削除」操作で行う(再インストールで戻せるようにするため・N-REL-2)。
;
; 共存(標準版 AivisSpeech 同居)への配慮(engine-userdata.ts と文字列で連携):
;   - "$APPDATA\AivisSpeech-Engine\.ene-owns-engine" あり → ENE が専有作成 → ディレクトリごと削除。
;   - 上記なし＆ ".ene-cleanup" あり → 標準版と共存 → ENE が置いた行(torimi/BERT の相対パス)だけ個別削除。
;     .ene-cleanup は UTF-16LE+BOM・CRLF 区切り・"\" 区切りの相対パス(Unicode NSIS の FileRead と整合)。
;   ⚠️ 本マクロは実機 NSIS(electron-builder package)でのみ走る=要実機検証(N-REL-2 残課題⑥:
;      とくに .ene-cleanup の文字コード判定と個別削除の経路)。

; .ene-cleanup の各行末尾の改行(\r / \n)を除くヘルパ(アンインストーラ用)。
Function un.TrimNewlines
  Exch $R0
  Push $R1
  Push $R2
  StrCpy $R1 0
  loop:
    IntOp $R1 $R1 - 1
    StrCpy $R2 $R0 1 $R1
    StrCmp $R2 "$\r" loop
    StrCmp $R2 "$\n" loop
    IntOp $R1 $R1 + 1
    IntCmp $R1 0 done
    StrCpy $R0 $R0 $R1
  done:
  Pop $R2
  Pop $R1
  Exch $R0
FunctionEnd

!macro customUnInstall
  StrCpy $0 "$APPDATA\AivisSpeech-Engine"
  ${If} ${FileExists} "$0\.ene-owns-engine"
    ; ENE が専有作成 → ディレクトリごと削除して良い
    RMDir /r "$0"
  ${ElseIf} ${FileExists} "$0\.ene-cleanup"
    ; 標準版 AivisSpeech と共存 → ENE が置いたファイル/ディレクトリだけ個別削除(相手は無改変)
    ClearErrors
    FileOpen $1 "$0\.ene-cleanup" r
    ${IfNot} ${Errors}
      ${Do}
        ClearErrors
        FileRead $1 $2
        ${If} ${Errors}
          ${ExitDo}
        ${EndIf}
        Push $2
        Call un.TrimNewlines
        Pop $2
        ${If} $2 != ""
          StrCpy $3 "$0\$2"
          ${If} ${FileExists} "$3\*.*"
            RMDir /r "$3"   ; ディレクトリ(例: BertModelCaches)
          ${Else}
            Delete "$3"     ; ファイル(例: Models\<uuid>.aivmx)
          ${EndIf}
        ${EndIf}
      ${Loop}
      FileClose $1
      Delete "$0\.ene-cleanup"
      RMDir "$0\Models"   ; torimi を消して空になったら除去(相手のモデルが残れば失敗=無害)
      RMDir "$0"          ; エンジン dir 自体も空なら除去(相手が居れば失敗=無害)
    ${EndIf}
  ${EndIf}
  ; ユーザーの記憶(%APPDATA%\project-ene)はここでは削除しない(既定保持・上記コメント参照)。
!macroend
