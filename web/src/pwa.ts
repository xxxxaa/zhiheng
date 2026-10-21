import {isNative} from './native';
import {useSyncExternalStore} from 'react';

type InstallPrompt=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed'}>};
type PwaState={installed:boolean;canInstall:boolean;offline:'checking'|'ready'|'unavailable'|'error'|'waiting';message:string;updateWaiting:boolean};
let state:PwaState={installed:false,canInstall:false,offline:'checking',message:'正在准备离线页面…',updateWaiting:false};
let prompt:InstallPrompt|null=null,registration:ServiceWorkerRegistration|undefined,started=false,checking:Promise<void>|null=null;
const listeners=new Set<()=>void>();
function update(next:Partial<PwaState>){state={...state,...next};listeners.forEach(listener=>listener());}
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export const usePwa=()=>useSyncExternalStore(subscribe,()=>state);

async function inspectOffline(){
  const worker=navigator.serviceWorker.controller;
  update({updateWaiting:!!registration?.waiting});
  if(!worker){update({offline:'waiting',message:'离线页面正在准备，完成前请保持联网。'});return;}
  const ready=await new Promise<boolean>((resolve,reject)=>{
    const channel=new MessageChannel();
    const finish=(result?:boolean)=>{clearTimeout(timeout);channel.port1.close();channel.port2.close();result===undefined?reject(new Error('离线状态暂时无法确认，请关闭所有知衡窗口后重新打开。')):resolve(result);};
    const timeout=setTimeout(()=>finish(),5000);
    channel.port1.onmessage=event=>{if(event.data?.type==='zhiheng-offline-status')finish(event.data.ready===true);};
    try{worker.postMessage({type:'zhiheng-offline-status'},[channel.port2]);}catch{finish();}
  });
  update({offline:ready?'ready':'error',message:ready?'离线页面已就绪，可离线打开和编辑本机账本。':'离线文件不完整，请联网后点击重新检查。'});
}
export function checkOffline(){
  if(checking)return checking;
  checking=(async()=>{try{await inspectOffline();}catch(error){update({offline:'error',message:error instanceof Error?error.message:'离线页面准备失败，请联网后重试。'});}finally{checking=null;}})();
  return checking;
}
export function startPwa(){
  if(started)return;started=true;
  if(isNative()){update({installed:true,offline:'ready',message:'界面已随安装包保存在手机上，可离线打开和编辑账本。'});return;}
  const standalone=matchMedia('(display-mode: standalone)');
  const installed=()=>update({installed:standalone.matches||(navigator as Navigator&{standalone?:boolean}).standalone===true});
  installed();standalone.addEventListener('change',installed);
  window.addEventListener('online',()=>{if(registration)void checkOffline();});
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();prompt=event as InstallPrompt;update({canInstall:true});});
  window.addEventListener('appinstalled',()=>{prompt=null;update({installed:true,canInstall:false});});
  if(!import.meta.env.PROD){update({offline:'unavailable',message:'开发模式不启用离线缓存，请使用生产构建预览。'});return;}
  if(!window.isSecureContext||!('serviceWorker' in navigator)){
    update({offline:'unavailable',message:'当前环境不支持离线安装，请在手机系统浏览器中打开 HTTPS 地址。'});return;
  }
  navigator.serviceWorker.addEventListener('controllerchange',()=>void checkOffline());
  const register=async()=>{
    try{
      registration=await navigator.serviceWorker.register('/sw.js');
      const watch=()=>{const worker=registration?.installing;if(!worker)return;worker.addEventListener('statechange',()=>{if(worker.state==='activated'||worker.state==='installed')void checkOffline();if(worker.state==='redundant'){if(navigator.serviceWorker.controller)void checkOffline();else update({offline:'error',message:'离线页面未能完整下载，请联网后重新检查。'});}});};
      registration.addEventListener('updatefound',watch);watch();await checkOffline();
    }catch{if(navigator.serviceWorker.controller)await checkOffline();else update({offline:'error',message:'无法准备离线页面，请检查网络与浏览器权限后重试。'});}
  };
  if(document.readyState==='complete')void register();else window.addEventListener('load',()=>void register(),{once:true});
}
export async function promptInstall(){
  const current=prompt;if(!current)return;
  prompt=null;update({canInstall:false});
  await current.prompt();await current.userChoice;
}
export async function retryOffline(){
  // Never force an update/reload while a user may have unsaved edits or unlocked keys.
  if(registration)await registration.update();
  else if(window.isSecureContext&&'serviceWorker' in navigator)registration=await navigator.serviceWorker.register('/sw.js');
  await checkOffline();
}
