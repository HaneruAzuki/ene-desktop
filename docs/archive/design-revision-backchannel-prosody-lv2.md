# 相槌の韻律トーン判定(task_18 Lv2 / Lv2b)— 設計と撤去の記録

> **状態:撤去済み(2026-06-10)**。本書は「せっかく作った機能」を後から復元できるよう、
> 設計意図・仕組み・撤去理由を保存するアーカイブ。**現行コードには存在しない**。

---

## 1. これは何だったか

相槌(あいづち)エンジン(`task_18`)は2層で設計されていた。

- **Lv1 = いつ打つか(タイミング)** … 「十分に話して、短い言いよどみ(ターン終了より手前)で打つ」。
  → **現行も主役**。`backchannel-engine.ts` のタイミング判定として残存。
- **Lv2 = どんなトーンで打つか(韻律トーン判定)** … 相手が淡々としていれば「うん」(continuer)、
  **興奮して声が高く・大きくなったら「へえ!」「えっ!」(surprise)** と打ち分ける。
  → **本書の対象。2026-06-10 に撤去**。
- **Lv2b = 学習の永続化** … Lv2 の判定閾値をその人に合わせて学習し、ディスクに保存して
  継続利用で賢くする。→ **Lv2 と一緒に撤去**。

狙いは「聞き上手は相手のテンションに合わせて相槌の色を変える」を再現すること。

---

## 2. 仕組み(3階建て)

### 2.1 興奮の検出 = 「その人の平常」との比

1フレームごとに2つの韻律量を取り、相槌を打つ瞬間に「いまの発話 ÷ その人の平常」の比で判定した。

- **ピッチ比 pRatio(主信号)** = いまの発話の F0(声の高さ)の山 ÷ 平常 F0 の山。
  F0 は自己相関(`frameF0`・ラグ走査)で推定。興奮で声が高くなるのを主信号にした
  (大きさより安定、という実機判断)。
- **エネルギー比 eRatio(補助)** = いまの発話の RMS(声の大きさ)の山 ÷ 平常 RMS の山。
- `pRatio ≥ 閾値` **または** `eRatio ≥ 閾値` → **surprise**、さもなくば **continuer**。

**重要な実装上の発見(コメントに残っていた「★要点」):**
平常値(baseline)を**フレーム単位 EMA** で更新すると、興奮の最中に baseline 自身が追従して
比が動かなくなる(平常も興奮も比 ≈ 1.4)。一方で**絶対ピーク**は興奮時に約 1.6 倍だった。
→ baseline は**文単位(相槌ごと)の長期 EMA**(`PHRASE_BASELINE_ALPHA = 0.15`、約7文で馴染む)で
更新し、ピークは**減衰保持の最大**(`PEAK_DECAY = 0.97`、約1秒山を保持)とした。
これで「1文だけ大きい/高い」と比が跳ね、数文続けば新しい平常に馴染む、という挙動になった。

### 2.2 閾値の自己キャリブレーション

「比が 1.4 を超えたら surprise」と**手で閾値を決める**代わりに、エンジンが
**比の分布(平均・分散を EMA で学習)** を持ち、`閾値 = 平均 + K×標準偏差`(floor/ceil でクランプ)を
自動算出した(`adaptiveThreshold`)。warmup(6件)までは固定値。
パラメータ:`RATIO_ALPHA=0.08`、`RATIO_K=1.3`、ピッチ閾値 `1.12..1.7`、エネルギー閾値 `1.25..2.4`。

### 2.3 永続化(Lv2b)

学習値(`baselinePeak / baselinePitch / pRatioMean / pRatioVar / eRatioMean / eRatioVar / ratioCount`)を
**`data/config/backchannel-calibration.json`(平文 JSON・§6.1)** に5回ごと保存し、
ハンズフリー開始時に復元した。**音響キャリブレーションであり感情・好感度の状態ではない**ので
§5.3(保存スカラー禁止)には非抵触、という整理だった。

---

