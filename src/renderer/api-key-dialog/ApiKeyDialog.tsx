import React, { useState } from 'react';
import { getErrorMessage } from '../../main/api-key-error-messages';

// APIキー管理ダイアログ UI(設計書 §3.7)。
// 形式検証は同期(インライン)、疎通テスト・保存は window.eneApiKey 経由(main)。
// 形式チェックは Anthropic SDK を引き込まないよう Renderer 内にインライン化している
// (api-key-tester は SDK を import するため Renderer からは読まない)。

type TestStatus = 'idle' | 'testing' | 'success' | 'failed';

export function ApiKeyDialog(): React.ReactElement {
  const [key, setKey] = useState('');
  const [status, setStatus] = useState<TestStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const formatValid = key.startsWith('sk-ant-') && key.length >= 50;

  async function runTest(): Promise<boolean> {
    setStatus('testing');
    setErrorMessage(null);
    const result = await window.eneApiKey.testApiKey(key);
    if (result.ok) {
      setStatus('success');
      return true;
    }
    setStatus('failed');
    setErrorMessage(getErrorMessage(result.reason));
    return false;
  }

  async function handleTest(): Promise<void> {
    await runTest();
  }

  async function handleSave(): Promise<void> {
    const ok = await runTest();
    if (!ok) return;
    try {
      await window.eneApiKey.saveApiKey(key);
      void window.eneApiKey.closeDialog(true);
    } catch {
      setStatus('failed');
      setErrorMessage('保存に失敗しました。もう一度お試しください。');
    }
  }

  return (
    <div className="dialog">
      <h1>ENE をはじめる準備</h1>
      <p>ENE と会話するには、Anthropic の API キーが必要です。</p>

      <button className="link-button" onClick={() => void window.eneApiKey.openAnthropicConsole()}>
        ▶ Anthropic Console を開く
      </button>

      <ol className="steps">
        <li>Anthropic Console にサインアップ</li>
        <li>「API Keys」から新しいキーを作成</li>
        <li>利用にはクレジット購入が必要(無料枠あり)</li>
        <li>作成したキー(sk-ant-...)を下に貼り付け</li>
      </ol>

      <div className="key-input">
        <input
          type="password"
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            setStatus('idle');
            setErrorMessage(null);
          }}
          placeholder="sk-ant-..."
          spellCheck={false}
          autoComplete="off"
        />
        <button disabled={!formatValid || status === 'testing'} onClick={() => void handleTest()}>
          接続テスト
        </button>
      </div>

      <div className={`status status-${status}`}>
        {status === 'idle' && (key.length === 0 ? '未入力' : formatValid ? '入力済み' : '形式が正しくありません(sk-ant-… / 50文字以上)')}
        {status === 'testing' && '検証中...'}
        {status === 'success' && '✓ 接続できました'}
        {status === 'failed' && `✗ ${errorMessage ?? '失敗しました'}`}
      </div>

      <p className="note">
        ※ キーはあなたのPC内に暗号化保存されます
        <br />
        ※ Anthropic 以外には送信しません
      </p>

      <div className="buttons">
        <button className="cancel" onClick={() => void window.eneApiKey.closeDialog(false)}>
          キャンセル
        </button>
        <button className="save" disabled={!formatValid || status === 'testing'} onClick={() => void handleSave()}>
          保存して始める
        </button>
      </div>
    </div>
  );
}
