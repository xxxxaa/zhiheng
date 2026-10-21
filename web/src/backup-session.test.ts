import 'fake-indexeddb/auto';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {db,getMeta,setMeta,exportData} from './db';
import {encrypt} from './crypto';
import {defaultS3,type BackupStatus} from './backup';
import {readBackupSettings,saveBackupConnection,unlockBackupConnection,backupSessionMatches,executeCloudBackup} from './backup-session';

const config={...defaultS3,endpoint:'https://s3.example.com',bucket:'first',enabled:true};
const keys={accessKeyId:'KEY_FIRST',secretAccessKey:'SYNTHETIC_SECRET'};
const password='synthetic-passphrase';
beforeEach(async()=>{await db.meta.clear();});
afterEach(()=>vi.unstubAllGlobals());

describe('备份连接切换',()=>{
  it('无效保存不修改原连接，凭据加密保存且不进入账本备份',async()=>{
    const session=await saveBackupConnection(config,keys,password);
    await expect(saveBackupConnection({...config,bucket:'second'},keys,'short')).rejects.toThrow('10');
    expect((await readBackupSettings()).revision).toBe(session.revision);
    expect(await getMeta('s3Vault','')).not.toContain(keys.secretAccessKey);
    expect(JSON.stringify(await exportData())).not.toContain(keys.accessKeyId);
    expect((await unlockBackupConnection(password)).credentials).toEqual(keys);
  });
  it('同一目标调整间隔保留成功记录，更换目标重置记录并使旧解锁失效',async()=>{
    const old=await saveBackupConnection(config,keys,password);
    const status={lastSuccess:new Date().toISOString(),key:'zhiheng/old.zhb'};await setMeta('backupStatus',status);
    const resaved=await saveBackupConnection({...config,intervalHours:8},keys,password);
    expect((await readBackupSettings()).status).toEqual(status);
    expect(backupSessionMatches(old,resaved.revision,password)).toBe(false);
    expect(backupSessionMatches(resaved,resaved.revision,password+'changed')).toBe(false);
    expect(backupSessionMatches(resaved,resaved.revision,password)).toBe(true);
    await saveBackupConnection({...config,bucket:'second'},keys,password);
    expect((await readBackupSettings()).status).toEqual({});
  });
  it('已失效的旧连接不能发出上传请求',async()=>{
    const old=await saveBackupConnection(config,keys,password);
    await saveBackupConnection({...config,bucket:'second'},keys,password);
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    await expect(executeCloudBackup(old,true)).rejects.toThrow('连接已更改');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('旧任务完成时不能把成功结果写进新存储桶状态',async()=>{
    const old=await saveBackupConnection(config,keys,password);let stored='';
    vi.stubGlobal('fetch',vi.fn(async(request:Request)=>{
      expect(new URL(request.url).pathname).toContain('/first/');
      if(request.method==='PUT'){
        stored=await request.text();
        await saveBackupConnection({...config,bucket:'second'},{...keys,accessKeyId:'KEY_SECOND'},password);
        return new Response('');
      }
      return new Response(stored);
    }));
    await expect(executeCloudBackup(old,true)).rejects.toThrow('连接已更改');
    const saved=await readBackupSettings();expect(saved.config.bucket).toBe('second');expect(saved.status).toEqual({});
  });
  it('新目标自动执行首次备份，使用对应凭据，不受旧成功时间影响',async()=>{
    await saveBackupConnection(config,keys,password);await setMeta('backupStatus',{lastSuccess:new Date().toISOString(),key:'old.zhb'});
    const session=await saveBackupConnection({...config,bucket:'second'},{...keys,accessKeyId:'KEY_SECOND'},password);let stored='';
    const fetch=vi.fn(async(request:Request)=>{
      expect(new URL(request.url).pathname).toContain('/second/');
      expect(request.headers.get('Authorization')).toContain('Credential=KEY_SECOND/');
      if(request.method==='PUT'){stored=await request.text();return new Response('');}
      return new Response(stored);
    });vi.stubGlobal('fetch',fetch);
    expect(await executeCloudBackup(session)).toBe(true);
    expect((await getMeta<BackupStatus>('backupStatus',{})).lastSuccess).toBeTruthy();
    expect(await executeCloudBackup(session)).toBe(false);expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('兼容升级前的加密连接；错误口令不会改变连接或成功记录',async()=>{
    await setMeta('s3',config);await setMeta('s3Vault',await encrypt(keys,password));
    await setMeta('backupStatus',{key:'legacy.zhb'});
    const session=await unlockBackupConnection(password);expect(session.revision).toBe('legacy');expect(session.credentials).toEqual(keys);
    await expect(unlockBackupConnection('incorrect-password')).rejects.toThrow('口令');
    expect((await readBackupSettings()).status).toEqual({key:'legacy.zhb'});
  });
});
