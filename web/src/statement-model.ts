import {z} from 'zod';

export const statementSources={alipay:'支付宝',wechat:'微信支付',cmb:'招商银行',pingan:'平安银行',other:'其他'} as const;
export const reviewLabels={pending:'待核对',confirmed:'已核对',excluded:'不计入收支'} as const;
export const categoryLabels={income:'收入',expense:'支出',transfer:'本人账户互转',refund:'退款',other:'其他 / 待确认'} as const;
export const sourceSchema=z.enum(['alipay','wechat','cmb','pingan','other']);
const id=z.string().min(1).max(100),hash=z.string().regex(/^[a-f0-9]{64}$/);
export function validStatementTime(value:string){
  if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value))return false;
  const parsed=new Date(value.replace(' ','T')+'Z');
  return !isNaN(parsed.getTime())&&parsed.toISOString().slice(0,19).replace('T',' ')===value;
}
export const statementSchema=z.object({
  id,accountId:id,batchId:id,source:sourceSchema,sourceId:z.string().max(120),
  time:z.string().refine(validStatementTime,'交易时间无效'),amount:z.string().regex(/^\d{1,14}\.\d{2}$/),
  direction:z.enum(['in','out','neutral']),counterparty:z.string().max(200),description:z.string().max(500),
  paymentMethod:z.string().max(120),status:z.string().max(120),fingerprint:hash,
  review:z.enum(['pending','confirmed','excluded']),category:z.enum(['income','expense','transfer','refund','other']),
}).strict();
export const statementBatchSchema=z.object({id,accountId:id,source:sourceSchema,fileName:z.string().min(1).max(200),fileHash:hash,importedAt:z.string().datetime()}).strict();
export type Statement=z.infer<typeof statementSchema>;
export type StatementBatch=z.infer<typeof statementBatchSchema>;
export type StatementSource=z.infer<typeof sourceSchema>;
export type StatementRow=Omit<Statement,'id'|'accountId'|'batchId'|'source'|'fingerprint'|'review'|'category'>;
