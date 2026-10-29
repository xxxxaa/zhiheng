import Papa from 'papaparse';
import {read,utils} from 'xlsx';

export const MAX_STATEMENT_BYTES=5_000_000;
export const MAX_STATEMENT_ROWS=5100;
export type StatementSheet={name:string;rows:string[][]};
export type StatementFile={name:string;hash:string;sheets:StatementSheet[];encoding:string};
export async function digest(value:string|ArrayBuffer){
  const bytes=typeof value==='string'?new TextEncoder().encode(value):value;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
}
function bounded(rows:string[][]){
  if(rows.length>MAX_STATEMENT_ROWS||rows.some(r=>r.length>60))throw new Error('账单超过 5,100 行或 60 列，请按较短时间范围重新导出');
  if(rows.some(r=>r.some(c=>c.length>4000)))throw new Error('账单单元格内容过长，请检查文件');
  return rows;
}
export function decodeStatement(bytes:ArrayBuffer){
  const prefix=new Uint8Array(bytes,0,Math.min(bytes.byteLength,2));
  if(prefix[0]===0xff&&prefix[1]===0xfe)return {text:new TextDecoder('utf-16le',{fatal:true}).decode(bytes),encoding:'UTF-16'};
  try{return {text:new TextDecoder('utf-8',{fatal:true}).decode(bytes),encoding:'UTF-8'};}
  catch{return {text:new TextDecoder('gb18030',{fatal:true}).decode(bytes),encoding:'GB18030'};}
}
// Check the ZIP directory before decompressing an XLSX file in the worker.
function checkWorkbookSize(bytes:ArrayBuffer){
  const view=new DataView(bytes);let end=-1;
  for(let i=bytes.byteLength-22;i>=Math.max(0,bytes.byteLength-65557);i--){if(view.getUint32(i,true)===0x06054b50&&i+22+view.getUint16(i+20,true)===bytes.byteLength){end=i;break;}}
  if(end<0)throw new Error('Excel 文件损坏或不支持，请重新导出 .xlsx');
  const count=view.getUint16(end+10,true),offset=view.getUint32(end+16,true);
  if(count>2000||count===0||view.getUint16(end+4,true)!==0||view.getUint16(end+6,true)!==0)throw new Error('Excel 文件结构不支持');
  let at=offset,total=0;
  for(let i=0;i<count;i++){
    if(at+46>end||view.getUint32(at,true)!==0x02014b50)throw new Error('Excel 文件目录损坏');
    if(view.getUint16(at+8,true)&1)throw new Error('请先用原平台提供的密码解压或解锁文件，再选择 .xlsx');
    total+=view.getUint32(at+24,true);
    if(total>30_000_000)throw new Error('Excel 解压后超过 30 MB，请缩小账单范围');
    at+=46+view.getUint16(at+28,true)+view.getUint16(at+30,true)+view.getUint16(at+32,true);
  }
  if(at>end)throw new Error('Excel 文件目录损坏');
}
export async function readStatementBytes(name:string,bytes:ArrayBuffer):Promise<StatementFile>{
  if(!bytes.byteLength||bytes.byteLength>MAX_STATEMENT_BYTES)throw new Error('请选择非空且不超过 5 MB 的账单');
  const hash=await digest(bytes);
  if(/\.csv$/i.test(name)){
    const decoded=decodeStatement(bytes);
    if(decoded.text.includes('\0'))throw new Error('CSV 内容无效，请选择原始文本账单');
    const parsed=Papa.parse<string[]>(decoded.text.replace(/^\uFEFF/,''),{skipEmptyLines:false,preview:MAX_STATEMENT_ROWS+1,delimitersToGuess:[',','\t',';']});
    if(parsed.errors.some(e=>e.type==='Quotes'))throw new Error('CSV 引号格式不完整，请重新导出');
    return {name,hash,encoding:decoded.encoding,sheets:[{name:'CSV',rows:bounded(parsed.data.map(row=>row.map(v=>v.trim())))}]};
  }
  if(!/\.xlsx$/i.test(name))throw new Error('支持 CSV 和 XLSX。ZIP 请先解压；PDF、旧版 XLS 和截图暂不支持');
  checkWorkbookSize(bytes);
  const book=read(bytes,{type:'array',cellDates:false,cellFormula:false,cellHTML:false,sheetRows:MAX_STATEMENT_ROWS+1,dateNF:'yyyy-mm-dd hh:mm:ss'});
  if(book.SheetNames.length>10)throw new Error('工作表超过 10 张，请只保留所需账单');
  const sheets=book.SheetNames.map(name=>{
    const sheet=book.Sheets[name],range=utils.decode_range(sheet['!fullref']||sheet['!ref']||'A1');
    if(range.e.r>=MAX_STATEMENT_ROWS||range.e.c>=60)throw new Error('Excel 超过 5,100 行或 60 列，请缩小账单范围');
    for(let r=range.s.r;r<=range.e.r;r++)for(let c=range.s.c;c<=range.e.c;c++){
      const cell=sheet[utils.encode_cell({r,c})];
      if(cell?.t==='n'&&Math.abs(Number(cell.v))>Number.MAX_SAFE_INTEGER){cell.t='s';cell.v='[编号精度已丢失]';delete cell.w;}
    }
    return {name,rows:bounded(utils.sheet_to_json<string[]>(sheet,{header:1,raw:false,defval:'',blankrows:true}).map(r=>r.map(v=>String(v).trim())))};
  });
  if(!sheets.length)throw new Error('Excel 中没有工作表');
  return {name,hash,encoding:'Excel',sheets};
}
