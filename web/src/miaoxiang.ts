import {z} from 'zod';
import {serviceFetch} from './transport';
import {checkAborted} from './abort';

export const MX_ENDPOINT = 'https://mxapi.eastmoney.com/mxds/mcp';
export const MX_TOOLS = [
  {name:'mx_ashare_finance_data',label:'A 股行情与财务'},
  {name:'mx_hk_finance_data',label:'港股行情与财务'},
  {name:'mx_us_finance_data',label:'美股行情与财务'},
  {name:'mx_fund_finance_data',label:'基金净值与持仓'},
  {name:'mx_bond_finance_data',label:'债券数据'},
  {name:'mx_index_block_finance_data',label:'指数与板块'},
  {name:'mx_macro_data',label:'宏观与行业数据'},
  {name:'mx_finance_search_notice',label:'公告与官方披露'},
  {name:'mx_finance_search_news',label:'新闻与研报'},
  {name:'mx_stocks_screener',label:'条件筛选（每次一种品种）'},
  {name:'mx_comprehensive_finance_data',label:'其他及跨市场数据'},
] as const;
export type MxTool = typeof MX_TOOLS[number]['name'];
export type MxTable = {title:string;columns:string[];rows:string[][]};
export type MxResult = {id:string;query:string;tool:MxTool;retrievedAt:string;text:string;tables:MxTable[];sources:{url:string;title:string}[];warnings:string[]};
const MAX_RESPONSE = 2_000_000;
const toolList = z.object({tools:z.array(z.object({name:z.string(),inputSchema:z.object({type:z.literal('object'),properties:z.record(z.unknown()),required:z.array(z.string()).optional()})})).max(200),nextCursor:z.string().optional()});
const object = (x:unknown):x is Record<string,unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function envelope(value:unknown,id:number) {
  if(!object(value) || value.jsonrpc !== '2.0' || value.id !== id) throw new Error('妙想返回的响应编号或格式无效');
  if(value.error) throw new Error('妙想请求未完成，请稍后重试或检查服务权限');
  if(!('result' in value)) throw new Error('妙想未返回查询结果');
  return value.result;
}
/** Streamed responses may include progress notifications; only accept the matching result. */
async function readRpc(response:Response,id:number,signal:AbortSignal):Promise<unknown> {
  const sse = response.headers.get('content-type')?.includes('text/event-stream');
  const reader = response.body?.getReader();
  if(!reader) throw new Error('妙想返回了空响应');
  const decoder = new TextDecoder(); let bytes=0, buffer='';
  const cancel=()=>{void reader.cancel().catch(()=>{});};
  signal.addEventListener('abort',cancel,{once:true});
  try {
    while(true) {
      checkAborted(signal);
      const {value,done}=await reader.read(); checkAborted(signal);
      bytes+=value?.byteLength||0;
      if(bytes>MAX_RESPONSE) throw new Error('妙想返回内容过大，请缩小查询范围');
      buffer+=decoder.decode(value,{stream:!done});
      if(sse) {
        buffer=buffer.replace(/\r\n/g,'\n');
        let end:number;
        while((end=buffer.indexOf('\n\n'))>=0 || (done&&buffer.length>0)) {
          if(end<0) end=buffer.length;
          const event=buffer.slice(0,end); buffer=buffer.slice(end+2);
          const data=event.split('\n').filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trimStart()).join('\n');
          if(!data || data==='[DONE]') continue;
          let parsed:unknown; try{parsed=JSON.parse(data);}catch{throw new Error('妙想返回了无效的事件数据');}
          if(object(parsed)&&parsed.id===id) return envelope(parsed,id);
        }
      }
      if(done) break;
    }
    if(sse) throw new Error('妙想连接已结束，但没有完整查询结果');
    let parsed:unknown;try{parsed=JSON.parse(buffer);}catch{throw new Error('妙想返回了无效 JSON');}
    return envelope(parsed,id);
  } finally {signal.removeEventListener('abort',cancel);await reader.cancel().catch(()=>{});}
}

