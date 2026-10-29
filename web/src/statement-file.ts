import type {StatementFile} from './statement-reader';
export async function readStatementFile(file:File,signal:AbortSignal):Promise<StatementFile>{
  if(file.size>5_000_000)throw new Error('账单不能超过 5 MB');
  if(signal.aborted)throw new Error('已取消读取');
  const bytes=await file.arrayBuffer();
  if(signal.aborted)throw new Error('已取消读取');
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./statement-worker.ts',import.meta.url),{type:'module'});
    const finish=(error?:string,result?:StatementFile)=>{clearTimeout(timer);signal.removeEventListener('abort',abort);worker.terminate();if(error)reject(new Error(error));else resolve(result!);};
    const abort=()=>finish('已取消读取');
    const timer=setTimeout(()=>finish('账单解析超时，请缩小导出范围后重试'),15000);
    signal.addEventListener('abort',abort,{once:true});
    worker.onmessage=e=>finish(e.data.error,e.data.result);
    worker.onerror=()=>finish('无法解析账单，请检查格式或重新导出');
    worker.postMessage({name:file.name,bytes},[bytes]);
  });
}
