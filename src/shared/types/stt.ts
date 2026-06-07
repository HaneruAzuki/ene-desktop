// 音声認識(STT・task_17 Phase B)の IPC 契約。
// マイク音声(16kHz mono Float32)を main 側 Whisper で文字起こしする。

/**
 * 文字起こし結果。失敗時は ok:false でキャラ口調メッセージを返し、
 * Renderer はそれを吹き出しに出す(技術詳細はユーザーに見せない・CLAUDE §8.3)。
 */
export type TranscribeResult = { ok: true; text: string } | { ok: false; message: string };
