import { lifecycleDigest, type BackendTarget } from './index'

/**
 * Explicit complete fleet or nonempty concrete tenant selection for a reviewed data move.
 * 
 * @see planBackendMigration for canonical integration usage.
 */
export type BackendMigrationScope =
  | { 
  /**
   * Scope discriminator: all-tenants includes the fleet; tenants names a concrete bounded selection.
   */
  kind: 'all-tenants' }
  | { 
  /**
   * Scope discriminator: all-tenants includes the fleet; tenants names a concrete bounded selection.
   */
  kind: 'tenants'; 
  /**
   * Nonempty distinct concrete tenant IDs; dedicated endpoint tenants must be included.
   */
  tenantIds: readonly string[] }

/**
 * Operator-reviewed source/target database move with bounded scope and reason.
 * 
 * @see planBackendMigration for canonical integration usage.
 */
export interface BackendMigrationRequest {
  /**
   * Nonblank stable migration identity, up to 256 characters.
   */
  migrationId: string
  /**
   * Existing backend whose data remains retained.
   */
  source: BackendTarget
  /**
   * Different backend and physical database identity.
   */
  target: BackendTarget
  /**
   * All tenants or nonempty unique explicit tenant IDs; dedicated endpoints require their tenant in explicit scope.
   */
  scope: BackendMigrationScope
  /**
   * Nonempty unique registered-style feature IDs covered by the move.
   */
  pluginIds: readonly string[]
  /**
   * Parseable request timestamp.
   */
  requestedAt: string
  /**
   * Nonblank reviewed operator reason, at most 1024 characters.
   */
  reason: string
}

/**
 * Deterministic five-phase non-destructive data migration plan.
 * 
 * @see planBackendMigration for canonical integration usage.
 */
export interface BackendMigrationPlan {
  /**
   * Plan discriminator; currently 1.
   */
  format: 1
  /**
   * Canonical digest of the normalized request and phase/safety flags.
   */
  id: string
  /**
   * Cloned request with sorted plugin and explicit tenant IDs.
   */
  request: BackendMigrationRequest
  /**
   * Ordered prepare/copy/verify/cutover/retain-source execution phases.
   */
  phases: readonly ['prepare', 'copy', 'verify', 'cutover', 'retain-source']
  /**
   * Always true; the host must drain affected execution before switching.
   */
  requiresQuiesce: true
  /**
   * Always true; source data must remain available.
   */
  retainSourceData: true
  /**
   * Always false; dropping source data is outside this plan.
   */
  destructiveOperations: false
}

/**
 * Host-reported match for one tenant/plugin copy at observed revisions.
 * 
 * @see planBackendMigration for canonical integration usage.
 */
export interface BackendMigrationVerification {
  /**
   * Concrete verified tenant covered by the plan.
   */
  tenantId: string
  /**
   * Planned feature whose records were compared.
   */
  pluginId: string
  /**
   * Nonnegative safe revision observed at source.
   */
  sourceRevision: number
  /**
   * Nonnegative safe revision observed at target; not required to numerically equal source.
   */
  targetRevision: number
  /**
   * True only when the host comparison passed; validator does not perform the comparison.
   */
  matched: boolean
}

/**
 * Host verification evidence bound to a reviewed source/target migration.
 * 
 * @see planBackendMigration for canonical integration usage.
 */
export interface BackendMigrationVerificationReport {
  /**
   * Plan request migration identity.
   */
  migrationId: string
  /**
   * Exact source backend identity.
   */
  sourceBackendId: string
  /**
   * Exact target backend identity.
   */
  targetBackendId: string
  /**
   * Parseable verification timestamp.
   */
  checkedAt: string
  /**
   * Nonempty matched in-scope record reports; host must establish exhaustive coverage.
   */
  records: readonly BackendMigrationVerification[]
  /**
   * Host declaration that verification passed; must be true for acceptance.
   */
  passed: boolean
}

/**
 * Host-reported routing switch retaining the original database for recovery.
 * 
 * @see planBackendMigration for canonical integration usage.
 */
