import {useEffect,useRef,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {Panel,Field} from './App';
import {defaultAI,isDeepSeek,type AIConfig,type DeepSeekEffort} from './ai';
import {deepSeekModels,fetchDeepSeekModels,saveAIConnection} from './ai-models';
import {isNative} from './native';
import type {SearchConfig} from './search';

type Props={ai:AIConfig;apiKey:string;setApiKey:(s:string)=>void;searchConfig:SearchConfig;run:(task:()=>Promise<unknown>,success?:string)=>Promise<void>};
export function AIConnectionPanel({ai,apiKey,setApiKey,searchConfig,run}:Props){
  const [draft,setDraft]=useState(ai);
  const [service,setService]=useState<'deepseek'|'custom'>(isDeepSeek(ai.baseUrl)&&ai.protocol==='chat'?'deepseek':'custom');
  const [models,setModels]=useState(deepSeekModels),[manual,setManual]=useState(false);
  const [busy,setBusy]=useState(false),[saving,setSaving]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  const request=useRef<AbortController|null>(null);
  useEffect(()=>()=>request.current?.abort(),[]);
  const isOfficial=service==='deepseek';
  const missing=!models.some(m=>m.id===draft.model);
  function chooseService(value:'deepseek'|'custom'){
    request.current?.abort();setBusy(false);setMessage('');setError('');setManual(false);setService(value);
    if(value==='deepseek'){
      if(!isDeepSeek(draft.baseUrl))setApiKey('');
      setDraft({...defaultAI});
    }
  }
  async function refresh(){
    request.current?.abort();const controller=new AbortController();request.current=controller;
    setBusy(true);setMessage('');setError('');
    try{
      const list=await fetchDeepSeekModels(apiKey,controller.signal);
      if(controller.signal.aborted)return;
      setModels(list);setMessage(`已获取 ${list.length} 个可用模型，请选择后保存。`);
    }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'无法获取模型，请检查网络后重试');}
    finally{if(request.current===controller){setBusy(false);request.current=null;}}
  }
  return <Panel title="AI 模型连接" subtitle="选择 DeepSeek 模型，或连接其他兼容服务">
    <form onSubmit={e=>{e.preventDefault();setSaving(true);void run(()=>saveAIConnection(draft,searchConfig),'模型设置已保存；下次分析使用所选模型').finally(()=>setSaving(false));}}>
      <Field label="模型服务"><select value={service} disabled={busy||saving} onChange={e=>chooseService(e.target.value as typeof service)}><option value="deepseek">DeepSeek 官方</option><option value="custom">自定义兼容服务</option></select></Field>
      {isOfficial?<p className="muted">连接 api.deepseek.com · 接口地址已配置。切换模型不会开启联网搜索。</p>:<Field label="Base URL（包含 /v1，如供应商需要）"><input name="baseUrl" type="url" required value={draft.baseUrl} onChange={e=>setDraft({...draft,baseUrl:e.target.value})} placeholder="https://api.example.com/v1"/></Field>}
      <Field label={isOfficial?'DeepSeek API Key（当前会话）':'API Key（当前会话）'}><input type="password" autoComplete="new-password" value={apiKey} disabled={busy} onChange={e=>{setApiKey(e.target.value);setMessage('');setError('');}} placeholder="sk-…"/></Field>
      {isOfficial?<>
        <Field label="选择模型"><select value={manual?'__manual__':draft.model} disabled={busy||saving} onChange={e=>{const value=e.target.value;setManual(value==='__manual__');if(value!=='__manual__')setDraft({...draft,model:value});}}>
          {models.map(m=><option key={m.id} value={m.id}>{m.name} · {m.id}</option>)}
          {missing&&<option value={draft.model}>当前模型 · {draft.model}</option>}
          <option value="__manual__">手动填写模型 ID</option>
        </select></Field>
        {manual&&<Field label="模型 ID"><input required maxLength={100} value={draft.model} onChange={e=>setDraft({...draft,model:e.target.value})}/></Field>}
        <button className="secondary" type="button" disabled={busy||saving||!apiKey.trim()} onClick={()=>void refresh()}><RefreshCw size={15}/>{busy?'正在获取模型…':'刷新可用模型'}</button>
        <p className="muted">{message||'内置 Flash 与 V4 Pro；填写密钥后可刷新官方列表。刷新只获取模型信息，不发送账本。'}</p>
        {error&&<p className="notice error" role="alert">{error}。已有模型仍可选择。</p>}
        {message&&missing&&<p className="muted">当前模型不在返回列表中，请确认可用性或选择其他模型。</p>}
        <Field label="思考强度"><select value={draft.deepseekEffort||'high'} onChange={e=>setDraft({...draft,deepseekEffort:e.target.value as DeepSeekEffort})}><option value="none">关闭思考</option><option value="low">轻量 · low</option><option value="high">标准 · high</option><option value="max">深入 · max</option></select></Field>
        <p className="muted">更高的思考强度可能增加等待时间和用量。<a href="https://api-docs.deepseek.com/zh-cn/quick_start/pricing/" target="_blank" rel="noopener noreferrer">查看官方模型与价格</a></p>
      </>:<div className="form-grid"><Field label="模型名"><input required maxLength={100} value={draft.model} onChange={e=>setDraft({...draft,model:e.target.value})}/></Field><Field label="接口协议"><select value={draft.protocol} onChange={e=>setDraft({...draft,protocol:e.target.value as AIConfig['protocol']})}><option value="chat">Chat Completions</option><option value="responses">Responses</option></select></Field></div>}
      {draft.protocol==='chat'&&searchConfig.provider==='builtin'&&<p className="muted">保存后将关闭当前的 Responses 内置搜索；需要联网资料时，可在下方另行配置 DeepSeek Search。</p>}
      <p className="muted">{isNative()?'App 直接连接模型服务。':'浏览器直连需要服务商允许 CORS。'}保存设置不会调用模型；密钥仅保留在当前会话，也可在下方加密保存。</p>
      <button className="primary" type="submit" disabled={busy||saving}>{saving?'正在保存…':'保存模型设置'}</button>
    </form>
  </Panel>;
}
