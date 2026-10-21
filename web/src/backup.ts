import {withTimeout} from './abort';
import {serviceFetch} from './transport';
import { AwsClient } from 'aws4fetch';
import { z } from 'zod';
import { decrypt,encrypt } from './crypto';
import { bundleSchema,type Bundle } from './model';
import {readBackupText} from './backup-limits';
export const s3Schema=z.object({endpoint:z.string().url().refine(v=>{const u=new URL(v);return (u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname))&&!u.username&&!u.password&&!u.search&&!u.hash;},'需要 HTTPS 地址（本机测试可用 HTTP）'),bucket:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9.-]{1,62}$/),region:z.string().min(1).max(60),prefix:z.string().regex(/^[a-zA-Z0-9/_-]*$/).max(150),pathStyle:z.boolean(),intervalHours:z.number().int().min(1).max(168),enabled:z.boolean()}).strict();
export type S3Config=z.infer<typeof s3Schema>;
export const defaultS3:S3Config={endpoint:'',bucket:'',region:'us-east-1',prefix:'zhiheng/',pathStyle:true,intervalHours:24,enabled:false};
export const credentialsSchema=z.object({accessKeyId:z.string().min(1),secretAccessKey:z.string().min(1),sessionToken:z.string().optional()});
export type Credentials=z.infer<typeof credentialsSchema>;
export type BackupStatus={lastSuccess?:string,key?:string,error?:string,lastAttempt?:string};
export function objectUrl(config:S3Config,key:string){const c=s3Schema.parse(config),url=new URL(c.endpoint);if(key.split('/').some(p=>p==='..'||p==='.'))throw new Error('对象路径无效');const path=[url.pathname.replace(/\/$/,''),c.pathStyle?c.bucket:'',key].filter(Boolean).join('/');url.pathname=path.split('/').map(encodeURIComponent).join('/');if(!c.pathStyle)url.hostname=`${c.bucket}.${url.hostname}`;return url.toString();}
export function due(config:S3Config,status:BackupStatus,now=Date.now()){if(!config.enabled)return false;if(status.lastAttempt&&now-Date.parse(status.lastAttempt)<5*60000)return false;return !status.lastSuccess||now-Date.parse(status.lastSuccess)>=config.intervalHours*3600000;}
function client(credentials:Credentials,region:string){return new AwsClient({...credentialsSchema.parse(credentials),region,service:'s3',retries:0});}
async function request(aws:AwsClient,url:string,init:RequestInit){try{const response=await serviceFetch(await aws.sign(url,{...init,redirect:'error',cache:'no-store',signal:withTimeout(45000)}));if(!response.ok)throw new Error(`S3 返回 HTTP ${response.status}，请检查权限、区域与对象路径`);return response;}catch(e){if(e instanceof TypeError)throw new Error('无法连接 S3，请检查网络、Endpoint 和存储桶 CORS 配置');throw e;}}
export async function uploadBackup(bundle:Bundle,password:string,config:S3Config,credentials:Credentials){
  const serialized=await encrypt(bundleSchema.parse(bundle),password);const key=`${config.prefix.replace(/\/?$/,'/')}${new Date().toISOString().replace(/[:.]/g,'-')}-${crypto.randomUUID()}.zhb`.replace(/^\//,'');
  const aws=client(credentials,config.region),url=objectUrl(config,key);
  await request(aws,url,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:serialized});
  const readback=await readBackupText(await request(aws,url,{method:'GET'}));if(readback!==serialized)throw new Error('上传后的读回校验失败，未记录为成功');
  bundleSchema.parse(await decrypt(readback,password));return {key,lastSuccess:new Date().toISOString()};
}
export async function fetchBackup(config:S3Config,credentials:Credentials,key:string,password:string){const prefix=config.prefix.replace(/^\/+|\/+$/g,'');if(prefix&&!(key.startsWith(prefix+'/')))throw new Error('对象不在配置的备份前缀中');const response=await request(client(credentials,config.region),objectUrl(config,key),{method:'GET'});return bundleSchema.parse(await decrypt(await readBackupText(response),password));}
