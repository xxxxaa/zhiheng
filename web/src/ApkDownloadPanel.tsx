import {useEffect,useRef,useState} from 'react';
import {Download,RefreshCw,ShieldCheck} from 'lucide-react';
import {downloadBusy,downloadOptions,downloadPercent,emptyDownload,nextDownload,updater} from './apk-download';
import type {AppRelease} from './updates';

export function ApkDownloadPanel({release}:{release:AppRelease|null}){
  const [state,setState]=useState(emptyDownload),[busy,setBusy]=useState(false),[error,setError]=useState(''),[installMessage,setInstallMessage]=useState(''),[needsPermission,setNeedsPermission]=useState(false);
  const mounted=useRef(true);
  async function refresh(){const incoming=await updater.getState();if(mounted.current)setState(current=>nextDownload(current,incoming));}
  useEffect(()=>{
    mounted.current=true;let polling=false;
    const poll=async()=>{if(polling)return;polling=true;try{await refresh();}catch{if(mounted.current)setError('无法读取下载状态，请重启 App 后重试。');}finally{polling=false;}};
    void poll();const timer=setInterval(()=>{if(!document.hidden)void poll();},750);
    return()=>{mounted.current=false;clearInterval(timer);};
  },[]);
  async function action(task:()=>Promise<unknown>){
    setBusy(true);setError('');
    try{await task();await refresh();}catch(e){if(mounted.current)setError(e instanceof Error?e.message:'操作失败，请重试');}
    finally{if(mounted.current)setBusy(false);}
  }
  const transferring=downloadBusy(state),ready=state.phase==='ready';
  if(!release&&!state.version&&!state.message&&!error)return null;
  return <div className="apk-download">
    {(state.version||transferring||state.message)&&<div className="download-status" role="status" aria-live="polite">
      {state.version&&<strong>{ready?<ShieldCheck size={16}/>:<Download size={16}/>}安装包 {state.version}</strong>}
      <p>{state.message}</p>
      {state.total>0&&<><progress aria-label="安装包下载进度" value={downloadPercent(state)} max={100}/><small>{downloadPercent(state)}% · {(state.received/1024/1024).toFixed(2)} / {(state.total/1024/1024).toFixed(2)} MB{state.phase==='verifying'?' · 校验中':ready?' · 已校验':''}</small></>}
    </div>}
    {error&&<p className="notice error" role="alert">{error}</p>}
    <div className="button-row">
      {ready&&<button className="primary" disabled={busy} onClick={()=>void action(async()=>{const result=await updater.install();setNeedsPermission(result.needsPermission);setInstallMessage(result.needsPermission?'系统尚未允许知衡安装更新。授权返回后，再点击“安装更新”。':'已打开系统安装器，请按系统提示完成覆盖安装。');})}>安装更新</button>}
      {transferring&&state.phase!=='restoring'&&<button className="secondary" disabled={busy||state.phase==='cancelling'} onClick={()=>void action(()=>updater.cancel())}>{state.phase==='cancelling'?'正在取消…':'取消下载'}</button>}
      {release&&!transferring&&(!ready||state.version!==release.version)&&<button className="primary" disabled={busy} onClick={()=>void action(async()=>{setNeedsPermission(false);setInstallMessage('');await updater.start(downloadOptions(release));})}>{state.phase==='error'||state.phase==='cancelled'?<RefreshCw size={16}/>:<Download size={16}/>} {state.phase==='error'||state.phase==='cancelled'?'重试下载':'在 App 内下载更新'}</button>}
    </div>
    {installMessage&&<p role="status">{installMessage}</p>}
    {needsPermission&&<button className="secondary" disabled={busy} onClick={()=>void action(()=>updater.openInstallSettings())}>前往系统允许安装更新</button>}
    <p className="muted">安装包保存在 App 内，无需去“下载”目录寻找。只有完整下载并通过大小、SHA-256、版本与签名校验后，才可安装。安装仍由系统确认，请保留账本备份并直接覆盖安装。</p>
    <p className="muted">15 秒无网络响应会报错，总下载时间上限 3 分钟。离开此页面可以继续下载；系统终止 App 后需重试，已校验的安装包可在重启后继续安装。</p>
    {release&&<details><summary>下载失败时的其他方式</summary><div className="button-row"><a className="text-button" href={release.downloadUrl} target="_blank" rel="noreferrer">浏览器下载 APK</a>{release.versionCode>=6&&<a className="text-button" href={release.downloadUrl.replace(/\.apk$/,'.zip')} target="_blank" rel="noreferrer">备用 ZIP 安装包</a>}</div><p className="muted">浏览器可能未能保存下载文件。可尝试 ZIP，下载后解压并打开其中的 APK；浏览器下载的文件不由 App 校验。</p></details>}
  </div>;
}
