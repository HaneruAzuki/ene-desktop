import type { BrowserWindow } from 'electron';
import { speakResponse, type VoiceRuntime } from './voice-runtime';
import type { AppRuntime } from '../bootstrap/app-runtime';
import type { EmotionLabel } from '../../../shared/types/animation';

// 自発発話・起動挨拶・聞き返し(=ユーザー入力に紐づかない発話)の共通経路(穴A)。
// 「前の自発発話を中断 → 中断ハンドルを張り替え → barge-in 窓を開く → speakResponse」の5手が
// 3箇所(ipc の聞き返し/起動挨拶・idle-talk-manager の自発発話)で同一だったため1関数へ集約。
// barge-in の契約が変わってもここ1箇所を直せばよい。
export function speakSelfInitiated(
  runtime: AppRuntime,
  mainWindow: BrowserWindow,
  voice: VoiceRuntime,
  text: string,
  emotion: EmotionLabel,
): void {
  runtime.selfSpeech?.abort();
  const ctrl = new AbortController();
  runtime.selfSpeech = ctrl;
  runtime.setResponseActive?.(true); // barge-in で止められるよう窓を開く
  void speakResponse(text, emotion, voice.tts, voice.voiceConfig, mainWindow, ctrl.signal);
}
