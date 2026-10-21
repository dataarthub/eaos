import type { BackendMigrationCutover, BackendMigrationPlan, BackendMigrationVerificationReport, BackendTarget, LifecyclePlatformMigrationRecord } from '../index'
import type { PlatformTenant } from './index'

/**
 * Tenant record managed by the control plane; account membership stays host-owned.
 * 
 * 
 * A tenant record managed by the platform control plane. Membership remains host-owned.
 * @see PluginLifecycle for canonical integration usage.
 */
export interface PlatformTenantRecord extends PlatformTenant {
  /**
   * Public tenant display name.
   */
  name: string
  /**
   * Creation timestamp.
   */
  createdAt: string
  /**
   * Latest metadata modification timestamp.
   */
  updatedAt: string
}

/**
 * Requested tenant registration bound to an already configured backend.
 * 
 * @see PluginLifecycle for canonical integration usage.
 */
export interface PlatformTenantCreateInput {
  /**
   * Concrete tenant identifier to create.
   */
  id: string
  /**
   * Tenant display name.
   */
  name: string
  /**
   * Requested domain lookup mappings; no membership is implied.
   */
  domains: readonly string[]
  /**
   * Existing opaque backend ID to assign; does not trigger provisioning.
   */
  backendId: string
}

/**
 * Partial tenant metadata change; omitted properties retain their current values.
 * 
 * @see PluginLifecycle for canonical integration usage.
 */
export interface PlatformTenantPatch {
  /**
   * Optional replacement display name.
   */
  name?: string
  /**
   * Optional admission enable/disable flag.
   */
  active?: boolean
  /**
   * Optional complete replacement domain mapping list.
   */
  domains?: readonly string[]
}

/**
 * Existing opaque backend target plus nonsecret host metadata.
 * 
 * 
 * Backend IDs and database IDs are opaque host references, never DSNs or credentials.
 * @see PluginLifecycle for canonical integration usage.
 */
export interface PlatformBackendRecord extends BackendTarget {
  /**
   * Optional display caption.
   */
  label?: string
  /**
   * Optional provider name; never a DSN/credential.
   */
  provider?: string
  /**
   * Optional host-reported capability names.
   */
  capabilities?: readonly string[]
}

/**
 * Current tenant routing assignment and its recorded revision.
 * 
 * @see PluginLifecycle for canonical integration usage.
 */
export interface TenantBackendPlacement {
  /**
   * Concrete tenant whose traffic is routed.
   */
  tenantId: string
  /**
   * Configured target and its nonsecret metadata.
   */
  backend: PlatformBackendRecord
  /**
   * Nonnegative routing revision tracking cutover.
   */
  routingRevision: number
  /**
   * Routing-change timestamp.
   */
  changedAt: string
}

/**
 * Explicit platform administrative permissions checked independently from tenant roles.
 * 
 * @see PluginLifecycle for canonical integration usage.
 */
export type PlatformAdminAction =
  | 'tenant:list'
  | 'tenant:create'
  | 'tenant:update'
  | 'backend:list'
  | 'placement:read'
  | 'placement:plan'
  | 'placement:cutover'
  | 'placement:rollback'
  | 'placement:reconcile'

/**
 * Explicit operator recovery action for an uncertain or failed migration execution.
 * 
 * @see PluginLifecycle for canonical integration usage.
 */
export type PlatformMigrationReconcileAction = 'retry' | 'mark-failed' | 'mark-reconciling' | 'commit-verified'

/**
 * Host-verified platform operator identity; tenant membership roles alone cannot grant platform administration.
 * 
 * @see PluginLifecycle for canonical integration usage.
 */
export interface PlatformAdminPrincipal {
  /**
   * Authenticated platform actor identity.
   */
  userId: string
  /**
   * Explicit trusted platform-administrator claim.
   */
  isPlatformAdmin: boolean
  /**
   * Optional verified platform role metadata used by host authorization.
   */
  roles?: readonly string[]
}

