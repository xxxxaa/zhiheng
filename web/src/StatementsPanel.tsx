import {useEffect,useRef,useState} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import {Upload,Check,Trash2,FileSpreadsheet} from 'lucide-react';
import {Panel,Field,Empty,Modal} from './App';
import {type Account,money} from './model';
import {db} from './db';
import {isNative} from './native';
import {readStatementFile} from './statement-file';
import type {StatementFile} from './statement-reader';
import {categoryLabels,reviewLabels,statementSources,type Statement,type StatementSource,type StatementBatch} from './statement-model';
import {detectStatement,suggestMapping,parseStatementRows,mappingLabels,planStatementImport,commitStatementImport,reviewStatement,removeStatementBatch,type Mapping,type AmountMode,type StatementPlan} from './statements';

export function StatementsPanel({accounts,demo,hidden,goAccounts,notify}:{accounts:Account[];demo:boolean;hidden:boolean;goAccounts:()=>void;notify:(s:string)=>void}){
  const rows=useLiveQuery(()=>db.statements.toArray(),[])||[];
  const batches=useLiveQuery(()=>db.statementBatches.orderBy('importedAt').reverse().toArray(),[])||[];
  const [source,setSource]=useState<StatementSource>('alipay'),[accountId,setAccountId]=useState('');
  const [file,setFile]=useState<StatementFile|null>(null),[sheetIndex,setSheetIndex]=useState(0),[header,setHeader]=useState(0),[mapping,setMapping]=useState<Mapping>(()=>suggestMapping([])),[mode,setMode]=useState<AmountMode>('direction');
  const [preview,setPreview]=useState<StatementPlan|null>(null),[issues,setIssues]=useState<string[]>([]),[ignored,setIgnored]=useState(0),[ack,setAck]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[filter,setFilter]=useState('pending'),[batchFilter,setBatchFilter]=useState('all'),[page,setPage]=useState(0),[remove,setRemove]=useState<StatementBatch|null>(null);
  const reading=useRef<AbortController|null>(null),generation=useRef(0),active=useRef(true);
  useEffect(()=>{active.current=true;return()=>{active.current=false;generation.current++;reading.current?.abort();};},[]);
  useEffect(()=>{generation.current++;reading.current?.abort();setBusy(false);setPreview(null);setFile(null);setIssues([]);},[demo]);
  const sheet=file?.sheets[sheetIndex],headers=sheet?.rows[header]||[];
  const account=accounts.find(a=>a.id===accountId);
  const eligible=accounts.filter(a=>source==='alipay'?a.platform==='支付宝':source==='wechat'?a.platform==='微信钱包':source==='cmb'||source==='pingan'?a.platform==='银行卡':true);
  function invalidate(){generation.current++;setPreview(null);setIssues([]);setAck(false);setError('');}
  function selectSheet(f:StatementFile,i:number){const detected=detectStatement(f.sheets[i]);setSheetIndex(i);setHeader(detected.header);setMapping(detected.mapping);setMode(detected.mapping.direction>=0?'direction':detected.mapping.income>=0&&detected.mapping.expense>=0?'split':'direction');if(detected.source){setSource(detected.source);setAccountId('');}invalidate();}
  async function chooseFile(f:File){
    reading.current?.abort();const controller=new AbortController();reading.current=controller;invalidate();const token=generation.current;setBusy(true);setFile(null);
    try{const result=await readStatementFile(f,controller.signal);if(!active.current||token!==generation.current)return;setFile(result);selectSheet(result,0);}
    catch(e){if(active.current&&!controller.signal.aborted)setError(e instanceof Error?e.message:'读取失败');}
    finally{if(active.current&&reading.current===controller){setBusy(false);reading.current=null;}}
  }
  async function prepare(){
    if(!account||!file||!sheet)return;invalidate();const token=generation.current;setBusy(true);
    try{const parsed=parseStatementRows(sheet,header,mapping,mode);setIssues(parsed.errors);setIgnored(parsed.ignored);if(parsed.errors.length)return;
      const fingerprint=file.hash+':'+sheetIndex+':'+header;
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(fingerprint))),b=>b.toString(16).padStart(2,'0')).join('');
      const plan=await planStatementImport(account,source,file.name,hash,parsed.rows);
      if(active.current&&token===generation.current)setPreview(plan);
    }catch(e){if(active.current)setError(e instanceof Error?e.message:'预览失败');}
    finally{if(active.current)setBusy(false);}
  }
  async function run(action:()=>Promise<unknown>){if(demo||busy)return;setBusy(true);setError('');try{await action();}catch(e){if(active.current)setError(e instanceof Error?e.message:'操作失败');}finally{if(active.current)setBusy(false);}}
  const batchCounts=new Map<string,number>();for(const row of rows)batchCounts.set(row.batchId,(batchCounts.get(row.batchId)||0)+1);
  const visible=demo?[]:rows.filter(r=>(filter==='all'||r.review===filter)&&(batchFilter==='all'||r.batchId===batchFilter)).sort((a,b)=>b.time.localeCompare(a.time)||a.id.localeCompare(b.id));
  useEffect(()=>setPage(0),[filter,batchFilter,rows.length]);
  if(demo)return <Empty title="用自己的账单开始核对"><p>退出示例模式后，可导入支付宝、微信 CSV / XLSX 账单，或映射银行表格列。处理在本机完成。</p></Empty>;
  return <div className="stack statements-page">
    <div className="notice">手机账单导入：先在原平台导出文件，再由知衡解析。这里保存交易流水，余额、存款和持仓仍在“账户与持仓”中校准。</div>
    {error&&<div className="notice error" role="alert">{error}</div>}
    <Panel title="导入账单" subtitle="支持 CSV、XLSX · 本机处理 · 先预览再保存">
      <p className="muted">支付宝、微信支持按常见表头识别；招商、平安等银行表格需核对列。ZIP 请先解压，旧版 XLS 请转存为 XLSX。PDF 和截图暂不支持。每份文件只导入一个账户、人民币流水。</p>
      <label className={'import-drop '+(busy?'disabled':'')}><Upload/><span>{busy?'正在处理…':'选择手机中的账单文件（最多 5 MB）'}</span><input aria-label="选择账单文件" type="file" accept={isNative()?'*/*':'.csv,.xlsx'} disabled={busy} onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void chooseFile(f);}}/></label>
      {reading.current&&<button className="secondary" onClick={()=>reading.current?.abort()}>取消读取</button>}
      <div className="form-grid"><Field label="账单来源"><select value={source} disabled={busy} onChange={e=>{setSource(e.target.value as StatementSource);setAccountId('');invalidate();}}>{Object.entries(statementSources).map(([id,name])=><option value={id} key={id}>{name}</option>)}</select></Field>
      <Field label="归属账户"><select value={accountId} disabled={busy} onChange={e=>{setAccountId(e.target.value);invalidate();}}><option value="">请选择账单所属账户</option>{eligible.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></Field></div>
      {!eligible.length&&<button className="text-button" onClick={goAccounts}>先添加对应平台的账户</button>}
      {file&&sheet&&<>
        <p className="muted"><FileSpreadsheet size={16}/> {file.name} · {file.encoding}</p>
        <div className="form-grid"><Field label="工作表"><select value={sheetIndex} disabled={busy} onChange={e=>selectSheet(file,Number(e.target.value))}>{file.sheets.map((s,i)=><option key={i} value={i}>{s.name}</option>)}</select></Field>
        <Field label="表头所在行"><select value={header} disabled={busy} onChange={e=>{const i=Number(e.target.value);setHeader(i);setMapping(suggestMapping(sheet.rows[i]||[]));invalidate();}}>{sheet.rows.slice(0,80).map((r,i)=><option value={i} key={i}>第 {i+1} 行 · {r.filter(Boolean).join(' / ').slice(0,70)||'空行'}</option>)}</select></Field></div>
        <Field label="金额与收支如何记录"><select value={mode} disabled={busy} onChange={e=>{setMode(e.target.value as AmountMode);invalidate();}}><option value="direction">金额 + 收 / 支方向列</option><option value="signed">带正负号的金额（正数收入、负数支出）</option><option value="split">收入金额和支出金额分列</option></select></Field>
        <div className="form-grid">{(['time',...(mode==='split'?['income','expense']:mode==='direction'?['amount','direction']:['amount'])] as (keyof Mapping)[]).map(key=><Column key={key} field={key} value={mapping[key]} headers={headers} disabled={busy} change={value=>{setMapping(m=>({...m,[key]:value}));invalidate();}}/>)}</div>
        <details className="statement-fields"><summary>核对订单号、付款方式等可选列</summary><div className="form-grid">{(['sourceId','counterparty','description','paymentMethod','status','currency'] as (keyof Mapping)[]).map(key=><Column key={key} field={key} value={mapping[key]} headers={headers} disabled={busy} change={value=>{setMapping(m=>({...m,[key]:value}));invalidate();}}/>)}</div></details>
        <button className="secondary" disabled={!account||busy} onClick={()=>void prepare()}>解析并预览</button>
      </>}
      {issues.length>0&&<div className="notice error" role="alert"><strong>{issues.length} 行需要修正，尚未导入</strong>{issues.slice(0,15).map((text,i)=><p key={i}>{text}</p>)}{issues.length>15&&<p>请修正列映射或原文件后重新预览。</p>}</div>}
      {preview&&<div className="statement-preview"><h3>{preview.rows.length} 笔可导入 · {preview.duplicates} 笔重复</h3><p className="muted">已跳过 {ignored} 行说明或合计。所有新记录先进入待核对，不会改写资产余额。</p>
        {!!preview.conflicts.length&&<div className="notice error">{preview.conflicts.slice(0,10).map((text,i)=><p key={i}>{text}</p>)}</div>}
        {!!preview.possibleDuplicates&&<p className="notice">{preview.possibleDuplicates} 笔与已有记录同日、同方向、同金额，需要核对是否为银行卡和支付渠道对同一笔交易的重复记录。</p>}
        {preview.rows.slice(0,20).map(r=><div className="statement-preview-row" key={r.id}><div><strong>{r.counterparty||r.description||'未提供交易对方'}</strong><small>{r.time} · {r.paymentMethod||'未提供付款方式'} · {r.status||'未提供状态'}</small></div><b>{hidden?'••••':`${r.direction==='in'?'+':r.direction==='out'?'-':''}${money(r.amount)}`}</b></div>)}
        {preview.rows.length>20&&<p className="muted">预览前 20 笔；保存后可分页核对全部 {preview.rows.length} 笔。</p>}
        {!!preview.rows.length&&<label className="checkbox"><input type="checkbox" checked={ack} disabled={busy} onChange={e=>setAck(e.target.checked)}/>已确认归属“{account?.name}”，为人民币流水，列映射与收支方向正确</label>}
        <button className="primary" disabled={busy||!ack||!preview.rows.length||!!preview.conflicts.length} onClick={()=>void run(async()=>{await commitStatementImport(preview);setPreview(null);setFile(null);setAck(false);setFilter('pending');setBatchFilter('all');notify(`已保存 ${preview.rows.length} 笔待核对流水`);})}><Check size={16}/>保存 {preview.rows.length} 笔流水</button>
      </div>}
    </Panel>
    <Panel title="交易流水" subtitle="付款方式、退款和本人互转需核对；流水不会叠加到总资产，也暂不汇总跨平台收支">
      <div className="table-toolbar"><select aria-label="核对状态" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">全部状态（{rows.length}）</option>{Object.entries(reviewLabels).map(([id,name])=><option value={id} key={id}>{name}（{rows.filter(r=>r.review===id).length}）</option>)}</select><select aria-label="导入批次" value={batchFilter} onChange={e=>setBatchFilter(e.target.value)}><option value="all">全部批次</option>{batches.map(b=><option key={b.id} value={b.id}>{b.fileName} · {new Date(b.importedAt).toLocaleDateString('zh-CN')}</option>)}</select></div>
      {visible.slice(page*30,(page+1)*30).map(row=><StatementCard key={row.id} row={row} accountName={accounts.find(a=>a.id===row.accountId)?.name||'未知账户'} hidden={hidden} busy={busy} run={run}/>)}
      {!visible.length&&<Empty title="没有符合筛选条件的流水"><p>导入文件后在这里逐笔核对，或切换筛选条件。</p></Empty>}
      {visible.length>30&&<div className="button-row"><button className="secondary" disabled={!page} onClick={()=>setPage(p=>p-1)}>上一页</button><span>{page+1} / {Math.ceil(visible.length/30)}</span><button className="secondary" disabled={(page+1)*30>=visible.length} onClick={()=>setPage(p=>p+1)}>下一页</button></div>}
    </Panel>
    {!!batches.length&&<Panel title="导入记录" subtitle="批次随加密备份保存；移除批次会删除其中的流水及核对结果"><div className="statement-batches">{batches.map(batch=><div key={batch.id}><div><strong>{batch.fileName}</strong><small>{statementSources[batch.source]} · {accounts.find(a=>a.id===batch.accountId)?.name} · {new Date(batch.importedAt).toLocaleString('zh-CN')} · {batchCounts.get(batch.id)||0} 笔</small></div><button className="icon-button" disabled={busy} aria-label={'移除批次 '+batch.fileName} onClick={()=>{setError('');setRemove(batch);}}><Trash2 size={16}/></button></div>)}</div></Panel>}
    <p className="muted">流水在本机保存，并纳入加密文件和云备份。新格式备份需要知衡 0.1.8 或更新版本恢复；支持恢复旧版资产备份。</p>
    {remove&&<Modal title="移除这批流水" close={()=>{if(!busy)setRemove(null);}}><p>将删除“{remove.fileName}”内的 {rows.filter(r=>r.batchId===remove.id).length} 笔流水及核对结果。资产余额不受影响；之后可重新导入原文件。</p>{error&&<p className="notice error">{error}</p>}<div className="button-row"><button className="secondary" disabled={busy} onClick={()=>setRemove(null)}>取消</button><button className="primary" disabled={busy} onClick={()=>void run(async()=>{await removeStatementBatch(remove.id);setRemove(null);setBatchFilter('all');setPreview(null);notify('已移除该批次流水');})}>确认移除</button></div></Modal>}
  </div>;
}
function Column({field,value,headers,disabled,change}:{field:keyof Mapping;value:number;headers:string[];disabled:boolean;change:(n:number)=>void}){return <Field label={mappingLabels[field]}><select value={value} disabled={disabled} onChange={e=>change(Number(e.target.value))}><option value={-1}>请选择 / 文件未提供</option>{headers.map((h,i)=><option value={i} key={i}>第 {i+1} 列 · {h||'无标题'}</option>)}</select></Field>;}
function StatementCard({row,accountName,hidden,busy,run}:{row:Statement;accountName:string;hidden:boolean;busy:boolean;run:(f:()=>Promise<unknown>)=>Promise<void>}){
  const [category,setCategory]=useState(row.category);
  useEffect(()=>setCategory(row.category),[row.category]);
  return <article className="statement-card"><div className="statement-preview-row"><div><strong>{row.counterparty||row.description||'未提供交易对方'}</strong><small>{row.time} · {accountName} · {statementSources[row.source]}</small></div><b>{hidden?'••••':`${row.direction==='in'?'+':row.direction==='out'?'-':''}${money(row.amount)}`}</b></div>
    <p>{row.description||'未提供摘要'}</p><p className="muted">付款方式：{row.paymentMethod||'未提供'} · 原始状态：{row.status||'未提供'} · {reviewLabels[row.review]}</p>
    {row.sourceId&&<details><summary>订单号</summary><code className="break">{row.sourceId}</code></details>}
    <div className="statement-review"><select aria-label={'流水分类 '+row.id} value={category} disabled={busy} onChange={e=>setCategory(e.target.value as Statement['category'])}>{Object.entries(categoryLabels).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select><button className="secondary" disabled={busy} onClick={()=>void run(()=>reviewStatement(row,'confirmed',category))}>核对保存</button>{row.review==='excluded'?<button className="text-button" disabled={busy} onClick={()=>void run(()=>reviewStatement(row,'pending',category))}>重新核对</button>:<button className="text-button" disabled={busy} onClick={()=>void run(()=>reviewStatement(row,'excluded',category))}>不计入收支</button>}</div>
  </article>;
}
