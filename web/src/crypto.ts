import { z } from 'zod';
import {MAX_BACKUP_BYTES,BACKUP_SIZE_ERROR} from './backup-limits';
const ITERATIONS=310000;
const envelopeSchema=z.object({format:z.literal('zhiheng-encrypted'),version:z.literal(1),kdf:z.literal('PBKDF2-SHA256'),iterations:z.literal(ITERATIONS),salt:z.string().max(64),iv:z.string().max(32),ciphertext:z.string().max(MAX_BACKUP_BYTES)}).strict();
function b64(bytes:Uint8Array){let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);}
function bytes(s:string){return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}
async function key(password:string,salt:Uint8Array){const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:ITERATIONS,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
const aad=new TextEncoder().encode('zhiheng-encrypted:v1');
export async function encrypt(data:unknown,password:string){
  if(password.length<10)throw new Error('备份口令至少 10 个字符');
  const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
  const plain=new TextEncoder().encode(JSON.stringify(data));
  const header={format:'zhiheng-encrypted',version:1,kdf:'PBKDF2-SHA256',iterations:ITERATIONS,salt:b64(salt),iv:b64(iv),ciphertext:''};
  // AES-GCM appends a 16-byte tag; base64 and JSON overhead also count toward the file limit.
  if(JSON.stringify(header).length+4*Math.ceil((plain.byteLength+16)/3)>MAX_BACKUP_BYTES)throw new Error(BACKUP_SIZE_ERROR);
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},await key(password,salt),plain);
  return JSON.stringify({...header,ciphertext:b64(new Uint8Array(ciphertext))});
}
export async function decrypt(text:string,password:string):Promise<unknown>{if(text.length>MAX_BACKUP_BYTES||new TextEncoder().encode(text).byteLength>MAX_BACKUP_BYTES)throw new Error(BACKUP_SIZE_ERROR);let e;try{e=envelopeSchema.parse(JSON.parse(text));if(bytes(e.salt).length!==16||bytes(e.iv).length!==12)throw new Error();}catch{throw new Error('不支持的备份格式或文件已损坏');}try{const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(e.iv),additionalData:aad},await key(password,bytes(e.salt)),bytes(e.ciphertext));return JSON.parse(new TextDecoder().decode(plain));}catch{throw new Error('口令不正确，或备份文件已损坏');}}
export {download} from './file-export';
