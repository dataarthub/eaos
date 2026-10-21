import { test, expect } from 'bun:test'
import { createTenantModuleStore, createWorkspaceSession, type TenantContext, type WorkspaceClient } from '../src/index'
test('context starts closed, drops previous tenant while loading, and ignores stale replies', async () => {
 const pending: ((v: TenantContext | null) => void)[] = []
 const store = createTenantModuleStore(() => new Promise<TenantContext | null>(r => pending.push(r)))
 expect(store.getSnapshot().context).toBeNull()
 const a = store.refresh(), b = store.refresh()
 pending[1]({ tenantId: 'beta', userId: 'b', enabledModules: ['notes'] }); await b
 pending[0]({ tenantId: 'alpha', userId: 'a', enabledModules: ['all'] }); await a
 expect(store.getSnapshot().context?.tenantId).toBe('beta')
 const c = store.refresh(); expect(store.getSnapshot().context).toBeNull()
 store.clear(); pending[2]({ tenantId: 'alpha', userId: 'a', enabledModules: ['all'] }); await c
 expect(store.getSnapshot().context).toBeNull()
})
test('failed and unauthenticated context cannot grant modules', async () => {
 const store = createTenantModuleStore(async () => ({ tenantId: 'default', userId: null, enabledModules: ['all'] }))
 await store.refresh(); expect(store.getSnapshot().error).toBeInstanceOf(Error); expect(store.getSnapshot().context).toBeNull()
 const failed = createTenantModuleStore(async () => { throw new Error('offline') }); await failed.refresh(); expect(failed.getSnapshot().context).toBeNull()
})

test('workspace session rejects stale and foreign snapshots and closes cleanly', async () => {
 const pending: Array<(snapshot: { tenantId: string; recordId: string; revision: number; data: { tenantId: string } }) => void> = []
 const source: WorkspaceClient<{ tenantId: string }> = {
  load: () => new Promise(resolve => pending.push(resolve)),
  execute: async () => ({ tenantId: 'tenant-a', recordId: 'record-1', revision: 1, data: { tenantId: 'tenant-a' } }),
 }
 const session = createWorkspaceSession('tenant-a', 'record-1', source)
 const first = session.client.load()
 const second = session.client.load()
 pending[1]({ tenantId: 'tenant-a', recordId: 'record-1', revision: 2, data: { tenantId: 'tenant-a' } })
 await expect(second).resolves.toMatchObject({ revision: 2 })
 pending[0]({ tenantId: 'tenant-a', recordId: 'record-1', revision: 1, data: { tenantId: 'tenant-a' } })
 await expect(first).rejects.toThrow('Stale response')
 const foreign: WorkspaceClient<{ tenantId: string }> = { load: async () => ({ tenantId: 'other', recordId: 'record-1', revision: 1, data: { tenantId: 'other' } }), execute: source.execute }
 await expect(createWorkspaceSession('tenant-a', 'record-1', foreign).client.load()).rejects.toThrow('Foreign response')
 session.close()
 await expect(session.client.execute('noop', {})).rejects.toThrow('Session expired')
})
test('independent operation/resource replies coexist while same-resource refreshes and a closed context remain stale',async()=>{
 const pending:Array<(value:any)=>void>=[],source:WorkspaceClient<unknown>={load:async()=>({tenantId:'a',recordId:'plugin',revision:1,data:{}}),execute:()=>new Promise(resolve=>pending.push(resolve))},session=createWorkspaceSession('a','plugin',source,{responseScope:'operation-resource'}),reply=(n:number)=>pending[n]({tenantId:'a',recordId:'plugin',revision:1,data:{tenantId:'a',index:n}})
 const photo=session.client.execute('photos',{id:'one'}),vendors=session.client.execute('vendors',{}),other=session.client.execute('photos',{id:'two'});reply(1);reply(2);reply(0);await expect(vendors).resolves.toMatchObject({data:{index:1}});await expect(other).resolves.toMatchObject({data:{index:2}});await expect(photo).resolves.toMatchObject({data:{index:0}})
 const old=session.client.execute('photos',{id:'one'}),fresh=session.client.execute('photos',{id:'one'});reply(4);await fresh;reply(3);await expect(old).rejects.toThrow('Stale response')
 const closed=session.client.execute('vendors',{});session.close();reply(5);await expect(closed).rejects.toThrow('Stale response')
})