async function session<T>(apiKey:string,parent:AbortSignal|undefined,work:(rpc:(method:string,params?:unknown)=>Promise<unknown>)=>Promise<T>):Promise<T> {
  const key=apiKey.trim(); if(!key||/[\r\n]/.test(key)) throw new Error('请填写有效的妙想 API Key');
  const controller=new AbortController(); const cancel=()=>controller.abort(parent?.reason);
  parent?.addEventListener('abort',cancel,{once:true}); if(parent?.aborted) cancel();
  const timer=setTimeout(()=>controller.abort(new DOMException('妙想查询超时，请缩小范围后重试','TimeoutError')),90000);
  const headers:Record<string,string>={'Content-Type':'application/json',Accept:'application/json, text/event-stream',em_api_key:key};
  let seq=0;
  async function request(method:string,params?:unknown,notification=false) {
    checkAborted(controller.signal); const id=++seq;
    const response=await serviceFetch(MX_ENDPOINT,{method:'POST',headers,credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal,body:JSON.stringify({jsonrpc:'2.0',...(notification?{}:{id}),method,...(params===undefined?{}:{params})})});
    checkAborted(controller.signal);
    if(!response.ok) {
      await response.body?.cancel();
      if([401,403].includes(response.status)) throw new Error('妙想鉴权失败，请检查 API Key 和数据访问权限');
      if(response.status===429) throw new Error('妙想请求过于频繁或额度不足，请稍后重试');
      if(response.status===404&&headers['Mcp-Session-Id']) throw new Error('妙想会话已失效，请重新查询');
      throw new Error(`妙想服务暂不可用（${response.status}）`);
    }
    const sid=response.headers.get('Mcp-Session-Id');
    if(sid) {if(sid.length>256||/[^\x21-\x7E]/.test(sid)) throw new Error('妙想会话标识无效');headers['Mcp-Session-Id']=sid;}
    if(notification) {await response.body?.cancel();return;}
    return readRpc(response,id,controller.signal);
  }
  try {
    const init=await request('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'zhiheng',version:'1.0'}});
    const parsed=z.object({protocolVersion:z.enum(['2024-11-05','2025-03-26','2025-06-18','2025-11-25']),serverInfo:z.object({name:z.literal('mx-ds-mcp')})}).safeParse(init);
    if(!parsed.success) throw new Error('妙想服务或协议不匹配，请更新 App 后重试');
    headers['MCP-Protocol-Version']=parsed.data.protocolVersion;
    await request('notifications/initialized',undefined,true);
    return await work(request);
  } finally {clearTimeout(timer);parent?.removeEventListener('abort',cancel);}
}
async function available(rpc:(method:string,params?:unknown)=>Promise<unknown>) {
  const names=new Set<string>(); let cursor:string|undefined; const seen=new Set<string>();
  for(let page=0;page<5;page++) {
    const result=toolList.safeParse(await rpc('tools/list',cursor?{cursor}:{}));
    if(!result.success) throw new Error('妙想工具列表格式已变化，请更新 App');
    for(const tool of result.data.tools) {
      const query=tool.inputSchema.properties.query;
      if(object(query)&&query.type==='string'&&!(tool.inputSchema.required||[]).some(x=>x!=='query')) names.add(tool.name);
    }
    cursor=result.data.nextCursor;
    if(!cursor) return MX_TOOLS.filter(x=>names.has(x.name));
    if(seen.has(cursor)) break; seen.add(cursor);
  }
  throw new Error('妙想工具列表分页异常');
}
export async function testMxConnection(key:string,signal?:AbortSignal) {
  return session(key,signal,async rpc=>{const tools=await available(rpc);if(!tools.length)throw new Error('妙想未开放本 App 支持的查询工具');return tools;});
}
export function safeMxSource(value:string) {
  try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(u.hostname==='eastmoney.com'||u.hostname.endsWith('.eastmoney.com'))?u.href:null;}catch{return null;}
}
/** Keep dated provider tables as evidence; never infer a ledger price from natural language output. */
export function parseMxResult(raw:unknown,query:string,tool:MxTool,now=new Date()):MxResult {
  if(!object(raw)||raw.isError===true) throw new Error('妙想未完成查询，请检查关键词、服务额度或工具权限');
  const content=Array.isArray(raw.content)?raw.content:[];
  const chunks=content.filter(x=>object(x)&&x.type==='text'&&typeof x.text==='string').map(x=>String(x.text));
  if(!chunks.length&&object(raw.structuredContent)) chunks.push(JSON.stringify(raw.structuredContent));
  if(!chunks.some(x=>x.trim())) throw new Error('妙想没有返回可用数据，请调整查询词');
  const tables:MxTable[]=[], sources:MxResult['sources']=[], warnings:string[]=[]; const texts:string[]=[];
  let truncated=false;
  function links(value:unknown,depth=0) {
    if(depth>12) return;
    if(typeof value==='string') {const url=safeMxSource(value);if(url&&!sources.some(x=>x.url===url)&&sources.length<30)sources.push({url,title:'东方财富数据来源'});}
    else if(Array.isArray(value)) value.slice(0,500).forEach(x=>links(x,depth+1));
    else if(object(value)) Object.values(value).slice(0,100).forEach(x=>links(x,depth+1));
  }
  const cell=(x:unknown)=>typeof x==='string'||typeof x==='number'||typeof x==='boolean'?String(x):x==null?'—':JSON.stringify(x);
  for(const chunk of chunks) {
    let parsed:unknown;try{parsed=JSON.parse(chunk);}catch{parsed=null;}
    links(parsed);
    const sheets=object(parsed)&&Array.isArray(parsed.data)?parsed.data:[];
    let handled=0;
    for(const sheet of sheets) {
      if(!object(sheet)||!Array.isArray(sheet.columns)||!sheet.columns.length||!Array.isArray(sheet.items)||!sheet.items.every(Array.isArray)) continue;
      const title=typeof sheet.sheetName==='string'?sheet.sheetName:'妙想查询数据';
      const columns=sheet.columns.map(cell),rows=(sheet.items as unknown[][]).map(row=>row.map(cell));
      tables.push({title,columns:columns.slice(0,12),rows:rows.slice(0,40).map(row=>row.slice(0,12))});
      texts.push(`${title}\n${JSON.stringify({columns,rows})}`);handled++;
      if(columns.length>12||rows.length>40) truncated=true;
    }
    if(!handled||handled!==sheets.length) texts.push(parsed?JSON.stringify(parsed,null,2):chunk);
  }
  const full=texts.join('\n\n');
  if(full.length>32000||truncated||tables.length>20) warnings.push('结果较多，预览或分析资料已截取；请缩小范围以核对完整数据。');
  if(!sources.length) warnings.push('服务未提供可打开的东方财富网页来源，请结合返回日期核对数据。');
  return {id:crypto.randomUUID(),query,tool,retrievedAt:now.toISOString(),text:full.slice(0,32000),tables:tables.slice(0,20),sources,warnings};
}
export async function queryMx(key:string,tool:MxTool,query:string,signal?:AbortSignal) {
  if(!MX_TOOLS.some(x=>x.name===tool)) throw new Error('不支持的妙想工具');
  const clean=query.trim();if(!clean||Array.from(clean).length>500) throw new Error('妙想查询词需为 1–500 个字符');
  return session(key,signal,async rpc=>{
    if(!(await available(rpc)).some(x=>x.name===tool)) throw new Error('当前 Key 未开放所选妙想工具');
    return parseMxResult(await rpc('tools/call',{name:tool,arguments:{query:clean}}),clean,tool);
  });
}
