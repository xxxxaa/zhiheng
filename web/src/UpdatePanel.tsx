import {Download,RefreshCw,ExternalLink} from 'lucide-react';
import {Panel} from './App';
import {RELEASES_URL} from './updates';
import {checkForUpdates,setAutomaticUpdates,useUpdates} from './update-store';
import {ApkDownloadPanel} from './ApkDownloadPanel';

export function UpdateNotice({openSettings}:{openSettings:()=>void}) {
  const state = useUpdates();
  if (!state.supported || !state.latest) return null;
  return <div className="update-notice" role="status"><span>知衡 {state.latest.version} 已发布</span><button className="text-button" onClick={openSettings}>查看更新 <Download size={15}/></button></div>;
}
export function UpdatePanel() {
  const state = useUpdates();
  if (!state.supported) return null;
  return <Panel title="应用更新" subtitle="从知衡的 GitHub 发布页获取新版">
    {state.version&&<p>当前安装版本：{state.version}</p>}
    <div className="button-row"><button className="secondary" disabled={state.checking} onClick={()=>void checkForUpdates()}><RefreshCw size={16}/>{state.checking?'正在检查…':'检查更新'}</button><a className="text-button" href={RELEASES_URL} target="_blank" rel="noreferrer">发布页 <ExternalLink size={15}/></a></div>
    <p role="status">{state.checking?'正在连接 GitHub…':state.error||state.message||'可手动检查是否有新版。'}</p>
    {state.checkedAt>0&&<p className="muted">最近成功检查：{new Date(state.checkedAt).toLocaleString('zh-CN')}</p>}
    {state.latest&&<div className="update-details"><strong>新版 {state.latest.version} · {(state.latest.bytes/1024/1024).toFixed(1)} MB</strong><pre>{state.latest.notes}</pre><details><summary>安装包发布摘要</summary><code className="break">SHA-256：{state.latest.sha256}</code></details></div>}
    <ApkDownloadPanel release={state.latest}/>
    <label className="checkbox"><input type="checkbox" checked={state.automatic} onChange={e=>setAutomaticUpdates(e.target.checked)}/>打开并解锁 App 后自动检查（每天最多一次）</label>
    <p className="muted">只读取公开版本信息，不发送账本或密钥。下载与安装由你确认；GitHub 无法连接时仍可正常使用本机账本。</p>
  </Panel>;
}
