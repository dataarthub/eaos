import { describe, expect, test } from 'bun:test'
import { FRAMEWORK_VERSION, emptyLifecycleState, planBackendMigration, type LifecycleState, type LifecycleStore, type LifecycleWriter } from '@alneas/eaos-server/lifecycle-engine'
import { LifecyclePlatformControlStore } from './store'

const source = { id: 'shared', databaseId: 'db-shared', dialect: 'sqlite' as const, mode: 'shared' as const, provider: 'sqlite-host' }
const target = { id: 'alpha-dedicated', databaseId: 'db-alpha', dialect: 'sqlite' as const, mode: 'dedicated' as const, tenantId: 'alpha', provider: 'sqlite-host' }
const release = { id: 'orders', version: '1.0.0', framework: '^' + FRAMEWORK_VERSION, migrations: [] }

function fixture() {
  let state = emptyLifecycleState()
  state.backends = { shared: source, 'alpha-dedicated': target }
  state.installations[JSON.stringify(['shared', 'orders'])] = { release, digest: 'orders-digest', status: 'installed' }
  state.installations[JSON.stringify(['alpha-dedicated', 'orders'])] = { release, digest: 'orders-digest', status: 'installed' }
  state.activations[JSON.stringify(['shared', 'alpha', 'orders'])] = { backendId: 'shared', tenantId: 'alpha', pluginId: 'orders', digest: 'orders-digest', enabled: true }
  state.platform.placements.alpha = { tenantId: 'alpha', backendId: 'shared', routingRevision: 4, changedAt: '2026-09-23T00:00:00.000Z' }
  const lifecycle: LifecycleStore = {
    read: async () => structuredClone(state),
    withLock: async <T>(fn: (writer: LifecycleWriter) => Promise<T>) => fn({ read: async () => structuredClone(state), write: async next => { state = structuredClone(next) } }),
  }
  return { lifecycle, getState: () => state }
}

