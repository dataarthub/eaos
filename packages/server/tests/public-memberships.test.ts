import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import { emptyLifecycleState } from '@alneas/eaos-server/lifecycle-engine'
import { createKratosSessionVerifier, createPlatformSessionResolver, publicAccountMemberships } from '../src/browser-auth/index'

const member = { tenantId: 'a', role: 'member', active: true }
test('only public, administrator-managed tenant memberships grant access', () => {
  const identity = { state: 'active', metadata_public: { eaos_memberships: [member] } }
  expect(publicAccountMemberships(identity).memberships).toEqual([member])
  expect(publicAccountMemberships({ state: 'active', traits: { eaos_memberships: [member] }, metadata_admin: { eaos_memberships: [member] } }).memberships).toEqual([])
  for (const metadata of [[], 'member', { eaos_memberships: [{ ...member, role: 'super_admin' }] }, { eaos_memberships: [member, member] }]) {
    expect(() => publicAccountMemberships({ state: 'active', metadata_public: metadata })).toThrow()
  }
  expect(() => publicAccountMemberships({ ...identity, state: 'inactive' })).toThrow()
})

test('one whoami supplies membership to all checks in a request; the next request sees revocation', async () => {
  let active = true, sessionActive = true, refresh = false
  const calls: string[] = []
  const backend = { id: 'shared', databaseId: 'db', dialect: 'oracle' as const, mode: 'shared' as const }
  const state = emptyLifecycleState()
  state.platform.tenants.a = { id: 'a', name: 'A', active: true, domains: [], createdAt: '', updatedAt: '' }
  state.platform.placements.a = { tenantId: 'a', backendId: 'shared', routingRevision: 1, changedAt: '' }
  const verify = createKratosSessionVerifier({ publicUrl: 'https://kratos.test', fetch: (async url => {
    calls.push(String(url))
    return Response.json({ active: sessionActive, identity: { id: 'verified', state: 'active', metadata_public: { eaos_memberships: [{ ...member, active }] } } })
  }) as typeof fetch })
  const resolve = createPlatformSessionResolver({ verify, memberships: async (id, tenant, identity) => {
    expect(id).toBe(identity.id)
    return publicAccountMemberships(identity).memberships.filter(m => m.active && (!tenant || m.tenantId === tenant)).map(m => ({ tenantId: m.tenantId, roles: [m.role], enabledModules: [] }))
  }, store: { read: async () => state, withLock: async () => { throw Error('Read only') } }, targetFor: () => backend })
  const app = new Hono()
  app.get('/', async c => {
    const values = await Promise.all([resolve(c), resolve(c), resolve(c)])
    expect(values[1]).toBe(values[0]); expect(values[2]).toBe(values[0])
    if (refresh) { active = false; return c.json(await resolve(c, { refresh: true })) }
    return c.json(values[0], values[0] ? 200 : 401)
  })
  const request = () => app.request('/', { headers: { Cookie: 'session', 'X-Tenant-Id': 'a', 'X-Roles': 'super_admin' } })
  expect((await request()).status).toBe(200)
  expect(calls).toEqual(['https://kratos.test/sessions/whoami'])
  active = false
  expect((await request()).status).toBe(401)
  active = true; sessionActive = false
  expect((await request()).status).toBe(401)
  sessionActive = true; refresh = true
  expect(await (await request()).json()).toBeNull()
  expect(calls).toHaveLength(5)
  expect(calls.every(url => url.endsWith('/sessions/whoami'))).toBe(true)
})
