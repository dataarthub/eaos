import {test,expect} from 'bun:test'
import {Database} from 'bun:sqlite'
import {LocalFirstSqliteAdapter,type SqliteDriver} from '../../src/db-package/db/local-first-sqlite-adapter'
import type {DataAccessAdapter} from '@alneas/appkit-core/data/types'
function fixture(options:{rejectSql?:(sql:string)=>boolean;upstream?:Partial<DataAccessAdapter>;syncIntervalMs?:number;enableLifecycleSync?:boolean;onSyncError?:(event:any)=>void}={}){
 const db=new Database(':memory:'),calls:string[]=[]
 const sqlite:SqliteDriver={execute:async(sql,params=[])=>{calls.push(sql);if(options.rejectSql?.(sql))throw Error('Injected driver failure');db.run(sql,params)},select:async(sql,params=[])=>db.query(sql).all(...params) as any}
 const adapter=new LocalFirstSqliteAdapter({sqlite,upstream:{find:async()=>[],create:async()=>({}),update:async()=>({}),delete:async()=>({}),...options.upstream} as DataAccessAdapter,tenantId:'fixture',syncIntervalMs:options.syncIntervalMs??0,enableLifecycleSync:options.enableLifecycleSync??false,autoSyncOnMutation:false,onSyncError:options.onSyncError})
 return{db,calls,adapter,close:()=>{adapter.destroy();db.close()}}
}
test('real SQLite CRUD creates metadata, restores rejected update/delete and preserves offline work',async()=>{
 let mode:'success'|'offline'|'reject'='success';const failures:any[]=[],upstreamCalls:any[]=[]
 const send=async(...args:any[])=>{upstreamCalls.push(args);if(mode==='offline')throw Object.assign(Error('offline'),{code:'ECONNREFUSED'});if(mode==='reject')throw Error('permission revoked');return{} as any}
 const f=fixture({upstream:{create:send,update:send,delete:send},onSyncError:event=>failures.push(event)})
 try{
  await f.adapter.initSchema();f.db.exec('CREATE TABLE notes(id TEXT PRIMARY KEY,tenant_id TEXT,name TEXT,value INTEGER)')
  await f.adapter.create('notes',{id:'a',name:'first',value:1});expect((await f.adapter.findOne<any>('notes','a'))!.tenant_id).toBe('fixture')
  await f.adapter.processOutbox();expect(f.db.query('SELECT * FROM _outbox_queue').all()).toHaveLength(0)
  await f.adapter.update('notes','a',{name:'changed'});mode='offline';await f.adapter.processOutbox()
  expect((await f.adapter.findOne<any>('notes','a'))!.name).toBe('changed');expect(f.db.query('SELECT status,retry_count FROM _outbox_queue').get()).toEqual({status:'pending',retry_count:1})
  mode='reject';await f.adapter.processOutbox();expect((await f.adapter.findOne<any>('notes','a'))!.name).toBe('first')
  mode='success';await f.adapter.delete('notes','a');expect(await f.adapter.findOne('notes','a')).toBeNull();mode='reject';await f.adapter.processOutbox();expect((await f.adapter.findOne<any>('notes','a'))!.name).toBe('first')
  expect(upstreamCalls.length).toBe(4);expect(await f.adapter.count('notes')).toBe(1);expect(failures.map(event=>[event.item.operation,event.rolledBack,event.error.message])).toEqual([['UPDATE',true,'permission revoked'],['DELETE',true,'permission revoked']])
 }finally{f.close()}
})
test('sync cursor and remote rows roll back together on write/commit failures and advance on success',async()=>{
 let rows=[{id:'a',tenant_id:'fixture',name:'remote',ORA_ROWSCN:10}],failure=''
 const filters:any[]=[],f=fixture({rejectSql:sql=>!!failure&&sql.startsWith(failure),upstream:{find:async(_table,filter)=>{filters.push(filter);return rows as any}}})
 try{
  await f.adapter.initSchema();f.db.exec('CREATE TABLE notes(id TEXT PRIMARY KEY,tenant_id TEXT,name TEXT,ORA_ROWSCN INTEGER)')
  expect(await f.adapter.pullChanges('notes')).toBe(1)
  rows=[{id:'a',tenant_id:'fixture',name:'new',ORA_ROWSCN:20}];failure='COMMIT'
  await expect(f.adapter.pullChanges('notes')).rejects.toThrow('driver failure');expect(f.db.query('SELECT last_sync_scn FROM _sync_meta').get()).toEqual({last_sync_scn:10});expect((await f.adapter.findOne<any>('notes','a'))!.name).toBe('remote')
  failure='BEGIN';const start=f.calls.length;await expect(f.adapter.pullChanges('notes')).rejects.toThrow('driver failure');expect(f.calls.slice(start).some(s=>s.startsWith('INSERT INTO "notes"'))).toBe(false)
  failure='';expect(await f.adapter.pullChanges('notes')).toBe(1);expect(filters.at(-1)).toEqual({ORA_ROWSCN:{$gt:10}})
  rows=[];expect(await f.adapter.pullChanges('notes')).toBe(0)
 }finally{f.close()}
})
test('SQL filtering binds values, preserves NULL and validates pagination instead of broadening queries',async()=>{
 const f=fixture();try{
  await f.adapter.initSchema();f.db.exec("CREATE TABLE notes(id TEXT PRIMARY KEY, value INTEGER, name TEXT); INSERT INTO notes VALUES ('a',1,NULL),('b',2,'two'),('c',3,'three')")
  expect((await f.adapter.find<any>('notes',{name:null})).map(r=>r.id)).toEqual(['a'])
  expect(await f.adapter.find('notes',{}, {limit:0})).toEqual([])
  expect((await f.adapter.find<any>('notes',{value:{$gte:1}},{sort:{value:-1},skip:1})).map(r=>r.id)).toEqual(['b','a'])
  for(const op of ['$in','$ne','$or'])await expect(f.adapter.find('notes',{value:{[op]:[1]}})).rejects.toThrow('Unsupported')
  for(const options of [{limit:-1},{limit:1.5},{limit:NaN},{skip:-1},{limit:'1; DROP TABLE notes'}])await expect(f.adapter.find('notes',{},options as any)).rejects.toThrow('pagination')
  expect(await f.adapter.count('notes',{}, {limit:1,skip:2})).toBe(3)
  expect(await f.adapter.find('notes',{name:"x' OR 1=1 --"})).toEqual([])
 }finally{f.close()}
})
test('metadata initializes after unsupported PRAGMA and lifecycle listeners stop on destroy',async()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'window'),events=new EventTarget();Object.defineProperty(globalThis,'window',{configurable:true,value:events})
 let pulls=0;const f=fixture({rejectSql:sql=>sql.startsWith('PRAGMA'),enableLifecycleSync:true,syncIntervalMs:10,upstream:{find:async()=>{pulls++;return[]}}})
 try{
  await f.adapter.initSchema();f.db.exec('CREATE TABLE notes(id TEXT PRIMARY KEY)');await f.adapter.recordAccess('notes','read')
  events.dispatchEvent(new Event('focus'));await Bun.sleep(20);expect(pulls).toBeGreaterThan(0)
  f.adapter.destroy();await Bun.sleep(10);const stopped=pulls;events.dispatchEvent(new Event('online'));await Bun.sleep(20);expect(pulls).toBe(stopped)
 }finally{f.close();if(previous)Object.defineProperty(globalThis,'window',previous);else Reflect.deleteProperty(globalThis,'window')}
})
