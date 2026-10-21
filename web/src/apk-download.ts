import {registerPlugin} from '@capacitor/core';
import type {AppRelease} from './updates';

export type DownloadPhase='idle'|'restoring'|'connecting'|'downloading'|'verifying'|'ready'|'cancelling'|'cancelled'|'error';
export type DownloadState={phase:DownloadPhase;message:string;received:number;total:number;version:string;revision:number};
export const emptyDownload:DownloadState={phase:'restoring',message:'正在检查已下载的安装包…',received:0,total:0,version:'',revision:-1};
export const updater=registerPlugin<{
  getState():Promise<DownloadState>;
  start(options:{version:string;versionCode:number;bytes:number;sha256:string}):Promise<void>;
  cancel():Promise<void>;
  install():Promise<{needsPermission:boolean}>;
  openInstallSettings():Promise<void>;
}>('AppUpdater');
export function downloadBusy(state:DownloadState){return ['restoring','connecting','downloading','verifying','cancelling'].includes(state.phase);}
export function downloadPercent(state:DownloadState){
  if(state.phase==='ready')return 100;
  if(!state.total)return 0;
  return Math.min(state.phase==='verifying'?100:99,Math.max(0,Math.floor(state.received/state.total*100)));
}
export function downloadOptions(release:AppRelease){
  return {version:release.version,versionCode:release.versionCode,bytes:release.bytes,sha256:release.sha256};
}
export function nextDownload(current:DownloadState,incoming:DownloadState){return incoming.revision>=current.revision?incoming:current;}
