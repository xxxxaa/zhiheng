import {withTimeout} from './abort';
import {serviceFetch} from './transport';
import {apiUrl,type AIConfig} from './ai';
import {db,setMeta} from './db';
import type {SearchConfig} from './search';

export type ModelOption={id:string;name:string};
// Official catalog checked 2026-10-21. Refresh keeps this selector usable as IDs evolve.
export const deepSeekModels:ModelOption[]=[
  {id:'deepseek-flash',name:'DeepSeek Flash'},
  {id:'deepseek-v4-pro',name:'DeepSeek V4 Pro'},
];
export function parseModels(raw:unknown):ModelOption[]{
  const data=(raw as {data?:unknown})?.data;
  if(!Array.isArray(data)||data.length>500)throw new Error('模型列表格式不正确');
  const models=new Map<string,ModelOption>();
  for(const item of data){
    if(!item||typeof item.id!=='string'||!item.id.trim()||item.id.length>100||/\s|[\x00-\x1f\x7f]/.test(item.id))continue;
    if(Array.isArray(item.output_modalities)&&!item.output_modalities.includes('text'))continue;
    models.set(item.id,{id:item.id,name:typeof item.name==='string'&&item.name.trim()?item.name.trim().slice(0,100):item.id});
  }
  if(!models.size)throw new Error('服务没有返回可选的文本模型，请保留原选择或手动填写');
  return [...models.values()];
}
export async function fetchDeepSeekModels(apiKey:string,signal?:AbortSignal){
  if(!apiKey.trim())throw new Error('请先填写 DeepSeek API Key');
  const controller=new AbortController();
  const cancel=()=>controller.abort(signal?.reason);
  if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
  try{
    const response=await serviceFetch('https://api.deepseek.com/models',{
      method:'GET',headers:{Authorization:`Bearer ${apiKey.trim()}`,Accept:'application/json'},
      credentials:'omit',redirect:'error',signal:withTimeout(20000,controller.signal),
    });
    if(response.status===401||response.status===403)throw new Error('无法获取模型，请检查 DeepSeek API Key 和访问权限');
    if(response.status===429)throw new Error('模型列表请求过于频繁，请稍后重试');
    if(!response.ok)throw new Error(`获取模型失败（${response.status}），请稍后重试`);
    return parseModels(await response.json());
  }finally{controller.abort();signal?.removeEventListener('abort',cancel);}
}
export async function saveAIConnection(config:AIConfig,search:SearchConfig){
  const next={...config,baseUrl:config.baseUrl.trim(),model:config.model.trim()};
  apiUrl(next);
  if(!next.model||next.model.length>100||/\s|[\x00-\x1f\x7f]/.test(next.model))throw new Error('请选择或填写有效模型名（不超过 100 字符，不含空格）');
  const nextSearch=next.protocol==='chat'&&search.provider==='builtin'?{...search,provider:'none' as const}:search;
  next.webSearch=nextSearch.provider==='builtin';
  await db.transaction('rw',db.meta,async()=>{
    await setMeta('ai',next);
    if(nextSearch!==search)await setMeta('search',nextSearch);
  });
}
