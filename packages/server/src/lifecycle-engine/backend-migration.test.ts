import { describe, expect, test } from 'bun:test'
import { assertBackendMigrationCutover, assertBackendMigrationVerification, planBackendMigration } from './backend-migration'

const request = {
  migrationId: 'adb-to-neon-2026-09',
  source: { id: 'adb', databaseId: 'adb-prod', dialect: 'oracle' as const, mode: 'shared' as const },
  target: { id: 'neon', databaseId: 'neon-prod', dialect: 'postgres' as const, mode: 'shared' as const },
  scope: { kind: 'all-tenants' as const },
  pluginIds: ['construction-core', 'task-graph'],
  requestedAt: '2026-09-23T00:00:00.000Z',
  reason: 'Move the whole fleet after ADB capacity review',
}

describe('backend migration plans', () => {
  test('creates a deterministic non-destructive fleet migration plan', () => {
    const plan = planBackendMigration(request)
    expect(plan).toMatchObject({ format: 1, requiresQuiesce: true, retainSourceData: true, destructiveOperations: false })
    expect(plan.phases).toEqual(['prepare', 'copy', 'verify', 'cutover', 'retain-source'])
    expect(plan.id).toBe(planBackendMigration(structuredClone(request)).id)
  })

  test('requires a different physical target and rejects invalid scopes', () => {
    expect(() => planBackendMigration({ ...request, target: { ...request.source, id: 'other' } })).toThrow('different physical database')
    expect(() => planBackendMigration({ ...request, scope: { kind: 'tenants', tenantIds: [] } })).toThrow('tenant scope')
  })

  test('only permits cutover after matched source and target revisions', () => {
    const plan = planBackendMigration(request)
    const report = assertBackendMigrationVerification(plan, { migrationId: request.migrationId, sourceBackendId: 'adb', targetBackendId: 'neon', checkedAt: '2026-09-23T00:00:00.000Z', passed: true, records: [{ tenantId: 'tenant-a', pluginId: 'construction-core', sourceRevision: 3, targetRevision: 3, matched: true }] })
    expect(assertBackendMigrationCutover(plan, report, { migrationId: request.migrationId, targetBackendId: 'neon', routingRevision: 4, cutoverAt: '2026-09-23T00:01:00.000Z', sourceRetained: true }).sourceRetained).toBe(true)
    expect(() => assertBackendMigrationVerification(plan, { ...report, passed: false })).toThrow('incomplete')
  })
})
