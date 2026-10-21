import { assertBackendMigrationCutover, canonical, normalizeLifecycleState, planBackendMigration, type BackendMigrationPlan, type BackendMigrationCutover, type BackendMigrationVerificationReport, type BackendTarget, type LifecyclePlatformMigrationRecord, type LifecycleStore, type LifecycleState } from '@alneas/eaos-server/lifecycle-engine'
import type { PlatformBackendRecord, PlatformControlStore, PlatformMigrationReconcileAction, PlatformTenantCreateInput, PlatformTenantPatch, PlatformTenantRecord, TenantBackendPlacement } from '@alneas/eaos-server/platform'

const key = (...parts: string[]) => JSON.stringify(parts)
const identifier = (value: string, name: string) => {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)) throw new Error(`Invalid ${name}`)
  return value
}
const text = (value: string, name: string, max = 256) => {
  if (!value.trim() || value.length > max) throw new Error(`Invalid ${name}`)
  return value
}
const timestamp = (value: string, name: string) => {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`Invalid ${name}`)
  return value
}

function materializeBackend(state: LifecycleState, backendId: string): PlatformBackendRecord | null {
  const backend = state.backends[backendId]
  if (!backend) return null
  return { ...backend, ...state.platform.backendMetadata[backendId] }
}

function targetOf(backend: PlatformBackendRecord | BackendTarget): BackendTarget {
  return { id: backend.id, databaseId: backend.databaseId, dialect: backend.dialect, mode: backend.mode, ...(backend.tenantId === undefined ? {} : { tenantId: backend.tenantId }) }
}

function placement(state: LifecycleState, tenantId: string): TenantBackendPlacement | null {
  const record = state.platform.placements[tenantId]
  if (!record) return null
  const backend = materializeBackend(state, record.backendId)
  if (!backend) throw new Error(`Tenant placement references unknown backend: ${record.backendId}`)
  return { tenantId, backend, routingRevision: record.routingRevision, changedAt: record.changedAt }
}

function validateBackend(backend: PlatformBackendRecord): void {
  identifier(backend.id, 'backend id')
  identifier(backend.databaseId, 'database id')
  if (!['sqlite', 'postgres', 'oracle'].includes(backend.dialect) || !['shared', 'dedicated'].includes(backend.mode)) throw new Error('Invalid backend target')
  if (backend.mode === 'dedicated') identifier(backend.tenantId ?? '', 'dedicated backend tenant')
  if (backend.mode === 'shared' && backend.tenantId !== undefined) throw new Error('Shared backend cannot bind a tenant')
}

/**
 * Platform control facade backed by the same LifecycleStore snapshot and lock.
 * Use this with SqlLifecycleStore for distributed hosts; it intentionally does
 * not create a second platform database or a second placement authority.
 * @remarks Mutations normalize one locked lifecycle snapshot, increment its revision, and persist it; transaction/CAS/lock recovery depend on the host LifecycleStore. This facade performs no caller authentication, SQL/infra provisioning, remote migration, or automatic retry. Authorize operators before invoking it and reconcile uncertain store failures.
 * @example
 * ```typescript
 * import { LifecyclePlatformControlStore } from "@alneas/eaos-server/platform-admin/store";
 * import type { LifecycleStore } from "@alneas/eaos-server/lifecycle-engine";
 * export function controlStore(lifecycle: LifecycleStore) { return new LifecyclePlatformControlStore(lifecycle); }
 * ```
 */
export class LifecyclePlatformControlStore implements PlatformControlStore {
  /**
   * Captures the shared authoritative lifecycle ledger and clock.
   * @param lifecycle - Host store providing consistent reads and exclusive writer callbacks.
   * @param now - Clock for mutation timestamps; defaults to a fresh Date.
   */
  constructor(private readonly lifecycle: LifecycleStore, private readonly now: () => Date = () => new Date()) {}

  private async read(): Promise<LifecycleState> { return normalizeLifecycleState(await this.lifecycle.read()) }

