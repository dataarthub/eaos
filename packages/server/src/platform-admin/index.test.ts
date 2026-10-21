import { describe, expect, test } from 'bun:test'
import { createPlatformAdminRouter, type PlatformPlacementExecutor } from './index'
import type { BackendMigrationPlan, BackendMigrationVerificationReport } from '@alneas/eaos-server/lifecycle-engine'
import type { LifecyclePlatformMigrationRecord } from '@alneas/eaos-server/lifecycle-engine'
import type { PlatformAdminPrincipal, PlatformBackendRecord, PlatformControlStore, PlatformTenantCreateInput, PlatformTenantPatch, PlatformTenantRecord, TenantBackendPlacement } from '@alneas/eaos-server/platform'

const source: PlatformBackendRecord = { id: 'shared-adb', databaseId: 'adb-shared', dialect: 'oracle', mode: 'shared', provider: 'oracle-adb' }
const dedicated: PlatformBackendRecord = { id: 'tenant-alpha-adb', databaseId: 'adb-alpha', dialect: 'oracle', mode: 'dedicated', tenantId: 'alpha', provider: 'oracle-adb' }
const wrongDedicated: PlatformBackendRecord = { id: 'tenant-beta-adb', databaseId: 'adb-beta', dialect: 'oracle', mode: 'dedicated', tenantId: 'beta', provider: 'oracle-adb' }
const tenant: PlatformTenantRecord = { id: 'alpha', name: 'Alpha', active: true, domains: ['alpha.example.test'], createdAt: '2026-09-23T00:00:00.000Z', updatedAt: '2026-09-23T00:00:00.000Z' }

function createHarness(principal: PlatformAdminPrincipal | null = { userId: 'root', isPlatformAdmin: true, roles: ['platform_admin'] }) {
  let placement: TenantBackendPlacement = { tenantId: 'alpha', backend: source, routingRevision: 1, changedAt: tenant.updatedAt }
  const plans = new Map<string, BackendMigrationPlan>()
  const records = new Map<string, LifecyclePlatformMigrationRecord>()
  const audit: string[] = []
  const store: PlatformControlStore = {
    listTenants: async () => [tenant],
    createTenant: async (input: PlatformTenantCreateInput) => ({ id: input.id, name: input.name, domains: input.domains, active: true, createdAt: tenant.createdAt, updatedAt: tenant.updatedAt }),
    updateTenant: async (tenantId: string, patch: PlatformTenantPatch) => ({ ...tenant, id: tenantId, ...patch, updatedAt: tenant.updatedAt }),
    registerBackend: async backend => backend,
    listBackends: async () => [source, dedicated, wrongDedicated],
    getBackend: async id => [source, dedicated, wrongDedicated].find(backend => backend.id === id) ?? null,
    getTenantPlacement: async () => placement,
    saveMigrationPlan: async plan => { plans.set(plan.id, plan); records.set(plan.id, { status: 'planned', updatedAt: plan.request.requestedAt }) },
    getMigrationPlan: async id => plans.get(id) ?? null,
    getMigrationStatus: async id => { const record = records.get(id); return record ? structuredClone(record) : null },
    beginMigrationExecution: async ({ migrationId, executionId }) => {
      const record = records.get(migrationId)!; record.status = record.status === 'cutover' ? 'cutover' : 'running'; record.executionId = executionId; return structuredClone(record)
    },
    recordMigrationVerification: async ({ plan, executionId, verification, cutover }) => {
      const record = records.get(plan.id)!; record.status = 'verified'; record.executionId = executionId; record.verification = verification; record.cutover = cutover; return structuredClone(record)
    },
    markMigrationFailure: async ({ migrationId, status, message }) => { const record = records.get(migrationId)!; record.status = status; record.error = { message, occurredAt: tenant.updatedAt }; return structuredClone(record) },
    reconcileMigration: async ({ migrationId, action, note }) => { const record = records.get(migrationId)!; if (action !== 'commit-verified') record.status = action === 'retry' ? 'planned' : action === 'mark-failed' ? 'failed' : 'reconciling'; record.error = { message: note, occurredAt: tenant.updatedAt }; return structuredClone(record) },
    createRollbackPlan: async () => { throw new Error('not used in this route fixture') },
    recordTenantPlacement: async input => {
      placement = { tenantId: input.tenantId, backend: input.plan.request.target, routingRevision: input.cutover.routingRevision, changedAt: input.cutover.cutoverAt }
      records.get(input.plan.id)!.status = 'cutover'
      return placement
    },
  }
  const executor: PlatformPlacementExecutor = {
    execute: async plan => ({
      verification: {
        migrationId: plan.request.migrationId,
        sourceBackendId: plan.request.source.id,
        targetBackendId: plan.request.target.id,
        checkedAt: '2026-09-23T00:01:00.000Z',
        records: [{ tenantId: 'alpha', pluginId: 'orders', sourceRevision: 1, targetRevision: 1, matched: true }],
        passed: true,
      } satisfies BackendMigrationVerificationReport,
      cutover: { migrationId: plan.request.migrationId, targetBackendId: plan.request.target.id, routingRevision: 2, cutoverAt: '2026-09-23T00:02:00.000Z', sourceRetained: true },
    }),
  }
  const app = createPlatformAdminRouter({
    store,
    placementExecutor: executor,
    resolvePrincipal: async () => principal,
    authorize: async current => current.isPlatformAdmin,
    audit: async event => { audit.push(`${event.action}:${event.outcome}`) },
    now: () => new Date('2026-09-23T00:00:00.000Z'),
  })
  return { app, plans, audit, getPlacement: () => placement }
}