/**
 * Metadata-only platform administration outcome bound to verified actor and affected scope.
 * 
 * @see PluginLifecycle for canonical integration usage.
 */
export interface PlatformAdminAuditEvent {
  /**
   * Requested platform administrative permission.
   */
  action: PlatformAdminAction
  /**
   * Verified operator identity.
   */
  actorId: string
  /**
   * Optional affected concrete tenant.
   */
  tenantId?: string
  /**
   * Optional existing source backend reference.
   */
  sourceBackendId?: string
  /**
   * Optional reviewed target backend reference.
   */
  targetBackendId?: string
  /**
   * Optional backend migration identity.
   */
  migrationId?: string
  /**
   * Allowed/denied/failed result reported by the host.
   */
  outcome: 'allowed' | 'denied' | 'failed'
  /**
   * Audit occurrence timestamp.
   */
  occurredAt: string
}

/**
 * Host persistence for tenant catalog, verified migration evidence and atomic routing/activation changes.
 * 
 * 
 * Host persistence for the platform control plane. The framework never opens an
 * ADB connection, stores credentials, or runs Pulumi from these callbacks.
 * @see PluginLifecycle for canonical integration usage.
 */
export interface PlatformControlStore {
  /**
   * List current platform tenant records without granting membership.
   * @returns Current platform tenant records, possibly empty.
   * @throws Host adapter or callback failures reject the returned Promise; side effects may already be partially complete.
   
   * @example
   * ```typescript
   * import type { PlatformControlStore } from '@alneas/eaos-server/platform';
   * export async function reviewedOperation(store: PlatformControlStore) {
   *   // The host authenticates the operator and reviews any mutation inputs first.
   *   return store.listTenants();
   * }
   * ```
   */
  listTenants(): Promise<readonly PlatformTenantRecord[]>
  /**
   * Persist tenant metadata and initial configured backend assignment.
   * @param input - Reviewed operation inputs; preserve the verified tenant/migration/execution identity described by this contract.
   * @returns The newly persisted platform tenant record.
   * @throws Host adapter or callback failures reject the returned Promise; side effects may already be partially complete.
   
   * @example
   * ```typescript
   * import type { PlatformControlStore } from '@alneas/eaos-server/platform';
   * export async function reviewedOperation(store: PlatformControlStore, input: Parameters<PlatformControlStore["createTenant"]>[0]) {
   *   // The host authenticates the operator and reviews any mutation inputs first.
   *   return store.createTenant(input);
   * }
   * ```
   */
  createTenant(input: PlatformTenantCreateInput): Promise<PlatformTenantRecord>
  /**
   * Update only supplied metadata fields for the specified tenant.
   * @param tenantId - Verified concrete tenant ID whose current state or permission is requested.
   * @param patch - Partial tenant metadata update; omitted fields retain their values.
   * @returns The updated tenant record.
   * @throws Host adapter or callback failures reject the returned Promise; side effects may already be partially complete.
   
   * @example
   * ```typescript
   * import type { PlatformControlStore } from '@alneas/eaos-server/platform';
   * export async function reviewedOperation(store: PlatformControlStore, tenantId: string, patch: Parameters<PlatformControlStore["updateTenant"]>[1]) {
   *   // The host authenticates the operator and reviews any mutation inputs first.
   *   return store.updateTenant(tenantId, patch);
   * }
   * ```
   */
  updateTenant(tenantId: string, patch: PlatformTenantPatch): Promise<PlatformTenantRecord>
  /**
   * Register an already-provisioned opaque backend; never provision a database here.
   * 
   * Register only an already-provisioned opaque backend; provisioning remains host-owned.
   * @param backend - Already-provisioned opaque backend declaration; never a connection string or credentials.
   * @returns The persisted existing backend registration.
   * @throws Host adapter or callback failures reject the returned Promise; side effects may already be partially complete.
   
   * @example
   * ```typescript
   * import type { PlatformControlStore } from '@alneas/eaos-server/platform';
   * export async function reviewedOperation(store: PlatformControlStore, backend: Parameters<PlatformControlStore["registerBackend"]>[0]) {
   *   // The host authenticates the operator and reviews any mutation inputs first.
   *   return store.registerBackend(backend);
   * }
   * ```
   */
  registerBackend(backend: PlatformBackendRecord): Promise<PlatformBackendRecord>
  /**
   * List registered nonsecret backend targets.
   * @returns Configured opaque backend records, possibly empty.
   * @throws Host adapter or callback failures reject the returned Promise; side effects may already be partially complete.
   
   * @example
   * ```typescript
   * import type { PlatformControlStore } from '@alneas/eaos-server/platform';
   * export async function reviewedOperation(store: PlatformControlStore) {
   *   // The host authenticates the operator and reviews any mutation inputs first.
   *   return store.listBackends();
   * }
   * ```
   */
  listBackends(): Promise<readonly PlatformBackendRecord[]>
  /**
   * Resolve an existing backend by ID, or null.
   * @param backendId - Existing opaque backend identity to resolve.
   * @returns The existing backend, or null when absent.
   * @throws Host adapter or callback failures reject the returned Promise; side effects may already be partially complete.
   
   * @example
   * ```typescript
   * import type { PlatformControlStore } from '@alneas/eaos-server/platform';
   * export async function reviewedOperation(store: PlatformControlStore, backendId: string) {
   *   // The host authenticates the operator and reviews any mutation inputs first.
   *   return store.getBackend(backendId);
   * }
   * ```
   */
  getBackend(backendId: string): Promise<PlatformBackendRecord | null>
  /**
   * Read current tenant routing assignment, or null.
   * @param tenantId - Verified concrete tenant ID whose current state or permission is requested.
   * @returns Current tenant routing placement, or null when absent.
   * @throws Host adapter or callback failures reject the returned Promise; side effects may already be partially complete.
   
   * @example
   * ```typescript
   * import type { PlatformControlStore } from '@alneas/eaos-server/platform';
   * export async function reviewedOperation(store: PlatformControlStore, tenantId: string) {
   *   // The host authenticates the operator and reviews any mutation inputs first.
   *   return store.getTenantPlacement(tenantId);
   * }
   * ```
   */
  getTenantPlacement(tenantId: string): Promise<TenantBackendPlacement | null>
  /**
   * Durably persist the exact reviewed migration plan; no copy/cutover is executed.
   * @param plan - Reviewed unmodified backend migration plan; host must preserve quiescence and source data.
   * @returns Resolves without a value after the reviewed plan is durably stored.
   * @throws Host adapter or callback failures reject the returned Promise; side effects may already be partially complete.
   
   * @example
   * ```typescript
   * import type { PlatformControlStore } from '@alneas/eaos-server/platform';
   * export async function reviewedOperation(store: PlatformControlStore, plan: Parameters<PlatformControlStore["saveMigrationPlan"]>[0]) {
   *   // The host authenticates the operator and reviews any mutation inputs first.
   *   await store.saveMigrationPlan(plan);
   * }
   * ```
   */
  saveMigrationPlan(plan: BackendMigrationPlan): Promise<void>
  /**
   * Read a reviewed plan by migration ID, or null.
   * @param migrationId - Stable reviewed backend migration identity.
   * @returns The saved reviewed migration plan, or null when absent.
   * @throws Host adapter or callback failures reject the returned Promise; side effects may already be partially complete.
   
   * @example
   * ```typescript
   * import type { PlatformControlStore } from '@alneas/eaos-server/platform';
   * export async function reviewedOperation(store: PlatformControlStore, migrationId: string) {
   *   // The host authenticates the operator and reviews any mutation inputs first.
   *   return store.getMigrationPlan(migrationId);
   * }
   * ```
   */
  getMigrationPlan(migrationId: string): Promise<BackendMigrationPlan | null>
  /**
   * Read current migration progress/evidence, or null.
   * @param migrationId - Stable reviewed backend migration identity.
   * @returns The current progress/evidence record, or null when absent.
   * @throws Host adapter or callback failures reject the returned Promise; side effects may already be partially complete.
   
   * @example
   * ```typescript
   * import type { PlatformControlStore } from '@alneas/eaos-server/platform';
   * export async function reviewedOperation(store: PlatformControlStore, migrationId: string) {
   *   // The host authenticates the operator and reviews any mutation inputs first.
   *   return store.getMigrationStatus(migrationId);
   * }
   * ```
   */
  getMigrationStatus(migrationId: string): Promise<LifecyclePlatformMigrationRecord | null>
  /**
   * Claim execution for a tenant migration with a unique execution ID before host effects begin.
   * @param input - Reviewed operation inputs; preserve the verified tenant/migration/execution identity described by this contract.
   * @returns The claimed running migration record.
   * @throws Host adapter or callback failures reject the returned Promise; side effects may already be partially complete.
   
   * @example
   * ```typescript
   * import type { PlatformControlStore } from '@alneas/eaos-server/platform';
   * export async function reviewedOperation(store: PlatformControlStore, input: Parameters<PlatformControlStore["beginMigrationExecution"]>[0]) {
   *   // The host authenticates the operator and reviews any mutation inputs first.
   *   return store.beginMigrationExecution(input);
   * }
   * ```
   */
  beginMigrationExecution(input: { 
    /**
     * Verified concrete tenant whose reviewed migration or routing placement is being changed.
     */
    tenantId: string; 
    /**
     * Stable identity of the saved reviewed migration plan whose execution/progress is being changed.
     */
    migrationId: string; 
    /**
     * Unique host execution claim; preserve it when recording results so obsolete or competing workers cannot claim the transition.
     */
    executionId: string }): Promise<LifecyclePlatformMigrationRecord>
  /**
   * Persist verified copy/cutover evidence for the claimed execution before routing commit.
   * @param input - Reviewed operation inputs; preserve the verified tenant/migration/execution identity described by this contract.
   * @returns The migration record containing persisted verification and cutover evidence.
   * @throws Host adapter or callback failures reject the returned Promise; side effects may already be partially complete.
   
   * @example
   * ```typescript
   * import type { PlatformControlStore } from '@alneas/eaos-server/platform';
   * export async function reviewedOperation(store: PlatformControlStore, input: Parameters<PlatformControlStore["recordMigrationVerification"]>[0]) {
   *   // The host authenticates the operator and reviews any mutation inputs first.
   *   return store.recordMigrationVerification(input);
   * }
   * ```
   */
  recordMigrationVerification(input: { 
    /**
     * Verified concrete tenant whose reviewed migration or routing placement is being changed.
     */
    tenantId: string; 
    /**
     * Exact reviewed backend migration plan whose source, target, scope and digest must match the saved control-plane plan.
     */
    plan: BackendMigrationPlan; 
    /**
     * Unique host execution claim; preserve it when recording results so obsolete or competing workers cannot claim the transition.
     */
    executionId: string; 
    /**
     * Host-produced complete copy verification matching the plan and claimed execution; persistence does not independently measure the data.
     */
    verification: BackendMigrationVerificationReport; 
    /**
     * Matching source-retaining host routing receipt; commit placement only after current verification is accepted.
     */
    cutover: BackendMigrationCutover }): Promise<LifecyclePlatformMigrationRecord>
  /**
   * Record failed or uncertain/reconciling outcome without claiming rollback of host effects.
   * @param input - Reviewed operation inputs; preserve the verified tenant/migration/execution identity described by this contract.
   * @returns The recorded failed/reconciling migration state.
   * @throws Host adapter or callback failures reject the returned Promise; side effects may already be partially complete.
   
   * @example
   * ```typescript
   * import type { PlatformControlStore } from '@alneas/eaos-server/platform';
   * export async function reviewedOperation(store: PlatformControlStore, input: Parameters<PlatformControlStore["markMigrationFailure"]>[0]) {
   *   // The host authenticates the operator and reviews any mutation inputs first.
   *   return store.markMigrationFailure(input);
   * }
   * ```
   */
  markMigrationFailure(input: { 
    /**
     * Stable identity of the saved reviewed migration plan whose execution/progress is being changed.
     */
    migrationId: string; 
    /**
     * Unique host execution claim; preserve it when recording results so obsolete or competing workers cannot claim the transition.
     */
    executionId?: string; 
    /**
     * Explicit failed or reconciling classification; use reconciling when external copy/routing outcomes are uncertain.
     */
    status: 'failed' | 'reconciling'; 
    /**
     * Nonsecret failure description retained for operator diagnosis; exclude credentials and business payloads.
     */
    message: string }): Promise<LifecyclePlatformMigrationRecord>
  /**
   * Apply an explicit documented operator recovery action with a retained note.
   * @param input - Reviewed operation inputs; preserve the verified tenant/migration/execution identity described by this contract.
   * @returns The resulting migration record after the explicit recovery action.
   * @throws Host adapter or callback failures reject the returned Promise; side effects may already be partially complete.
   
   * @example
   * ```typescript
   * import type { PlatformControlStore } from '@alneas/eaos-server/platform';
   * export async function reviewedOperation(store: PlatformControlStore, input: Parameters<PlatformControlStore["reconcileMigration"]>[0]) {
   *   // The host authenticates the operator and reviews any mutation inputs first.
   *   return store.reconcileMigration(input);
   * }
   * ```
   */
  reconcileMigration(input: { 
    /**
     * Stable identity of the saved reviewed migration plan whose execution/progress is being changed.
     */
    migrationId: string; 
    /**
     * Explicit reviewed recovery action for this migration; never infer successful cutover from a timeout.
     */
    action: PlatformMigrationReconcileAction; 
    /**
     * Retained operator explanation/evidence for the selected reconciliation action.
     */
    note: string }): Promise<LifecyclePlatformMigrationRecord>
  /**
   * Create a reviewed reverse placement plan referencing the retained original source; no copy/cutover executes.
   * @param input - Reviewed operation inputs; preserve the verified tenant/migration/execution identity described by this contract.
   * @returns A reviewed source-retaining reverse migration plan; no backend effects run.
   * @throws Host adapter or callback failures reject the returned Promise; side effects may already be partially complete.
   
   * @example
   * ```typescript
   * import type { PlatformControlStore } from '@alneas/eaos-server/platform';
   * export async function reviewedOperation(store: PlatformControlStore, input: Parameters<PlatformControlStore["createRollbackPlan"]>[0]) {
   *   // The host authenticates the operator and reviews any mutation inputs first.
   *   return store.createRollbackPlan(input);
   * }
   * ```
   */
  createRollbackPlan(input: { 
    /**
     * Verified concrete tenant whose reviewed migration or routing placement is being changed.
     */
    tenantId: string; 
    /**
     * Stable identity of the saved reviewed migration plan whose execution/progress is being changed.
     */
    migrationId: string; 
    /**
     * Reviewed operator reason for creating a reverse migration to the retained source.
     */
    reason: string; 
    /**
     * Parseable timestamp of the reviewed rollback-plan request.
     */
    requestedAt: string }): Promise<BackendMigrationPlan>
  /**
   * Atomically commit verified plan, routing assignment and lifecycle activation switch.
   * 
   * Atomically commits the verified plan, routing placement and lifecycle activation switch.
   * @param input - Reviewed operation inputs; preserve the verified tenant/migration/execution identity described by this contract.
   * @returns The atomically committed tenant routing placement.
   * @throws Host adapter or callback failures reject the returned Promise; side effects may already be partially complete.
   
   * @example
   * ```typescript
   * import type { PlatformControlStore } from '@alneas/eaos-server/platform';
   * export async function reviewedOperation(store: PlatformControlStore, input: Parameters<PlatformControlStore["recordTenantPlacement"]>[0]) {
   *   // The host authenticates the operator and reviews any mutation inputs first.
   *   return store.recordTenantPlacement(input);
   * }
   * ```
   */
  recordTenantPlacement(input: { 
    /**
     * Verified concrete tenant whose reviewed migration or routing placement is being changed.
     */
    tenantId: string; 
    /**
     * Exact reviewed backend migration plan whose source, target, scope and digest must match the saved control-plane plan.
     */
    plan: BackendMigrationPlan; 
    /**
     * Matching source-retaining host routing receipt; commit placement only after current verification is accepted.
     */
    cutover: BackendMigrationCutover }): Promise<TenantBackendPlacement>
}

