import { describe, it, expect } from 'vitest';
import { isCloudSyncFolder } from '../../src/shared/node/cloud-warning';

describe('cloud-warning (設計書 §7.1)', () => {
  it('OneDrive 配下を検知する', () => {
    expect(isCloudSyncFolder('C:\\Users\\me\\OneDrive\\ENE\\data')).toBe(true);
  });
  it('Dropbox を大文字小文字を無視して検知する', () => {
    expect(isCloudSyncFolder('C:\\users\\me\\dropbox\\ene')).toBe(true);
  });
  it('Google Drive を検知する', () => {
    expect(isCloudSyncFolder('C:\\Users\\me\\Google Drive\\x')).toBe(true);
  });
  it('通常パスは false', () => {
    expect(isCloudSyncFolder('C:\\Users\\me\\Desktop\\ENE\\data')).toBe(false);
  });
});
