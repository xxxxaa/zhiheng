import {describe,expect,it,vi} from 'vitest';
import {serviceWorkerSource} from '../build/service-worker';

const files=['/index.html','/assets/app.js','/assets/app.css'];
function worker(){
  const handlers:Record<string,(event:any)=>void>={};
  const data=new Map<string,Response>();
  const cache={addAll:vi.fn(async(urls:string[])=>{for(const url of urls)data.set(url,new Response(url));}),match:vi.fn(async(url:string)=>data.get(url)?.clone())};
  const caches={open:vi.fn(async()=>cache),keys:vi.fn(async()=>['unrelated-cache','zhiheng-old','zhiheng-shell-v2-test']),delete:vi.fn(async()=>true)};
  const fetch=vi.fn(async()=>{throw new TypeError('offline');});
  const self={location:{origin:'https://app.example'},clients:{claim:vi.fn(async()=>{})},addEventListener:(name:string,handler:(event:any)=>void)=>{handlers[name]=handler;}};
  // Execute the actual generated worker in an isolated test harness; no browser automation.
  new Function('self','caches','fetch',serviceWorkerSource(files,'test'))(self,caches,fetch);
  const lifetime=async(name:string,extra:Record<string,unknown>={})=>{let completion:Promise<unknown>|undefined;handlers[name]({...extra,waitUntil:(p:Promise<unknown>)=>{completion=p;}});await completion;};
  const request=(path:string,mode='navigate',method='GET')=>{let response:Promise<Response>|undefined;handlers.fetch({request:{url:new URL(path,'https://app.example').href,mode,method},respondWith:(p:Promise<Response>)=>{response=p;}});return response;};
  return {data,cache,caches,fetch,self,lifetime,request};
}
describe('离线应用页面',()=>{
  it('下载完成才安装；下载失败会拒绝安装',async()=>{
    const w=worker();await w.lifetime('install');expect(w.cache.addAll).toHaveBeenCalledWith(files);
    w.cache.addAll.mockRejectedValueOnce(new Error('download failed'));await expect(w.lifetime('install')).rejects.toThrow('download failed');
  });
  it('断网后根路径和带示例参数的导航均返回已缓存页面',async()=>{
    const w=worker();await w.lifetime('install');
    for(const path of ['/','/?demo=1','/index.html'])expect(await (await w.request(path))?.text()).toBe('/index.html');
    expect(await (await w.request('/assets/app.js','same-origin'))?.text()).toBe('/assets/app.js');
  });
  it('缺失缓存返回可读的错误，不返回空白页面',async()=>{
    const w=worker(),response=await w.request('/');expect(response?.status).toBe(503);expect(await response?.text()).toContain('离线页面尚未准备好');
  });
  it('缓存完整性反馈能识别丢失的单个文件',async()=>{
    const w=worker();await w.lifetime('install');const postMessage=vi.fn();
    const request={data:{type:'zhiheng-offline-status'},ports:[{postMessage}]};
    await w.lifetime('message',request);expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ready:true}));
    w.data.delete('/assets/app.js');await w.lifetime('message',request);expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ready:false}));
  });
  it('不接管外部服务、同源 API、POST 或未知导航',()=>{
    const w=worker();expect(w.request('https://api.deepseek.com/v1/tools/search','cors','POST')).toBeUndefined();
    expect(w.request('/api/account','same-origin')).toBeUndefined();expect(w.request('/private','navigate')).toBeUndefined();
    expect(w.request('/index.html','same-origin','POST')).toBeUndefined();expect(w.request('/assets/app.js?token=private','same-origin')).toBeUndefined();
    expect(w.fetch).not.toHaveBeenCalled();expect(w.caches.open).not.toHaveBeenCalled();
  });
  it('升级只清理知衡旧缓存，不影响账本或同源其他缓存',async()=>{
    const w=worker();await w.lifetime('activate');expect(w.caches.delete.mock.calls).toEqual([['zhiheng-old']]);expect(w.self.clients.claim).toHaveBeenCalledOnce();
  });
});
