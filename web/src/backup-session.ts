import {db,getMeta,setMeta,exportData} from './db';
import {encrypt,decrypt} from './crypto';
import {defaultS3,s3Schema,credentialsSchema,due,uploadBackup,type S3Config,type Credentials,type BackupStatus} from './backup';

export type BackupSettings={config:S3Config;revision:string;status:BackupStatus};
export type UnlockedBackup={config:S3Config;revision:string;credentials:Credentials;password:string};
export const emptyBackupSettings:BackupSettings={config:defaultS3,revision:'unconfigured',status:{}};
const changedMessage='备份连接已更改，请解锁当前连接后重试';

export async function readBackupSettings():Promise<BackupSettings>{
  return db.transaction('r',db.meta,async()=>({
    config:await getMeta('s3',defaultS3),
    revision:await getMeta('s3Revision','legacy'),
    status:await getMeta<BackupStatus>('backupStatus',{})
  }));
}
function destination(config:S3Config){return JSON.stringify([config.endpoint,config.bucket,config.region,config.prefix,config.pathStyle]);}
export async function saveBackupConnection(input:S3Config,credentials:Credentials,password:string):Promise<UnlockedBackup>{
  const config=s3Schema.parse(input),keys=credentialsSchema.parse(credentials);
  const vault=await encrypt(keys,password),revision=crypto.randomUUID();
  await db.transaction('rw',db.meta,async()=>{
    const previous=await getMeta<S3Config>('s3',defaultS3);
    await setMeta('s3',config);await setMeta('s3Vault',vault);await setMeta('s3Revision',revision);
    if(destination(previous)!==destination(config))await setMeta('backupStatus',{});
  });
  return {config,revision,credentials:keys,password};
}
export async function unlockBackupConnection(password:string):Promise<UnlockedBackup>{
  const saved=await db.transaction('r',db.meta,async()=>({settings:await readBackupSettings(),vault:await getMeta<string|null>('s3Vault',null)}));
  if(!saved.vault)throw new Error('请先填写 S3 配置并保存');
  const credentials=credentialsSchema.parse(await decrypt(saved.vault,password));
  if(await getMeta('s3Revision','legacy')!==saved.settings.revision)throw new Error(changedMessage);
  return {config:s3Schema.parse(saved.settings.config),revision:saved.settings.revision,credentials,password};
}
export function backupSessionMatches(session:UnlockedBackup|null,revision:string,password:string){return !!session&&session.revision===revision&&session.password===password;}
async function requireCurrent(session:UnlockedBackup){if(await getMeta('s3Revision','legacy')!==session.revision)throw new Error(changedMessage);}
async function recordStatus(session:UnlockedBackup,status:BackupStatus){
  return db.transaction('rw',db.meta,async()=>{
    if(await getMeta('s3Revision','legacy')!==session.revision)return false;
    await setMeta('backupStatus',status);return true;
  });
}
export async function executeCloudBackup(session:UnlockedBackup,manual=false){
  const previous=await db.transaction('rw',db.meta,async()=>{
    await requireCurrent(session);
    const current=await getMeta<BackupStatus>('backupStatus',{});
    if(!manual&&!due(session.config,current))return null;
    await setMeta('backupStatus',{...current,lastAttempt:new Date().toISOString(),error:undefined});return current;
  });
  if(previous===null)return false;
  try{
    const data=await exportData();await requireCurrent(session);
    const result=await uploadBackup(data,session.password,session.config,session.credentials);
    if(!await recordStatus(session,{...result,lastAttempt:new Date().toISOString()}))throw new Error(changedMessage);
    return true;
  }catch(error){
    await recordStatus(session,{...previous,lastAttempt:new Date().toISOString(),error:error instanceof Error?error.message:'备份失败'});
    if(manual)throw error;
    return false;
  }
}
