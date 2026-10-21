import 'fake-indexeddb/auto';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {readBackupText,MAX_BACKUP_BYTES} from './backup-limits';
import {encrypt,decrypt} from './crypto';
import {defaultProfile,makeBundle,type Report} from './model';
import {db,exportData,restoreData} from './db';
import {defaultS3,uploadBackup,fetchBackup} from './backup';

afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('可恢复的备份边界',()=>{
  it('501 条分析可完整导出、加密上传、下载并恢复，不截断历史',async()=>{
    const reports:Report[]=Array.from({length:501},(_,i)=>({id:`analysis-${i}`,createdAt:new Date().toISOString(),question:`问题 ${i}`,model:'test-model',text:`合成分析 ${i}`,sources:[],demo:false}));
    await restoreData(makeBundle([],[],defaultProfile,[],reports));
    let remote='';vi.stubGlobal('fetch',vi.fn(async(input:Request)=>{
      if(input.method==='PUT'){remote=await input.text();return new Response('');}
      return new Response(remote);
    }));
    const config={...defaultS3,endpoint:'https://s3.example.com',bucket:'assets'};
    const credentials={accessKeyId:'SYNTHETIC',secretAccessKey:'SYNTHETIC'};
    const result=await uploadBackup(await exportData(),'test-passphrase',config,credentials);
    expect(remote).not.toContain('合成分析');
    const restored=await fetchBackup(config,credentials,result.key,'test-passphrase');
    await db.reports.clear();await restoreData(restored);
    expect(await db.reports.count()).toBe(501);expect(await db.reports.get('analysis-500')).toEqual(reports[500]);
  });
  it('按加密后的文件大小预检，超限时不执行加密或生成无法恢复的导出',async()=>{
    const spy=vi.spyOn(crypto.subtle,'encrypt');
    // UTF-8 is 24 MB here; base64 expansion makes the output larger than 30 MB.
    await expect(encrypt({text:'资'.repeat(8_000_000)},'test-passphrase')).rejects.toThrow('30 MB');
    expect(spy).not.toHaveBeenCalled();
  });
  it('正常中文文件仍可解密，恢复也使用字节而不是仅使用字符数限制',async()=>{
    const data={text:'账户与资产'};const encrypted=await encrypt(data,'test-passphrase');
    expect(new TextEncoder().encode(encrypted).byteLength).toBeLessThan(MAX_BACKUP_BYTES);
    expect(await decrypt(encrypted,'test-passphrase')).toEqual(data);
    await expect(decrypt('资'.repeat(10_000_001),'test-passphrase')).rejects.toThrow('30 MB');
  });
  it('分块读取没有长度头或低报长度的响应，超限后取消下载',async()=>{
    for(const headers of [new Headers(),new Headers({'Content-Length':'1'})]){
      const cancel=vi.fn();let reads=0;
      const stream=new ReadableStream<Uint8Array>({pull(controller){reads++;controller.enqueue(new Uint8Array(8));},cancel});
      await expect(readBackupText(new Response(stream,{headers}),10)).rejects.toThrow('30 MB');
      expect(cancel).toHaveBeenCalledOnce();expect(reads).toBeLessThanOrEqual(3);
    }
  });
  it('长度头已超限时直接取消；跨分块的 UTF-8 字符完整保留',async()=>{
    const cancel=vi.fn();const response=new Response(new ReadableStream({cancel}),{headers:{'Content-Length':'31'}});
    await expect(readBackupText(response,30)).rejects.toThrow('30 MB');expect(cancel).toHaveBeenCalledOnce();
    const bytes=new TextEncoder().encode('知衡');let index=0;
    const stream=new ReadableStream<Uint8Array>({pull(controller){if(index===bytes.length)controller.close();else controller.enqueue(bytes.slice(index,index+=1));}});
    expect(await readBackupText(new Response(stream),6)).toBe('知衡');
  });
});