  private async mutate<T>(fn: (state: LifecycleState) => Promise<T> | T): Promise<T> {
    return this.lifecycle.withLock(async writer => {
      const state = normalizeLifecycleState(await writer.read())
      const result = await fn(state)
      state.revision += 1
      await writer.write(state)
      return result
    })
  }

  /**
   * Lists tenant records from the authoritative normalized lifecycle snapshot.
   * @returns Tenant records with cloned domains arrays, or an empty array.
   * @throws Host read/normalization failure.
   * @example
   * ```typescript
   * import { LifecyclePlatformControlStore } from "@alneas/eaos-server/platform-admin/store";
   * export async function listTenants(store: LifecyclePlatformControlStore, ...args: Parameters<LifecyclePlatformControlStore["listTenants"]>) {
   *   return store.listTenants(...args);
   * }
   * ```
   */
  async listTenants(): Promise<readonly PlatformTenantRecord[]> {
    const state = await this.read()
    return Object.values(state.platform.tenants).map(tenant => ({ ...tenant, domains: [...tenant.domains] }))
  }

  /**
   * Creates an active tenant and its initial backend routing record under the lifecycle writer lock.
   * @param input - Valid scope ID, nonblank name, nonempty domain strings, and registered initial backendId; a dedicated backend must bind the same tenant.
   * @returns Created tenant record with clock timestamps; initial routing revision is one.
   * @throws Invalid input, duplicate tenant, missing/mismatched backend, or host lock/write/clock failure.
   * @example
   * ```typescript
   * import { LifecyclePlatformControlStore } from "@alneas/eaos-server/platform-admin/store";
   * export async function createTenant(store: LifecyclePlatformControlStore, ...args: Parameters<LifecyclePlatformControlStore["createTenant"]>) {
   *   return store.createTenant(...args);
   * }
   * ```
   */
  async createTenant(input: PlatformTenantCreateInput): Promise<PlatformTenantRecord> {
    const id = identifier(input.id, 'tenant id')
    const name = text(input.name, 'tenant name')
    const backendId = identifier(input.backendId, 'initial backend id')
    if (!Array.isArray(input.domains) || input.domains.length === 0 || input.domains.some(domain => typeof domain !== 'string' || !domain.trim())) throw new Error('Invalid tenant domains')
    return this.mutate(state => {
      if (state.platform.tenants[id]) throw new Error('Tenant already exists')
      const backend = materializeBackend(state, backendId)
      if (!backend) throw new Error('Initial backend not found')
      if (backend.mode === 'dedicated' && backend.tenantId !== id) throw new Error('Initial backend tenant mismatch')
      const at = this.now().toISOString()
      const tenant = { id, name, active: true, domains: [...input.domains], createdAt: at, updatedAt: at }
      state.platform.tenants[id] = tenant
      state.platform.placements[id] = { tenantId: id, backendId, routingRevision: 1, changedAt: at }
      return tenant
    })
  }

  /**
   * Updates an existing tenant name, active flag, or domains and refreshes updatedAt.
   * @param tenantId - Existing valid tenant scope ID.
   * @param patch - Optional nonblank name, boolean active, and nonempty nonblank domains; omitted fields remain unchanged.
   * @returns Updated tenant with cloned domains.
   * @throws Missing tenant, invalid supplied fields, or host lock/write/clock failure.
   * @example
   * ```typescript
   * import { LifecyclePlatformControlStore } from "@alneas/eaos-server/platform-admin/store";
   * export async function updateTenant(store: LifecyclePlatformControlStore, ...args: Parameters<LifecyclePlatformControlStore["updateTenant"]>) {
   *   return store.updateTenant(...args);
   * }
   * ```
   */
  async updateTenant(tenantId: string, patch: PlatformTenantPatch): Promise<PlatformTenantRecord> {
    identifier(tenantId, 'tenant id')
    return this.mutate(state => {
      const current = state.platform.tenants[tenantId]
      if (!current) throw new Error('Tenant not found')
      if (patch.name !== undefined) current.name = text(patch.name, 'tenant name')
      if (patch.active !== undefined) {
        if (typeof patch.active !== 'boolean') throw new Error('Invalid tenant active state')
        current.active = patch.active
      }
      if (patch.domains !== undefined) {
        if (!Array.isArray(patch.domains) || patch.domains.length === 0 || patch.domains.some(domain => typeof domain !== 'string' || !domain.trim())) throw new Error('Invalid tenant domains')
        current.domains = [...patch.domains]
      }
      current.updatedAt = this.now().toISOString()
      return { ...current, domains: [...current.domains] }
    })
  }