export interface BackendMigrationCutover {
  /**
   * Plan migration identity.
   */
  migrationId: string
  /**
   * Exact reviewed target backend.
   */
  targetBackendId: string
  /**
   * Nonnegative safe routing revision after cutover.
   */
  routingRevision: number
  /**
   * Parseable routing-switch timestamp.
   */
  cutoverAt: string
  /**
   * Must be true; destructive source cleanup is outside this contract.
   */
  sourceRetained: true
}

/**
 * Host-owned migration phases operating on real adapters and retained source storage.
 * 
 * @see planBackendMigration for canonical integration usage.
 */
export interface BackendMigrationExecutor {
  /**
   * Provision/adopt the reviewed target and establish quiescence without deleting source data.
   * @param plan - Reviewed unmodified backend migration plan; host must preserve quiescence and source data.
   * @returns Resolves without a value after target preparation and required quiescence.
   * @throws Host adapter or callback failures reject the returned Promise; side effects may already be partially complete.
   
   * @example
   * ```typescript
   * import type { BackendMigrationExecutor, BackendMigrationPlan } from '@alneas/eaos-server/lifecycle-engine';
   * export async function prepareReviewed(executor: BackendMigrationExecutor, plan: BackendMigrationPlan) {
   *   // The host approves exact targets and serializes migration writers.
   *   await executor.prepare(plan);
   * }
   * ```
   */
  prepare(plan: BackendMigrationPlan): Promise<void>
  /**
   * Copy the scoped tenant/plugin data into the target and retain source state.
   * @param plan - Reviewed unmodified backend migration plan; host must preserve quiescence and source data.
   * @returns Resolves without a value after the scoped copy completes, with source retained.
   * @throws Host adapter or callback failures reject the returned Promise; side effects may already be partially complete.
   
   * @example
   * ```typescript
   * import type { BackendMigrationExecutor, BackendMigrationPlan } from '@alneas/eaos-server/lifecycle-engine';
   * export async function copyReviewed(executor: BackendMigrationExecutor, plan: BackendMigrationPlan) {
   *   // The host approves exact targets and serializes migration writers.
   *   await executor.copy(plan);
   * }
   * ```
   */
  copy(plan: BackendMigrationPlan): Promise<void>
  /**
   * Produce nonempty exhaustive host match evidence for the plan's scope.
   * @param plan - Reviewed unmodified backend migration plan; host must preserve quiescence and source data.
   * @returns The host verification report; caller must check it against the reviewed plan.
   * @throws Host adapter or callback failures reject the returned Promise; side effects may already be partially complete.
   
   * @example
   * ```typescript
   * import type { BackendMigrationExecutor, BackendMigrationPlan } from '@alneas/eaos-server/lifecycle-engine';
   * export async function verifyReviewed(executor: BackendMigrationExecutor, plan: BackendMigrationPlan) {
   *   // The host approves exact targets and serializes migration writers.
   *   return executor.verify(plan);
   * }
   * ```
   */
  verify(plan: BackendMigrationPlan): Promise<BackendMigrationVerificationReport>
  /**
   * Switch routing only after valid verification, retaining source and returning a cutover receipt.
   * @param plan - Reviewed unmodified backend migration plan; host must preserve quiescence and source data.
   * @param verification - Matching passed host verification report; establish complete copy coverage before cutover.
   * @returns A source-retaining routing cutover receipt after accepted verification.
   * @throws Host adapter or callback failures reject the returned Promise; side effects may already be partially complete.
   
   * @example
   * ```typescript
   * import type { BackendMigrationExecutor, BackendMigrationPlan, BackendMigrationVerificationReport } from '@alneas/eaos-server/lifecycle-engine';
   * export async function cutoverReviewed(executor: BackendMigrationExecutor, plan: BackendMigrationPlan, verification: BackendMigrationVerificationReport) {
   *   // Supply current, successful evidence for this exact reviewed plan.
   *   return executor.cutover(plan, verification);
   * }
   * ```
   */
  cutover(plan: BackendMigrationPlan, verification: BackendMigrationVerificationReport): Promise<BackendMigrationCutover>
}

