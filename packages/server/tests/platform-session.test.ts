import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import { createPlatformSessionResolver as createSessionResolver } from '../src/browser-auth/platform-session'
import { emptyLifecycleState } from '@alneas/eaos-server/lifecycle-engine'
const backend = { id: 'shared', databaseId: 'test-db', dialect: 'oracle' as const, mode: 'shared' as const }
function app(options: { identity?: string; memberships?: any[]; placed?: string; active?: boolean } = {}) {
  const state = emptyLifecycleState()
  state.platform.tenants.tkc = { id: 'tkc', name: 'TKC', active: options.active ?? true, domains: ['app.example.com'], createdAt: '', updatedAt: '' }
  state.platform.placements.tkc = { tenantId: 'tkc', backendId: options.placed ?? 'shared', routingRevision: 1, changedAt: '' }
  let calls = 0
  const resolver = createSessionResolver({ verify: async () => { calls++; return options.identity ? { userId: options.identity, identity: {} } : null }, memberships: async (user, tenant) => (options.memberships ?? []).filter(x => x.identityId === user && (!tenant || x.tenantId === tenant)), store: { read: async () => state, withLock: async () => { throw new Error('Read only') } }, targetFor: () => backend })
  const router = new Hono()
  router.onError((_e,c) => c.json({error:'unavailable'},503))
  router.get('/',async c=> { const first=await resolver(c); await resolver(c); return c.json(first ?? {error:'unauthorized'},first?200:401) })
  return {router,calls:()=>calls}
}
const member = { identityId: 'verified-user', tenantId: 'tkc', roles: ['member'], enabledModules: ['crm'] }
test('tenant header does not authenticate or create membership',async()=>{
  const {router}=app({memberships:[member]}); expect((await router.request('/',{headers:{'X-Tenant-Id':'tkc'}})).status).toBe(401)
  const second=app({identity:'other-user',memberships:[member]}); expect((await second.router.request('/',{headers:{'X-Tenant-Id':'tkc'}})).status).toBe(401)
})
test('verified identity resolves only an active membership and caches verification per request',async()=>{
  const a=app({identity:'verified-user',memberships:[member]});const r=await a.router.request('/',{headers:{'X-Tenant-Id':'tkc'}});expect(r.status).toBe(200);expect(a.calls()).toBe(1)
  const s=await r.json();expect(s.userId).toBe('verified-user');expect(s.enabledModules).toEqual(['crm'])
  expect((await app({identity:'verified-user',memberships:[member],active:false}).router.request('/')).status).toBe(401)
})
test('ambiguous memberships and backend mismatches fail closed',async()=>{
  expect((await app({identity:'verified-user',memberships:[member,{...member,tenantId:'other'}]}).router.request('/')).status).toBe(401)
  expect((await app({identity:'verified-user',memberships:[member],placed:'other'}).router.request('/')).status).toBe(503)
})
