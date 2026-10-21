import Dexie,{type Table} from 'dexie';
import {type Account,type Position,type Profile,type Snapshot,type Report,type Bundle,defaultProfile,bundleSchema,makeBundle,metrics,localDay} from './model';
class AssetDB extends Dexie{
  accounts!:Table<Account,string>; positions!:Table<Position,string>; snapshots!:Table<Snapshot,string>; reports!:Table<Report,string>; meta!:Table<{key:string,value:unknown},string>;
  constructor(){super('zhiheng-local-v1');this.version(1).stores({accounts:'id',positions:'id,accountId',snapshots:'date',reports:'id,createdAt',meta:'key'});}
}
export const db=new AssetDB();
export async function getMeta<T>(key:string,fallback:T):Promise<T>{return (await db.meta.get(key))?.value as T??fallback;}
export async function setMeta(key:string,value:unknown){await db.meta.put({key,value});}
export async function exportData(){return db.transaction('r',[db.accounts,db.positions,db.snapshots,db.reports,db.meta],async()=>makeBundle(await db.accounts.toArray(),await db.positions.toArray(),await getMeta<Profile>('profile',defaultProfile),await db.snapshots.toArray(),await db.reports.toArray()));}
export async function snapshot(){const positions=await db.positions.toArray();const m=metrics(positions,defaultProfile);await db.snapshots.put({date:localDay(),assets:m.assets.toFixed(2),debt:m.debt.toFixed(2),net:m.net.toFixed(2)});}
export async function savePosition(p:Position){await db.transaction('rw',[db.positions,db.accounts,db.snapshots],async()=>{if(!await db.accounts.get(p.accountId))throw new Error('账户已被删除，请重新选择');await db.positions.put(p);await snapshot();});}
export async function removePosition(id:string){await db.transaction('rw',[db.positions,db.snapshots],async()=>{await db.positions.delete(id);await snapshot();});}
export async function removeAccount(id:string){await db.transaction('rw',[db.accounts,db.positions],async()=>{if(await db.positions.where('accountId').equals(id).count())throw new Error('请先移出或删除这个账户内的资产');await db.accounts.delete(id);});}
export async function restoreData(input:unknown){const b=bundleSchema.parse(input);await db.transaction('rw',[db.accounts,db.positions,db.snapshots,db.reports,db.meta],async()=>{
  const before=await exportData();await setMeta('beforeRestore',before);
  await db.accounts.clear();await db.positions.clear();await db.snapshots.clear();await db.reports.clear();
  await db.accounts.bulkPut(b.accounts);await db.positions.bulkPut(b.positions);await db.snapshots.bulkPut(b.snapshots);await db.reports.bulkPut(b.reports);await setMeta('profile',b.profile);
});}
export async function undoRestore(){const previous=await getMeta<Bundle|null>('beforeRestore',null);if(!previous)throw new Error('没有可撤销的恢复记录');await restoreData(previous);}
