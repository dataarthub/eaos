import { Database } from 'bun:sqlite'
import { test,expect } from 'bun:test'
import { createAtomicRepository,createSqliteAtomicDriver,atomicCommand,createOracleAtomicDriver } from './atomic'
const p = { tenantId:'t',userId:'u',roles:[] }
test('atomic CAS rolls back a partial command and preserves tenant isolation', async () => {
 const db = new Database(':memory:');db.exec('CREATE TABLE records (tenant_id TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),payload TEXT NOT NULL,PRIMARY KEY(tenant_id,id))')
 const repository = createAtomicRepository('records',createSqliteAtomicDriver(db))
 await repository.run(p,tx => tx.put('a',{ count:1 },0))
 await expect(repository.run(p,async tx => { await tx.put('b',{},0);await tx.put('a',{},0) })).rejects.toThrow()
 expect(await repository.run(p,tx => tx.get('b'))).toBeNull()
 expect(await repository.run({ ...p,tenantId:'other' },tx => tx.get('a'))).toBeNull()
 const attempts = await Promise.allSettled([1,2].map(n => repository.run(p,tx => tx.put('a',{ n },1))))
 expect(attempts.filter(r => r.status === 'fulfilled')).toHaveLength(1)
 const input = { commandId:'c' }, execute = () => repository.run(p,tx => atomicCommand(tx,p,'create',input,async () => { await tx.put('once',{},0);return 'receipt' }))
 expect(await execute()).toBe('receipt');expect(await execute()).toBe('receipt')
 await expect(repository.run(p,tx => atomicCommand(tx,p,'create',{ ...input,extra:1 } as any,async () => 'wrong'))).rejects.toThrow('reused')
 db.close()
})
test('Oracle host driver commits and binds large payloads as CLOB, rolls back failures', async () => {
 const calls:any[]=[]
 const connection = { execute:async (...args:any[]) => { calls.push(args);return { rowsAffected:1 } },commit:async () => { calls.push('commit') },rollback:async () => { calls.push('rollback') } }
 const driver = createOracleAtomicDriver({ withTenantConnection:async (_d,fn,context) => { expect(context).toEqual({ tenantId:'t',userId:'u' });return fn(connection) } },{ objectFormat:4002,stringType:'STRING',clobType:'CLOB' })
 await driver.transaction(p,c => c.execute('INSERT INTO t VALUES(:1)',['x'.repeat(5000)]))
 expect(calls[0][1][0].type).toBe('CLOB');expect(calls[1]).toBe('commit')
 await expect(driver.transaction(p,async () => { throw new Error('failed') })).rejects.toThrow('failed')
 expect(calls.at(-1)).toBe('rollback')
})
test('Oracle batch writes request row counts without autocommit and reject missing counts or CAS conflicts', async () => {
 const calls:any[]=[], scalar:any[]=[]
 let counts:number[]|undefined=[1,1]
 const connection={execute:async(...args:any[])=>{scalar.push(args);return {rowsAffected:1}},executeMany:async(...args:any[])=>{calls.push(args);return {dmlRowCounts:counts}},commit:async()=>{calls.push('commit')},rollback:async()=>{calls.push('rollback')}}
 const driver=createOracleAtomicDriver({withTenantConnection:async(_domain,fn)=>fn(connection)},{objectFormat:4002,stringType:'STRING',clobType:'CLOB'})
 const repository=createAtomicRepository('records',driver)
 const changes=[{id:'a',expected:0,value:{count:1}},{id:'b',expected:0,value:{count:2}}]
 expect(await repository.run(p,tx=>tx.putMany(changes))).toHaveLength(2)
 expect(calls[0][2]).toEqual({autoCommit:false,dmlRowCounts:true})
 expect(calls.at(-1)).toBe('commit')
 counts=[1,0]
 await expect(repository.run(p,tx=>tx.putMany(changes))).rejects.toThrow('Record revision changed')
 expect(calls.at(-1)).toBe('rollback')
 counts=undefined
 await expect(repository.run(p,tx=>tx.putMany(changes))).rejects.toThrow('row counts')
 expect(calls.at(-1)).toBe('rollback')
 const batches=calls.filter(Array.isArray).length
 await repository.run(p,tx=>tx.putMany([{id:'large',expected:0,value:{body:'x'.repeat(5000)}}]))
 expect(calls.filter(Array.isArray)).toHaveLength(batches)
 expect(scalar[0][1].at(-1).type).toBe('CLOB')
 expect(calls.at(-1)).toBe('commit')
})
