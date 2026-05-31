import { contextBridge } from 'electron';

// task_00 では最小実装。Renderer 向けの安全な API(EneAPI)は
// 設計書 §4.2 / §4.3 に従い後続タスク(task_07)で公開する。
contextBridge.exposeInMainWorld('ene', {});
