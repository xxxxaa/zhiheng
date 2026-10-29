import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import {beforeEach,describe,expect,it} from 'vitest';
import {utils,write} from 'xlsx';
import {readStatementBytes,decodeStatement,type StatementSheet} from './statement-reader';
import {detectStatement,parseStatementRows,planStatementImport,commitStatementImport,reviewStatement,removeStatementBatch,suggestMapping} from './statements';
import {db,exportData,restoreData,undoRestore,removeAccount} from './db';
import {bundleSchema,defaultProfile,makeBundle,type Account,type Position} from './model';
import {encrypt,decrypt} from './crypto';

const account:Account={id:'wallet',name:'合成支付宝测试账户',platform:'支付宝'};
const sheet:StatementSheet={name:'合成账单',rows:[['支付宝交易记录明细查询'],['以下均为合成测试数据'],['交易时间','交易分类','交易对方','商品说明','收/支','金额（元）','收付款方式','交易状态','交易订单号'],['2026-01-01 10:00:00','餐饮','合成商户','午餐','支出','18.50','招商银行(0000)','交易成功','202601010000000000001'],['2026-01-02 10:00:00','退款','合成商户','午餐退款','收入','18.50','招商银行(0000)','退款成功','202601020000000000002'],['2026-01-03 10:00:00','转账','本人','充值','不计收支','100','余额','交易成功','202601030000000000003'],['-----说明-----']]};
const parse=()=>{const detected=detectStatement(sheet);return parseStatementRows(sheet,detected.header,detected.mapping,'direction');};
const fileHash='a'.repeat(64);
async function plan(){return planStatementImport(account,'alipay','synthetic.csv',fileHash,parse().rows);}
beforeEach(async()=>{await db.open();await db.transaction('rw',db.tables,async()=>{for(const table of db.tables)await table.clear();});await db.accounts.add(account);});

