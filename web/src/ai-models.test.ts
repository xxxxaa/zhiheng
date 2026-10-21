import 'fake-indexeddb/auto';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {defaultAI,isDeepSeek,research,type AIConfig} from './ai';
import {fetchDeepSeekModels,parseModels,saveAIConnection} from './ai-models';
import {db,getMeta,setMeta} from './db';
import {defaultProfile} from './model';
import {defaultSearch,type SearchConfig} from './search';

beforeEach(async()=>{await db.meta.clear();});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
describe('DeepSeek 模型列表',()=>{
  it('接受新旧列表格式，去重并排除无效 ID 和非文本输出',()=>{
    expect(parseModels({data:[{id:'deepseek-flash',name:'Flash'},{id:'deepseek-flash',name:'Flash 更新'},{id:'new-text-model'},{id:'bad model'},{id:'image',output_modalities:['image']},null]})).toEqual([{id:'deepseek-flash',name:'Flash 更新'},{id:'new-text-model',name:'new-text-model'}]);
    expect(()=>parseModels({data:[]})).toThrow('没有返回');
    expect(()=>parseModels({error:'bad'})).toThrow('格式');
    expect(()=>parseModels({data:Array(501).fill({id:'model'})})).toThrow('格式');
  });
  it('仅识别官方地址，防止向相似域名套用专有参数',()=>{
    expect(isDeepSeek('https://api.deepseek.com/v1/')).toBe(true);
    for(const base of ['https://api.deepseek.com.evil.example','https://api.deepseek.com@evil.example','http://api.deepseek.com','https://api.deepseek.com?key=x','https://api.deepseek.com/proxy'])expect(isDeepSeek(base)).toBe(false);
  });
  it('刷新只向官方 /models 发 GET，不包含账本或对话，且禁止跳转',async()=>{
    const fetch=vi.fn(async(url:string,init:RequestInit)=>{
      expect(url).toBe('https://api.deepseek.com/models');
      expect(init).toMatchObject({method:'GET',credentials:'omit',redirect:'error',headers:{Authorization:'Bearer TEST'}});
      expect(init.body).toBeUndefined();
      return Response.json({data:[{id:'deepseek-flash'}]});
    });vi.stubGlobal('fetch',fetch);
    expect(await fetchDeepSeekModels(' TEST ')).toEqual([{id:'deepseek-flash',name:'deepseek-flash'}]);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('缺少密钥不发请求，鉴权和限流失败返回可操作提示',async()=>{
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    await expect(fetchDeepSeekModels(' ')).rejects.toThrow('API Key');expect(fetch).not.toHaveBeenCalled();
    fetch.mockResolvedValue(new Response('',{status:401}));await expect(fetchDeepSeekModels('TEST')).rejects.toThrow('访问权限');
    fetch.mockResolvedValue(new Response('',{status:429}));await expect(fetchDeepSeekModels('TEST')).rejects.toThrow('频繁');
  });
  it('慢请求可超时，离开面板可取消',async()=>{
    vi.useFakeTimers();
    vi.stubGlobal('fetch',vi.fn((_url:string,init:RequestInit)=>new Promise((_resolve,reject)=>init.signal?.addEventListener('abort',()=>reject(init.signal?.reason)))));
    const pending=expect(fetchDeepSeekModels('TEST')).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(20000);await pending;
    const controller=new AbortController();const cancelled=expect(fetchDeepSeekModels('TEST',controller.signal)).rejects.toThrow();controller.abort();await cancelled;
  });
});
describe('模型选择持久化与请求',()=>{
  it('保存所选模型与思考强度，重读后仍一致；不保存 API Key',async()=>{
    const selected={...defaultAI,model:'deepseek-v4-pro',deepseekEffort:'max' as const};
    await saveAIConnection(selected,defaultSearch);
    expect(await getMeta('ai',null)).toEqual(selected);
    expect((await db.meta.toArray()).map(x=>x.key)).toEqual(['ai']);
  });
  it('切换到 Chat 时原子关闭不兼容内置搜索，保留独立搜索',async()=>{
    await setMeta('search',{...defaultSearch,provider:'builtin'});
    await saveAIConnection(defaultAI,{...defaultSearch,provider:'builtin'});
    expect(await getMeta<SearchConfig>('search',defaultSearch)).toMatchObject({provider:'none'});
    expect(await getMeta<AIConfig>('ai',defaultAI)).toMatchObject({webSearch:false});
    const independent={...defaultSearch,provider:'deepseek' as const};await setMeta('search',independent);
    await saveAIConnection(defaultAI,independent);expect(await getMeta('search',null)).toEqual(independent);
  });
  it('无效模型或地址不覆盖原配置',async()=>{
    await saveAIConnection(defaultAI,defaultSearch);
    await expect(saveAIConnection({...defaultAI,model:''},defaultSearch)).rejects.toThrow('模型');
    await expect(saveAIConnection({...defaultAI,baseUrl:'https://key:secret@api.example.com'},defaultSearch)).rejects.toThrow('凭据');
    expect(await getMeta('ai',null)).toEqual(defaultAI);
  });
  it.each(['deepseek-flash','deepseek-v4-pro'])('实际发送所选 %s 并记录报告模型',async model=>{
    vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{
      expect(url).toBe('https://api.deepseek.com/chat/completions');
      const body=JSON.parse(init.body as string);
      expect(body).toMatchObject({model,thinking:{type:'enabled'},reasoning_effort:'max'});
      expect(body.tools).toBeUndefined();
      return Response.json({choices:[{message:{content:'合成测试回答',reasoning_content:'不可当作最终答案'},finish_reason:'stop'}]});
    }));
    const result=await research('TEST',{...defaultAI,model,deepseekEffort:'max'},[],defaultProfile,'合成问题',true);
    expect(result.model).toBe(model);expect(result.text).toContain('合成测试回答');expect(result.text).not.toContain('不可当作最终答案');
  });
  it('关闭思考发送 disabled，自定义服务不携带 DeepSeek 参数',async()=>{
    const bodies:Record<string,unknown>[]=[];
    vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{bodies.push(JSON.parse(init.body as string));return Response.json({choices:[{message:{content:'回答'},finish_reason:'stop'}]});}));
    await research('TEST',{...defaultAI,deepseekEffort:'none'},[],defaultProfile,'问题',true);
    await research('TEST',{...defaultAI,baseUrl:'https://custom.example/v1',model:'custom-model'},[],defaultProfile,'问题',true);
    expect(bodies[0].thinking).toEqual({type:'disabled'});expect(bodies[0].reasoning_effort).toBeUndefined();
    expect(bodies[1].thinking).toBeUndefined();expect(bodies[1].reasoning_effort).toBeUndefined();expect(bodies[1].model).toBe('custom-model');
  });
  it('旧自定义配置保持协议和模型，保存不隐式替换为 DeepSeek',async()=>{
    const existing:AIConfig={baseUrl:'https://custom.example/v1',model:'existing-model',protocol:'responses',webSearch:true};
    await saveAIConnection(existing,{...defaultSearch,provider:'builtin'});expect(await getMeta('ai',null)).toEqual(existing);
  });
});
