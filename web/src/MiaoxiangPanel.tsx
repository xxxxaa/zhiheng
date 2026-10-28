import {useEffect,useRef,useState} from 'react';
import {Database,Search,Square,ArrowUpRight,PlugZap} from 'lucide-react';
import Markdown from 'react-markdown';
import {Panel,Field} from './App';
import {MX_ENDPOINT,MX_TOOLS,queryMx,testMxConnection,type MxResult,type MxTool} from './miaoxiang';

function useMxRequest(key:string) {
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>{setBusy(false);setMessage('');setError('');return()=>{controller.current?.abort();controller.current=null;};},[key]);
  async function run(work:(signal:AbortSignal)=>Promise<void>) {
    if(controller.current)return;
    const request=new AbortController();controller.current=request;setBusy(true);setError('');setMessage('');
    try{await work(request.signal);}catch(e){if(controller.current===request)setError(request.signal.aborted?'查询已取消':e instanceof TypeError?'连接失败，请检查网络；浏览器预览还需要服务允许跨域。手机 App 使用原生连接。':e instanceof Error?e.message:'妙想连接失败');}
    finally{if(controller.current===request){controller.current=null;setBusy(false);}}
  }
  return {busy,message,setMessage,error,run,cancel:()=>controller.current?.abort()};
}
export function MiaoxiangConnection({apiKey,setApiKey}:{apiKey:string;setApiKey:(key:string)=>void}) {
  const state=useMxRequest(apiKey);
  return <Panel title="妙想金融数据" subtitle="东方财富 · 行情、基金、公告与宏观资料" action={<Database size={20}/>}>
    <Field label="妙想 API Key（当前会话）"><input type="password" autoComplete="new-password" spellCheck={false} value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="填写妙想平台申请的 Key"/></Field>
    <div className="button-row"><button className="secondary" disabled={state.busy||!apiKey.trim()} onClick={()=>void state.run(async signal=>{const tools=await testMxConnection(apiKey,signal);if(!signal.aborted)state.setMessage(`连接成功 · 可用 ${tools.length} 类查询工具`);})}><PlugZap size={16}/>{state.busy?'正在连接…':'验证妙想连接'}</button>{state.busy&&<button className="text-button" onClick={state.cancel}>取消</button>}</div>
    {state.message&&<p role="status">{state.message}</p>}{state.error&&<p className="notice error" role="alert">{state.error}</p>}
    <p className="muted">在“市场资料”中查询，再选择加入 AI 分析。妙想只接收你输入的查询词；不会自动发送账本、账户余额或持仓数量。需要跨次使用时，可在下方密钥库中加密保存。</p>
    <details><summary>服务地址</summary><p className="muted">{MX_ENDPOINT}</p></details>
  </Panel>;
}
export function MiaoxiangPanel({apiKey,onAttach,goSettings}:{apiKey:string;onAttach:(result:MxResult)=>void;goSettings:()=>void}) {
  const [tool,setTool]=useState<MxTool>('mx_ashare_finance_data'),[query,setQuery]=useState(''),[result,setResult]=useState<MxResult|null>(null);
  const state=useMxRequest(apiKey);
  useEffect(()=>setResult(null),[apiKey]);
  return <div className="stack"><Panel title="妙想市场资料" subtitle="查询公开金融数据，再带着资料和 AI 讨论" action={<span className="pill">东方财富</span>}>
    {!apiKey&&<div className="notice">请先配置妙想 API Key。<button className="text-button" onClick={goSettings}>前往偏好与连接 <ArrowUpRight size={15}/></button></div>}
    <Field label="查询类型"><select value={tool} disabled={state.busy} onChange={e=>setTool(e.target.value as MxTool)}>{MX_TOOLS.map(x=><option key={x.name} value={x.name}>{x.label}</option>)}</select></Field>
    <Field label="查询内容" hint="写清证券名称或代码、指标和时间范围。筛选时每次只查询一种品种。"><textarea rows={3} maxLength={500} disabled={state.busy} value={query} onChange={e=>setQuery(e.target.value)} placeholder="例如：贵州茅台（600519.SH）的最新价和行情时间"/></Field>
    <div className="button-row"><button className="primary" disabled={state.busy||!apiKey.trim()||!query.trim()} onClick={()=>void state.run(async signal=>{setResult(null);const next=await queryMx(apiKey,tool,query,signal);if(!signal.aborted)setResult(next);})}><Search size={16}/>{state.busy?'正在查询妙想…':'查询妙想'}</button>{state.busy&&<button className="secondary" onClick={state.cancel}><Square size={14}/>取消</button>}</div>
    <p className="muted">仅将上方查询内容发送至东方财富妙想，调用可能消耗服务额度。数据可能延迟，请核对结果中的日期与单位；查询不会修改持仓估值或执行交易。</p>
    {state.error&&<div className="notice error" role="alert">{state.error}</div>}
  </Panel>{result&&<Panel title="查询结果" subtitle={`${MX_TOOLS.find(x=>x.name===result.tool)?.label} · 查询于 ${new Date(result.retrievedAt).toLocaleString('zh-CN')}`} action={<button className="primary" onClick={()=>onAttach(result)}>用于 AI 分析 <ArrowUpRight size={16}/></button>}>
    <p>{result.query}</p><p className="muted">查询时间不等于行情或报告日期。下列内容由妙想返回，AI 分析前请先核对。</p>
    {result.warnings.map(w=><p className="notice" key={w}>{w}</p>)}
    {result.tables.map((table,index)=><div className="mx-sheet" key={index}><h3>{table.title}</h3><div className="mx-table-scroll" role="region" aria-label={table.title} tabIndex={0}><table><thead><tr>{table.columns.map((col,i)=><th scope="col" key={i}>{col}</th>)}</tr></thead><tbody>{table.rows.map((row,i)=><tr key={i}>{row.map((value,j)=>j===0?<th scope="row" key={j}>{value}</th>:<td key={j}>{value}</td>)}</tr>)}</tbody></table></div></div>)}
    <details open={!result.tables.length}><summary>查看查询资料文本</summary><div className="markdown mx-text"><Markdown components={{img:()=>null,a:({href,children})=><a href={href} target="_blank" rel="noopener noreferrer">{children}</a>}}>{result.text}</Markdown></div></details>
    {result.sources.length>0&&<div className="source-list"><h4>服务返回的网页来源</h4>{result.sources.map((s,i)=><a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer"><span>{i+1}</span>{s.title}<ArrowUpRight size={15}/></a>)}</div>}
  </Panel>}</div>;
}