function text(value: unknown, name: string, max = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid migration ${name}`)
  return value
}

function assertBackend(backend: BackendTarget, name: string): void {
  if (!backend || typeof backend !== 'object') throw new Error(`Invalid migration ${name}`)
  text(backend?.id, `${name} id`)
  text(backend?.databaseId, `${name} databaseId`)
  if (!['sqlite', 'postgres', 'oracle'].includes(backend.dialect) || !['shared', 'dedicated'].includes(backend.mode)) throw new Error(`Invalid migration ${name}`)
  if (backend.mode === 'dedicated' && !backend.tenantId) throw new Error(`Dedicated ${name} requires tenantId`)
  if (backend.mode === 'shared' && backend.tenantId !== undefined) throw new Error(`Shared ${name} cannot pin tenantId`)
}

/**
 * Creates a deterministic source-retaining migration plan without touching either database.
 * 
 * Create a reviewable fleet/tenant data-migration plan without touching either backend.
 * @param request - Reviewed distinct physical source/target backends, concrete tenant scope, nonempty unique plugin IDs, timestamp and reason.
 * @returns A shallow-frozen plan with sorted cloned scopes/plugin IDs and five ordered phases.
 * @throws Error for malformed request, same source/target identity, invalid scope or dedicated-tenant mismatch.
 * 
 * @remarks
 * Dedicated backend tenants must appear in explicit tenant scope. No executor, lock, provisioning, copy or cutover runs during planning; host must implement quiescence.
 * 
 * @example
 * ```typescript
 * import { planBackendMigration } from '@alneas/eaos-server/lifecycle-engine/backend-migration';
 * const plan = planBackendMigration({ migrationId: 'move-1', source: { id: 'old', databaseId: 'db-old', dialect: 'sqlite', mode: 'shared' }, target: { id: 'new', databaseId: 'db-new', dialect: 'postgres', mode: 'shared' }, scope: { kind: 'tenants', tenantIds: ['sample'] }, pluginIds: ['reports'], requestedAt: '2026-01-01T00:00:00Z', reason: 'Reviewed backend move' });
 * ```
 */
export function planBackendMigration(request: BackendMigrationRequest): BackendMigrationPlan {
  text(request?.migrationId, 'migrationId')
  text(request?.reason, 'reason', 1024)
  if (!Number.isFinite(Date.parse(request.requestedAt))) throw new Error('Invalid migration requestedAt')
  assertBackend(request.source, 'source backend')
  assertBackend(request.target, 'target backend')
  if (request.source.id === request.target.id || request.source.databaseId === request.target.databaseId) throw new Error('Backend migration requires a different physical database')
  if (!Array.isArray(request.pluginIds) || request.pluginIds.length === 0 || new Set(request.pluginIds).size !== request.pluginIds.length || request.pluginIds.some(id => !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id))) throw new Error('Invalid migration pluginIds')
  if (!request.scope || typeof request.scope !== 'object' || !['all-tenants', 'tenants'].includes(request.scope.kind)) throw new Error('Invalid migration scope')
  if (request.scope.kind === 'tenants' && (!Array.isArray(request.scope.tenantIds) || request.scope.tenantIds.length === 0 || new Set(request.scope.tenantIds).size !== request.scope.tenantIds.length || request.scope.tenantIds.some(id => !/^\S{1,256}$/.test(id)))) throw new Error('Invalid migration tenant scope')
  const scope = request.scope.kind === 'all-tenants' ? request.scope : { kind: 'tenants' as const, tenantIds: [...request.scope.tenantIds].sort() }
  const scopedTenants = scope.kind === 'tenants' ? scope.tenantIds : null
  if (request.source.mode === 'dedicated' && (!scopedTenants || !scopedTenants.includes(request.source.tenantId!))) throw new Error('Migration scope does not include the dedicated source tenant')
  if (request.target.mode === 'dedicated' && (!scopedTenants || !scopedTenants.includes(request.target.tenantId!))) throw new Error('Migration scope does not include the dedicated target tenant')
  const normalized = structuredClone({ ...request, pluginIds: [...request.pluginIds].sort(), scope })
  const body = { format: 1 as const, request: normalized, phases: ['prepare', 'copy', 'verify', 'cutover', 'retain-source'] as const, requiresQuiesce: true as const, retainSourceData: true as const, destructiveOperations: false as const }
  return Object.freeze({ ...body, id: lifecycleDigest(body) })
}

/**
 * Checks that a reported migration verification matches its plan and contains only matched in-scope records.
 * @param plan - Reviewed backend migration plan.
 * @param report - Host report claiming passed verification for the plan's source and target.
 * @returns The original report when accepted; it is neither cloned nor independently measured.
 * @throws Error for mismatched identities, invalid timestamp/revisions, out-of-scope records or unpassed/unmatched evidence.
 * 
 * @remarks
 * Validates nonempty records and nonnegative revisions, but does not prove exhaustive tenant/plugin coverage or equal source/target revision numbers. The host owns verification completeness and truth.
 * 
 * @example
 * ```typescript
 * import { assertBackendMigrationVerification, type BackendMigrationPlan, type BackendMigrationVerificationReport } from '@alneas/eaos-server/lifecycle-engine/backend-migration';
 * export function inspectVerification(plan: BackendMigrationPlan, report: BackendMigrationVerificationReport) { return assertBackendMigrationVerification(plan, report); }
 * ```
 */
export function assertBackendMigrationVerification(plan: BackendMigrationPlan, report: BackendMigrationVerificationReport): BackendMigrationVerificationReport {
  if (!report || report.migrationId !== plan.request.migrationId || report.sourceBackendId !== plan.request.source.id || report.targetBackendId !== plan.request.target.id || !Number.isFinite(Date.parse(report.checkedAt)) || report.passed !== true || !Array.isArray(report.records) || report.records.length === 0) throw new Error('Backend migration verification is incomplete')
  const tenants = plan.request.scope.kind === 'tenants' ? new Set(plan.request.scope.tenantIds) : null
  for (const record of report.records) {
    if (!record || typeof record.tenantId !== 'string' || (tenants && !tenants.has(record.tenantId)) || !plan.request.pluginIds.includes(record.pluginId) || !Number.isSafeInteger(record.sourceRevision) || record.sourceRevision < 0 || !Number.isSafeInteger(record.targetRevision) || record.targetRevision < 0 || record.matched !== true) throw new Error('Backend migration verification is incomplete')
  }
  return report
}

/**
 * Validates matching verification and a source-retaining cutover receipt for the target backend.
 * @param plan - Reviewed backend migration plan.
 * @param report - Passed host verification matching the plan.
 * @param cutover - Host routing receipt with nonnegative routing revision and parseable cutover timestamp.
 * @returns The original cutover object; no routing mutation occurs.
 * @throws Error for invalid verification, mismatched target/migration, missing source-retention claim or invalid revision/time.
 * 
 * @remarks
 * This is evidence shape validation, not independent copy verification or authority to switch a tenant.
 * 
 * @example
 * ```typescript
 * import { assertBackendMigrationCutover, type BackendMigrationPlan, type BackendMigrationVerificationReport, type BackendMigrationCutover } from '@alneas/eaos-server/lifecycle-engine/backend-migration';
 * export function inspectCutover(plan: BackendMigrationPlan, report: BackendMigrationVerificationReport, receipt: BackendMigrationCutover) { return assertBackendMigrationCutover(plan, report, receipt); }
 * ```
 */
export function assertBackendMigrationCutover(plan: BackendMigrationPlan, report: BackendMigrationVerificationReport, cutover: BackendMigrationCutover): BackendMigrationCutover {
  assertBackendMigrationVerification(plan, report)
  if (!cutover || cutover.migrationId !== plan.request.migrationId || cutover.targetBackendId !== plan.request.target.id || cutover.sourceRetained !== true || !Number.isSafeInteger(cutover.routingRevision) || cutover.routingRevision < 0 || !Number.isFinite(Date.parse(cutover.cutoverAt))) throw new Error('Backend migration cutover is invalid')
  return cutover
}