describe('lifecycle-backed platform control store', () => {
  test('commits placement and activation routing in one lifecycle snapshot', async () => {
    const fixtureState = fixture()
    const store = new LifecyclePlatformControlStore(fixtureState.lifecycle, () => new Date('2026-09-23T00:01:00.000Z'))
    await store.createTenant({ id: 'beta', name: 'Beta', domains: ['beta.example.test'], backendId: 'shared' })
    await expect(store.getTenantPlacement('beta')).resolves.toMatchObject({ tenantId: 'beta', backend: { id: 'shared' }, routingRevision: 1 })
    const plan = planBackendMigration({ migrationId: 'move-alpha', source, target, scope: { kind: 'tenants', tenantIds: ['alpha'] }, pluginIds: ['orders'], requestedAt: '2026-09-23T00:00:00.000Z', reason: 'Dedicated workload' })
    await store.saveMigrationPlan(plan)
    const cutover = { migrationId: 'move-alpha', targetBackendId: target.id, routingRevision: 5, cutoverAt: '2026-09-23T00:02:00.000Z', sourceRetained: true as const }
    await store.beginMigrationExecution({ tenantId: 'alpha', migrationId: plan.id, executionId: 'exec-alpha' })
    await store.recordMigrationVerification({ tenantId: 'alpha', plan, executionId: 'exec-alpha', verification: { migrationId: 'move-alpha', sourceBackendId: source.id, targetBackendId: target.id, checkedAt: '2026-09-23T00:01:00.000Z', records: [{ tenantId: 'alpha', pluginId: 'orders', sourceRevision: 1, targetRevision: 1, matched: true }], passed: true }, cutover })
    const placement = await store.recordTenantPlacement({ tenantId: 'alpha', plan, cutover })
    expect(placement.backend.id).toBe('alpha-dedicated')
    expect(fixtureState.getState().platform.placements.alpha.backendId).toBe('alpha-dedicated')
    expect(fixtureState.getState().activations['["shared","alpha","orders"]'].enabled).toBe(false)
    expect(fixtureState.getState().activations['["alpha-dedicated","alpha","orders"]']).toMatchObject({ backendId: 'alpha-dedicated', enabled: true })
    await expect(store.getMigrationStatus(plan.id)).resolves.toMatchObject({ status: 'cutover' })
    await expect(store.recordTenantPlacement({ tenantId: 'alpha', plan, cutover: { ...cutover, routingRevision: 6, cutoverAt: '2026-09-23T00:03:00.000Z' } })).resolves.toMatchObject({ backend: { id: 'alpha-dedicated' } })
  })

  test('normalizes legacy state and rejects stale placement commits', async () => {
    const fixtureState = fixture()
    const state = fixtureState.getState() as LifecycleState & { platform?: LifecycleState['platform'] }
    delete state.platform
    const store = new LifecyclePlatformControlStore(fixtureState.lifecycle)
    const plan = planBackendMigration({ migrationId: 'stale-alpha', source, target, scope: { kind: 'tenants', tenantIds: ['alpha'] }, pluginIds: ['orders'], requestedAt: '2026-09-23T00:00:00.000Z', reason: 'Dedicated workload' })
    await store.saveMigrationPlan(plan)
    const cutover = { migrationId: 'stale-alpha', targetBackendId: target.id, routingRevision: 5, cutoverAt: '2026-09-23T00:02:00.000Z', sourceRetained: true as const }
    await store.beginMigrationExecution({ tenantId: 'alpha', migrationId: plan.id, executionId: 'exec-stale' })
    await store.recordMigrationVerification({ tenantId: 'alpha', plan, executionId: 'exec-stale', verification: { migrationId: 'stale-alpha', sourceBackendId: source.id, targetBackendId: target.id, checkedAt: '2026-09-23T00:01:00.000Z', records: [{ tenantId: 'alpha', pluginId: 'orders', sourceRevision: 1, targetRevision: 1, matched: true }], passed: true }, cutover })
    fixtureState.getState().backends.shared.databaseId = 'db-changed'
    await expect(store.recordTenantPlacement({ tenantId: 'alpha', plan, cutover })).rejects.toThrow('stale')
  })

  test('persists failure recovery and makes rollback an explicit reverse migration', async () => {
    const fixtureState = fixture()
    const store = new LifecyclePlatformControlStore(fixtureState.lifecycle, () => new Date('2026-09-23T00:04:00.000Z'))
    const plan = planBackendMigration({ migrationId: 'move-alpha', source, target, scope: { kind: 'tenants', tenantIds: ['alpha'] }, pluginIds: ['orders'], requestedAt: '2026-09-23T00:00:00.000Z', reason: 'Dedicated workload' })
    const cutover = { migrationId: 'move-alpha', targetBackendId: target.id, routingRevision: 5, cutoverAt: '2026-09-23T00:02:00.000Z', sourceRetained: true as const }
    const verification = { migrationId: 'move-alpha', sourceBackendId: source.id, targetBackendId: target.id, checkedAt: '2026-09-23T00:01:00.000Z', records: [{ tenantId: 'alpha', pluginId: 'orders', sourceRevision: 1, targetRevision: 1, matched: true }], passed: true as const }
    await store.saveMigrationPlan(plan)
    await store.beginMigrationExecution({ tenantId: 'alpha', migrationId: plan.id, executionId: 'exec-alpha-1' })
    await expect(store.beginMigrationExecution({ tenantId: 'alpha', migrationId: plan.id, executionId: 'exec-alpha-2' })).rejects.toThrow('already in progress')
    await store.markMigrationFailure({ migrationId: plan.id, executionId: 'exec-alpha-1', status: 'reconciling', message: 'copy receipt requires inspection' })
    await expect(store.getMigrationStatus(plan.id)).resolves.toMatchObject({ status: 'reconciling', error: { message: 'copy receipt requires inspection' } })
    await store.reconcileMigration({ migrationId: plan.id, action: 'retry', note: 'operator verified the source receipt' })
    await expect(store.getMigrationStatus(plan.id)).resolves.toMatchObject({ status: 'planned' })
    await store.beginMigrationExecution({ tenantId: 'alpha', migrationId: plan.id, executionId: 'exec-alpha-3' })
    await store.recordMigrationVerification({ tenantId: 'alpha', plan, executionId: 'exec-alpha-3', verification, cutover })
    await store.recordTenantPlacement({ tenantId: 'alpha', plan, cutover })
    const rollback = await store.createRollbackPlan({ tenantId: 'alpha', migrationId: plan.id, reason: 'Rollback acceptance rehearsal', requestedAt: '2026-09-23T00:05:00.000Z' })
    expect(rollback.request.source.id).toBe(target.id)
    expect(rollback.request.target.id).toBe(source.id)
    await store.beginMigrationExecution({ tenantId: 'alpha', migrationId: rollback.id, executionId: 'exec-rollback-1' })
    const rollbackCutover = { migrationId: rollback.request.migrationId, targetBackendId: source.id, routingRevision: 6, cutoverAt: '2026-09-23T00:06:00.000Z', sourceRetained: true as const }
    const rollbackVerification = { migrationId: rollback.request.migrationId, sourceBackendId: target.id, targetBackendId: source.id, checkedAt: '2026-09-23T00:05:30.000Z', records: [{ tenantId: 'alpha', pluginId: 'orders', sourceRevision: 5, targetRevision: 5, matched: true }], passed: true as const }
    await store.recordMigrationVerification({ tenantId: 'alpha', plan: rollback, executionId: 'exec-rollback-1', verification: rollbackVerification, cutover: rollbackCutover })
    await store.recordTenantPlacement({ tenantId: 'alpha', plan: rollback, cutover: rollbackCutover })
    await expect(store.getMigrationStatus(plan.id)).resolves.toMatchObject({ status: 'rolled-back', rollbackPlanId: rollback.id })
    await expect(store.getMigrationStatus(rollback.id)).resolves.toMatchObject({ status: 'cutover', rollbackOf: plan.id })
    await expect(store.markMigrationFailure({ migrationId: rollback.id, status: 'reconciling', message: 'late error' })).rejects.toThrow('Completed migration')
  })
})
