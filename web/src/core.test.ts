import 'fake-indexeddb/auto';
import {beforeEach,afterEach,describe,expect,it,vi} from 'vitest';
import {metrics,money,defaultProfile,type Position,makeBundle,bundleSchema,localDay} from './model';
import {encrypt,decrypt} from './crypto';
import {parsePositions,template} from './import';
import {db,exportData,restoreData,undoRestore,savePosition,removeAccount} from './db';
import {defaultS3,due,objectUrl,uploadBackup} from './backup';
import {apiUrl,parseResponse,research,defaultAI} from './ai';
import {defaultSearch,searchUrl,searchWeb,fetchPage,collectEvidence} from './search';
import {derToRaw,unlockDevice} from './device-lock';
const account={id:'a1',name:'日常储蓄',platform:'银行卡' as const};
const base:Position={id:'p1',accountId:'a1',name:'资产',kind:'cash',code:'',quantity:'100',price:'1',cost:null,asOf:localDay(),fundType:'unknown',maturity:'',rate:null};
const bundle=()=>makeBundle([account],[base],defaultProfile);
beforeEach(async()=>{await Promise.all([db.accounts.clear(),db.positions.clear(),db.snapshots.clear(),db.reports.clear(),db.meta.clear()]);});
afterEach(()=>vi.unstubAllGlobals());
describe('金额与指标',()=>{
  it('使用十进制计算，现金和负债分别汇总',()=>{const m=metrics([{...base,quantity:'0.1'},{...base,id:'p2',quantity:'0.2'},{...base,id:'d',kind:'debt',quantity:'0.1'}],defaultProfile);expect(m.assets.toString()).toBe('0.3');expect(m.net.toString()).toBe('0.2');expect(m.months).toBeNull();expect(money('9007199254740993.01')).toBe('¥9,007,199,254,740,993.01');});
  it('合并跨账户同代码证券，基金分类不猜测',()=>{const m=metrics([{...base,kind:'stock',code:'A',quantity:'30'},{...base,id:'p2',accountId:'a2',kind:'stock',code:'a',quantity:'20'},{...base,id:'p3',kind:'fund',quantity:'50',fundType:'mixed'}],defaultProfile);expect(m.largestRatio).toBe(50);expect(m.equityRatio).toBe(50);expect(m.unknownRatio).toBe(50);expect(m.liquid.toString()).toBe('0');});
  it('本金不计未来利息，未提供成本不伪造收益',()=>{const m=metrics([{...base,kind:'deposit',rate:'3'},{...base,id:'s',kind:'stock',quantity:'2',price:'8',cost:null}],defaultProfile);expect(m.assets.toString()).toBe('116');expect(m.missingCost).toBe(1);expect(m.pnl.toString()).toBe('0');});
  it('已知成本只计算对应部分，过期估值提醒',()=>{const m=metrics([{...base,kind:'stock',price:'1.23',cost:'120',asOf:'2020-01-01'}],defaultProfile);expect(m.pnl.toString()).toBe('3');expect(m.stale).toBe(1);});
  it('负净资产可备份，未来数据和悬空引用不能恢复',()=>{const b=bundle();expect(bundleSchema.safeParse({...b,positions:[{...base,asOf:'2099-01-01'}]}).success).toBe(false);expect(bundleSchema.safeParse({...b,accounts:[]}).success).toBe(false);expect(bundleSchema.safeParse({...b,positions:[base,base]}).success).toBe(false);});
});
describe('加密与恢复',()=>{
  it('随机盐和 IV，正确口令可还原且明文不出现',async()=>{const a=await encrypt(bundle(),'correct-passphrase'),b=await encrypt(bundle(),'correct-passphrase');expect(a).not.toEqual(b);expect(a).not.toContain('日常储蓄');expect(await decrypt(a,'correct-passphrase')).toEqual(expect.objectContaining({accounts:[account]}));});
  it('拒绝错误口令、篡改与迭代数注入',async()=>{const a=await encrypt(bundle(),'correct-passphrase');await expect(decrypt(a,'wrong-passphrase')).rejects.toThrow('口令');const e=JSON.parse(a);e.ciphertext=e.ciphertext.slice(0,-8)+'AAAAAAAA';await expect(decrypt(JSON.stringify(e),'correct-passphrase')).rejects.toThrow();e.iterations=999999999;await expect(decrypt(JSON.stringify(e),'correct-passphrase')).rejects.toThrow('格式');});
  it('资产与每日快照原子保存，非空账户不能删除',async()=>{await db.accounts.add(account);await savePosition(base);expect((await exportData()).snapshots).toHaveLength(1);await expect(removeAccount('a1')).rejects.toThrow();await expect(savePosition({...base,accountId:'missing'})).rejects.toThrow();expect(await db.positions.count()).toBe(1);});
  it('恢复替换数据、保留回退点；无效文件不修改原数据',async()=>{await restoreData(bundle());const next=makeBundle([{...account,id:'a2'}],[{...base,id:'p2',accountId:'a2',quantity:'999'}],defaultProfile);await restoreData(next);expect((await exportData()).positions[0].quantity).toBe('999');await expect(restoreData({...next,accounts:[]})).rejects.toThrow();expect((await exportData()).positions[0].quantity).toBe('999');await undoRestore();expect((await exportData()).positions[0].quantity).toBe('100');});
  it('导出排除所有连接密钥、设备锁和回退副本',async()=>{await db.meta.bulkPut([{key:'apiVault',value:'secret'},{key:'s3Vault',value:'secret'},{key:'deviceLock',value:'secret'}]);expect(JSON.stringify(await exportData())).not.toContain('secret');});
});
describe('CSV 导入',()=>{
  it('支持 BOM 模板，完全相同行去重',()=>{const text='\uFEFF'+template+template.split('\n')[1]+'\n';const parsed=parsePositions(text,[account],[]);expect(parsed.positions).toHaveLength(1);expect(parsed.duplicates).toHaveLength(1);expect(parsed.errors).toHaveLength(0);});
  it('不同快照不重复计入，原始钱包交易文件不冒充持仓',()=>{const first=parsePositions(template,[account],[]).positions;const changed=template.replace('12000','13000');expect(parsePositions(changed,[account],first).errors).toHaveLength(1);expect(()=>parsePositions('交易时间,金额\n今天,123',[account],[])).toThrow('模板');});
  it('未知账户或重复名称必须先修正',()=>{expect(parsePositions(template,[],[]).errors).toHaveLength(1);expect(parsePositions(template,[account,{...account,id:'a2'}],[]).errors).toHaveLength(1);});
});
describe('S3 与定时备份',()=>{
  const config={...defaultS3,endpoint:'https://s3.example.com',bucket:'assets',enabled:true};
  it('首次和到期补做，失败后至少 5 分钟再试',()=>{expect(due(config,{})).toBe(true);expect(due(config,{lastSuccess:new Date().toISOString()})).toBe(false);expect(due(config,{lastAttempt:new Date().toISOString()})).toBe(false);expect(due({...config,enabled:false},{})).toBe(false);});
  it('同时支持 path 和 virtual hosted，阻止路径穿越和凭据 URL',()=>{expect(objectUrl(config,'zhiheng/a.zhb')).toBe('https://s3.example.com/assets/zhiheng/a.zhb');expect(objectUrl({...config,pathStyle:false},'a.zhb')).toBe('https://assets.s3.example.com/a.zhb');expect(()=>objectUrl(config,'../secret')).toThrow();expect(()=>objectUrl({...config,endpoint:'https://key:secret@s3.example.com'},'x')).toThrow();});
  it('签名上传并读回，成功前完成解密校验',async()=>{let stored='';const calls:string[]=[];vi.stubGlobal('fetch',vi.fn(async(input:Request)=>{calls.push(input.method);expect(input.headers.get('Authorization')).toContain('AWS4-HMAC-SHA256');if(input.method==='PUT'){stored=await input.text();return new Response('');}return new Response(stored);}));const result=await uploadBackup(bundle(),'correct-passphrase',config,{accessKeyId:'TESTKEY',secretAccessKey:'TESTSECRET'});expect(calls).toEqual(['PUT','GET']);expect(result.lastSuccess).toBeTruthy();expect(stored).not.toContain('日常储蓄');});
  it('读回不一致不会报告成功',async()=>{vi.stubGlobal('fetch',vi.fn(async(input:Request)=>new Response(input.method==='GET'?'corrupt':'')));await expect(uploadBackup(bundle(),'correct-passphrase',config,{accessKeyId:'TESTKEY',secretAccessKey:'TESTSECRET'})).rejects.toThrow('校验失败');});
});
describe('AI 与 DeepSeek 协议',()=>{
  it('自定义地址只拼接正确协议，不允许 URL 携带凭据',()=>{expect(apiUrl({...defaultAI,baseUrl:'https://model.example/v1/',protocol:'chat'})).toBe('https://model.example/v1/chat/completions');expect(()=>apiUrl({...defaultAI,baseUrl:'https://key:pass@api.example/v1'})).toThrow();expect(searchUrl('https://api.deepseek.com/v1/','fetch')).toBe('https://api.deepseek.com/v1/tools/fetch');});
  it('联网结果必须有完成的检索与可点击来源',()=>{expect(()=>parseResponse({status:'completed',output:[]})).toThrow();const result=parseResponse({status:'completed',output:[{type:'web_search_call',status:'completed'},{type:'message',content:[{type:'output_text',text:'事实 [1]',annotations:[{type:'url_citation',url:'https://example.org/fact',title:'事实来源',start_index:3,end_index:6}]}]}]});expect(result.sources).toHaveLength(1);expect(result.text).toContain('https://example.org/fact');});
  it('Chat Completions 发送给用户配置的地址，不包含平台账户名称',async()=>{vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{expect(url).toBe('https://custom.example/v1/chat/completions');const b=JSON.parse(init.body as string);expect(b.messages[0].role).toBe('system');expect(init.headers).toEqual(expect.objectContaining({Authorization:'Bearer TEST'}));expect(init.body).not.toContain('日常储蓄');return Response.json({choices:[{message:{content:'资产结构分析'},finish_reason:'stop'}]});}));const result=await research('TEST',{...defaultAI,baseUrl:'https://custom.example/v1',protocol:'chat',webSearch:false},[base],defaultProfile,'如何调整？',false);expect(result.text).toContain('未启用联网检索');});
  it('DeepSeek Search 和 Fetch 使用独立接口与字段',async()=>{const calls:string[]=[];vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{calls.push(url);const body=JSON.parse(init.body as string);if(url.endsWith('/search')){expect(body).toEqual({query:'公司公告',count:5,need_content:false});return Response.json({results:[{title:'公司公告',url:'https://example.org',snippet:'摘要',summary:'长摘要',content:'',date:null}]});}expect(body).toEqual({url:'https://example.org'});return Response.json({title:'公告',content:'正文'});}));const evidence=await collectEvidence({...defaultSearch,provider:'deepseek'},'SEARCHKEY','公司公告');expect(calls).toEqual(['https://api.deepseek.com/v1/tools/search','https://api.deepseek.com/v1/tools/fetch']);expect(evidence.pages[0].content).toBe('正文');});
  it('空搜索与网络错误不生成虚构研究，禁止私网抓取',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>Response.json({results:[]})));await expect(collectEvidence(defaultSearch,'KEY','公告')).rejects.toThrow('无结果');await expect(fetchPage(defaultSearch,'KEY','http://127.0.0.1/admin')).rejects.toThrow('公开');await expect(searchWeb(defaultSearch,'KEY','')).rejects.toThrow('1–128');});
});
describe('设备签名',()=>{it('将真实 DER r/s 格式转换为固定宽度',()=>{const raw=derToRaw(new Uint8Array([0x30,6,2,1,7,2,1,9]).buffer);expect(raw).toHaveLength(64);expect(raw[31]).toBe(7);expect(raw[63]).toBe(9);expect(()=>derToRaw(new Uint8Array([0]).buffer)).toThrow();});});
it('设备解锁验证真实 ECDSA 签名，拒绝缺少 UV、来源错误和伪造签名',async()=>{
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const b64=(a:Uint8Array)=>btoa(String.fromCharCode(...a)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const lock={id:b64(new Uint8Array([1,2,3])),publicKey:b64(new Uint8Array(await crypto.subtle.exportKey('spki',pair.publicKey))),rpId:'example.com',origin:'https://example.com'};
  let mode='valid';vi.stubGlobal('location',{hostname:lock.rpId,origin:lock.origin});
  vi.stubGlobal('navigator',{credentials:{get:async({publicKey}:{publicKey:{challenge:Uint8Array}})=>{
    const client=new TextEncoder().encode(JSON.stringify({type:'webauthn.get',challenge:b64(publicKey.challenge),origin:mode==='origin'?'https://evil.example':lock.origin}));
    const auth=new Uint8Array(37);auth.set(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(lock.rpId))));auth[32]=mode==='uv'?1:5;
    const data=new Uint8Array(69);data.set(auth);data.set(new Uint8Array(await crypto.subtle.digest('SHA-256',client)),37);
    const raw=new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,data));if(mode==='signature')raw[1]^=1;
    const integer=(a:Uint8Array)=>{let i=0;while(i<31&&a[i]===0)i++;const p=Array.from(a.slice(i));if(p[0]&128)p.unshift(0);return [2,p.length,...p];};const ints=[...integer(raw.slice(0,32)),...integer(raw.slice(32))];
    return {id:lock.id,response:{clientDataJSON:client.buffer,authenticatorData:auth.buffer,signature:new Uint8Array([0x30,ints.length,...ints]).buffer}};
  }}});
  await expect(unlockDevice(lock)).resolves.toBeUndefined();mode='uv';await expect(unlockDevice(lock)).rejects.toThrow('用户验证');mode='origin';await expect(unlockDevice(lock)).rejects.toThrow('来源');mode='signature';await expect(unlockDevice(lock)).rejects.toThrow('签名');
});