  /**
   * Registers an immutable backend placement identity and replaceable public metadata.
   * @param backend - Valid backend/database IDs, dialect/mode, optional dedicated tenant binding, and metadata.
   * @returns Materialized registered target with metadata.
   * @throws Invalid target, changed placement for an existing ID, database dialect conflict, or host store failure.
   * @example
   * ```typescript
   * import { LifecyclePlatformControlStore } from "@alneas/eaos-server/platform-admin/store";
   * export async function registerBackend(store: LifecyclePlatformControlStore, ...args: Parameters<LifecyclePlatformControlStore["registerBackend"]>) {
   *   return store.registerBackend(...args);
   * }
   * ```
   */
  async registerBackend(backend: PlatformBackendRecord): Promise<PlatformBackendRecord> {
    validateBackend(backend)
    return this.mutate(state => {
      const existing = state.backends[backend.id]
      const target: BackendTarget = { id: backend.id, databaseId: backend.databaseId, dialect: backend.dialect, mode: backend.mode, ...(backend.tenantId === undefined ? {} : { tenantId: backend.tenantId }) }
      if (existing && canonical(existing) !== canonical(target)) throw new Error('Backend placement is immutable; register a new backend ID')
      for (const other of Object.values(state.backends)) if (other.id !== backend.id && other.databaseId === backend.databaseId && other.dialect !== backend.dialect) throw new Error('Database dialect conflict')
      state.backends[backend.id] = target
      const { id: _id, databaseId: _databaseId, dialect: _dialect, mode: _mode, tenantId: _tenantId, ...metadata } = backend
      state.platform.backendMetadata[backend.id] = metadata
      return { ...target, ...metadata }
    })
  }

  /**
   * Materializes registered backend targets with their public metadata.
   * @returns Backend list, or an empty array.
   * @throws Host read/normalization failure.
   * @example
   * ```typescript
   * import { LifecyclePlatformControlStore } from "@alneas/eaos-server/platform-admin/store";
   * export async function listBackends(store: LifecyclePlatformControlStore, ...args: Parameters<LifecyclePlatformControlStore["listBackends"]>) {
   *   return store.listBackends(...args);
   * }
   * ```
   */
  async listBackends(): Promise<readonly PlatformBackendRecord[]> {
    const state = await this.read()
    return Object.keys(state.backends).map(id => materializeBackend(state, id)!).filter(Boolean)
  }

  /**
   * Reads a registered backend target and its public metadata.
   * @param backendId - Valid registered backend scope ID.
   * @returns Materialized backend, or null when unregistered.
   * @throws Invalid ID or host read failure.
   * @example
   * ```typescript
   * import { LifecyclePlatformControlStore } from "@alneas/eaos-server/platform-admin/store";
   * export async function getBackend(store: LifecyclePlatformControlStore, ...args: Parameters<LifecyclePlatformControlStore["getBackend"]>) {
   *   return store.getBackend(...args);
   * }
   * ```
   */
  async getBackend(backendId: string): Promise<PlatformBackendRecord | null> {
    identifier(backendId, 'backend id')
    return materializeBackend(await this.read(), backendId)
  }

  /**
   * Resolves a tenant routing record into its registered backend target.
   * @param tenantId - Valid tenant scope ID.
   * @returns Placement with routing revision/time and backend, or null when absent.
   * @throws Invalid ID, dangling backend reference, or host read failure.
   * @example
   * ```typescript
   * import { LifecyclePlatformControlStore } from "@alneas/eaos-server/platform-admin/store";
   * export async function getTenantPlacement(store: LifecyclePlatformControlStore, ...args: Parameters<LifecyclePlatformControlStore["getTenantPlacement"]>) {
   *   return store.getTenantPlacement(...args);
   * }
   * ```
   */
  async getTenantPlacement(tenantId: string): Promise<TenantBackendPlacement | null> {
    identifier(tenantId, 'tenant id')
    return placement(await this.read(), tenantId)
  }

