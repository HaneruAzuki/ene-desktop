# 第三者ソフトウェア・素材のライセンス表記(Third-Party Notices)

本ソフトウェア「魚川トリミ」(コードネーム ENE / バージョン 0.1.0)は、以下の第三者の
ソフトウェア・モデル・音声素材を利用・同梱しています。各コンポーネントの著作権は
それぞれの権利者に帰属し、以下のライセンス条件のもとで再配布されています。

本ファイルは配布物(`Torimi.exe` と同じフォルダ)に同梱され、製品内「設定 → このアプリについて」
からも音声素材のクレジットを確認できます。

> ライセンスは改定され得ます。再配布前に各公式の最新条項を確認してください。
> 完全な分析は開発リポジトリの `docs/B_dependency_license_audit.md` を参照。

---

## 1. 同梱ソフトウェアライブラリ

| コンポーネント | ライセンス | 著作権表示 |
|---|---|---|
| React / React-DOM | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| Electron ランタイム | MIT | Copyright (c) Electron contributors / Copyright (c) 2013-2020 GitHub Inc. |
| three.js | MIT | Copyright © 2010-2024 three.js authors |
| @pixiv/three-vrm | MIT | Copyright (c) 2019-2026 pixiv Inc. |
| electron-log | MIT | Copyright (c) 2016 Alexey Prokhorov |
| @anthropic-ai/sdk | MIT | Copyright 2023 Anthropic, PBC. |
| @huggingface/transformers (Transformers.js) | Apache-2.0 | Copyright (c) Hugging Face Inc. |
| onnxruntime-node | MIT | Copyright (c) Microsoft Corporation |

MIT ライセンスの全文は本ファイル §5、Apache-2.0 は §6 を参照。

---

## 2. 同梱 AI モデル

| モデル | 用途 | ライセンス | 入手元 |
|---|---|---|---|
| Whisper small (onnx-community) | 音声認識(STT) | MIT(OpenAI Whisper 由来) | https://huggingface.co/onnx-community/whisper-small |
| ruri-v3-310m (cl-nagoya) | 文埋め込み(記憶検索) | Apache-2.0 | https://huggingface.co/cl-nagoya/ruri-v3-310m |
| Silero VAD v4 | 発話区間検出 | MIT(© Silero Team) | https://github.com/snakers4/silero-vad |

---

## 3. 音声合成エンジン — AivisSpeech Engine(LGPL-3.0)

- **ライセンス**:GNU Lesser General Public License v3.0(LGPL-3.0)
- **著作権**:© Aivis Project(VOICEVOX ENGINE 由来)
- **ソースコード**:https://github.com/Aivis-Project/AivisSpeech-Engine
- **VOICEVOX ENGINE**:https://github.com/VOICEVOX/voicevox_engine

本ソフトウェアは AivisSpeech Engine を **独立した別プロセス(`run.exe` サイドカー)** として
起動し、本体コードに静的・動的リンクしていません。エンジンは改変せず、配布物内の
`data/voice/engine/` に**そのまま差し替え可能な形**で同梱しています(ユーザは別バージョンの
エンジンに置き換え可能)。これにより LGPL-3.0 の義務を満たしています。

- LGPL-3.0 の全文・依存ライブラリのライセンス一覧は、同梱エンジン内の以下に含まれます:
  - `data/voice/engine/resources/engine_manifest_assets/terms_of_service.md`(LGPL-3.0 全文)
  - `data/voice/engine/resources/engine_manifest_assets/dependency_licenses.json`(依存の全ライセンス)
- LGPL-3.0 の正本:https://www.gnu.org/licenses/lgpl-3.0.txt

---

## 4. 音声モデル — torimi.aivmx(つくよみちゃんコーパス由来)

本ソフトウェアの音声合成には、フリー素材キャラクター「**つくよみちゃん**」(© Rei Yumesaki)が
無料公開している音声データ(つくよみちゃんコーパス CV.夢前黎)から学習した派生音声モデルを
使用しています。

- **クレジット(必須・製品内「このアプリについて」にも表示)**:
  > 本ソフトウェアの音声合成には、フリー素材キャラクター「つくよみちゃん」(© Rei Yumesaki)が
  > 無料公開している音声データを使用しています。
  > ■つくよみちゃんコーパス(CV.夢前黎)https://tyc.rei-yumesaki.net/material/corpus/
- **コーパス**:https://tyc.rei-yumesaki.net/material/corpus/
- **利用規約**:https://tyc.rei-yumesaki.net/about/terms/
- **ライセンス**:つくよみちゃん利用規約 ＋ コーパス Vol.1 は CC BY-SA 4.0
  (https://creativecommons.org/licenses/by-sa/4.0/)
- **禁止用途**:特定の人物・団体を批判/攻撃する言動、特定の政治・宗教・思想への
  賛否を呼びかける用途。
- **留意(Share-Alike)**:CC BY-SA 4.0 の継承条件により、本派生音声モデル `.aivmx` を
  第三者が再利用できる形で配布する場合、同等のライセンスが及び得ます。

> 配布されるのは派生モデル `.aivmx` であり、コーパス本体(再配布禁止)は含みません。

---

## 5. MIT License(全文)

上記 §1・§2 で「MIT」と記載した各コンポーネントは、以下の MIT License のもとで提供されます。
著作権表示は §1・§2 の各行のとおりです。

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 6. Apache License 2.0

上記で「Apache-2.0」と記載した各コンポーネント(Transformers.js / ruri-v3-310m)は、
Apache License, Version 2.0 のもとで提供されます。全文は以下を参照してください。

- https://www.apache.org/licenses/LICENSE-2.0

各コンポーネントに `NOTICE` ファイルがある場合、その内容は当該配布元の記載に従います。
本ソフトウェアはこれらのコンポーネントを改変せずに利用しています。