describe('账单格式与金额边界',()=>{
  it('识别前置说明、全角表头和退款/互转记录，保留超长订单号',()=>{
    expect(detectStatement(sheet)).toMatchObject({header:2,source:'alipay'});const result=parse();expect(result.errors).toEqual([]);expect(result.rows).toHaveLength(3);expect(result.ignored).toBe(1);
    expect(result.rows[0]).toMatchObject({amount:'18.50',direction:'out',sourceId:'202601010000000000001',paymentMethod:'招商银行(0000)'});expect(result.rows[1]).toMatchObject({direction:'in',status:'退款成功'});expect(result.rows[2]).toMatchObject({direction:'neutral',amount:'100.00'});
  });
  it('CSV 支持 BOM、引号内逗号、空行和多行说明',async()=>{
    const csv='\uFEFF说明\n\n交易时间,交易分类,交易对方,商品说明,收/支,金额（元）,收付款方式,交易状态,交易订单号\n2026-01-01 10:00:00,购物,"合成,商户",商品,支出,12.30,余额,交易成功,12345678901234567890\n';
    const result=await readStatementBytes('sample.csv',new TextEncoder().encode(csv).buffer);const found=detectStatement(result.sheets[0]);const parsed=parseStatementRows(result.sheets[0],found.header,found.mapping,'direction');expect(parsed.errors).toEqual([]);expect(parsed.rows[0].counterparty).toBe('合成,商户');expect(parsed.rows[0].sourceId).toBe('12345678901234567890');
  });
  it('处理银行 GB18030 编码而不替换中文为乱码',()=>{expect(decodeStatement(Uint8Array.from([0xd6,0xd0,0xce,0xc4]).buffer)).toEqual({text:'中文',encoding:'GB18030'});});
  it('微信 XLSX 通过真实工作簿解析，保留日期与文本订单号',async()=>{
    const workbook=utils.book_new();utils.book_append_sheet(workbook,utils.aoa_to_sheet([['微信支付账单明细'],['交易时间','交易类型','交易对方','商品','收/支','金额(元)','支付方式','当前状态','交易单号'],['2026-01-01 12:30:00','商户消费','合成商家','测试商品','支出','￥1,234.56','零钱','支付成功','12345678901234567890']]));
    const file=await readStatementBytes('wechat.xlsx',write(workbook,{type:'array',bookType:'xlsx',compression:true}));const found=detectStatement(file.sheets[0]);expect(found.source).toBe('wechat');const parsed=parseStatementRows(file.sheets[0],found.header,found.mapping,'direction');expect(parsed.errors).toEqual([]);expect(parsed.rows[0]).toMatchObject({amount:'1234.56',sourceId:'12345678901234567890'});
  });
  it('拒绝 Excel 已丢失精度的数字编号和超出声明大小的 ZIP',async()=>{
    const book=utils.book_new();const rows=sheet.rows.map(r=>[...r]) as unknown[][];rows[3][8]=12345678901234567890;utils.book_append_sheet(book,utils.aoa_to_sheet(rows));
    const bytes=write(book,{type:'array',bookType:'xlsx'}) as ArrayBuffer;const file=await readStatementBytes('number.xlsx',bytes);const found=detectStatement(file.sheets[0]);expect(parseStatementRows(file.sheets[0],found.header,found.mapping,'direction').errors.join()).toContain('舍入');
    const corrupt=bytes.slice(0),view=new DataView(corrupt);for(let i=0;i<corrupt.byteLength-46;i++){if(view.getUint32(i,true)===0x02014b50){view.setUint32(i+24,40_000_000,true);break;}}await expect(readStatementBytes('oversize.xlsx',corrupt)).rejects.toThrow('30 MB');
  });
  it('银行正负金额和收支分列需明确选择，不凭金额猜方向',()=>{
    const bank:StatementSheet={name:'bank',rows:[['记账日期','交易金额','收入金额','支出金额','币种'],['2026/1/1','-12.30','','12.30','CNY']]};const mapping=suggestMapping(bank.rows[0]);
    expect(parseStatementRows(bank,0,mapping,'signed').rows[0]).toMatchObject({time:'2026-01-01 00:00:00',direction:'out',amount:'12.30'});
    expect(parseStatementRows(bank,0,mapping,'split').rows[0].amount).toBe('12.30');expect(()=>parseStatementRows(bank,0,mapping,'direction')).toThrow('选择');
    bank.rows[1][2]='10';expect(parseStatementRows(bank,0,mapping,'split').errors[0]).toContain('同时');bank.rows[1][4]='USD';expect(parseStatementRows(bank,0,mapping,'signed').errors[0]).toContain('人民币');
  });
  it('坏日期、未来日期、未知收支、非法金额及科学计数订单不能默默导入',()=>{
    for(const [column,value] of [[0,'2026-02-30'],[0,'2099-01-01'],[4,'待判断'],[5,'1,23'],[5,'18.501'],[8,'1.2345678901234568E+19']] as const){const broken=structuredClone(sheet);broken.rows[3][column]=value;const detected=detectStatement(broken);expect(parseStatementRows(broken,detected.header,detected.mapping,'direction').errors).toHaveLength(1);}
  });
  it('PDF、ZIP、空文件、过大文件与过量行不走模糊识别',async()=>{
    for(const name of ['a.pdf','a.zip','a.xls'])await expect(readStatementBytes(name,new TextEncoder().encode('not a table').buffer)).rejects.toThrow('暂不支持');
    await expect(readStatementBytes('empty.csv',new ArrayBuffer(0))).rejects.toThrow('非空');await expect(readStatementBytes('huge.csv',new ArrayBuffer(5_000_001))).rejects.toThrow('5 MB');
    await expect(readStatementBytes('rows.csv',new TextEncoder().encode('a,b\n'.repeat(5102)).buffer)).rejects.toThrow('5,100');
  });
});
describe('账单保存、去重和核对',()=>{
  it('预览不写数据，提交原子保存；交易不改变资产与净值',async()=>{
    const p:Position={id:'cash',accountId:account.id,name:'现金',kind:'cash',code:'',quantity:'500',price:'1',cost:null,asOf:'2026-01-01',fundType:'unknown',maturity:'',rate:null};await db.positions.add(p);
    const preview=await plan();expect(await db.statements.count()).toBe(0);await commitStatementImport(preview);
    expect(await db.statements.count()).toBe(3);expect(await db.statementBatches.count()).toBe(1);expect(await db.positions.get(p.id)).toEqual(p);expect(await db.snapshots.count()).toBe(0);expect((await db.statements.toArray()).every(r=>r.review==='pending')).toBe(true);
  });
  it('重复文件、重复订单跳过，订单内容变化阻止覆盖',async()=>{
    await commitStatementImport(await plan());expect((await plan()).duplicates).toBe(3);
    const duplicate=await planStatementImport(account,'alipay','another.csv','b'.repeat(64),parse().rows);expect(duplicate.rows).toHaveLength(0);expect(duplicate.duplicates).toBe(3);
    const changed=parse().rows;changed[0].status='退款成功';const preview=await planStatementImport(account,'alipay','changed.csv','c'.repeat(64),changed);expect(preview.conflicts).toHaveLength(1);await expect(commitStatementImport(preview)).rejects.toThrow('冲突');expect(await db.statements.count()).toBe(3);
  });
  it('无订单号的同额交易不误删，跨来源候选仅提示',async()=>{
    const records=parse().rows.map(r=>({...r,sourceId:''}));const first=await planStatementImport(account,'alipay','a.csv',fileHash,[records[0],records[0]]);expect(first.rows).toHaveLength(2);await commitStatementImport(first);
    const next=await planStatementImport(account,'alipay','b.csv','b'.repeat(64),[records[0]]);expect(next.rows).toHaveLength(1);expect(next.possibleDuplicates).toBe(1);
  });
  it('并发重复提交、恢复后的旧预览、账户错误均被拒绝',async()=>{
    const one=await plan(),two=await plan();await commitStatementImport(one);await expect(commitStatementImport(two)).rejects.toThrow('已导入');
    const stale=await planStatementImport(account,'alipay','different.csv','d'.repeat(64),[{...parse().rows[0],sourceId:'different'}]);await restoreData(makeBundle([account],[],defaultProfile));await expect(commitStatementImport(stale)).rejects.toThrow('替换');
    await expect(planStatementImport(account,'wechat','wrong.csv',fileHash,parse().rows)).rejects.toThrow('微信钱包');
  });
  it('核对需匹配当前记录；移除批次可回退，不影响其他批次',async()=>{
    const first=await plan();await commitStatementImport(first);const row=first.rows[0];await reviewStatement(row,'excluded','transfer');await expect(reviewStatement(row,'confirmed','expense')).rejects.toThrow('变化');
    await expect(removeAccount(account.id)).rejects.toThrow('流水');const next=await planStatementImport(account,'alipay','next.csv','e'.repeat(64),[{...parse().rows[0],sourceId:'next'}]);await commitStatementImport(next);await removeStatementBatch(first.rows[0].batchId);expect(await db.statements.count()).toBe(1);expect(await db.statementBatches.count()).toBe(1);
  });
});
describe('数据升级和加密恢复',()=>{
  it('旧数据库升级保留资产，并增加流水表',async()=>{
    await db.delete();const legacy=new Dexie(db.name);legacy.version(1).stores({accounts:'id',positions:'id,accountId',snapshots:'date',reports:'id,createdAt',meta:'key'});await legacy.table('accounts').add(account);legacy.close();await db.open();expect(await db.accounts.get(account.id)).toEqual(account);expect(await db.statements.count()).toBe(0);
  });
  it('流水、批次与核对状态加密往返，恢复和撤销不丢记录',async()=>{
    const preview=await plan();await commitStatementImport(preview);await reviewStatement(preview.rows[0],'confirmed','expense');const bundle=await exportData();expect(bundle.version).toBe(2);
    const encrypted=await encrypt(bundle,'test-passphrase');expect(encrypted).not.toContain('合成商户');const restored=bundleSchema.parse(await decrypt(encrypted,'test-passphrase'));await restoreData(makeBundle([account],[],defaultProfile));expect(await db.statements.count()).toBe(0);await undoRestore();expect(await db.statements.count()).toBe(3);await restoreData(restored);expect(await db.statements.get(preview.rows[0].id)).toMatchObject({review:'confirmed',category:'expense'});
  });
  it('v1 备份迁移为空流水；错误批次引用和缺失 v2 字段拒绝恢复',async()=>{
    const {statements:_s,statementBatches:_b,...base}=makeBundle([account],[],defaultProfile);const old={...base,version:1};expect(bundleSchema.parse(old)).toMatchObject({version:2,statements:[],statementBatches:[]});
    await commitStatementImport(await plan());const saved=await exportData();await expect(restoreData({...saved,statementBatches:[]})).rejects.toThrow();expect(await db.statements.count()).toBe(3);expect(bundleSchema.safeParse({...base,version:2}).success).toBe(false);
  });
});
