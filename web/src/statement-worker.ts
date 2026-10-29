import {readStatementBytes} from './statement-reader';
self.onmessage=async(event:MessageEvent<{name:string;bytes:ArrayBuffer}>)=>{
  try{self.postMessage({result:await readStatementBytes(event.data.name,event.data.bytes)});}
  catch(e){self.postMessage({error:e instanceof Error?e.message:'账单解析失败，请检查文件格式'});}
};
