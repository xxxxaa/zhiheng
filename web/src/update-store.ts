import {useSyncExternalStore} from 'react';
import {App} from '@capacitor/app';
import {Capacitor} from '@capacitor/core';
import {fetchRelease, isNewerRelease, parseCachedRelease, updateDue, type AppRelease} from './updates';

type State = {supported: boolean; automatic: boolean; checking: boolean; version: string;
  latest: AppRelease | null; checkedAt: number; message: string; error: string};
const supported = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
function read(key: string) { try { return localStorage.getItem(`zhiheng-update-${key}`); } catch { return null; } }
function save(key: string, value: string) { try { localStorage.setItem(`zhiheng-update-${key}`, value); } catch { /* Checking still works without persistent preferences. */ } }
let state: State = {supported, automatic: read('automatic') !== 'false', checking: false, version: '', latest: null, checkedAt: 0, message: '', error: ''};
let pending: Promise<void> | null = null;
let lastAttempt = Number(read('lastAttempt') || 0);
const listeners = new Set<() => void>();
function update(next: Partial<State>) { state = {...state, ...next}; listeners.forEach(listener => listener()); }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useUpdates = () => useSyncExternalStore(subscribe, () => state);
export function setAutomaticUpdates(enabled: boolean) {
  save('automatic', String(enabled)); update({automatic: enabled});
  if (enabled) void checkForUpdates(false);
}
export function checkForUpdates(manual = true): Promise<void> {
  if (!supported) return Promise.resolve();
  if (pending) return pending;
  if (!manual && (!state.automatic || !updateDue(lastAttempt))) return Promise.resolve();
  lastAttempt = Date.now(); save('lastAttempt', String(lastAttempt));
  update({checking: true, error: ''});
  pending = (async () => {
    try {
      const info = await App.getInfo();
      if (info.id !== 'app.zhiheng.assets') throw new Error('当前安装包与更新源不匹配');
      update({version: info.version});
      const release = await fetchRelease();
      const latest = release && isNewerRelease(release, info.build) ? release : null;
      save('release',JSON.stringify(release));
      update({latest, checkedAt: Date.now(), message: !release ? '暂时没有可用的公开版本，可稍后再检查。' : latest ? `发现新版 ${latest.version}` : '当前已是最新版本'});
    } catch (error) {
      update({error: error instanceof Error ? error.message : '检查更新失败，请检查网络后重试'});
    } finally { update({checking: false}); pending = null; }
  })();
  return pending;
}
// Runs only while the unlocked App is mounted. No background service or financial data is involved.
export function startUpdateChecks() {
  if (!supported) return () => {};
  let disposed = false;
  const check = () => { if (!document.hidden) void checkForUpdates(false); };
  void (async()=>{
    try {
      const info=await App.getInfo();
      if(info.id!=='app.zhiheng.assets'||disposed)return;
      update({version:info.version});
      const stored=read('release');
      if(stored&&stored!=='null'&&!state.checkedAt){const release=parseCachedRelease(JSON.parse(stored));if(isNewerRelease(release,info.build))update({latest:release,message:`上次检查发现新版 ${release.version}`});}
    } catch { /* Invalid or unavailable local cache never blocks a fresh check. */ }
    finally { if(!disposed)check(); }
  })();
  const timer = setInterval(check, 60000);
  document.addEventListener('visibilitychange', check);
  return () => { disposed=true;clearInterval(timer); document.removeEventListener('visibilitychange', check); };
}
