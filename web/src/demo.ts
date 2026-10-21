import {type Account,type Position,type Snapshot,localDay} from './model';
export const demoAccounts:Account[]=[{id:'a1',name:'日常储蓄',platform:'银行卡'},{id:'a2',name:'生活与基金',platform:'支付宝'},{id:'a3',name:'零钱账户',platform:'微信钱包'},{id:'a4',name:'证券账户',platform:'东方财富'}];
const day=localDay();
export const demoPositions:Position[]=[
  ['p1','a1','日常备用金','cash','',48000,1,null,'unknown',''],['p2','a1','一年期存款','deposit','',120000,1,null,'unknown','2027-04-10'],
  ['p3','a2','货币基金（示例）','fund','DEMO-MONEY',32000,1,32000,'money',''],['p4','a2','宽基指数基金（示例）','fund','DEMO-EQUITY',40000,1.36,50000,'equity',''],
  ['p5','a2','中短债基金（示例）','fund','DEMO-BOND',50000,1.08,50000,'bond',''],['p6','a3','零钱','cash','',2680,1,null,'unknown',''],
  ['p7','a4','消费企业 A（示例）','stock','DEMO-A',100,1380,125000,'unknown',''],['p8','a4','制造企业 B（示例）','stock','DEMO-B',800,31.6,24000,'unknown',''],
  ['p9','a1','信用卡待还','debt','',6800,1,null,'unknown','']
].map(([id,accountId,name,kind,code,quantity,price,cost,fundType,maturity])=>({id,accountId,name,kind,code,quantity:String(quantity),price:String(price),cost:cost===null?null:String(cost),asOf:day,fundType,maturity,rate:kind==='deposit'?'1.5':null})) as Position[];
export const demoSnapshots:Snapshot[]=Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-30*(6-i));const net=[418000,426500,435800,450200,443000,462600,467560][i];return {date:localDay(d),net:String(net),assets:String(net+6800),debt:'6800'};});
