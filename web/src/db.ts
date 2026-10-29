import Dexie,{type Table} from 'dexie';
import type {Statement,StatementBatch} from './statement-model';
import {type Account,type Position,type Profile,type Snapshot,type Report,type Bundle,defaultProfile,bundleSchema,makeBundle,metrics,localDay} from './model';
class AssetDB extends Dexie{
  statements!:Table<Statement,string>; statementBatches!:Table<StatementBatch,string>; accounts!:Table<Account,string>; positions!:Table<Position,string>; snapshots!:Table<Snapshot,string>; reports!:Table<Report,string>; meta!:Table<{key:string,value:unknown},string>;
  constructor(){super('zhiheng-local-v1');this.version(1).stores({accounts:'id',positions:'id,accountId',snapshots:'date',reports:'id,createdAt',meta:'key'});this.version(2).stores({statements:'id,accountId,batchId,sourceId,review,fingerprint',statementBatches:'id,accountId,fileHash,importedAt'});}
}
export const db=new AssetDB();
export async function getMeta<T>(key:string,fallback:T):Promise<T>{return (await db.meta.get(key))?.value as T??fallback;}
export async function setMeta(key:string,value:unknown){await db.meta.put({key,value});}
export async function exportData(){return db.transaction('r',[db.accounts,db.positions,db.snapshots,db.reports,db.meta,db.statements,db.statementBatches],async()=>makeBundle(await db.accounts.toArray(),await db.positions.toArray(),await getMeta<Profile>('profile',defaultProfile),await db.snapshots.toArray(),await db.reports.toArray(),await db.statements.toArray(),await db.statementBatches.toArray()));}
export async function snapshot(){const positions=await db.positions.toArray();const m=metrics(positions,defaultProfile);await db.snapshots.put({date:localDay(),assets:m.assets.toFixed(2),debt:m.debt.toFixed(2),net:m.net.toFixed(2)});}
export async function savePosition(p:Position){await db.transaction('rw',[db.positions,db.accounts,db.snapshots],async()=>{if(!await db.accounts.get(p.accountId))throw new Error('账户已被删除，请重新选择');await db.positions.put(p);await snapshot();});}
export async function removePosition(id:string){await db.transaction('rw',[db.positions,db.snapshots],async()=>{await db.positions.delete(id);await snapshot();});}
export async function removeAccount(id:string){await db.transaction('rw',[db.accounts,db.positions,db.statements,db.statementBatches],async()=>{if(await db.positions.where('accountId').equals(id).count()||await db.statements.where('accountId').equals(id).count()||await db.statementBatches.where('accountId').equals(id).count())throw new Error('请先移出或删除这个账户内的资产和流水批次');await db.accounts.delete(id);});}
export async function restoreData(input:unknown){const b=bundleSchema.parse(input);await db.transaction('rw',[db.accounts,db.positions,db.snapshots,db.reports,db.meta,db.statements,db.statementBatches],async()=>{
  const before=await exportData();await setMeta('beforeRestore',before);
  await db.meta.delete('quoteRecords');await db.meta.delete('quoteSyncStatus');await setMeta('ledgerRevision',crypto.randomUUID());
  await db.accounts.clear();await db.positions.clear();await db.snapshots.clear();await db.reports.clear();await db.statements.clear();await db.statementBatches.clear();
  await db.accounts.bulkPut(b.accounts);await db.positions.bulkPut(b.positions);await db.snapshots.bulkPut(b.snapshots);await db.reports.bulkPut(b.reports);await db.statements.bulkPut(b.statements);await db.statementBatches.bulkPut(b.statementBatches);await setMeta('profile',b.profile);
});}
export async function undoRestore(){const previous=await getMeta<Bundle|null>('beforeRestore',null);if(!previous)throw new Error('没有可撤销的恢复记录');await restoreData(previous);}
