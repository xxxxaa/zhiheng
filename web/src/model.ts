import { z } from 'zod';
import Decimal from 'decimal.js';
import {statementSchema,statementBatchSchema,type Statement,type StatementBatch} from './statement-model';

export const kinds = { cash:'现金 / 活期', deposit:'定期存款', fund:'基金', stock:'股票', debt:'负债' } as const;
export const platforms = ['银行卡','支付宝','微信钱包','东方财富','其他'] as const;
const decimal = z.string().regex(/^\d{1,14}(\.\d{1,8})?$/, '请输入非负数字，最多 8 位小数');
const id = z.string().min(1).max(100);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v);return !isNaN(d.getTime())&&d.toISOString().slice(0,10)===v;},'日期无效');
export const accountSchema = z.object({id,name:z.string().trim().min(1).max(60),platform:z.enum(platforms)}).strict();
export const positionSchema = z.object({
  id,accountId:id,name:z.string().trim().min(1).max(80),kind:z.enum(['cash','deposit','fund','stock','debt']),
  code:z.string().trim().max(30),quantity:decimal,price:decimal,cost:decimal.nullable(),asOf:date,
  fundType:z.enum(['equity','bond','money','mixed','unknown']),maturity:z.union([date,z.literal('')]),rate:decimal.nullable()
}).strict();
export const profileSchema=z.object({expense:decimal,targetEquity:z.number().min(0).max(100),risk:z.enum(['稳健','均衡','进取']),horizon:z.enum(['1 年内','1–3 年','3–5 年','5 年以上'])}).strict();
export const snapshotSchema=z.object({date,assets:decimal,debt:decimal,net:z.string().regex(/^-?\d+(\.\d+)?$/)}).strict();
export const reportSchema=z.object({id,createdAt:z.string().datetime(),question:z.string().max(2000),model:z.string().max(100),text:z.string().max(100000),sources:z.array(z.object({url:z.string().url(),title:z.string()})).max(100),demo:z.boolean()});
const bundleFields={format:z.literal('zhiheng-data'),exportedAt:z.string().datetime(),accounts:z.array(accountSchema).max(500),positions:z.array(positionSchema).max(10000),profile:profileSchema,snapshots:z.array(snapshotSchema).max(10000),reports:z.array(reportSchema)};
const legacyBundle=z.object({...bundleFields,version:z.literal(1)}).strict();
const currentBundle=z.object({...bundleFields,version:z.literal(2),statements:z.array(statementSchema).max(50000),statementBatches:z.array(statementBatchSchema).max(2000)}).strict();
export const bundleSchema=z.union([currentBundle,legacyBundle.transform(b=>({...b,version:2 as const,statements:[] as Statement[],statementBatches:[] as StatementBatch[]}))]).superRefine((b,ctx)=>{
  for(const arr of [b.accounts,b.positions,b.reports,b.statements,b.statementBatches]) if(new Set(arr.map(x=>x.id)).size!==arr.length) ctx.addIssue({code:'custom',message:'备份中存在重复 ID'});
  const accounts=new Set(b.accounts.map(a=>a.id));
  if(b.positions.some(p=>!accounts.has(p.accountId))) ctx.addIssue({code:'custom',message:'持仓缺少关联账户'});
  const batches=new Map(b.statementBatches.map(batch=>[batch.id,batch]));
  const orderKeys=b.statements.filter(r=>r.sourceId).map(r=>JSON.stringify([r.accountId,r.source,r.sourceId]));
  if(new Set(orderKeys).size!==orderKeys.length)ctx.addIssue({code:'custom',message:'备份中存在重复流水订单号'});
  if(b.statementBatches.some(batch=>!accounts.has(batch.accountId))||b.statements.some(row=>{const batch=batches.get(row.batchId);return !accounts.has(row.accountId)||!batch||batch.accountId!==row.accountId||batch.source!==row.source;}))ctx.addIssue({code:'custom',message:'流水缺少有效关联账户或导入批次'});
  if(new Set(b.snapshots.map(s=>s.date)).size!==b.snapshots.length) ctx.addIssue({code:'custom',message:'快照日期重复'});
  if(b.positions.some(p=>p.asOf>localDay())||b.statements.some(s=>s.time.slice(0,10)>localDay())) ctx.addIssue({code:'custom',message:'数据日期不能晚于今天'});
});
export type Account=z.infer<typeof accountSchema>;
export type Position=z.infer<typeof positionSchema>;
export type Profile=z.infer<typeof profileSchema>;
export type Snapshot=z.infer<typeof snapshotSchema>;
export type Report=z.infer<typeof reportSchema>;
export type Bundle=z.infer<typeof bundleSchema>;
export const defaultProfile:Profile={expense:'0',targetEquity:40,risk:'均衡',horizon:'3–5 年'};
export function localDay(now=new Date()){return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;}
export const value=(p:Position)=>new Decimal(p.quantity).times(p.price);
export const money=(v:Decimal.Value)=>{const amount=new Decimal(v);const [whole,fraction]=amount.abs().toFixed(2).split('.');return `${amount.isNegative()?'-':''}¥${whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')}.${fraction}`;};
export function category(p:Position){if(p.kind==='stock')return '权益'; if(p.kind==='fund')return ({equity:'权益',bond:'债券',money:'现金',mixed:'混合 / 未分类',unknown:'混合 / 未分类'})[p.fundType];return ({cash:'现金',deposit:'存款',debt:'负债'})[p.kind];}
export function metrics(positions:Position[],profile:Profile,now=new Date()){
  let assets=new Decimal(0),debt=new Decimal(0),liquid=new Decimal(0),equity=new Decimal(0),unknown=new Decimal(0),cost=new Decimal(0),pnl=new Decimal(0),missingCost=0;
  const allocations:Record<string,Decimal>={},instruments:Record<string,Decimal>={};
  positions.forEach(p=>{const v=value(p),c=category(p); if(p.kind==='debt'){debt=debt.plus(v);return;} assets=assets.plus(v);allocations[c]=(allocations[c]||new Decimal(0)).plus(v);if(c==='现金')liquid=liquid.plus(v);if(c==='权益')equity=equity.plus(v);if(c==='混合 / 未分类')unknown=unknown.plus(v);
    if(p.kind==='stock'||p.kind==='fund'){const key=p.code?`${p.kind}:${p.code.toUpperCase()}`:p.id;instruments[key]=(instruments[key]||new Decimal(0)).plus(v);if(p.cost!==null){cost=cost.plus(p.cost);pnl=pnl.plus(v.minus(p.cost));}else missingCost++;}
  });
  const ratio=(v:Decimal)=>assets.gt(0)?v.div(assets).times(100).toNumber():0;
  const largest=Object.values(instruments).reduce((a,b)=>Decimal.max(a,b),new Decimal(0));
  const stale=positions.filter(p=>new Date(`${p.asOf}T00:00:00`).getTime()<new Date(`${localDay(now)}T00:00:00`).getTime()-7*86400000).length;
  return {assets,debt,net:assets.minus(debt),liquid,equity,unknown,cost,pnl,missingCost,allocations,stale,largestRatio:ratio(largest),equityRatio:ratio(equity),unknownRatio:ratio(unknown),debtRatio:ratio(debt),months:new Decimal(profile.expense).gt(0)?liquid.div(profile.expense).toNumber():null};
}
export function health(positions:Position[],profile:Profile){const m=metrics(positions,profile);return [
  {title:'应急资金',value:m.months===null?'待补充支出':`${m.months.toFixed(1)} 个月`,state:m.months===null?'unknown':m.months<6?'attention':'good',description:m.months===null?'设置每月必要支出后，计算现金与货币基金的覆盖月数。':'按现金与货币基金计算，6 个月是可调整的规划参考；定期存款未计入。'},
  {title:'持仓集中度',value:`${m.largestRatio.toFixed(1)}%`,state:m.largestRatio>20?'attention':'good',description:'同代码的股票 / 基金跨账户合并。20% 为检查提醒线，未穿透基金底层持仓；无代码记录无法合并。'},
  {title:'权益配置',value:`${m.equityRatio.toFixed(1)}%`,state:m.unknown.gt(0)?'unknown':Math.abs(m.equityRatio-profile.targetEquity)>10?'attention':'good',description:`你的目标为 ${profile.targetEquity}%。混合与未分类基金占 ${m.unknownRatio.toFixed(1)}%，未计入权益。`},
  {title:'数据新鲜度',value:m.stale?`${m.stale} 项待更新`:'7 天内已更新',state:m.stale?'attention':'good',description:'日期来自各项资产的估值日期。已更新股票采用行情截至日期，其他资产以账本快照为准；超过 7 天提醒复核。'}
];}
export function makeBundle(accounts:Account[],positions:Position[],profile:Profile,snapshots:Snapshot[]=[],reports:Report[]=[],statements:Statement[]=[],statementBatches:StatementBatch[]=[]):Bundle{return bundleSchema.parse({format:'zhiheng-data',version:2,exportedAt:new Date().toISOString(),accounts,positions,profile,snapshots,reports,statements,statementBatches});}
