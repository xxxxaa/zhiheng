import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {MX_ENDPOINT,queryMx,testMxConnection,parseMxResult} from './miaoxiang';
import {serviceFetch} from './transport';
import {apiKeysSchema} from './api-vault';
import {encrypt,decrypt} from './crypto';
import {research,defaultAI} from './ai';
import {defaultProfile} from './model';
vi.mock('./transport',()=>({serviceFetch:vi.fn()}));
const name='mx_ashare_finance_data';
const tools={tools:[{name,inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query']}}]};
const raw={content:[{type:'text',text:JSON.stringify({data:[{sheetName:'合成股票的行情',columns:['指标','2026-01-02 15:00'],items:[['最新价','12.30元']],meta:{jumpUrlList:[{choiceUrl:'https://quote.eastmoney.com/sh600000.html'},{choiceUrl:'EM://stock?code=600000'},{choiceUrl:'https://eastmoney.com.evil.test/'},{choiceUrl:'https://secret:token@eastmoney.com/'}]}}]})}],isError:false};
beforeEach(()=>{vi.mocked(serviceFetch).mockReset();});
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
function server(result:unknown=raw,overrides:Record<string,unknown>={}) {
  vi.mocked(serviceFetch).mockImplementation(async(_url,init)=>{
    const req=JSON.parse(String(init?.body));
    if(req.method==='notifications/initialized')return new Response(null,{status:202});
    return Response.json({jsonrpc:'2.0',id:req.id,result:req.method==='initialize'?{protocolVersion:'2025-11-25',serverInfo:{name:'mx-ds-mcp',version:'1'}}:req.method==='tools/list'?tools:result,...overrides},{headers:{'Mcp-Session-Id':'session-test'}});
  });
}
describe('妙想 MCP 协议与查询边界',()=>{
  it('握手、通知、工具发现后查询；仅固定地址收到 Key 和显式查询词',async()=>{
    server();const result=await queryMx(' TEST ',name,'合成公开行情');
    expect(result.tables[0].rows[0]).toEqual(['最新价','12.30元']);
    const calls=vi.mocked(serviceFetch).mock.calls;
    expect(calls.map(x=>JSON.parse(String(x[1]?.body)).method)).toEqual(['initialize','notifications/initialized','tools/list','tools/call']);
    for(const [url,init]of calls){expect(url).toBe(MX_ENDPOINT);expect(init).toMatchObject({credentials:'omit',redirect:'error',headers:{em_api_key:'TEST'}});expect(String(init?.body)).not.toContain('TEST');expect(String(init?.body)).not.toContain('portfolio');}
    expect(JSON.parse(String(calls[3][1]?.body)).params).toEqual({name,arguments:{query:'合成公开行情'}});
    expect(calls[3][1]?.headers).toMatchObject({'Mcp-Session-Id':'session-test','MCP-Protocol-Version':'2025-11-25'});
  });
  it('兼容保持连接的 SSE，忽略通知并在完整结果后停止读取',async()=>{
    server();const base=vi.mocked(serviceFetch).getMockImplementation()!;let cancelled=false;
    vi.mocked(serviceFetch).mockImplementation(async(url,init)=>{
      const req=JSON.parse(String(init?.body));if(req.method!=='tools/call')return base(url,init);
      const text=`: ping\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\r\n\r\nevent: message\r\ndata: ${JSON.stringify({jsonrpc:'2.0',id:req.id,result:raw})}\r\n\r\n`;
      return new Response(new ReadableStream({start(c){const enc=new TextEncoder();c.enqueue(enc.encode(text.slice(0,17)));c.enqueue(enc.encode(text.slice(17)));},cancel(){cancelled=true;}}),{headers:{'Content-Type':'text/event-stream'}});
    });
    await expect(queryMx('TEST',name,'公开查询')).resolves.toMatchObject({tool:name});expect(cancelled).toBe(true);
  });
  it('未填写 Key、非法工具、空查询、预先取消均不联网',async()=>{
    server();await expect(queryMx('',name,'公开查询')).rejects.toThrow('Key');
    await expect(queryMx('TEST','arbitrary_tool' as never,'公开查询')).rejects.toThrow('不支持');
    await expect(queryMx('TEST',name,' ')).rejects.toThrow('查询词');
    const abort=new AbortController();abort.abort();await expect(testMxConnection('TEST',abort.signal)).rejects.toThrow();expect(serviceFetch).not.toHaveBeenCalled();
  });
  it('鉴权和配额失败不回显服务响应中的密钥',async()=>{
    for(const [status,message]of [[401,'鉴权'],[403,'鉴权'],[429,'额度']] as const){vi.mocked(serviceFetch).mockResolvedValue(new Response('secret-key',{status}));await expect(testMxConnection('TEST')).rejects.toThrow(message);}
  });
  it('拒绝错误响应编号、RPC 错误、未知服务和未开放工具',async()=>{
    server(raw,{id:999});await expect(testMxConnection('TEST')).rejects.toThrow('编号');
    server(raw,{error:{message:'secret-key'}});await expect(testMxConnection('TEST')).rejects.toThrow('未完成');
    server(raw,{result:{protocolVersion:'unknown',serverInfo:{name:'unexpected'}}});await expect(testMxConnection('TEST')).rejects.toThrow('协议');
    server();await expect(queryMx('TEST','mx_fund_finance_data','基金查询')).rejects.toThrow('未开放');
  });
  it('请求超时与用户取消会终止等待',async()=>{
    vi.useFakeTimers();vi.mocked(serviceFetch).mockImplementation((_url,init)=>new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(init.signal?.reason))));
    const pending=expect(testMxConnection('TEST')).rejects.toThrow('超时');await vi.advanceTimersByTimeAsync(90000);await pending;
    const abort=new AbortController();const next=expect(testMxConnection('TEST',abort.signal)).rejects.toThrow();abort.abort();await next;
  });
  it('发现工具遵循分页，不调用未知或参数变化的工具',async()=>{
    server();const base=vi.mocked(serviceFetch).getMockImplementation()!;
    vi.mocked(serviceFetch).mockImplementation(async(url,init)=>{const req=JSON.parse(String(init?.body));if(req.method!=='tools/list')return base(url,init);return Response.json({jsonrpc:'2.0',id:req.id,result:req.params.cursor?tools:{tools:[{name:'unknown',inputSchema:{type:'object',properties:{}}}],nextCursor:'second'}});});
    expect(await testMxConnection('TEST')).toEqual([{name,label:'A 股行情与财务'}]);
  });
  it('拒绝过大和未完成的返回，而不是把失败当成金融资料',async()=>{
    server();const base=vi.mocked(serviceFetch).getMockImplementation()!;
    vi.mocked(serviceFetch).mockImplementation(async(url,init)=>{const req=JSON.parse(String(init?.body));if(req.method==='tools/call')return new Response('x'.repeat(2_000_001));return base(url,init);});
    await expect(queryMx('TEST',name,'公开查询')).rejects.toThrow('过大');
    expect(()=>parseMxResult({isError:true,content:[{type:'text',text:'secret'}]},'q',name)).toThrow('未完成');
    expect(()=>parseMxResult({content:[]},'q',name)).toThrow('没有返回');
  });
});
describe('妙想资料与密钥保护',()=>{
  it('保留数据时间和单位，查询时间单独显示，剔除非网页和带凭据来源',()=>{
    const result=parseMxResult(raw,'公开查询',name,new Date('2026-02-01T00:00:00Z'));
    expect(result.tables[0].columns[1]).toBe('2026-01-02 15:00');expect(result.retrievedAt).toBe('2026-02-01T00:00:00.000Z');
    expect(result.sources).toEqual([{url:'https://quote.eastmoney.com/sh600000.html',title:'东方财富数据来源'}]);
    expect(parseMxResult({content:[{type:'text',text:'公开文本资料'}]},'q',name).warnings.join()).toContain('未提供');
  });
  it('用户选中的资料进入模型请求与来源，妙想 Key 不进入 AI 请求',async()=>{
    const mx=parseMxResult(raw,'公开查询',name);vi.mocked(serviceFetch).mockResolvedValue(Response.json({choices:[{message:{content:'基于提供资料的分析'},finish_reason:'stop'}]}));
    const result=await research('MODEL_KEY',defaultAI,[],defaultProfile,'分析资料',false,[],undefined,undefined,mx);
    const body=JSON.parse(String(vi.mocked(serviceFetch).mock.calls[0][1]?.body));const sent=JSON.parse(body.messages.at(-1).content);
    expect(sent.financialEvidence).toMatchObject({provider:'东方财富妙想',query:'公开查询',text:mx.text});expect(sent.financialEvidence).not.toHaveProperty('apiKey');
    expect(body.messages[0].content).toContain('非可信数据');expect(body.messages[0].content).toContain('不得把旧数据称为实时行情');
    expect(result.sources).toEqual(mx.sources);expect(result.text).toContain('妙想资料查询于');expect(result.text).not.toContain('未启用联网检索');
  });
  it('新 Key 可加密往返，旧密钥库可继续解锁',async()=>{
    const keys={apiKey:'MODEL',searchKey:'SEARCH',mxKey:'MIAOXIANG_SECRET'};const encrypted=await encrypt(keys,'test-passphrase-123');
    expect(encrypted).not.toContain(keys.mxKey);expect(apiKeysSchema.parse(await decrypt(encrypted,'test-passphrase-123'))).toEqual(keys);
    expect(apiKeysSchema.parse({apiKey:'OLD',searchKey:''})).toEqual({apiKey:'OLD',searchKey:'',mxKey:''});
    expect(()=>apiKeysSchema.parse({apiKey:'a',searchKey:'',mxKey:42})).toThrow();
  });
});
