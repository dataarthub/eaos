import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import type { JsonDocumentContract } from '@alneas/eaos-server/lifecycle-engine'
import { resolveDataContracts } from '@alneas/eaos-server/lifecycle-engine'
import { createSqlRecordStore, createValidatedRecordStore, createAtomicRepository, createSqliteAtomicDriver, createPluginRecordStore, createPluginAtomicRepository, createValidatedAtomicRepository } from './index'

const document: JsonDocumentContract = { id: 'fixture.state', version: '1.0.0', table: 'records', column: 'payload', schema: {type:'object',additionalProperties:false,properties:{tenantId:{type:'string'},count:{type:'integer',minimum:0}},required:['tenantId','count']} }
const p = {tenantId:'tenant-a',userId:'actor',roles:[]}
test('manifest storage rejects missing catalogs and required JSON contracts before executing SQL', () => {
 const catalog = resolveDataContracts([{id:'fixture',version:'1.0.0',description:'Fixture',schema:{type:'object',$defs:{records:{type:'object','x-db':{tableName:'records'},required:['tenant_id','id','revision','payload'],properties:{tenant_id:{type:'string'},id:{type:'string'},revision:{type:'integer'},payload:{type:'string'}}}}},migrations:[],jsonDocuments:[document]}],{fixture:'1.0.0'})
 const manifest = {schema:{ownedTables:[],externalReferences:{},migrationOrder:1,storage:{contractId:'fixture',version:'^1.0.0',table:'records',jsonDocuments:['fixture.state']}}}
 const driver = {dialect:'sqlite' as const,execute:async()=>{throw Error('SQL must not execute')},transaction:async()=>{throw Error('SQL must not execute')}}
 expect(()=>createPluginRecordStore(manifest,driver)).toThrow('trusted schema catalog')
 expect(()=>createPluginAtomicRepository(manifest,driver)).toThrow('trusted schema catalog')
 expect(()=>createPluginRecordStore(manifest,driver,catalog)).not.toThrow()
 expect(()=>createPluginAtomicRepository(manifest,driver,catalog)).not.toThrow()
 manifest.schema.storage.jsonDocuments=['missing.document']
 expect(()=>createPluginRecordStore(manifest,driver,catalog)).toThrow('unavailable')
 expect(()=>createPluginAtomicRepository(manifest,driver,catalog)).toThrow('unavailable')
})
function fixture(immutable = false) {
 const db = new Database(':memory:')
 db.exec('CREATE TABLE records(tenant_id TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(tenant_id,id))')
 const docs = [{...document,immutable}]
 const driver = {dialect:'sqlite' as const,async execute(_tenant:string,sql:string,bindings:unknown[]){const q=db.query(sql);return /^SELECT/.test(sql)?{rows:q.all(...bindings as any[]) as any[]}:{affectedRows:q.run(...bindings as any[]).changes}}}
 return {db,docs,store:createSqlRecordStore<any>('records',driver,{documents:docs}),repository:createAtomicRepository('records',createSqliteAtomicDriver(db),{documents:docs})}
}
test('payload validation rejects unknown fields, coercion, foreign tenant and corrupt reloads; CAS remains effective', async () => {
 const {db,store} = fixture()
 try {
  const value = {tenantId:p.tenantId,count:1}
  for(const bad of [{...value,extra:1},{...value,count:'1'},{...value,count:NaN},{...value,tenantId:'other'}]) await expect(store.create(p.tenantId,{id:'r',revision:1,value:bad})).rejects.toThrow()
  await expect(store.create(p.tenantId,{id:'r',revision:2,value})).rejects.toThrow()
  await store.create(p.tenantId,{id:'r',revision:1,value})
  expect(await store.read('other','r')).toBeNull()
  expect(await store.replace(p.tenantId,{id:'r',revision:2,value:{...value,count:2}},1)).toBe(true)
  expect(await store.replace(p.tenantId,{id:'r',revision:2,value},1)).toBe(false)
  db.query('UPDATE records SET payload=?').run(JSON.stringify({...value,count:'bad'}))
  await expect(store.read(p.tenantId,'r')).rejects.toThrow('JSON contract')
  await expect(store.list(p.tenantId,10)).rejects.toThrow('JSON contract')
 } finally {db.close()}
})
test('transaction writes, batch preflight and read validation use the same contract and roll back', async () => {
 const {db,repository} = fixture()
 try {
  await expect(repository.run(p,async tx=>{await tx.put('good',{tenantId:p.tenantId,count:1},0);await tx.put('bad',{tenantId:p.tenantId,count:'1'},0)})).rejects.toThrow('JSON contract')
  expect(await repository.run(p,tx=>tx.get('good'))).toBeNull()
  await expect(repository.run(p,tx=>tx.putMany([{id:'a',value:{tenantId:p.tenantId,count:1},expected:0},{id:'b',value:{tenantId:p.tenantId,count:1,extra:true},expected:0}]))).rejects.toThrow()
  expect(db.query('SELECT COUNT(*) AS n FROM records').get()).toEqual({n:0})
  db.query('INSERT INTO records VALUES(?,?,1,?)').run(p.tenantId,'corrupt','{"tenantId":"tenant-a","count":"1"}')
  await expect(repository.run(p,tx=>tx.get('corrupt'))).rejects.toThrow()
  await expect(repository.run(p,tx=>tx.getMany(['corrupt']))).rejects.toThrow()
 } finally {db.close()}
})
test('append-only documents prohibit replace/delete and capture an immutable schema snapshot', async () => {
 const {db,docs,store,repository} = fixture(true)
 try {
  const value={tenantId:p.tenantId,count:1}
  docs[0].immutable=false
  await store.create(p.tenantId,{id:'event',revision:1,value})
  await expect(store.replace(p.tenantId,{id:'event',revision:2,value},1)).rejects.toThrow('Immutable')
  await expect(store.delete!(p.tenantId,'event',1)).rejects.toThrow('Immutable')
  await expect(repository.run(p,tx=>tx.put('event',value,1))).rejects.toThrow('Immutable')
  const wrapped=createValidatedRecordStore(store,[{...document,immutable:true}])
  await expect(wrapped.delete!(p.tenantId,'event')).rejects.toThrow('Immutable')
 } finally {db.close()}
})


test('host repository wrapper validates batches before writing, rolls back and expires its session', async () => {
 const {db,repository}=fixture()
 try {
  const wrapped=createValidatedAtomicRepository(repository,[document])
  let expired:import('./atomic').AtomicSession|undefined
  await expect(wrapped.run(p,async tx=>{expired=tx;await tx.put('good',{tenantId:p.tenantId,count:1},0);await tx.putMany!([{id:'bad',expected:0,value:{tenantId:p.tenantId,count:'1'}}])})).rejects.toThrow('JSON contract')
  expect(db.query('SELECT COUNT(*) AS n FROM records').get()).toEqual({n:0})
  await expect(expired!.get('good')).rejects.toThrow('expired')
  await wrapped.run(p,tx=>tx.put('good',{tenantId:p.tenantId,count:1},0))
  const rows=await wrapped.run(p,tx=>tx.getMany!(['good','absent']))
  expect(rows.map(row=>row?.id??null)).toEqual(['good',null])
 }finally{db.close()}
})