  /**
   * Persists an immutable migration plan after checking registered backend identities.
   * @param plan - Reviewed plan matching currently registered source/target; identical saved plans may be accepted before completion.
   * @returns No value; resolves after storing the plan and initial planned record if absent.
   * @throws Unregistered/changed backend, conflicting reused plan ID, already completed plan, clone or host store failure.
   * @example
   * ```typescript
   * import { LifecyclePlatformControlStore } from "@alneas/eaos-server/platform-admin/store";
   * export async function saveMigrationPlan(store: LifecyclePlatformControlStore, ...args: Parameters<LifecyclePlatformControlStore["saveMigrationPlan"]>) {
   *   return store.saveMigrationPlan(...args);
   * }
   * ```
   */
  async saveMigrationPlan(plan: BackendMigrationPlan): Promise<void> {
    await this.mutate(state => {
      if (!state.backends[plan.request.source.id] || !state.backends[plan.request.target.id]) throw new Error('Migration backend is not registered')
      if (canonical(targetOf(state.backends[plan.request.source.id])) !== canonical(targetOf(plan.request.source)) || canonical(targetOf(state.backends[plan.request.target.id])) !== canonical(targetOf(plan.request.target))) throw new Error('Migration backend changed since planning')
      const existing = state.platform.migrationPlans[plan.id]
      if (existing && canonical(existing) !== canonical(plan)) throw new Error('Migration plan ID already contains a different plan')
      const current = state.platform.migrationRecords[plan.id]
      if (current?.status === 'cutover' || current?.status === 'rolled-back') throw new Error('Migration plan has already completed')
      state.platform.migrationPlans[plan.id] = structuredClone(plan)
      state.platform.migrationRecords[plan.id] ??= { status: 'planned', updatedAt: plan.request.requestedAt }
    })
  }

  /**
   * Reads a cloned persisted migration plan by ID.
   * @param migrationId - Valid migration scope ID.
   * @returns Plan clone, or null when absent.
   * @throws Invalid ID or host read/clone failure.
   * @example
   * ```typescript
   * import { LifecyclePlatformControlStore } from "@alneas/eaos-server/platform-admin/store";
   * export async function getMigrationPlan(store: LifecyclePlatformControlStore, ...args: Parameters<LifecyclePlatformControlStore["getMigrationPlan"]>) {
   *   return store.getMigrationPlan(...args);
   * }
   * ```
   */
  async getMigrationPlan(migrationId: string): Promise<BackendMigrationPlan | null> {
    identifier(migrationId, 'migration id')
    const state = await this.read()
    const plan = state.platform.migrationPlans[migrationId]
    return plan ? structuredClone(plan) : null
  }

  /**
   * Reads the persisted migration execution/reconciliation record.
   * @param migrationId - Valid migration scope ID.
   * @returns Cloned status record, or null when absent.
   * @throws Invalid ID or host read/clone failure.
   * @example
   * ```typescript
   * import { LifecyclePlatformControlStore } from "@alneas/eaos-server/platform-admin/store";
   * export async function getMigrationStatus(store: LifecyclePlatformControlStore, ...args: Parameters<LifecyclePlatformControlStore["getMigrationStatus"]>) {
   *   return store.getMigrationStatus(...args);
   * }
   * ```
   */
  async getMigrationStatus(migrationId: string): Promise<LifecyclePlatformMigrationRecord | null> {
    identifier(migrationId, 'migration id')
    const record = (await this.read()).platform.migrationRecords[migrationId]
    return record ? structuredClone(record) : null
  }

