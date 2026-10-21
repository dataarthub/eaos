import { expect, test } from 'bun:test'
import type { DatabaseAdapter } from '@alneas/eaos-core/db/adapter'
import { TenantDatabaseRouter } from './database-router'
import { resolvePlatformDatabaseTarget, type PlatformRuntimeConfig } from './runtime'
const runtime: PlatformRuntimeConfig = { backend: { id: 'shared', databaseId: 'adb-1', dialect: 'oracle', mode: 'shared' }, databaseTargets: [{ id: 'private', databaseId: 'adb-2', dialect: 'oracle', mode: 'dedicated', tenantId: 'a' }], tenantPlacements: { a: 'private' } }
test('DB router uses the selected pool and never falls back on missing or failed dedicated DB', async () => {
  const calls: string[] = []
  const adapter = (id: string): DatabaseAdapter => ({ type: 'oracle', withConnection: async () => { throw new Error('unscoped') }, withTenantConnection: async (_domain, callback, context) => { calls.push(`${id}:${context.tenantId}`); return callback({ id }) }, ping: async () => true, getStats: () => ({ driver: 'oracle', activeConnections: 0, poolSize: 1 }), close: async () => {} })
  const shared = adapter('shared'), dedicated = adapter('private')
  const router = new TenantDatabaseRouter(tenant => resolvePlatformDatabaseTarget(runtime, tenant), new Map([['adb-1', shared], ['adb-2', dedicated]]))
  await router.withTenantConnection('crm', async () => {}, { tenantId: 'a' })
  await router.withTenantConnection('crm', async () => {}, { tenantId: 'b' })
  expect(calls).toEqual(['private:a', 'shared:b'])
  await expect(router.withConnection('crm', async () => {})).rejects.toThrow('verified tenant')
  const missing = new TenantDatabaseRouter(tenant => resolvePlatformDatabaseTarget(runtime, tenant), new Map([['adb-1', shared]]))
  await expect(missing.withTenantConnection('crm', async () => {}, { tenantId: 'a' })).rejects.toThrow('fallback')
  expect(calls).toHaveLength(2)
  dedicated.withTenantConnection = async () => { throw new Error('dedicated unavailable') }
  await expect(router.withTenantConnection('crm', async () => {}, { tenantId: 'a' })).rejects.toThrow('dedicated unavailable')
  expect(calls).toHaveLength(2)
})