/**
 * Host adapter performing prepare/copy/verify/cutover/retain-source phases against real resources.
 * 
 * 
 * The host performs the five migration phases against its own adapters and credentials.
 * @see PluginLifecycle for canonical integration usage.
 */
export interface PlatformPlacementExecutor {
  /**
   * Execute the reviewed plan with all-instance quiescence and return matching verification/cutover receipts; uncertain outcomes must be reconciled rather than blindly retried.
   * @param plan - Reviewed unmodified backend migration plan; host must preserve quiescence and source data.
   * @returns Matching verification and cutover receipts from the host execution.
   * @throws Host adapter or callback failures reject the returned Promise; side effects may already be partially complete.
   
   * @example
   * ```typescript
   * import type { PlatformPlacementExecutor } from '@alneas/eaos-server/platform';
   * export async function executeReviewed(executor: PlatformPlacementExecutor, plan: Parameters<PlatformPlacementExecutor["execute"]>[0]) {
   *   // This host port performs real copy/verification/routing effects.
   *   const evidence = await executor.execute(plan);
   *   return { verification: evidence.verification, cutover: evidence.cutover };
   * }
   * ```
   */
  execute(plan: BackendMigrationPlan): Promise<{
    
    /**
     * Host-reported complete copy verification for the exact reviewed plan.
     */
    verification: BackendMigrationVerificationReport
    
    /**
     * Routing receipt retaining source data for recovery.
     */
    cutover: BackendMigrationCutover
  }>
}