  /**
   * Binds an execution token and transitions a tenant migration record to running.
   * @param input - Verified tenantId, persisted migrationId, and unique host executionId; plan scope must include the tenant.
   * @returns Cloned running record, or completed cutover/rolled-back record unchanged.
   * @throws Missing plan, tenant mismatch, conflicting active token, reconciling state, invalid IDs, or host store failure.
   * @example
   * ```typescript
   * import { LifecyclePlatformControlStore } from "@alneas/eaos-server/platform-admin/store";
   * export async function beginMigrationExecution(store: LifecyclePlatformControlStore, ...args: Parameters<LifecyclePlatformControlStore["beginMigrationExecution"]>) {
   *   return store.beginMigrationExecution(...args);
   * }
   * ```
   */
  async beginMigrationExecution(input: { 
  /**
   * Verified tenant included in the persisted migration plan tenant scope; mismatch rejects before recording execution.
   */
  tenantId: string; 
  /**
   * Identity of an already persisted migration plan and its corresponding status record.
   */
  migrationId: string; 
  /**
   * Host execution token bound to this run; a different token cannot replace an active running/verified execution.
   */
  executionId: string }): Promise<LifecyclePlatformMigrationRecord> {
    identifier(input.tenantId, 'tenant id'); identifier(input.migrationId, 'migration id'); identifier(input.executionId, 'execution id')
    return this.mutate(state => {
      const plan = state.platform.migrationPlans[input.migrationId]
      const record = state.platform.migrationRecords[input.migrationId]
      if (!plan || !record) throw new Error('Migration plan not found')
      if (plan.request.scope.kind !== 'tenants' || !plan.request.scope.tenantIds.includes(input.tenantId)) throw new Error('Migration plan tenant mismatch')
      if (record.status === 'cutover' || record.status === 'rolled-back') return structuredClone(record)
      if ((record.status === 'running' || record.status === 'verified') && record.executionId !== input.executionId) throw new Error('Migration execution already in progress')
      if (record.status === 'reconciling') throw new Error('Migration requires reconciliation before retry')
      record.status = 'running'
      record.executionId = input.executionId
      record.error = undefined
      record.updatedAt = this.now().toISOString()
      return structuredClone(record)
    })
  }

  /**
   * Records verified migration evidence and cutover data for the active execution token.
   * @param input - Tenant, exact persisted plan, active executionId, verification report, and matching validated cutover.
   * @returns Cloned verified migration record.
   * @throws Invalid cutover/report, nonpersisted/changed plan, tenant/token/state mismatch, changed retry verification, or host store failure.
   * @example
   * ```typescript
   * import { LifecyclePlatformControlStore } from "@alneas/eaos-server/platform-admin/store";
   * export async function recordMigrationVerification(store: LifecyclePlatformControlStore, ...args: Parameters<LifecyclePlatformControlStore["recordMigrationVerification"]>) {
   *   return store.recordMigrationVerification(...args);
   * }
   * ```
   */
  async recordMigrationVerification(input: { 
  /**
   * Verified tenant included in the exact persisted plan tenant scope.
   */
  tenantId: string; 
  /**
   * Exact persisted migration plan; canonical contents must match the saved plan rather than a modified caller copy.
   */
  plan: BackendMigrationPlan; 
  /**
   * Current execution token recorded by beginMigrationExecution; only running/verified records with this token may accept evidence.
   */
  executionId: string; 
  /**
   * Passing source/target verification report validated against the plan and cutover; a verified retry must reproduce the recorded report.
   */
  verification: BackendMigrationVerificationReport; 
  /**
   * Matching validated cutover proof recorded with the report for a later explicit routing commit; recording verification does not itself switch placement.
   */
  cutover: BackendMigrationCutover }): Promise<LifecyclePlatformMigrationRecord> {
    identifier(input.tenantId, 'tenant id'); identifier(input.executionId, 'execution id')
    assertBackendMigrationCutover(input.plan, input.verification, input.cutover)
    return this.mutate(state => {
      const saved = state.platform.migrationPlans[input.plan.id]
      const record = state.platform.migrationRecords[input.plan.id]
      if (!saved || canonical(saved) !== canonical(input.plan) || !record) throw new Error('Migration plan is not the persisted plan')
      if (input.plan.request.scope.kind !== 'tenants' || !input.plan.request.scope.tenantIds.includes(input.tenantId)) throw new Error('Migration plan tenant mismatch')
      if (record.executionId !== input.executionId || !['running', 'verified'].includes(record.status)) throw new Error('Migration execution is not active')
      if (record.status === 'verified' && canonical(record.verification) !== canonical(input.verification)) throw new Error('Migration verification changed during retry')
      record.status = 'verified'
      record.verification = structuredClone(input.verification)
      record.cutover = structuredClone(input.cutover)
      record.updatedAt = this.now().toISOString()
      return structuredClone(record)
    })
  }

