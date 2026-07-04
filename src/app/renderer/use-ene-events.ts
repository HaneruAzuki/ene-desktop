import { useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { enqueueAudio } from './audio-player';
import { playBackchannel } from './backchannel-player';
import { BACKCHANNEL_NOD_STRENGTH } from '../../shared/constants';
import type { CharacterViewState } from '../../shared/types/animation';
import type { ConversationResponse } from '../../shared/types/conversation';

// main(ene)→ renderer のイベント購読を App から一手に引き受けるフック。
// すべて window.ene.on*(＋可視性は visibilitychange DOM イベントとの AND 導出)を、
// マウント時に一度だけ購読する(従来の各 useEffect([]) と同義=first-render のクロージャで固定)。
// App 側の状態更新は deps 経由で呼ぶ(イベント配線と状態保持を分離=疎結合)。

export interface EneEventsDeps {
  /** 起動準備完了の push(pull の isReady と冪等)。 */
  markReady: () => void;
  /** ユーザー発話で前を向く＋アイドル計時リセット。 */
  noteActivity: () => void;
  /** トレイ/コンテキストメニューから入力欄を開く。 */
  openInput: () => void;
  /** ウィンドウ可視性(描画停止/再開の SSOT)。 */
  setVisible: Dispatch<SetStateAction<boolean>>;
  setNodKey: Dispatch<SetStateAction<number>>;
  setNodStrength: Dispatch<SetStateAction<number>>;
  setYawnKey: Dispatch<SetStateAction<number>>;
  setIsListening: Dispatch<SetStateAction<boolean>>;
  setBubble: Dispatch<SetStateAction<string | null>>;
  setCharState: Dispatch<SetStateAction<CharacterViewState>>;
  /** ユーザー発話(音声認識テキスト)への応答フロー。 */
  respond: (text: string) => Promise<void>;
  /** 確定応答を UI(吹き出し/表情/口パク)へ反映(setBubbleToo=吹き出し全文表示の有無)。 */
  applyResponseUI: (response: ConversationResponse, setBubbleToo?: boolean) => void;
  /** barge-in(音声入力フックが提供)。 */
  handleBargeIn: () => void;
}

export function useEneEvents(deps: EneEventsDeps): void {
  useEffect(() => {
    // 準備完了の通知(push)。pull(isReady)との競合は App 側 readyRef で冪等化する。
    window.ene.onAppReady(() => deps.markReady());

    // ユーザー発話(ハンズフリー音声・コアレッシング含む)でアイドル計時をリセット(話しかけられた=前を向く)。
    // コアレッシング音声経路では応答時に noteActivity を通らないため、これが「前を向く」唯一のトリガー。
    window.ene.onUserSaid(() => deps.noteActivity());

    // トレイ / コンテキストメニューからのイベント(入力欄を開く)。
    window.ene.onOpenInputArea(() => deps.openInput());

    // 音声応答チャンク(WAV＋任意で文テキスト/通し番号)を逐次再生(task_17 Phase A)。
    window.ene.onVoiceChunk((chunk) => void enqueueAudio(chunk.wav, chunk.text, chunk.index));

    // 相槌(聞くターン・task_18 Phase B): WAV があれば即時再生＋必ずうなずく(音声未準備でもうなずきは出す)。
    window.ene.onBackchannel((wav) => {
      if (wav) void playBackchannel(wav);
      deps.setNodStrength(BACKCHANNEL_NOD_STRENGTH); // 相槌のうなずきは控えめ(ターン終端の浅い側と同程度)
      deps.setNodKey((k) => k + 1);
    });

    // ターン終端うなずき(2026-06-12): 無音窓終端で1回うなずき、ターン受け取りを視覚で示す(音は鳴らさない)。
    //   深さ(strength)は発話の長さで出し分け(main 側で算出)=短い発話は軽く・長い発話は重め。
    window.ene.onTurnNod((strength) => {
      deps.setNodStrength(strength);
      deps.setNodKey((k) => k + 1);
    });

    // あくび(長時間傾聴の情緒ビート・listening-mode): main が ene:yawn を送ったら1回あくび。
    window.ene.onYawn(() => deps.setYawnKey((k) => k + 1));

    // 傾聴モードの出入り(listening-mode): 入室で少し首をかしげ、退室で戻す。
    window.ene.onListening((on) => deps.setIsListening(on));

    // 思考フィラー(熟考の入り・Phase C): 吹き出しに「考えている」文字列を一時表示。
    // 応答が来たら setBubble(response.message) で上書きされる(=一瞬の"間"の見える化)。
    window.ene.onThinkingFiller((text) => deps.setBubble(text));

    // ハンズフリー: main からの状態/確定テキスト/割り込み。
    // 状態テキストは出さず、考え中(transcribing)だけ吹き出し「…」で示す(聞き取り中は neutral)。
    window.ene.onVoiceState((state) => {
      if (state === 'transcribing') {
        deps.setCharState((s) => ({ ...s, activity: 'thinking', pose: 'stand' }));
      } else if (state === 'listening') {
        // 空認識などで聞き取りに戻った時、考え中を解除して neutral へ。
        deps.setCharState((s) => (s.activity === 'thinking' ? { ...s, activity: 'idle' } : s));
      }
      // 'recording'(ユーザー発話中)は何もしない=キャラは neutral のまま。
    });
    window.ene.onVoiceTranscript((text) => void deps.respond(text));
    // コアレッシング(ENE_COALESCE)時は main で生成が完結し、確定応答だけが届く(投機キャンセルは届かない)。
    // 吹き出しは文の再生に同期して伸ばす(setSentenceHandler)ので、ここでは**全文をセットしない**(表情/口パクのみ)。
    window.ene.onVoiceResponse((response) => deps.applyResponseUI(response, false));
    // 自発発話(P7): main がアイドル判定で生成した一言を吹き出し/表情へ反映する(音声なし v1=全文表示)。
    window.ene.onProactiveMessage((response) => deps.applyResponseUI(response, true));
    window.ene.onVoiceBargeIn(() => deps.handleBargeIn());

    // ウィンドウ可視性 → VRM 描画の停止/再開(§3.6・軽量原則 柱4)。
    // 2つの独立信号——main の hide/minimize/show/restore(意図的な表示操作)と renderer の
    // visibilitychange(最小化/隠蔽=Chromium の可視性)——を **last-write-wins で奪い合わせず**、
    // 両者の AND から visible を一意に導出する(C3・SSOT)。どちらかが「隠れている」と言えば描画を止める。
    let windowVisible = true; // main 駆動(hide/minimize=false / show/restore=true)
    let docVisible = !document.hidden; // renderer 駆動(最小化/隠蔽で hidden=true)
    const recompute = (): void => deps.setVisible(windowVisible && docVisible);
    window.ene.onWindowVisibility((v) => {
      windowVisible = v;
      recompute();
    });
    const onVis = (): void => {
      docVisible = !document.hidden;
      recompute();
    };
    document.addEventListener('visibilitychange', onVis);
    recompute(); // 初期状態を一度同期

    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);
}
