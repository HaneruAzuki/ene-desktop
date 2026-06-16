import { useEffect, useRef, useState } from 'react';
import { setOutputVolume as audioSetVolume, setMuted as audioSetMuted } from './audio-player';
import type { IdleTalkMode } from '../../shared/types/settings';

// ユーザー設定(音量/ミュート・話しかけ頻度・自動起動・主人の呼び方)を App から切り出したフック。
// 起動時に main から読み込み、変更は即時反映＋(音量のみ)デバウンス保存する。
// アニメ/会話/マイクの状態機械とは独立=ここを差し替えても会話挙動に影響しない(疎結合)。

/** 音量・ミュートの保存デバウンス(ms)。連続操作の最後の値だけを書く。 */
const AUDIO_SAVE_DEBOUNCE_MS = 400;

export interface EneSettings {
  volume: number; // トリミの声(出力)の音量 0〜1
  muted: boolean;
  idleTalk: IdleTalkMode; // 自分から話しかける する/しない
  autoLaunch: boolean; // PC 起動時に自動起動
  ownerName: string; // 主人の呼び方
  ownerReading: string; // 呼び方の読み(かな・音声用)
  /** ミュート切替(即時に audio-player へ反映＋デバウンス保存)。 */
  toggleMute: () => void;
  /** 音量変更(スライダー)。動かしたらミュート解除。即時反映＋デバウンス保存。 */
  setVolumeValue: (v: number) => void;
  /** 話しかけてくる頻度の変更(即時反映＋保存)。 */
  setIdleTalkMode: (mode: IdleTalkMode) => void;
  /** 自動起動の切替(即時反映＋保存・本番は OS のスタートアップにも反映)。 */
  setAutoLaunchOn: (on: boolean) => void;
  /** 主人の呼び方＋読みの保存(意図的変更=会話ロックを通る)。 */
  saveOwnerName: (name: string, reading: string) => void;
}

export function useEneSettings(): EneSettings {
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [idleTalk, setIdleTalk] = useState<IdleTalkMode>('on');
  const [autoLaunch, setAutoLaunch] = useState(false);
  const [ownerName, setOwnerName] = useState('');
  const [ownerReading, setOwnerReading] = useState('');
  const audioSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 起動時に各設定を main から読み込む(設定パネルの初期表示用)。音量は audio-player へも適用する。
  useEffect(() => {
    void window.ene.getAudioPrefs().then(({ volume: v, muted: m }) => {
      setVolume(v);
      setMuted(m);
      audioSetVolume(v);
      audioSetMuted(m);
    });
    void window.ene.getIdleTalk().then(setIdleTalk);
    void window.ene.getAutoLaunch().then(setAutoLaunch);
    void window.ene.getOwnerName().then(({ name, reading }) => {
      setOwnerName(name);
      setOwnerReading(reading);
    });
  }, []);

  // アンマウント時にデバウンス保存タイマーを止める(リーク防止)。
  useEffect(() => {
    return () => {
      if (audioSaveTimerRef.current) clearTimeout(audioSaveTimerRef.current);
    };
  }, []);

  const persistAudio = (v: number, m: boolean): void => {
    if (audioSaveTimerRef.current) clearTimeout(audioSaveTimerRef.current);
    audioSaveTimerRef.current = setTimeout(() => void window.ene.saveAudioPrefs(v, m), AUDIO_SAVE_DEBOUNCE_MS);
  };

  const toggleMute = (): void => {
    const m = !muted;
    setMuted(m);
    audioSetMuted(m);
    persistAudio(volume, m);
  };

  const setVolumeValue = (v: number): void => {
    setVolume(v);
    audioSetVolume(v);
    if (muted) {
      setMuted(false);
      audioSetMuted(false);
    }
    persistAudio(v, false);
  };

  const setIdleTalkMode = (mode: IdleTalkMode): void => {
    setIdleTalk(mode);
    void window.ene.saveIdleTalk(mode);
  };

  const setAutoLaunchOn = (on: boolean): void => {
    setAutoLaunch(on);
    void window.ene.setAutoLaunch(on);
  };

  const saveOwnerName = (name: string, reading: string): void => {
    setOwnerName(name);
    setOwnerReading(reading);
    void window.ene.setOwnerName(name, reading);
  };

  return {
    volume,
    muted,
    idleTalk,
    autoLaunch,
    ownerName,
    ownerReading,
    toggleMute,
    setVolumeValue,
    setIdleTalkMode,
    setAutoLaunchOn,
    saveOwnerName,
  };
}