## 3. なぜ撤去したか

2026-06 のキャラ方針(クールなツンデレ・魚川トリミ)に合わせ、**相槌の語彙から surprise(驚き系)を外し、
continuer に統一**した(`backchannels.json` の `cues` は `continuer` のみ)。その結果:

> エンジンが `cue=surprise` と判定しても、surprise の語が無いため `selectBackchannel` が
> **continuer にフォールバック → 発声は変わらない**。

つまり Lv2/Lv2b の精巧な機械(毎フレームの F0 自己相関・自己キャリブレーション・永続化)が
**動いて `cue=surprise` とログに出すだけで、出力に一切効かない「死蔵コード」**になっていた。

撤去の利点:
- **CPU**:聞き取りループで最も重い `frameF0`(自己相関の二重ループ)が毎フレーム不要に。
- **見通し**:`backchannel-engine.ts` が約 360 行 → 約半分に。`storage/backchannel-calibration.ts`、
  関連定数(`BACKCHANNEL_EMPHASIS_RATIO` / `BACKCHANNEL_PITCH_RATIO`)、型(`BackchannelCalibration`)、
  `BackchannelDecision` の韻律フィールド、`paths.ts` の calibration パス、関連テストが消えた。
- **整合**:そもそも surprise を外したクール路線と一致。

---

## 4. 撤去の範囲(2026-06-10)

| 対象 | 処理 |
|---|---|
| `src/conversation/backchannel-engine.ts` | 韻律(`frameF0`・peak/baseline・比・`adaptiveThreshold`・`updateProsody`/`updateRatioStats`)、`getCalibration`/`loadCalibration` を削除。タイミング判定＋`frameRms`(VAD診断で使用)のみ残す。`push()` は `push(prob)` に簡素化、`fireDecision()` は常に `cue:'continuer'` を返す |
| `src/main/backchannel-controller.ts` | calibration 復元/保存(`loadBackchannelCalibration`/`saveBackchannelCalibration`/`save`/`fireCount`)を削除。`onFrame(prob)` に簡素化 |
| `src/main/vad-runtime.ts` | `onFrame(prob)` のみ(rms/f0 を渡さない)。`frameF0` import と `save()` 呼び出しを削除。`frameRms` は VAD 診断で残す |
| `src/shared/types/backchannel.ts` | `BackchannelCalibration` 削除。`BackchannelDecision` から韻律フィールド削除(`kind`＋`cue` のみ)。`BackchannelCue` 型は語彙スキーマ互換のため残置(出力は常に continuer) |
| `src/shared/constants.ts` | `BACKCHANNEL_EMPHASIS_RATIO` / `BACKCHANNEL_PITCH_RATIO` 削除 |
| `src/storage/backchannel-calibration.ts` | ファイル削除 |
| `src/storage/paths.ts` | `getBackchannelCalibrationPath` 削除 |
| `tests/unit/backchannel-engine.test.ts` | 韻律/ピッチ/学習値/`adaptiveThreshold`/`frameF0` のテストを削除。タイミング＋`frameRms` のみ残す |
| `tests/unit/backchannel-controller.test.ts` | calibration モックを削除 |

`backchannels.json` の `cues.continuer` 構造・`selectBackchannel` のシグネチャは**変更しない**
(将来 surprise 等の多型相槌を復活させやすいよう、語彙スキーマは温存)。

---

## 5. 復活させるには

1. `backchannels.json` の `cues` に `surprise`(等)の語を追加する。
2. 本書 §2 のロジックを `backchannel-engine.ts` に戻す(git 履歴: 本コミット直前を参照)。
3. `vad-runtime` で `onFrame(prob, frameRms(frame), frameF0(frame))` に戻し、`frameF0` を復元。
4. 永続化が要るなら `storage/backchannel-calibration.ts` と `paths.getBackchannelCalibrationPath` を復元。

ただし**クール路線では驚き系の過剰反応は出さない方が整合**するため、復活は要キャラ方針確認。
