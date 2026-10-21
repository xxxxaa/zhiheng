import {onNativePause} from './native';
import {useEffect,useState,type ReactNode} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import {getMeta} from './db';
import {unlockDevice,type DeviceLock} from './device-lock';
import {Fingerprint,LockKeyhole} from 'lucide-react';
export default function DeviceGate({children}:{children:ReactNode}){
  const [ready,setReady]=useState(false),[unlocked,setUnlocked]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const lock=useLiveQuery(async()=>{try{const l=await getMeta<DeviceLock|null>('deviceLock',null);setReady(true);return l;}catch{setError('无法打开本地数据库，请检查浏览器存储权限');return undefined;}},[]);
  useEffect(()=>{let hiddenAt=0;const change=()=>{if(document.hidden)hiddenAt=Date.now();else if(hiddenAt&&Date.now()-hiddenAt>60000)setUnlocked(false);};const manual=()=>setUnlocked(false);document.addEventListener('visibilitychange',change);window.addEventListener('zhiheng-lock',manual);window.addEventListener('pagehide',manual);return()=>{document.removeEventListener('visibilitychange',change);window.removeEventListener('zhiheng-lock',manual);window.removeEventListener('pagehide',manual);};},[]);
  useEffect(()=>onNativePause(()=>setUnlocked(false)),[]);
  if(!ready)return <div className="lock-screen"><LockKeyhole/><p>{error||'正在打开本地账本…'}</p></div>;
  if(!lock||unlocked)return children;
  return <div className="lock-screen"><div className="brand-mark">知</div><span className="eyebrow">PRIVATE BY DEFAULT</span><h1>欢迎回到知衡</h1><p>使用手机或电脑的系统验证，打开你的资产账本。</p><button className="primary" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await unlockDevice(lock);setUnlocked(true);}catch(e){setError(e instanceof Error?e.message:'解锁失败');}finally{setBusy(false);}}}><Fingerprint size={19}/>{busy?'等待系统验证…':'使用设备解锁'}</button>{error&&<p role="alert" className="error">{error}</p>}<small>Face ID、指纹或设备口令由系统提供。关闭页面后需重新验证。<br/>无法验证时，请在原设备重试；迁移设备需从加密备份恢复。</small></div>;
}