/**
 * Host authentication and live action/tenant authorization for platform administration.
 * 
 * @see PluginLifecycle for canonical integration usage.
 */
export interface PlatformAdminAuthorization {
  /**
   * Resolve verified current operator identity from the request, or null when unauthenticated.
   * @param request - Current authenticated HTTP request; resolve identity through trusted host session verification.
   * @returns The verified platform operator, or null when unauthenticated.
   * @throws Host adapter or callback failures reject the returned Promise; side effects may already be partially complete.
   
   * @example
   * ```typescript
   * import type { PlatformAdminAuthorization } from '@alneas/eaos-server/platform';
   * export async function authenticate(port: PlatformAdminAuthorization, request: Request) {
   *   const principal = await port.resolvePrincipal(request);
   *   return principal?.isPlatformAdmin === true ? principal : null;
   * }
   * ```
   */
  resolvePrincipal(request: Request): Promise<PlatformAdminPrincipal | null>
  /**
   * Check current platform administrator permission for an action and optional concrete tenant; false denies access.
   * @param principal - Verified current platform operator identity.
   * @param action - Specific platform administrative permission to check against live policy.
   * @param tenantId - Verified concrete tenant ID whose current state or permission is requested.
   * @returns True only when live platform action/scope policy permits access.
   * @throws Host adapter or callback failures reject the returned Promise; side effects may already be partially complete.
   
   * @example
   * ```typescript
   * import type { PlatformAdminAuthorization } from '@alneas/eaos-server/platform';
   * export async function canList(port: PlatformAdminAuthorization, request: Request) {
   *   const principal = await port.resolvePrincipal(request);
   *   return principal?.isPlatformAdmin === true && await port.authorize(principal, "tenant:list");
   * }
   * ```
   */
  authorize(principal: PlatformAdminPrincipal, action: PlatformAdminAction, tenantId?: string): Promise<boolean>
}
