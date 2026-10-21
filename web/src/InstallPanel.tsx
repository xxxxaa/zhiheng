import {useEffect,useState} from 'react';
import {App as NativeApp} from '@capacitor/app';
import {isNative} from './native';
import {Download,Smartphone,WifiOff} from 'lucide-react';
import {Panel} from './App';
import {usePwa,promptInstall,retryOffline} from './pwa';

export function InstallPanel({run}:{run:(task:()=>Promise<unknown>,success?:string)=>Promise<void>}){
  const pwa=usePwa();
  const [version,setVersion]=useState('');
  useEffect(()=>{let active=true;if(isNative())void NativeApp.getInfo().then(info=>{if(active)setVersion(info.version);}).catch(()=>{});return()=>{active=false;};},[]);
  if(isNative())return <Panel title="手机 App" subtitle={version?`知衡 · ${version}`:'知衡'}><div className="security-status"><Smartphone size={29}/><div><strong>已安装到手机</strong><p>界面随安装包提供，账本保存在本机。</p></div></div><div className="offline-status ready"><WifiOff size={18}/><div><strong>可离线使用</strong><p>离线时可查看、编辑账本和导出加密备份。AI、搜索和云端备份需要联网。</p></div></div><p className="muted">云端备份在 App 打开并解锁备份连接时检查；错过的备份会在下次打开并解锁后补做。更新 App 时请覆盖安装，卸载会删除本地账本。</p></Panel>;
  return <Panel title="安装与离线使用" subtitle="从手机主屏幕打开你的资产账本">
    <div className="security-status"><Smartphone size={29}/><div><strong>{pwa.installed?'正在 App 窗口中使用':'添加知衡到主屏幕'}</strong><p>{pwa.installed?'账本仍保存在当前设备，请定期备份。':'安装后可以像其他 App 一样从图标打开。'}</p></div></div>
    {pwa.canInstall&&!pwa.installed&&<button className="primary" onClick={()=>void run(promptInstall)}><Download size={16}/>安装知衡</button>}
    {!pwa.installed&&<ol className="install-steps"><li><strong>iPhone / iPad：</strong>在 Safari 打开，使用分享菜单中的“添加到主屏幕”；若有“作为网页 App 打开”，请开启。</li><li><strong>Android：</strong>在系统浏览器打开，通过菜单选择“安装应用”或“添加到主屏幕”。</li></ol>}
    <div className={'offline-status '+(pwa.offline==='ready'?'ready':'')} role="status"><WifiOff size={18}/><div><strong>{pwa.offline==='ready'?'离线使用已准备好':pwa.offline==='unavailable'?'当前环境暂不支持':pwa.offline==='error'?'离线准备未完成':'正在准备离线使用'}</strong><p>{pwa.message}</p></div></div>
    {pwa.updateWaiting&&<p className="muted">新版已下载。保存当前编辑并关闭所有知衡窗口，下次打开时使用新版。</p>}
    {pwa.offline!=='unavailable'&&<button className="text-button" onClick={()=>void run(retryOffline)}>重新检查离线状态</button>}
    <p className="muted">离线时可查看、编辑账本并导出加密备份。AI、互联网搜索和云端备份需要联网。安装不会把本机数据上传到托管空间。</p>
  </Panel>;
}
