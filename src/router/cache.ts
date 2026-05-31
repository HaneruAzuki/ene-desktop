import type { RouterResult } from '../shared/types/router';

// Router 判定結果の LRU キャッシュ(要件 F-ROUTE-06)。
// ライブラリは追加せず、Map の挿入順を使った簡易 LRU で実装する。

export const ROUTER_CACHE_SIZE = 10;

function normalizeKey(userText: string): string {
  return userText.trim().toLowerCase();
}

export class RouterCache {
  private readonly map = new Map<string, RouterResult>();

  get(userText: string): RouterResult | undefined {
    const key = normalizeKey(userText);
    const value = this.map.get(key);
    if (value !== undefined) {
      // 参照されたものを最近使用扱いにする(末尾へ移動)
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(userText: string, result: RouterResult): void {
    const key = normalizeKey(userText);
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, result);
    if (this.map.size > ROUTER_CACHE_SIZE) {
      // 最古(挿入順で先頭)を1件削除
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) {
        this.map.delete(oldest);
      }
    }
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
