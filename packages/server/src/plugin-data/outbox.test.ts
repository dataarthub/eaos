import { describe, expect, test } from 'bun:test'
import { createAtomicOutboxDispatcher, enqueueOutboxEvent, type AtomicRepository, type AtomicRow, type AtomicSession } from './index'
import type { PluginPrincipal } from './index'

function repository(): AtomicRepository {
  const rows = new Map<string, AtomicRow>()
  return {
    async run<T>(_principal: PluginPrincipal, work: (session: AtomicSession) => Promise<T>): Promise<T> {
      const session: AtomicSession = {
        async get<TValue>(id: string) {
          const row = rows.get(id)
          return row ? structuredClone(row) as AtomicRow<TValue> : null
        },
        async list<TValue>(prefix: string, after = '', limit = 100) {
          return [...rows.values()].filter(row => row.id.startsWith(prefix) && row.id > after).sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit).map(row => structuredClone(row) as AtomicRow<TValue>)
        },
        async put<TValue>(id: string, value: TValue, expected: number) {
          const old = rows.get(id)
          if ((expected === 0 && old) || (expected > 0 && (!old || old.revision !== expected))) throw new Error('CAS')
          const next = { id, revision: expected + 1, value: structuredClone(value) }
          rows.set(id, next)
          return structuredClone(next)
        },
      }
      return work(session)
    },
  }
}

describe('atomic outbox adapter', () => {
  test('enqueues with the domain transaction and deduplicates the same input', async () => {
    const repo = repository()
    const principal = { tenantId: 'tenant-a', userId: 'worker-a', roles: [] }
    const input = { tenantId: 'tenant-a', producer: 'estate-properties', topic: 'property.updated', idempotencyKey: 'command-1', payload: { propertyId: 'p1' }, availableAt: '2026-09-18T00:00:00.000Z' }
    const first = await repo.run(principal, tx => enqueueOutboxEvent(tx, input))
    const second = await repo.run(principal, tx => enqueueOutboxEvent(tx, input))
    expect(second).toEqual(first)
    await expect(repo.run(principal, tx => enqueueOutboxEvent(tx, { ...input, payload: { propertyId: 'p2' } }))).rejects.toThrow('idempotency')
  })

  test('drains through the existing AtomicRepository/CAS path', async () => {
    const repo = repository()
    const principal = { tenantId: 'tenant-a', userId: 'worker-a', roles: [] }
    await repo.run(principal, tx => enqueueOutboxEvent(tx, { tenantId: 'tenant-a', producer: 'estate-properties', topic: 'property.updated', idempotencyKey: 'command-2', payload: { propertyId: 'p1' }, availableAt: '2026-09-18T00:00:00.000Z' }))
    const received: string[] = []
    const dispatcher = createAtomicOutboxDispatcher({ repository: repo, principal, handlers: { 'property.updated': async event => { received.push(String((event.payload as { propertyId: string }).propertyId)) } }, now: () => new Date('2026-09-19T00:00:00.000Z') })
    expect(await dispatcher.runOnce()).toMatchObject({ claimed: 1, published: 1 })
    expect(received).toEqual(['p1'])
    expect(await dispatcher.runOnce()).toMatchObject({ claimed: 0 })
  })
})

test('atomic outbox claims later pending events after more than 100 completed rows',async()=>{
 const repo=repository(),principal={tenantId:'tenant-a',userId:'worker',roles:[]},received:string[]=[]
 await repo.run(principal,async tx=>{for(let n=0;n<205;n++){const event=await enqueueOutboxEvent(tx,{tenantId:principal.tenantId,producer:'estate-notifications',topic:'notify',id:'job-'+String(n).padStart(3,'0'),idempotencyKey:'job-'+n,payload:{n},availableAt:'2026-10-01T00:00:00Z'});if(n<204){const row=await tx.get<any>('outbox/'+event.id);await tx.put(row!.id,{...row!.value,status:'published'},row!.revision)}}})
 const dispatcher=createAtomicOutboxDispatcher({repository:repo,principal,handlers:{notify:async e=>{received.push(e.id)}},now:()=>new Date('2026-10-04T00:00:00Z')})
 expect(await dispatcher.runOnce()).toMatchObject({claimed:1,published:1});expect(received).toEqual(['job-204']);expect(await dispatcher.runOnce()).toMatchObject({claimed:0})
})

test('explicit failed-event recovery keeps the immutable delivery ID and denies foreign or running rows',async()=>{
 const {requeueOutboxEvent}=await import('./outbox'),repo=repository(),p={tenantId:'tenant-a',userId:'worker',roles:[]}
 await repo.run(p,async tx=>{const e=await enqueueOutboxEvent(tx,{tenantId:p.tenantId,producer:'notifications',topic:'notify',id:'fixed',idempotencyKey:'fixed',payload:{id:'notice'}}),r=await tx.get<any>('outbox/'+e.id);await tx.put(r!.id,{...r!.value,status:'failed'},r!.revision);await expect(requeueOutboxEvent(tx,'foreign',e.id)).rejects.toMatchObject({status:409});expect(await requeueOutboxEvent(tx,p.tenantId,e.id)).toMatchObject({id:'fixed',status:'pending',payload:{id:'notice'}});await expect(requeueOutboxEvent(tx,p.tenantId,e.id)).rejects.toMatchObject({status:409})})
})


test('restart reclaims stale work with a new CAS token and rejects both late settlements', async () => {
 const { createAtomicOutboxStore } = await import('./outbox')
 const repo = repository(), principal = { tenantId: 'tenant-a', userId: 'worker', roles: [] }
 await repo.run(principal, tx => enqueueOutboxEvent(tx, { tenantId: principal.tenantId, producer: 'fixture', topic: 'notify', idempotencyKey: 'restart', payload: {}, availableAt: '2026-10-01T00:00:00Z' }))
 const old = createAtomicOutboxStore({ repository: repo, principal, staleAfterMs: 1000 }), now = new Date('2026-10-02T00:00:00Z')
 const [first] = await old.claim(now, 1)
 const restarted = createAtomicOutboxStore({ repository: repo, principal, staleAfterMs: 1000 })
 expect(await restarted.claim(new Date(now.getTime() + 999), 1)).toEqual([])
 const [second] = await restarted.claim(new Date(now.getTime() + 1000), 1)
 expect(second.id).toBe(first.id); expect(second.claimToken).not.toBe(first.claimToken); expect(second.attempts).toBe(2)
 if (!first.claimToken || !second.claimToken) throw new Error('Expected claimed token')
 await expect(old.markPublished(first.id, first.claimToken, now)).rejects.toMatchObject({ status: 409 })
 await expect(old.markFailed(first.id, first.claimToken, 'late failure', now)).rejects.toMatchObject({ status: 409 })
 await restarted.markPublished(second.id, second.claimToken, now)
 expect(await restarted.claim(new Date(now.getTime() + 2000), 1)).toEqual([])
})

test('a foreign tenant envelope is rejected before an effect can execute', async () => {
 const repo = repository(), principal = { tenantId: 'tenant-a', userId: 'worker', roles: [] }; let effects = 0
 await repo.run(principal, tx => enqueueOutboxEvent(tx, { tenantId: 'tenant-b', producer: 'fixture', topic: 'notify', idempotencyKey: 'foreign', payload: {}, availableAt: '2026-10-01T00:00:00Z' }))
 const dispatcher = createAtomicOutboxDispatcher({ repository: repo, principal, handlers: { notify: async () => { effects++ } } })
 await expect(dispatcher.runOnce()).rejects.toMatchObject({ status: 409 }); expect(effects).toBe(0)
})
