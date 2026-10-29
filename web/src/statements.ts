import Decimal from 'decimal.js';
import {localDay,type Account} from './model';
import {statementSchema,statementBatchSchema,type Statement,type StatementRow,type StatementSource,type StatementBatch,validStatementTime} from './statement-model';
import {db,getMeta} from './db';
import type {StatementSheet} from './statement-reader';

export type Mapping={time:number;amount:number;direction:number;income:number;expense:number;sourceId:number;counterparty:number;description:number;paymentMethod:number;status:number;currency:number};
export type AmountMode='direction'|'signed'|'split';
const aliases:Record<keyof Mapping,string[]>={time:['交易时间','交易创建时间','交易日期','记账日期','日期'],amount:['金额','交易金额','发生额'],direction:['收支','收/支','收支类型'],income:['收入金额','收入','贷方发生额'],expense:['支出金额','支出','借方发生额'],sourceId:['交易订单号','交易号','交易单号','流水号','交易流水号'],counterparty:['交易对方','对方名称','对方户名'],description:['商品说明','商品名称','商品','摘要','交易摘要','备注'],paymentMethod:['收付款方式','付款方式','支付方式','资金渠道'],status:['交易状态','当前状态','状态'],currency:['币种','货币']};
export const mappingLabels:Record<keyof Mapping,string>={time:'交易日期 / 时间',amount:'交易金额',direction:'收 / 支',income:'收入金额',expense:'支出金额',sourceId:'订单号 / 流水号',counterparty:'交易对方',description:'商品 / 摘要',paymentMethod:'付款方式',status:'交易状态',currency:'币种'};
const normalized=(s:string)=>s.replace(/[\s\uFEFF]/g,'').replace(/（/g,'(').replace(/）/g,')').replace(/\((元|人民币)\)$/,'');
export function suggestMapping(headers:string[]):Mapping{return Object.fromEntries(Object.entries(aliases).map(([k,options])=>[k,headers.findIndex(h=>options.includes(normalized(h)))])) as Mapping;}
export function detectStatement(sheet:StatementSheet){
  let header=0,score=-1;
  sheet.rows.slice(0,80).forEach((row,i)=>{const m=suggestMapping(row),s=(m.time>=0?3:0)+(m.amount>=0?2:0)+(m.income>=0||m.expense>=0?2:0)+(m.direction>=0?2:0)+(m.sourceId>=0?1:0);if(s>score){score=s;header=i;}});
  const labels=(sheet.rows[header]||[]).map(normalized);
  const source:StatementSource|undefined=labels.includes('当前状态')&&labels.includes('交易类型')?'wechat':labels.includes('收付款方式')||labels.includes('交易分类')||labels.includes('交易号')&&labels.includes('对方账户')?'alipay':undefined;
  return {header,source,mapping:suggestMapping(sheet.rows[header]||[])};
}
function timeValue(s:string){
  let v=s.trim().replace(/\//g,'-').replace(/年|月/g,'-').replace(/日/g,'').replace('T',' ');
  if(/^\d{8}$/.test(v))v=v.slice(0,4)+'-'+v.slice(4,6)+'-'+v.slice(6);
  const match=v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if(!match)throw new Error('日期无法识别，请使用年-月-日及可选的时:分:秒');
  const [,y,m,d,h='00',min='00',sec='00']=match;
  v=`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')} ${h.padStart(2,'0')}:${min}:${sec}`;
  if(!validStatementTime(v)||v.slice(0,10)>localDay())throw new Error('日期无效或晚于今天');
  return v;
}
function amountValue(s:string,empty=false){
  let v=s.trim().replace(/^[¥￥]\s*/,'').replace(/元$/,'').trim();
  if(empty&&['','-','--','/'].includes(v))return new Decimal(0);
  if(!/^[+-]?(?:\d{1,14}|\d{1,3}(?:,\d{3}){1,4})(?:\.\d{1,2})?$/.test(v))throw new Error('金额无效：仅支持人民币数字和最多两位小数');
  v=v.replace(/,/g,'');const amount=new Decimal(v);
  if(amount.abs().gte('100000000000000'))throw new Error('金额超出范围');
  return amount;
}
function directionValue(s:string):StatementRow['direction']{
  if(['收入','收','入','贷','贷方'].includes(s))return 'in';
  if(['支出','支','出','借','借方'].includes(s))return 'out';
  if(['不计收支','不计收入支出','其他','中性交易','/'].includes(s))return 'neutral';
  throw new Error('收支方向不明确，请调整列映射或金额模式');
}
export function parseStatementRows(sheet:StatementSheet,header:number,mapping:Mapping,mode:AmountMode){
  if(mapping.time<0||mode==='direction'&&(mapping.amount<0||mapping.direction<0)||mode==='signed'&&mapping.amount<0||mode==='split'&&(mapping.income<0||mapping.expense<0))throw new Error('请先选择日期、金额和收支所对应的列');
  const rows:StatementRow[]=[],errors:string[]=[];let ignored=0;
  sheet.rows.slice(header+1).forEach((r,index)=>{
    if(!r.some(v=>v.trim()))return;
    const get=(key:keyof Mapping)=>mapping[key]<0?'':(r[mapping[key]]||'').trim();
    if(/^(?:[-*=]{3,}|共\s*\d+\s*笔|合计|说明[:：]|导出时间[:：])/.test(r.find(Boolean)||'')&&!/^\d{4}/.test(get('time'))){ignored++;return;}
    try{
      if(rows.length>=5000)throw new Error('单次最多导入 5,000 笔');
      const currency=get('currency');if(currency&&!['CNY','RMB','人民币','人民币元','156'].includes(currency.toUpperCase()))throw new Error('仅支持人民币，请按币种分开导出');
      const time=timeValue(get('time'));let amount:Decimal,direction:StatementRow['direction'];
      if(mode==='split'){
        const income=amountValue(get('income'),true),expense=amountValue(get('expense'),true);
        if(income.isNegative()||expense.isNegative()||income.gt(0)&&expense.gt(0))throw new Error('收入和支出不能同时有金额或为负数');
        amount=income.plus(expense);direction=income.gt(0)?'in':expense.gt(0)?'out':'neutral';
      }else{amount=amountValue(get('amount'));direction=mode==='signed'?(amount.gt(0)?'in':amount.lt(0)?'out':'neutral'):directionValue(get('direction'));if(mode==='direction'&&amount.isNegative())throw new Error('金额与方向分列时金额必须非负');}
      let sourceId=get('sourceId').replace(/^="([\w-]+)"$/,'$1');if(['-','--','/'].includes(sourceId))sourceId='';
      if(/精度已丢失|^\d+(?:\.\d+)?e[+-]?\d+$/i.test(sourceId))throw new Error('订单号已被 Excel 舍入，请使用原始文件或文本格式编号');
      const row={time,amount:amount.abs().toFixed(2),direction,sourceId,counterparty:get('counterparty'),description:get('description'),paymentMethod:get('paymentMethod'),status:get('status')};
      const check=statementSchema.pick({time:true,amount:true,direction:true,sourceId:true,counterparty:true,description:true,paymentMethod:true,status:true}).safeParse(row);
      if(!check.success)throw new Error('字段内容过长或格式无效');
      rows.push(check.data);
    }catch(e){errors.push(`第 ${header+index+2} 行：${e instanceof Error?e.message:'格式无效'}`);}
  });
  return {rows,errors,ignored};
}
async function hash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
export type StatementPlan={accountId:string;source:StatementSource;fileName:string;fileHash:string;revision:string;rows:Statement[];duplicates:number;conflicts:string[];possibleDuplicates:number};
function assertSource(account:Account,source:StatementSource){
  const required=source==='alipay'?'支付宝':source==='wechat'?'微信钱包':source==='cmb'||source==='pingan'?'银行卡':null;
  if(required&&account.platform!==required)throw new Error(`请选择“${required}”类型的账户；付款银行卡可在原始付款方式中查看`);
}
export async function planStatementImport(account:Account,source:StatementSource,fileName:string,fileHash:string,input:StatementRow[]):Promise<StatementPlan>{
  assertSource(account,source);
  const revision=await getMeta('ledgerRevision','');
  const existing=await db.statements.toArray(),batches=await db.statementBatches.toArray();
  const plan:StatementPlan={accountId:account.id,source,fileName,fileHash,revision,rows:[],duplicates:0,conflicts:[],possibleDuplicates:0};
  if(batches.some(b=>b.fileHash===fileHash&&b.source===source)){plan.duplicates=input.length;return plan;}
  const known=new Map(existing.filter(r=>r.accountId===account.id&&r.source===source&&r.sourceId).map(r=>[r.sourceId,r]));
  const peerKeys=new Set(existing.map(r=>JSON.stringify([r.amount,r.time.slice(0,10),r.direction])));
  const batchId=crypto.randomUUID();
  for(const raw of input){
    const fingerprint=await hash(JSON.stringify([account.id,source,raw.time,raw.amount,raw.direction,raw.sourceId,raw.counterparty,raw.description,raw.paymentMethod,raw.status]));
    const found=raw.sourceId?known.get(raw.sourceId):undefined;
    if(found){if(found.fingerprint===fingerprint)plan.duplicates++;else plan.conflicts.push(`订单 ${raw.sourceId} 的金额、状态或其他字段与已有记录不同，请先核对并移除旧批次，或修正文件`);continue;}
    const peer=peerKeys.has(JSON.stringify([raw.amount,raw.time.slice(0,10),raw.direction]));
    if(peer)plan.possibleDuplicates++;
    const row=statementSchema.parse({...raw,id:crypto.randomUUID(),accountId:account.id,batchId,source,fingerprint,review:'pending',category:'other'});
    plan.rows.push(row);if(row.sourceId)known.set(row.sourceId,row);
  }
  return plan;
}
export async function commitStatementImport(plan:StatementPlan){
  if(plan.conflicts.length||!plan.rows.length)throw new Error('没有可提交的预览，或存在订单冲突');
  if(plan.rows.length>5000)throw new Error('单次最多导入 5,000 笔');
  const rows=plan.rows.map(r=>statementSchema.parse(r));
  const batch:StatementBatch=statementBatchSchema.parse({id:rows[0].batchId,accountId:plan.accountId,source:plan.source,fileName:plan.fileName,fileHash:plan.fileHash,importedAt:new Date().toISOString()});
  if(rows.some(r=>r.accountId!==batch.accountId||r.source!==batch.source||r.batchId!==batch.id||r.review!=='pending'))throw new Error('预览内容无效');
  await db.transaction('rw',[db.accounts,db.statements,db.statementBatches,db.meta],async()=>{
    if(await getMeta('ledgerRevision','')!==plan.revision)throw new Error('账本已恢复或替换，请重新预览');
    const account=await db.accounts.get(plan.accountId);if(!account)throw new Error('账户已被删除，请重新选择');assertSource(account,plan.source);
    if(await db.statements.count()+rows.length>50000||await db.statementBatches.count()>=2000)throw new Error('已达到 50,000 笔流水或 2,000 个批次的保存上限，请先备份并整理历史批次');
    if(await db.statementBatches.where('fileHash').equals(plan.fileHash).filter(b=>b.source===plan.source).count())throw new Error('该文件已导入，请重新预览');
    const latest=await db.statements.where('accountId').equals(plan.accountId).toArray();
    const ids=new Set(latest.filter(r=>r.sourceId).map(r=>JSON.stringify([r.source,r.sourceId])));
    if(rows.some(r=>r.sourceId&&ids.has(JSON.stringify([r.source,r.sourceId]))))throw new Error('流水已变化，请重新预览以避免重复');
    await db.statementBatches.add(batch);await db.statements.bulkAdd(rows);
  });
}
export async function reviewStatement(before:Statement,review:Statement['review'],category:Statement['category']){
  const after=statementSchema.parse({...before,review,category});
  await db.transaction('rw',db.statements,async()=>{const current=await db.statements.get(before.id);if(JSON.stringify(current)!==JSON.stringify(before))throw new Error('这笔流水已变化，请重新核对');await db.statements.put(after);});
}
export async function removeStatementBatch(id:string){await db.transaction('rw',[db.statements,db.statementBatches],async()=>{await db.statements.where('batchId').equals(id).delete();await db.statementBatches.delete(id);});}
