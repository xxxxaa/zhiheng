import Papa from 'papaparse';
import {positionSchema,type Position,type Account,localDay} from './model';
export const template='账户,名称,类型,代码,数量,单价,总成本,数据日期,基金分类,到期日,年利率\n日常储蓄,活期余额,cash,,12000,1,,'+localDay()+',unknown,,\n';
export function parsePositions(text:string,accounts:Account[],existing:Position[]){
  const parsed=Papa.parse<Record<string,string>>(text.replace(/^\uFEFF/,''),{header:true,skipEmptyLines:'greedy',transformHeader:h=>h.trim(),transform:v=>v.trim()});
  if(parsed.errors.length)throw new Error(`CSV 格式错误：${parsed.errors[0].message}`);
  if(!parsed.meta.fields?.includes('账户')||!parsed.meta.fields.includes('名称'))throw new Error('请选择知衡持仓模板 CSV。支付宝 / 微信交易账单请到“账单与流水”导入。');
  if(parsed.data.length>10000)throw new Error('一次最多导入 10,000 项');
  const positions:Position[]=[],errors:string[]=[],duplicates:string[]=[];
  const fingerprint=(p:Position)=>JSON.stringify([p.accountId,p.name,p.kind,p.code,p.quantity,p.price,p.cost,p.asOf,p.fundType,p.maturity,p.rate]);
  const seen=new Set(existing.map(fingerprint));
  parsed.data.forEach((r,i)=>{try{const matches=accounts.filter(a=>a.name===r['账户']);if(matches.length!==1)throw new Error('账户名称不存在或不唯一，请先创建或调整账户');const p=positionSchema.parse({id:crypto.randomUUID(),accountId:matches[0].id,name:r['名称'],kind:r['类型'],code:r['代码']||'',quantity:r['数量'],price:r['单价'],cost:r['总成本']||null,asOf:r['数据日期'],fundType:r['基金分类']||'unknown',maturity:r['到期日']||'',rate:r['年利率']||null});if(p.asOf>localDay())throw new Error('数据日期不能晚于今天');const f=fingerprint(p);if(seen.has(f)){duplicates.push(`第 ${i+2} 行 · ${p.name}`);return;}
    if(existing.some(x=>x.accountId===p.accountId&&x.kind===p.kind&&((p.code&&x.code===p.code)||x.name===p.name)))throw new Error('已有同名或同代码资产，请使用编辑更新估值，避免重复计入');
    if(positions.some(x=>x.accountId===p.accountId&&x.kind===p.kind&&((p.code&&x.code===p.code)||x.name===p.name)))throw new Error('文件内同一资产存在不同快照，请保留一条');
    seen.add(f);positions.push(p);
  }catch(e){errors.push(`第 ${i+2} 行：${e instanceof Error?e.message:'数据无效'}`);}});
  return {positions,errors,duplicates};
}