  /**
   * Records a failed or reconciling migration status with host diagnostic text.
   * @param input - Persisted migrationId, optional expected executionId, failure status, and nonblank message up to 2048 characters.
   * @returns Cloned updated failure record.
   * @throws Missing/completed migration, mismatched token, invalid input, or host store/clock failure.
   * @example
   * ```typescript
   * import { LifecyclePlatformControlStore } from "@alneas/eaos-server/platform-admin/store";
   * export async function markMigrationFailure(store: LifecyclePlatformControlStore, ...args: Parameters<LifecyclePlatformControlStore["markMigrationFailure"]>) {
   *   return store.markMigrationFailure(...args);
   * }
   * ```
   */
  async markMigrationFailure(input: { 
  /**
   * Persisted migration record to mark failed or reconciling; completed cutover/rolled-back records cannot be changed through this method.
   */
  migrationId: string; 
  /**
   * Optional expected active execution token; a truthy supplied value must match, while omission skips this token check.
   */
  executionId?: string; 
  /**
   * Failure disposition to persist: failed permits explicit retry preparation, while reconciling requires operator outcome review before retry.
   */
  status: 'failed' | 'reconciling'; 
  /**
   * Nonblank diagnostic text up to 2048 characters, stored with a generated occurrence timestamp; exclude secrets and customer payloads.
   */
  message: string }): Promise<LifecyclePlatformMigrationRecord> {
    identifier(input.migrationId, 'migration id'); text(input.message, 'migration failure', 2048)
    return this.mutate(state => {
      const record = state.platform.migrationRecords[input.migrationId]
      if (!record) throw new Error('Migration plan not found')
      if (input.executionId && record.executionId !== input.executionId) throw new Error('Migration execution token mismatch')
      if (record.status === 'cutover' || record.status === 'rolled-back') throw new Error('Completed migration cannot be marked failed')
      record.status = input.status
      record.error = { message: input.message, occurredAt: this.now().toISOString() }
      record.updatedAt = this.now().toISOString()
      return structuredClone(record)
    })
  }

  /**
   * Applies an operator reconciliation status action and records its note.
   * @param input - Persisted migrationId, action, and nonblank note up to 2048 characters; retry only permits failed/reconciling state and clears execution/verification/cutover.
   * @returns Cloned updated migration record.
   * @throws Missing record, retry from an ineligible state, completed record for mark-failed/mark-reconciling, invalid text, or host store failure.
   * @example
   * ```typescript
   * import { LifecyclePlatformControlStore } from "@alneas/eaos-server/platform-admin/store";
   * export async function reconcileMigration(store: LifecyclePlatformControlStore, ...args: Parameters<LifecyclePlatformControlStore["reconcileMigration"]>) {
   *   return store.reconcileMigration(...args);
   * }
   * ```
   */
  async reconcileMigration(input: { 
  /**
   * Persisted migration whose operator reconciliation state is being updated.
   */
  migrationId: string; 
  /**
   * Explicit retry, mark-failed or mark-reconciling action; retry requires failed/reconciling state and clears execution, verification and cutover data.
   */
  action: PlatformMigrationReconcileAction; 
  /**
   * Nonblank operator rationale up to 2048 characters, persisted as timestamped diagnostic text; this does not independently verify external outcomes.
   */
  note: string }): Promise<LifecyclePlatformMigrationRecord> {
    identifier(input.migrationId, 'migration id'); text(input.note, 'reconciliation note', 2048)
    return this.mutate(state => {
      const record = state.platform.migrationRecords[input.migrationId]
      if (!record) throw new Error('Migration plan not found')
      if (input.action === 'retry') {
        if (!['failed', 'reconciling'].includes(record.status)) throw new Error('Only failed or reconciling migrations can be retried')
        record.status = 'planned'; record.executionId = undefined; record.verification = undefined; record.cutover = undefined
      } else if (input.action === 'mark-failed') {
        if (record.status === 'cutover' || record.status === 'rolled-back') throw new Error('Completed migration cannot be marked failed')
        record.status = 'failed'
      } else if (input.action === 'mark-reconciling') {
        if (record.status === 'cutover' || record.status === 'rolled-back') throw new Error('Completed migration cannot be reconciled')
        record.status = 'reconciling'
      }
      record.error = { message: input.note, occurredAt: this.now().toISOString() }
      record.updatedAt = this.now().toISOString()
      return structuredClone(record)
    })
  }

