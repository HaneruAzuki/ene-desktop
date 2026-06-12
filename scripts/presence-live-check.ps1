# 存在感の改修(N-PRES-*)実API behavior チェックの実行スクリプト。
#
# 使い方(PowerShell):
#   $env:ANTHROPIC_API_KEY = "sk-ant-..."   # 自分の API キーを一時的に設定
#   .\scripts\presence-live-check.ps1
#
# tests/live/scenarios.json の各シナリオを実 Claude API に流し、トリミの回答を
# presence-live-results.md に書き出す。回答を Claude/あなたが読んで OK/NG を判定する。
# シナリオは tests/live/scenarios.json を編集して自由に追加・変更してよい。

if (-not $env:ANTHROPIC_API_KEY) {
  Write-Host "[!] ANTHROPIC_API_KEY が未設定です。先に設定してください:" -ForegroundColor Yellow
  Write-Host '    $env:ANTHROPIC_API_KEY = "sk-ant-..."'
  exit 1
}

$env:ENE_LIVE_TEST = "1"
Write-Host "実 API でトリミの応答を確認します(tests/live/scenarios.json)..." -ForegroundColor Cyan
npx vitest run tests/live --reporter verbose

if (Test-Path "presence-live-results.md") {
  Write-Host ""
  Write-Host "[OK] 回答を presence-live-results.md に書き出しました。" -ForegroundColor Green
  Write-Host "     このファイルを Claude に見せれば OK/NG を判定できます。"
}
