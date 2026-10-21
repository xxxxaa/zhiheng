export const MAX_BACKUP_BYTES=30_000_000;
export const BACKUP_SIZE_ERROR='加密备份超过 30 MB 限制，本次操作未完成；本机数据保持不变';

// Count bytes while reading, including responses without a trustworthy Content-Length.
export async function readBackupText(response:Response,maxBytes=MAX_BACKUP_BYTES){
  const declared=Number(response.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>maxBytes){
    await response.body?.cancel();
    throw new Error(BACKUP_SIZE_ERROR);
  }
  if(!response.body)throw new Error('备份内容为空');
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
  const parts:string[]=[];let received=0;
  try{
    for(;;){
      const {done,value}=await reader.read();if(done)break;
      received+=value.byteLength;
      if(received>maxBytes)throw new Error(BACKUP_SIZE_ERROR);
      parts.push(decoder.decode(value,{stream:true}));
    }
    parts.push(decoder.decode());
    return parts.join('');
  }catch(error){
    await reader.cancel().catch(()=>{});
    throw error;
  }finally{reader.releaseLock();}
}