  /**
   * Creates a reverse migration plan for a completed cutover without executing rollback.
   * @param input - Verified tenantId, completed migrationId, nonblank reason up to 1024 characters, and parseable requestedAt timestamp.
   * @returns New planned reverse migration linked to the original record.
   * @throws Incomplete/already rollback-planned migration, tenant no longer on migrated target, invalid input/planning, or host store failure.
   * @example
   * ```typescript
   * import { LifecyclePlatformControlStore } from "@alneas/eaos-server/platform-admin/store";
   * export async function createRollbackPlan(store: LifecyclePlatformControlStore, ...args: Parameters<LifecyclePlatformControlStore["createRollbackPlan"]>) {
   *   return store.createRollbackPlan(...args);
   * }
   * ```
   */
  async createRollbackPlan(input: { 
  /**
   * Verified tenant currently placed on the completed migration target; the current placement must still match before a reverse plan is created.
   */
  tenantId: string; 
  /**
   * Completed cutover migration to reverse; an existing rollback plan prevents creating another one.
   */
  migrationId: string; 
  /**
   * Nonblank rollback planning rationale up to 1024 characters, copied to the new reverse migration request.
   */
  reason: string; 
  /**
   * Parseable rollback request timestamp copied to the new plan/status record; no rollback is executed by planning.
   */
  requestedAt: string }): Promise<BackendMigrationPlan> {
    identifier(input.tenantId, 'tenant id'); identifier(input.migrationId, 'migration id'); text(input.reason, 'rollback reason', 1024)
    timestamp(input.requestedAt, 'rollback requestedAt')
    return this.mutate(state => {
      const original = state.platform.migrationRecords[input.migrationId]
      const originalPlan = state.platform.migrationPlans[input.migrationId]
      if (!original || !originalPlan || original.status !== 'cutover') throw new Error('Only a completed migration can be rolled back')
      if (original.rollbackPlanId) throw new Error('Migration rollback already exists')
      const current = placement(state, input.tenantId)
      if (!current || current.backend.id !== originalPlan.request.target.id) throw new Error('Current tenant placement is not the migrated target')
      const rollback = planBackendMigration({
        migrationId: `rollback-${crypto.randomUUID()}`,
        source: originalPlan.request.target,
        target: originalPlan.request.source,
        scope: originalPlan.request.scope,
        pluginIds: originalPlan.request.pluginIds,
        requestedAt: input.requestedAt,
        reason: input.reason,
      })
      state.platform.migrationPlans[rollback.id] = structuredClone(rollback)
      state.platform.migrationRecords[rollback.id] = { status: 'planned', updatedAt: input.requestedAt, rollbackOf: input.migrationId }
      original.rollbackPlanId = rollback.id
      original.updatedAt = this.now().toISOString()
      return rollback
    })
  }

