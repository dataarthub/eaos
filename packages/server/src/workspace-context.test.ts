import { expect, test } from 'bun:test'
import { createWorkspaceContextResolver } from './workspace-context'
const tenant = { tenantName: 'Workspace' }
test('membership cannot grant platform privileges and identities cannot cross tenants', async () => {
  const resolve = createWorkspaceContextResolver({ readTenant: async () => tenant,
    readMembership: async (tid, uid) => tid === 'a' && uid === 'u' ? { role: 'SUPER_ADMIN' } : undefined })
  expect(await resolve({ userId: 'u' }, 'a')).toMatchObject({ role: 'member', isSuperAdmin: false, roles: ['USER', 'member'] })
  await expect(resolve({ userId: 'u' }, 'b')).rejects.toMatchObject({ status: 403 })
  await expect(resolve({ userId: 'v' }, 'a')).rejects.toMatchObject({ status: 403 })
})
test('verified platform administrator can manage active tenants, but cannot invent an active tenant', async () => {
  const resolve = createWorkspaceContextResolver({ readTenant: async tid => tid === 'a' ? tenant : undefined,
    readMembership: async () => undefined })
  expect(await resolve({ userId: 'u', isSuperAdmin: true }, 'a')).toMatchObject({ isSuperAdmin: true, role: 'admin' })
  await expect(resolve({ userId: 'u', isSuperAdmin: true }, 'b')).rejects.toMatchObject({ status: 403 })
})
test('store errors fail closed instead of returning a default membership', async () => {
  const resolve = createWorkspaceContextResolver({ readTenant: async () => { throw Error('offline') }, readMembership: async () => ({ role: 'admin' }) })
  await expect(resolve({ userId: 'u' }, 'a')).rejects.toMatchObject({ status: 503 })
})