describe('platform admin control plane', () => {
  test('requires a platform administrator for global routes', async () => {
    const { app, audit } = createHarness({ userId: 'member', isPlatformAdmin: false })
    const response = await app.request('/backends')
    expect(response.status).toBe(403)
    expect(audit).toEqual(['backend:list:denied'])
  })

  test('plans and executes selected-tenant migration to a dedicated backend', async () => {
    const { app, plans, getPlacement, audit } = createHarness()
    const planResponse = await app.request('/tenants/alpha/placement/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetBackendId: 'tenant-alpha-adb', pluginIds: ['orders'], reason: 'Isolate Alpha for regulatory workload' }),
    })
    expect(planResponse.status).toBe(201)
    const { plan } = await planResponse.json() as { plan: BackendMigrationPlan }
    expect(plan.request.scope).toEqual({ kind: 'tenants', tenantIds: ['alpha'] })
    expect(plan.request.target.mode).toBe('dedicated')
    expect(plans.has(plan.id)).toBe(true)

    const executeResponse = await app.request('/tenants/alpha/placement/execute', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ migrationId: plan.id, executionId: 'exec-alpha-1' }),
    })
    expect(executeResponse.status).toBe(200)
    expect(getPlacement().backend.id).toBe('tenant-alpha-adb')
    expect(audit).toEqual(['placement:plan:allowed', 'placement:cutover:allowed'])

    const repeatResponse = await app.request('/tenants/alpha/placement/execute', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ migrationId: plan.id, executionId: 'exec-alpha-1' }),
    })
    expect(repeatResponse.status).toBe(200)
    expect(audit).toEqual(['placement:plan:allowed', 'placement:cutover:allowed'])

    const statusResponse = await app.request(`/tenants/alpha/placement/migrations/${plan.id}`)
    expect(statusResponse.status).toBe(200)
    expect((await statusResponse.json() as { migration: { status: string } }).migration.status).toBe('cutover')
  })

  test('rejects a dedicated backend owned by another tenant', async () => {
    const { app } = createHarness()
    const response = await app.request('/tenants/alpha/placement/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetBackendId: 'tenant-beta-adb', pluginIds: ['orders'], reason: 'test' }),
    })
    expect(response.status).toBe(400)
  })
})