  /**
   * Commits a verified migration routing change and transfers active plugin activations to the target backend.
   * @param input - Tenant included by the exact persisted plan and its previously recorded cutover proof.
   * @returns New target placement, or current placement for an already-cutover record.
   * @throws Unverified/stale/changed plan, invalid cutover or nonadvancing routing revision, target tenant mismatch, missing planned active plugin or target installation, or host lock/write failure.
   * @example
   * ```typescript
   * import { LifecyclePlatformControlStore } from "@alneas/eaos-server/platform-admin/store";
   * export async function recordTenantPlacement(store: LifecyclePlatformControlStore, ...args: Parameters<LifecyclePlatformControlStore["recordTenantPlacement"]>) {
   *   return store.recordTenantPlacement(...args);
   * }
   * ```
   */
  async recordTenantPlacement(input: { 
  /**
   * Verified tenant included in the plan whose persisted routing placement and active plugin bindings will be moved.
   */
  tenantId: string; 
  /**
   * Exact persisted verified migration plan; current source/target backend identities and installations are rechecked before commit.
   */
  plan: BackendMigrationPlan; 
  /**
   * Previously recorded verification proof with source retained and an advancing routing revision; its canonical contents must match the saved cutover.
   */
  cutover: BackendMigrationCutover }): Promise<TenantBackendPlacement> {
    identifier(input.tenantId, 'tenant id')
    return this.mutate(state => {
      const { plan, cutover } = input
      const saved = state.platform.migrationPlans[plan.id]
      const record = state.platform.migrationRecords[plan.id]
      if (!saved || canonical(saved) !== canonical(plan) || !record) throw new Error('Migration plan is not the persisted plan')
      if (plan.request.scope.kind !== 'tenants' || !plan.request.scope.tenantIds.includes(input.tenantId)) throw new Error('Migration plan tenant mismatch')
      if (record.status === 'cutover') return placement(state, input.tenantId)!
      if (record.status !== 'verified' || !record.executionId || !record.verification || !record.cutover || canonical(record.cutover) !== canonical(cutover)) throw new Error('Migration must be verified before cutover')
      if (cutover.migrationId !== plan.request.migrationId || cutover.targetBackendId !== plan.request.target.id || cutover.sourceRetained !== true || !Number.isSafeInteger(cutover.routingRevision) || cutover.routingRevision < 0 || !Number.isFinite(Date.parse(cutover.cutoverAt))) throw new Error('Invalid migration cutover')
      const current = placement(state, input.tenantId)
      if (!current || current.backend.id !== plan.request.source.id || current.backend.databaseId !== plan.request.source.databaseId) throw new Error('Migration plan is stale')
      if (cutover.routingRevision <= current.routingRevision) throw new Error('Migration routing revision must advance')
      const target = materializeBackend(state, plan.request.target.id)
      if (!target || canonical(targetOf(target)) !== canonical(targetOf(plan.request.target))) throw new Error('Migration target backend changed')
      if (target.mode === 'dedicated' && target.tenantId !== input.tenantId) throw new Error('Migration target tenant mismatch')

      const active = Object.entries(state.activations).filter(([, activation]) => activation.backendId === plan.request.source.id && activation.tenantId === input.tenantId && activation.enabled)
      const planned = new Set(plan.request.pluginIds)
      for (const [, activation] of active) {
        if (!planned.has(activation.pluginId)) throw new Error(`Migration plan does not include active plugin: ${activation.pluginId}`)
        const installation = state.installations[key(plan.request.target.id, activation.pluginId)]
        if (!installation || installation.status !== 'installed') throw new Error(`Target backend is missing installed plugin: ${activation.pluginId}`)
      }
      for (const [activationKey, activation] of active) {
        activation.enabled = false
        const targetKey = key(plan.request.target.id, input.tenantId, activation.pluginId)
        const installation = state.installations[key(plan.request.target.id, activation.pluginId)]
        state.activations[targetKey] = { ...activation, backendId: plan.request.target.id, digest: installation.digest, enabled: true }
        state.activations[activationKey] = activation
      }
      state.platform.placements[input.tenantId] = { tenantId: input.tenantId, backendId: plan.request.target.id, routingRevision: cutover.routingRevision, changedAt: timestamp(cutover.cutoverAt, 'cutover time') }
      record.status = 'cutover'
      record.updatedAt = this.now().toISOString()
      record.cutover = structuredClone(cutover)
      if (record.rollbackOf) {
        const original = state.platform.migrationRecords[record.rollbackOf]
        if (original) { original.status = 'rolled-back'; original.updatedAt = this.now().toISOString(); original.rollbackPlanId = plan.id }
      }
      return placement(state, input.tenantId)!
    })
  }
}
