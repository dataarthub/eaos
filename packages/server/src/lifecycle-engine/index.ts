import { dataContractTables, resolveDataContracts, type DataContract, type DataContractCatalog } from '@alneas/eaos-core/contracts/data-contracts'
import { createHash } from 'node:crypto'
import { satisfies, valid, validRange, lt } from 'semver'
import { version as packageVersion } from '../../package.json'
import type { BackendMigrationCutover, BackendMigrationPlan, BackendMigrationVerificationReport } from './backend-migration'
/**
 * Installed server package version used as the default lifecycle compatibility version.
 * 
 * @see PluginLifecycle for canonical integration usage.
 */
export const FRAMEWORK_VERSION = packageVersion
/**
 * Supported SQL dialects used to select reviewed migration statements.
 * 
 * @see PluginLifecycle for canonical integration usage.
 */
export type Dialect = 'sqlite' | 'oracle' | 'postgres'
export * from './baseline'
/**
 * Opaque physical database placement and shared/dedicated tenant scope.
 * 
 * @see PluginLifecycle for canonical integration usage.
 */
export interface BackendTarget {
  /**
   * Stable execution backend ID; lifecycle plans reject identity changes under an existing ID.
   */
  id: string;
  /**
   * Opaque physical database identity shared by aliases of the same database; never a DSN.
   */
  databaseId: string;
  /**
   * SQL dialect required by this database and migration history.
   */
  dialect: Dialect;
  /**
   * Shared permits tenant isolation within one database; dedicated binds one tenant.
   */
  mode: 'shared' | 'dedicated';
  /**
   * Required concrete tenant for dedicated mode and forbidden for shared mode.
   */
  tenantId?: string }
/**
 * Immutable reviewed migration statements scoped to a physical database or one tenant.
 * 
 * @see PluginLifecycle for canonical integration usage.
 */
export interface PluginMigration {
  /**
   * Stable unique migration ID whose applied definition must never be rewritten.
   */
  id: string;
  /**
   * Database runs once per physical database; tenant runs once per tenant.
   */
  scope: 'database' | 'tenant';
  /**
   * Dialect-to-ordered-statements map; the target dialect must have nonempty statements.
   */
  sql: Partial<Record<Dialect, string[]>> }
/**
 * Trusted release definition with feature dependencies, schema requirements and immutable migrations.
 * 
 * @see PluginLifecycle for canonical integration usage.
 */
export interface LifecyclePlugin {
  /**
   * Registered feature identifier, up to 128 letters/digits/underscore/hyphen characters starting alphanumeric.
   */
  id: string;
  /**
   * Valid semantic release version; changed contents require a version bump.
   */
  version: string;
  /**
   * Valid semver range for compatible framework versions.
   */
  framework: string
  /**
   * Optional feature ID to semver range dependencies installed/enabled as a closure.
   */
  dependencies?: Record<string, string>
  /**
   * Optional canonical data contract ranges; never installs or enables feature plugins.
   * 
   * Storage dependencies do not install or enable a feature plugin.
   */
  schemaDependencies?: Record<string, string>
  /**
   * Optional canonical releases supplied by a data package; duplicate IDs must agree exactly.
   * 
   * Canonical contract releases supplied by the data package, not inline table copies.
   */
  schemaContracts?: DataContract[]
  /**
   * Append-only reviewed plugin migrations; contract-backed plugins must put DDL in data contracts instead.
   * 
   * Immutable, reviewed migrations generated from the plugin's schema; never rewrite applied IDs.
   */
  migrations: PluginMigration[]
  /**
   * Optional nonsecret declarative host requirements; absence causes no infrastructure work.
   * 
   * Declarative, host-defined resource requirements. No secrets. Absence means no infrastructure changes.
   */
  infrastructure?: Record<string, unknown>
}
/**
 * Lifecycle change to installation or tenant activation; disable/uninstall retain business data.
 * 
 * @see PluginLifecycle for canonical integration usage.
 */
export type Operation = 'install' | 'update' | 'enable' | 'disable' | 'uninstall'
/**
 * Concrete lifecycle operation scoped to one registered backend and verified tenant.
 * 
 * @see PluginLifecycle for canonical integration usage.
 */
export interface LifecycleRequest {
  /**
   * Requested install/update/enable/disable/uninstall transition.
   */
  operation: Operation;
  /**
   * Registered plugin ID, or bundle ID for bundle planning.
   */
  pluginId: string;
  /**
   * Registered execution backend ID.
   */
  backendId: string;
  /**
   * Verified concrete tenant; must match dedicated backend scope.
   */
  tenantId: string }
/**
 * Durable per-database/tenant migration progress and immutable definition checksum.
 * 
 * @see PluginLifecycle for canonical integration usage.
 */
export interface MigrationRecord {
  /**
   * Physical database on which the migration executes.
   */
  databaseId: string;
  /**
   * Plugin or canonical data-contract migration identity.
   */
  pluginId: string;
  /**
   * Immutable migration definition ID.
   */
  migrationId: string;
  /**
   * Zero-based position in the append-only migration history.
   */
  position: number;
  /**
   * Concrete tenant for tenant-scoped work, or null for database scope.
   */
  tenantId: string | null;
  /**
   * Canonical definition digest used to detect rewritten applied SQL.
   */
  checksum: string;
  /**
   * Running/applied/failed progress; running and failed require reconciliation before planning further changes.
   */
  status: 'running' | 'applied' | 'failed' }
/**
 * Registered release snapshot and progress stored for one backend/plugin.
 * 
 * @see PluginLifecycle for canonical integration usage.
 */
export interface Installation {
  /**
   * Copied trusted plugin release installed on this backend.
   */
  release: LifecyclePlugin;
  /**
   * Canonical digest of the release snapshot.
   */
  digest: string;
  /**
   * Installing/installed/failed progress; noninstalled records require reconciliation.
   */
  status: 'installing' | 'installed' | 'failed' }
/**
 * Durable platform tenant metadata independent of business schemas.
 * 
 * @see PluginLifecycle for canonical integration usage.
 */
export interface LifecyclePlatformTenant {
  /**
   * Stable concrete tenant ID.
   */
  id: string;
  /**
   * Public tenant display name.
   */
  name: string;
  /**
   * Whether platform tenant admission is enabled; membership remains host-owned.
   */
  active: boolean;
  /**
   * Configured tenant lookup domains; domain mapping alone never proves membership.
   */
  domains: readonly string[];
  /**
   * Tenant creation timestamp.
   */
  createdAt: string;
  /**
   * Latest metadata update timestamp.
   */
  updatedAt: string }
/**
 * Durable tenant-to-backend routing assignment with optimistic routing revision.
 * 
 * @see PluginLifecycle for canonical integration usage.
 */
export interface LifecyclePlatformPlacement {
  /**
   * Verified tenant whose traffic is routed.
   */
  tenantId: string;
  /**
   * Opaque configured backend receiving traffic.
   */
  backendId: string;
  /**
   * Nonnegative revision used to track routing changes.
   */
  routingRevision: number;
  /**
   * Timestamp of the recorded routing switch.
   */
  changedAt: string }
/**
 * Nonsecret descriptive metadata for an existing backend.
 * 
 * @see PluginLifecycle for canonical integration usage.
 */
export interface LifecyclePlatformBackendMetadata {
  /**
   * Optional public display label.
   */
  label?: string;
  /**
   * Optional provider descriptor; never credentials or DSNs.
   */
  provider?: string;
  /**
   * Optional declared host capability names, not permission grants.
   */
  capabilities?: readonly string[] }
/**
 * Persisted migration progress including uncertainty, failure, reconciliation and rollback states.
 * 
 * @see PluginLifecycle for canonical integration usage.
 */
export type LifecyclePlatformMigrationStatus = 'planned' | 'running' | 'verified' | 'cutover' | 'failed' | 'reconciling' | 'rolled-back'
/**
 * Durable migration execution, verification and reconciliation evidence.
 * 
 * @see PluginLifecycle for canonical integration usage.
 */
export interface LifecyclePlatformMigrationRecord {
  /**
   * Current progress; reconciling represents uncertain execution outcomes.
   */
  status: LifecyclePlatformMigrationStatus
  /**
   * Optional identity claiming the host migration execution.
   */
  executionId?: string
  /**
   * Optional host-reported verification matching the migration plan.
   */
  verification?: BackendMigrationVerificationReport
  /**
   * Optional source-retaining cutover receipt.
   */
  cutover?: BackendMigrationCutover
  /**
   * Optional failure message and occurrence timestamp; exclude secrets.
   */
  error?: { 
    /**
     * Nonsecret failure description retained for operator reconciliation.
     */
    message: string; 
    /**
     * Timestamp at which the error was recorded.
     */
    occurredAt: string }
  /**
   * Timestamp of the latest migration-state change.
   */
  updatedAt: string
  /**
   * Optional original migration ID when this is a rollback execution.
   */
  rollbackOf?: string
  /**
   * Optional reviewed reverse plan associated with this migration.
   */
  rollbackPlanId?: string
}
/**
 * Platform-owned tenant, backend and migration control maps stored with the lifecycle ledger.
 * 
 * @see PluginLifecycle for canonical integration usage.
 */
export interface LifecyclePlatformState {
  /**
   * Tenant records indexed by tenant ID.
   */
  tenants: Record<string, LifecyclePlatformTenant>
  /**
   * Current routing assignments indexed by tenant ID.
   */
  placements: Record<string, LifecyclePlatformPlacement>
  /**
   * Nonsecret backend labels/provider capabilities indexed by backend ID.
   */
  backendMetadata: Record<string, LifecyclePlatformBackendMetadata>
  /**
   * Reviewed backend migration plans indexed by migration ID.
   */
  migrationPlans: Record<string, BackendMigrationPlan>
  /**
   * Execution/reconciliation records indexed by migration ID.
   */
  migrationRecords: Record<string, LifecyclePlatformMigrationRecord>
}
/**
 * Versioned durable control ledger for plugin readiness, schema history and platform placement.
 * 
 * @see PluginLifecycle for canonical integration usage.
 */
export interface LifecycleState {
  /**
   * Optional archived exact histories replaced by reviewed baselines.
   */
  baselineHistory?: Record<string, { 
    /**
     * Exact archived baseline integrity hash.
     */
    hash: string; 
    /**
     * Original canonical contract release retained for historical evidence.
     */
    source: DataContract; 
    /**
     * Archived exact applied migration receipts.
     */
    migrations: Record<string, MigrationRecord> }>
  /**
   * Persistent ledger discriminator; currently 1.
   */
  format: 1;
  /**
   * Nonnegative safe integer incremented on persisted lifecycle changes.
   */
  revision: number
  /**
   * Opaque backend target definitions indexed by backend ID.
   */
  backends: Record<string, BackendTarget>
  /**
   * Release snapshots indexed by JSON [backendId, pluginId].
   */
  installations: Record<string, Installation>
  /**
   * Requested tenant activation records indexed by JSON [backendId, tenantId, pluginId]; effective readiness is checked separately.
   */
  activations: Record<string, { 
    /**
     * Registered execution backend owning this activation.
     */
    backendId: string; 
    /**
     * Concrete verified tenant owning this activation.
     */
    tenantId: string; 
    /**
     * Registered feature ID requested for activation.
     */
    pluginId: string; 
    /**
     * Canonical release or infrastructure definition digest.
     */
    digest: string; 
    /**
     * Requested activation flag; effective readiness also requires matching installed digests and dependencies.
     */
    enabled: boolean }>
  /**
   * Progress indexed by JSON [databaseId, migrationIdentity, migrationId, tenantId-or-*].
   */
  migrations: Record<string, MigrationRecord>
  /**
   * Infrastructure digests/progress indexed by JSON [backendId, pluginId].
   */
  infrastructure: Record<string, { 
    /**
     * Canonical release or infrastructure definition digest.
     */
    digest: string; 
    /**
     * Persisted installing/installed/failed or running/applied/failed progress, according to this ledger map.
     */
    status: 'running' | 'applied' | 'failed' }>
  /**
   * Tenant/control-plane metadata and backend migration evidence.
   */
  platform: LifecyclePlatformState
  /**
   * Optional canonical contract installation records indexed by JSON [databaseId, contractId].
   */
  dataContracts?: Record<string, { 
    /**
     * Canonical schema contract release bound by its stored digest.
     */
    contract: DataContract; 
    /**
     * Canonical release or infrastructure definition digest.
     */
    digest: string; 
    /**
     * Persisted installing/installed/failed or running/applied/failed progress, according to this ledger map.
     */
    status: 'installing' | 'installed' | 'failed' }>
}
/**
 * Atomic lifecycle snapshot access made available inside the host's exclusive lock.
 * 
 * @see PluginLifecycle for canonical integration usage.
 */
export interface LifecycleWriter {
  /**
   * Read the currently committed ledger snapshot; must not expose uncommitted writes.
   * @returns The currently committed atomic ledger snapshot.
   * @throws Host adapter or callback failures reject the returned Promise; side effects may already be partially complete.
   
   * @example
   * ```typescript
   * import type { LifecycleStore } from '@alneas/eaos-server/lifecycle-engine';
   * export async function readLocked(store: LifecycleStore) {
   *   return store.withLock(async writer => writer.read());
   * }
   * ```
   */
  read(): Promise<LifecycleState>;
  /**
   * Atomically persist the complete next snapshot; resolve only after durable completion.
   * @param state - Complete next ledger snapshot with updated revision and control metadata.
   * @returns Resolves without a value after the complete snapshot is durably committed.
   * @throws Host adapter or callback failures reject the returned Promise; side effects may already be partially complete.
   
   * @example
   * ```typescript
   * import type { LifecycleStore } from '@alneas/eaos-server/lifecycle-engine';
   * export async function persistReviewedRevision(store: LifecycleStore) {
   *   await store.withLock(async writer => {
   *     const state = await writer.read();
   *     // Domain changes belong in the same reviewed writer callback.
   *     state.revision += 1;
   *     await writer.write(state);
   *   });
   * }
   * ```
   */
  write(state: LifecycleState): Promise<void> }
/**
 * Durable lifecycle reads and cross-process exclusive writer coordination.
 * 
 * 
 * withLock must exclude every other writer, across processes. Reads must observe atomic committed snapshots.
 * @see PluginLifecycle for canonical integration usage.
 */
export interface LifecycleStore extends Pick<LifecycleWriter, 'read'> {
  /**
   * Exclude every competing writer across processes and hold the lock until the async callback settles; release on success or failure.
   * @param fn - Async work invoked only while holding exclusive writer ownership; receives atomic read/write capabilities.
   * @typeParam T - Result resolved by the exclusive-lock callback.
   * @returns The callback result after its lock is released; the lock is also released on failure.
   * @throws Host adapter or callback failures reject the returned Promise; side effects may already be partially complete.
   
   * @example
   * ```typescript
   * import type { LifecycleStore } from '@alneas/eaos-server/lifecycle-engine';
   * export async function snapshot(store: LifecycleStore) {
   *   return store.withLock(async writer => writer.read());
   * }
   * ```
   */
  withLock<T>(fn: (writer: LifecycleWriter) => Promise<T>): Promise<T> }
/**
 * Planned migration ledger identity and ordered SQL to execute on one physical target.
 * 
 * @see PluginLifecycle for canonical integration usage.
 */
export interface MigrationStep {
  /**
   * Exact ledger map key for this migration and scope.
   */
  key: string;
  /**
   * Initial running migration receipt with immutable checksum.
   */
  record: MigrationRecord;
  /**
   * Reviewed target-dialect SQL executed in order by the host migrate adapter.
   */
  statements: string[] }
/**
 * Planned host infrastructure change bound to the release and backend digest.
 * 
 * @see PluginLifecycle for canonical integration usage.
 */
export interface InfrastructureStep {
  /**
   * Infrastructure ledger key for backend/plugin.
   */
  key: string;
  /**
   * Canonical digest binding backend and plugin infrastructure configuration.
   */
  digest: string;
  /**
   * Trusted plugin release declaring infrastructure requirements.
   */
  plugin: LifecyclePlugin;
  /**
   * Exact target whose resources are previewed/applied.
   */
  backend: BackendTarget }
/**
 * Reviewable hash-bound lifecycle transition generated against one ledger revision.
 * 
 * @see PluginLifecycle for canonical integration usage.
 */
export interface LifecyclePlan {
  /**
   * Plan discriminator; currently 1.
   */
  format: 1;
  /**
   * Canonical SHA-256 hash of all plan body fields.
   */
  id: string;
  /**
   * Ledger revision observed during planning; apply rejects stale plans.
   */
  revision: number;
  /**
   * Framework compatibility version used to resolve the plan.
   */
  frameworkVersion: string;
  /**
   * Original scoped operation request.
   */
  request: LifecycleRequest;
  /**
   * Snapshot of the exact immutable backend identity.
   */
  backend: BackendTarget
  /**
   * Optional dependency-resolved canonical data contracts and table ownership.
   */
  dataCatalog?: DataContractCatalog
  /**
   * Dependency-ordered trusted feature releases involved in the transition.
   */
  plugins: LifecyclePlugin[];
  /**
   * Ordered migration steps not already applied with matching checksums.
   */
  migrations: MigrationStep[];
  /**
   * Planned host infrastructure changes requiring the configured executor.
   */
  infrastructure: InfrastructureStep[]
  /**
   * Activation map keys disabled before disruptive changes.
   */
  deactivate: string[];
  /**
   * Configured executor identity, or null when none exists.
   */
  infrastructureProvider: string | null;
  /**
   * Always true; lifecycle uninstall never drops business data.
   */
  retainData: true
}
/**
 * Host-provided trusted release catalogs, durable lifecycle storage and side-effect adapters.
 * 
 * @see PluginLifecycle for canonical integration usage.
 */
export interface LifecycleProject {
  /**
   * Cross-process locked atomic durable lifecycle store.
   */
  store: LifecycleStore;
  /**
   * Trusted configured backend catalog; existing physical identities are immutable.
   */
  backends: BackendTarget[];
  /**
   * Trusted registered plugin releases; registration alone grants no tenant activation.
   */
  plugins: LifecyclePlugin[]
  /**
   * Optional canonical schema contract releases, also collected from plugin schemaContracts.
   * 
     */
  dataContracts?: readonly DataContract[]
  /**
   * Optional host aliases mapping bundle IDs to ordered registered feature IDs.
   */
  bundles?: Record<string, readonly string[]>
  /**
   * Execute one reviewed migration step on the exact backend; reject failures so reconciliation state is recorded.
   * @param step - Exact planned infrastructure step and target digest; do not reinterpret unreviewed settings.
   * @param backend - Already-provisioned opaque backend declaration; never a connection string or credentials.
   * @returns Resolves without a value after the reviewed host side effect completes.
   * @throws Host adapter or callback failures reject the returned Promise; side effects may already be partially complete.
   */
  migrate: (step: MigrationStep, backend: BackendTarget) => Promise<void>
  /**
   * Optional all-instance admission stop and active-work drain; required before upgrades affecting enabled activations.
   * 
   * Stop admission and drain existing work on ALL affected backend instances before upgrades.
   * @param activations - Host operation input bound to the scope described by this member.
   * @returns Resolves without a value after the reviewed host side effect completes.
   * @throws Host adapter or callback failures reject the returned Promise; side effects may already be partially complete.
   */
  quiesce?: (activations: LifecycleState['activations'][string][]) => Promise<void>
  /**
   * Optional named host preview/apply capability; no credentials belong in declarative plugin settings.
   */
  infrastructure?: { 
    /**
     * Stable nonsecret infrastructure-provider identity bound into reviewed plans.
     */
    identity: string; 
    /**
     * Preview one exact infrastructure step; host must not claim application completion from preview.
     * @param step - Exact reviewed infrastructure step for the configured backend.
     * @returns Host preview information; no apply result is implied.
     * @throws Rejects host adapter failures; effects may already have partially completed.
     
     * @example
     * ```typescript
     * import type { LifecycleProject, InfrastructureStep } from '@alneas/eaos-server/lifecycle-engine';
     * export async function previewInfrastructure(project: LifecycleProject, step: InfrastructureStep) {
     *   if (!project.infrastructure) throw new Error("Host infrastructure port required");
     *   return project.infrastructure.preview(step);
     * }
     * ```
     */
    preview(step: InfrastructureStep): Promise<unknown>; 
    /**
     * Apply one reviewed infrastructure step; errors leave reconciliation state and may follow partial external success.
     * @param step - Exact reviewed infrastructure step for the configured backend.
     * @returns Resolves without a value after host application completes.
     * @throws Rejects host adapter failures; effects may already have partially completed.
     
     * @example
     * ```typescript
     * import type { LifecycleProject, InfrastructureStep } from '@alneas/eaos-server/lifecycle-engine';
     * export async function applyInfrastructure(project: LifecycleProject, step: InfrastructureStep) {
     *   if (!project.infrastructure) throw new Error("Host infrastructure port required");
     *   await project.infrastructure.apply(step);
     * }
     * ```
     */
    apply(step: InfrastructureStep): Promise<void> }
}
/**
 * One registered or historical plugin/backend pair with requested and effective tenant readiness.
 * 
 * @see PluginLifecycle for canonical integration usage.
 */
export interface LifecycleInventoryEntry {
  /**
   * Registered or historically recorded plugin ID.
   */
  pluginId: string
  /**
   * Backend associated with the entry, or null when no backend is known.
   */
  backendId: string | null
  /**
   * Whether this backend remains in the trusted runtime catalog.
   */
  backendConfigured: boolean
  /**
   * Current registered code version, or null for orphaned history.
   */
  registeredVersion: string | null
  /**
   * Stored installation version, or null before installation.
   */
  installedVersion: string | null
  /**
   * Stored progress or not-installed.
   */
  installationStatus: Installation['status'] | 'not-installed'
  /**
   * Whether stored digest matches registered code, or null without installation.
   */
  releaseMatches: boolean | null
  /**
   * Tenant requestedEnabled flags and effective enabled readiness results.
   */
  tenants: { 
    /**
     * Concrete tenant whose activation is inspected.
     */
    tenantId: string; 
    /**
     * Stored requested activation flag without readiness guarantees.
     */
    requestedEnabled: boolean; 
    /**
     * Effective lifecycle readiness for the registered release and dependency closure.
     */
    enabled: boolean }[]
}
/**
 * Read-only revision-bound plugin inventory including code-only and orphaned entries.
 * 
 * @see PluginLifecycle for canonical integration usage.
 */
export interface LifecycleInventory {
  /**
   * Inventory discriminator; currently 1.
   */
  format: 1
  /**
   * Ledger snapshot revision inspected.
   */
  revision: number
  /**
   * Framework compatibility version used for readiness.
   */
  frameworkVersion: string
  /**
   * Deterministically ordered plugin/backend inventory entries, possibly empty.
   */
  plugins: LifecycleInventoryEntry[]
}
/**
 * Reviewable ordered collection of member plans with projected sequential ledger revisions.
 * 
 * @see PluginLifecycle for canonical integration usage.
 */
export interface LifecycleBundlePlan {
  /**
   * Bundle discriminator; currently 1.
   */
  format: 1;
  /**
   * Canonical digest of bundle identity, operation and member plans.
   */
  id: string;
  /**
   * Registered host bundle alias.
   */
  bundleId: string;
  /**
   * Transition applied to every bundle member.
   */
  operation: Operation;
  /**
   * Dependency-compatible member order; reversed for disable/uninstall.
   */
  plans: LifecyclePlan[] }
export * from './backend-migration'
export * from '@alneas/eaos-core/contracts/data-contracts'
export { dataContractTables, resolveDataContracts, assertDataContractBinding, collectSchemaMigrations, createJsonDocumentAssertion, assertJsonDocumentContracts } from '@alneas/eaos-core/contracts/data-contracts'
/**
 * Creates independent empty platform tenant, placement and migration maps.
 * @returns A new mutable platform-state object.
 * 
 * @example
 * ```typescript
 * import { emptyLifecyclePlatformState } from '@alneas/eaos-server/lifecycle-engine';
 * const platform = emptyLifecyclePlatformState();
 * ```
 */
export const emptyLifecyclePlatformState = (): LifecyclePlatformState => ({ tenants: {}, placements: {}, backendMetadata: {}, migrationPlans: {}, migrationRecords: {} })
/**
 * Creates an independent empty version-1 ledger with revision zero and platform state.
 * @returns A new mutable LifecycleState with empty maps; no persistence is performed.
 * 
 * @example
 * ```typescript
 * import { emptyLifecycleState } from '@alneas/eaos-server/lifecycle-engine';
 * const state = emptyLifecycleState();
 * ```
 */
export const emptyLifecycleState = (): LifecycleState => ({ format: 1, revision: 0, backends: {}, installations: {}, activations: {}, migrations: {}, infrastructure: {}, platform: emptyLifecyclePlatformState() })
/**
 * Clones a historical ledger snapshot and fills missing platform maps without rewriting storage.
 * 
 * Add fields introduced after the original snapshot format without rewriting old control rows on read.
 * @param input - Historical state snapshot to normalize.
 * @returns A structured clone with a complete platform object; unrelated state validation remains the caller's responsibility.
 * @throws Error for nonobject input or malformed platform/maps; structuredClone errors propagate.
 * 
 * @example
 * ```typescript
 * import { emptyLifecycleState, normalizeLifecycleState } from '@alneas/eaos-server/lifecycle-engine';
 * const state = normalizeLifecycleState(emptyLifecycleState());
 * ```
 */
export function normalizeLifecycleState(input: LifecycleState): LifecycleState {
  if (!input || typeof input !== 'object') throw new Error('Invalid lifecycle state')
  const state = structuredClone(input) as LifecycleState
  if (state.platform === undefined) state.platform = emptyLifecyclePlatformState()
  if (!state.platform || typeof state.platform !== 'object' || Array.isArray(state.platform)) throw new Error('Invalid lifecycle platform state')
  for (const field of ['tenants', 'placements', 'backendMetadata', 'migrationPlans', 'migrationRecords'] as const) {
    if (state.platform[field] === undefined) state.platform[field] = {}
    if (!state.platform[field] || typeof state.platform[field] !== 'object' || Array.isArray(state.platform[field])) throw new Error(`Invalid lifecycle platform ${field}`)
  }
  return state
}
/**
 * Serializes JSON-compatible lifecycle values with recursively sorted object keys.
 * @param value - JSON-serializable primitives, arrays or plain/null-prototype objects; avoid cycles and nonfinite numbers.
 * @returns Deterministic JSON text; array order is preserved.
 * @throws Error for unsupported values/prototypes, JSON serialization failure or recursive cycles.
 * 
 * @remarks
 * Uses JSON.stringify primitive semantics, including null for nonfinite numbers. It does not accept undefined/function/symbol values or class instances. Cyclic graphs are unsupported.
 * 
 * @example
 * ```typescript
 * import { canonical } from '@alneas/eaos-server/lifecycle-engine';
 * const serialized = canonical({ b: [2, 1], a: true });
 * ```
 */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const result = JSON.stringify(value)
    if (result === undefined) throw new Error('Lifecycle configuration must be JSON serializable')
    return result
  }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('Lifecycle configuration must contain plain objects')
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical((value as any)[k])).join(',') + '}'
}
/**
 * Computes a lowercase SHA-256 digest of the canonical lifecycle JSON representation.
 * @param value - Supported canonical JSON lifecycle configuration.
 * @returns A 64-character lowercase hexadecimal digest.
 * @throws Propagates canonical serialization errors for unsupported values.
 * 
 * @remarks
 * Requires Node crypto; the digest proves content identity, not authorization or authenticity.
 * 
 * @example
 * ```typescript
 * import { lifecycleDigest } from '@alneas/eaos-server/lifecycle-engine';
 * const digest = lifecycleDigest({ pluginId: 'reports', version: '1.0.0' });
 * ```
 */
export const lifecycleDigest = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex')
const key = (...parts: string[]) => JSON.stringify(parts)
function id(value: string): void { if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)) throw new Error('Invalid lifecycle identifier') }
function assertState(s: LifecycleState): void {
  if (s?.format !== 1 || !Number.isSafeInteger(s.revision) || s.revision < 0 || !s.backends || !s.installations || !s.activations || !s.migrations || !s.infrastructure) throw new Error('Invalid lifecycle state')
  if (s.dataContracts !== undefined) {
    if (!s.dataContracts || typeof s.dataContracts !== 'object' || Array.isArray(s.dataContracts)) throw new Error('Invalid data contract state')
    for (const [recordKey, record] of Object.entries(s.dataContracts)) {
      const parts = JSON.parse(recordKey)
      if (!Array.isArray(parts) || parts.length !== 2 || parts[1] !== record.contract?.id || record.digest !== lifecycleDigest(record.contract) || !['installing', 'installed', 'failed'].includes(record.status)) throw new Error('Invalid data contract state record')
    }
  }
}
/**
 * Plans and applies checksum-bound plugin/schema changes against an exclusively locked host ledger.
 * 
 * @remarks
 * Server runtime uses Node crypto and semver. The host provides durable cross-process locking, tenant authorization, SQL migration execution and any infrastructure/quiesce adapters. Installation never implies tenant enablement; disable/uninstall retain data. Migration/infrastructure failures persist reconciliation state, and DDL is not rolled back automatically.
 * 
 * @example
 * ```typescript
 * import { PluginLifecycle, type LifecycleProject } from '@alneas/eaos-server/lifecycle-engine';
 * export function connectLifecycle(project: LifecycleProject) { return new PluginLifecycle(project); }
 * ```
 */
export class PluginLifecycle {
  private readonly plugins: Map<string, LifecyclePlugin>
  private readonly backends: Map<string, BackendTarget>
  private readonly contracts: DataContract[]
  /**
   * Validates and snapshots the registered plugin, backend, contract and bundle catalogs.
   * @param project - Host lifecycle storage, trusted catalogs and execution adapters.
   * @param frameworkVersion - Valid semver framework version; defaults to the installed package version.
   * @throws Error for invalid/duplicate IDs, versions, migrations, conflicting schemas, unsupported backend configuration or unsatisfied contract dependencies.
   * 
   * @example
   * ```typescript
   * import { PluginLifecycle, type LifecycleProject } from '@alneas/eaos-server/lifecycle-engine';
   * export function connectLifecycle(project: LifecycleProject) { return new PluginLifecycle(project); }
   * ```
   */
  constructor(private readonly project: LifecycleProject, readonly frameworkVersion = FRAMEWORK_VERSION) {
    if (!valid(frameworkVersion)) throw new Error('Invalid framework version')
    const plugins = JSON.parse(canonical(project.plugins)) as LifecyclePlugin[]
    const backends = JSON.parse(canonical(project.backends)) as BackendTarget[]
    this.plugins = new Map(); this.backends = new Map()
    for (const p of plugins) {
      id(p.id)
      if (this.plugins.has(p.id) || !valid(p.version) || !validRange(p.framework)) throw new Error('Invalid or duplicate plugin release')
      if ((project.dataContracts !== undefined || Object.keys(p.schemaDependencies ?? {}).length) && p.migrations.length) throw new Error(`Contract-backed plugin must put DDL in data contracts: ${p.id}`)
      const migrations = new Set<string>()
      for (const m of p.migrations) {
        id(m.id)
        if (migrations.has(m.id) || !['database', 'tenant'].includes(m.scope)) throw new Error('Invalid or duplicate migration')
        for (const sql of Object.values(m.sql)) if (!Array.isArray(sql) || !sql.length || sql.some(s => typeof s !== 'string' || !s.trim())) throw new Error('Invalid migration SQL')
        migrations.add(m.id)
      }
      const release = { ...p }; delete release.schemaContracts
      this.plugins.set(p.id, release)
    }
    const contracts = new Map<string, DataContract>()
    for (const contract of [...(project.dataContracts ?? []), ...plugins.flatMap(p => p.schemaContracts ?? [])]) {
      const previous = contracts.get(contract.id)
      if (previous && canonical(previous) !== canonical(contract)) throw new Error(`Conflicting data contract definitions: ${contract.id}`)
      contracts.set(contract.id, JSON.parse(canonical(contract)))
    }
    this.contracts = [...contracts.values()]
    resolveDataContracts(this.contracts, Object.fromEntries(this.contracts.map(c => [c.id, c.version])))
    for (const p of plugins) this.catalog([p])
    for (const [bundleId, pluginIds] of Object.entries(project.bundles ?? {})) {
      id(bundleId)
      if (!Array.isArray(pluginIds) || !pluginIds.length || new Set(pluginIds).size !== pluginIds.length || pluginIds.some(pluginId => !this.plugins.has(pluginId))) throw new Error(`Invalid plugin bundle: ${bundleId}`)
    }
    for (const b of backends) {
      id(b.id); id(b.databaseId)
      if (this.backends.has(b.id) || !['sqlite', 'oracle', 'postgres'].includes(b.dialect) || !['shared', 'dedicated'].includes(b.mode)) throw new Error('Invalid backend target')
      if (b.mode === 'dedicated') { if (!b.tenantId) throw new Error('Dedicated backend requires tenant'); id(b.tenantId) }
      else if (b.tenantId !== undefined) throw new Error('Shared backend cannot bind a tenant')
      for (const other of backends) if (other.databaseId === b.databaseId && other.dialect !== b.dialect) throw new Error('Database dialect conflict')
      this.backends.set(b.id, b)
    }
  }
  private bundle(bundleId: string): readonly string[] {
    id(bundleId)
    const pluginIds = this.project.bundles?.[bundleId]
    if (!pluginIds) throw new Error(`Plugin bundle not registered: ${bundleId}`)
    return pluginIds
  }
  /**
   * Plans registered bundle members sequentially against a projected ledger state.
   * @param request - Lifecycle request whose pluginId names a registered bundle.
   * @returns A checksum-bound ordered bundle plan with each member's projected revision.
   * @throws Rejects unknown bundle, invalid member request/state or propagated store failures.
   * 
   * @remarks
   * Disable/uninstall reverse bundle order. Planning executes no migrations or writes; projected revisions mirror member apply ordering.
   * 
   * @example
   * ```typescript
   * import { PluginLifecycle, type LifecycleRequest } from '@alneas/eaos-server/lifecycle-engine';
   * export function reviewBundle(lifecycle: PluginLifecycle, request: LifecycleRequest) { return lifecycle.planBundle(request); }
   * ```
   */
  async planBundle(request: LifecycleRequest): Promise<LifecycleBundlePlan> {
    const pluginIds = [...this.bundle(request.pluginId)]
    if (request.operation === 'disable' || request.operation === 'uninstall') pluginIds.reverse()
    let projected = await this.project.store.read()
    const plans: LifecyclePlan[] = []
    for (const pluginId of pluginIds) {
      const plan = this.makePlan({ ...request, pluginId }, projected)
      plans.push(plan)
      projected = this.projectBundleState(projected, plan)
    }
    const body = { format: 1 as const, bundleId: request.pluginId, operation: request.operation, plans }
    return JSON.parse(canonical({ ...body, id: lifecycleDigest(body) }))
  }

  /**
   * Advance the read-only state used while constructing sequential bundle plans.
   * apply() performs these writes in the same order; mirroring them here keeps
   * each plan's revision and dependency closure valid when applyBundle() runs.
   */
  private projectBundleState(source: LifecycleState, plan: LifecyclePlan): LifecycleState {
    const state = structuredClone(source)
    state.backends[plan.backend.id] = plan.backend
    for (const k of plan.deactivate) if (state.activations[k]) state.activations[k].enabled = false

    if (plan.request.operation === 'install' || plan.request.operation === 'update') {
      for (const plugin of plan.plugins) state.installations[key(plan.backend.id, plugin.id)] = { release: plugin, digest: lifecycleDigest(plugin), status: 'installed' }
      if (plan.dataCatalog) {
        state.dataContracts ??= {}
        for (const contract of plan.dataCatalog.contracts) state.dataContracts[key(plan.backend.databaseId, contract.id)] = { contract, digest: lifecycleDigest(contract), status: 'installed' }
      }
      for (const step of plan.migrations) state.migrations[step.key] = { ...step.record, status: 'applied' }
      for (const step of plan.infrastructure) state.infrastructure[step.key] = { digest: step.digest, status: 'applied' }
      state.revision += 2 + (plan.migrations.length * 2) + (plan.infrastructure.length * 2)
    } else if (plan.request.operation === 'enable') {
      for (const plugin of plan.plugins) state.activations[key(plan.backend.id, plan.request.tenantId, plugin.id)] = { backendId: plan.backend.id, tenantId: plan.request.tenantId, pluginId: plugin.id, digest: lifecycleDigest(plugin), enabled: true }
      state.revision += 1
    } else if (plan.request.operation === 'uninstall') {
      delete state.installations[key(plan.backend.id, plan.request.pluginId)]
      state.revision += 1
    } else {
      state.revision += 1
    }
    return state
  }
  /**
   * Validates a reviewed bundle plan and applies its member plans in sequence.
   * @param bundlePlan - Unmodified checksum-bound bundle plan from planBundle.
   * @returns Resolves without a value after every member apply completes.
   * @throws Rejects modified/stale/misordered bundle plans, member apply failures and propagated host errors.
   * 
   * @remarks
   * Members acquire their own ledger locks. There is no all-or-nothing bundle transaction; earlier members remain applied if a later member fails. Replan/reconcile before retrying uncertain outcomes.
   * 
   * @example
   * ```typescript
   * import { PluginLifecycle, type LifecycleBundlePlan } from '@alneas/eaos-server/lifecycle-engine';
   * export function applyReviewedBundle(lifecycle: PluginLifecycle, plan: LifecycleBundlePlan) { return lifecycle.applyBundle(plan); }
   * ```
   */
  async applyBundle(bundlePlan: LifecycleBundlePlan): Promise<void> {
    const normalized = JSON.parse(canonical(bundlePlan)) as LifecycleBundlePlan
    const pluginIds = this.bundle(normalized.bundleId)
    const expectedIds = normalized.operation === 'disable' || normalized.operation === 'uninstall' ? [...pluginIds].reverse() : [...pluginIds]
    if (normalized.format !== 1 || !['install', 'update', 'enable', 'disable', 'uninstall'].includes(normalized.operation) || normalized.plans.length !== expectedIds.length || normalized.plans.some((plan, index) => plan.request.pluginId !== expectedIds[index] || plan.request.operation !== normalized.operation)) throw new Error('Invalid plugin bundle plan')
    const body = { format: 1 as const, bundleId: normalized.bundleId, operation: normalized.operation, plans: normalized.plans }
    if (lifecycleDigest(body) !== normalized.id) throw new Error('Stale or modified plugin bundle plan')
    for (const plan of normalized.plans) await this.apply(plan)
  }
  private release(id: string): LifecyclePlugin {
    const p = this.plugins.get(id)
    if (!p) throw new Error(`Plugin code not registered: ${id}`)
    if (!satisfies(this.frameworkVersion, p.framework, { includePrerelease: true })) throw new Error(`Incompatible framework for ${id}`)
    return p
  }
  private order(pluginId: string): LifecyclePlugin[] {
    const ordered: LifecyclePlugin[] = [], visited = new Set<string>(), visiting = new Set<string>()
    const visit = (id: string) => {
      if (visiting.has(id)) throw new Error('Plugin dependency cycle')
      if (visited.has(id)) return
      visiting.add(id)
      const p = this.release(id)
      for (const [dependency, range] of Object.entries(p.dependencies ?? {})) {
        if (!validRange(range) || !satisfies(this.release(dependency).version, range, { includePrerelease: true })) throw new Error(`Unsatisfied dependency: ${dependency}`)
        visit(dependency)
      }
      visiting.delete(id); visited.add(id); ordered.push(p)
    }
    visit(pluginId); return ordered
  }
  /**
   * Resolves the canonical schema dependency catalog for registered feature plugins.
   * 
   * Read-only complete schema inventory for the selected trusted feature catalog.
   * @param pluginIds - Optional feature IDs; omitted includes all registered plugins, while an empty array selects none.
   * @returns A JSON-cloned dependency-resolved DataContractCatalog.
   * @throws Error for unknown/incompatible feature dependencies or invalid/conflicting contract requirements.
   * 
   * @remarks
   * Read-only; schema dependencies never install or enable feature plugins.
   * 
   * @example
   * ```typescript
   * import { PluginLifecycle } from '@alneas/eaos-server/lifecycle-engine';
   * export function schemas(lifecycle: PluginLifecycle) { return lifecycle.schemaCatalog(); }
   * ```
   */
  schemaCatalog(pluginIds?: readonly string[]): DataContractCatalog {
    const plugins = pluginIds ? pluginIds.flatMap(id => this.order(id)) : [...this.plugins.values()]
    return JSON.parse(canonical(this.catalog(plugins)))
  }
  private catalog(plugins: LifecyclePlugin[]): DataContractCatalog {
    const requirements: Record<string, string> = {}
    // Check each range independently; combining plugins must never discard a constraint.
    for (const plugin of plugins) {
      resolveDataContracts(this.contracts, plugin.schemaDependencies ?? {})
      Object.assign(requirements, plugin.schemaDependencies ?? {})
    }
    return resolveDataContracts(this.contracts, requirements)
  }
  private contractReady(state: LifecycleState, backend: BackendTarget, tenantId: string, contract: DataContract): boolean {
    const installed = state.dataContracts?.[key(backend.databaseId, contract.id)]
    if (installed?.status !== 'installed' || installed.digest !== lifecycleDigest(contract)) return false
    const identity = contract.migrationIdentity ?? `data-${contract.id}`
    return contract.migrations.every(m => {
      const record = state.migrations[key(backend.databaseId, identity, m.id, m.scope === 'tenant' ? tenantId : '*')]
      return record?.status === 'applied' && record.checksum === lifecycleDigest(m)
    })
  }
  /** Contract ledger identities may retain a feature's historical name even
   * when that feature no longer consumes the contract. Match the actual
   * immutable migration, rather than only the current feature's catalog. */
  private isContractMigration(record: MigrationRecord): boolean {
    return this.contracts.some(contract => {
      if ((contract.migrationIdentity ?? `data-${contract.id}`) !== record.pluginId) return false
      const migration = contract.migrations[record.position]
      return !!migration && migration.id === record.migrationId && lifecycleDigest(migration) === record.checksum && record.status === 'applied'
    })
  }
  private target(request: LifecycleRequest): BackendTarget {
    id(request.pluginId); id(request.backendId); id(request.tenantId)
    if (!['install', 'update', 'enable', 'disable', 'uninstall'].includes(request.operation)) throw new Error('Invalid lifecycle operation')
    const b = this.backends.get(request.backendId)
    if (!b || (b.mode === 'dedicated' && b.tenantId !== request.tenantId)) throw new Error('Backend tenant mismatch or unknown backend')
    return b
  }
  /**
   * Creates a reviewable lifecycle plan from one current ledger snapshot without executing side effects.
   * @param request - Concrete operation, registered plugin/backend and verified tenant; see LifecycleRequest.
   * @returns A deterministic checksum-bound plan carrying the snapshot revision, dependency closure, migrations and retained-data policy.
   * @throws Rejects invalid request/state, incompatible or missing dependencies, changed applied migrations, dirty ledger, unsupported dialect, tenant mismatch or propagated store failures.
   * 
   * @remarks
   * Planning is read-only but may become stale immediately. Backend physical identity is immutable. Updates require appended immutable migrations and compatible schema versions; installation and enablement are separate operations.
   * 
   * @example
   * ```typescript
   * import { PluginLifecycle, type LifecycleRequest } from '@alneas/eaos-server/lifecycle-engine';
   * export function review(lifecycle: PluginLifecycle, request: LifecycleRequest) { return lifecycle.plan(request); }
   * ```
   */
  async plan(request: LifecycleRequest): Promise<LifecyclePlan> { return this.makePlan(request, await this.project.store.read()) }
  private makePlan(request: LifecycleRequest, state: LifecycleState): LifecyclePlan {
    assertState(state)
    const backend = this.target(request), operation = request.operation
    if (state.backends[backend.id] && canonical(state.backends[backend.id]) !== canonical(backend)) throw new Error('Backend placement is immutable; use a new backend ID and migrate data explicitly')
    for (const b of Object.values(state.backends)) if (b.databaseId === backend.databaseId && b.dialect !== backend.dialect) throw new Error('Database dialect conflict')
    const changing = operation === 'install' || operation === 'update'
    // Disable/uninstall remain available when the new core cannot load an old plugin release.
    const installed = state.installations[key(backend.id, request.pluginId)]
    const plugins = changing || operation === 'enable' ? this.order(request.pluginId) : [installed?.release ?? this.plugins.get(request.pluginId)].filter(Boolean) as LifecyclePlugin[]
    if (!plugins.length) throw new Error('Plugin is not installed')
    if (operation === 'update' && !installed) throw new Error('Install plugin before updating')
    const dataCatalog = this.catalog(plugins)
    for (const table of dataCatalog.tables) {
      for (const [contractKey, installation] of Object.entries(state.dataContracts ?? {})) {
        if (JSON.parse(contractKey)[0] !== backend.databaseId) continue
        if (installation.contract.id !== table.contractId && dataContractTables(installation.contract.schema).has(table.name)) throw new Error(`Installed data contract already owns table: ${table.name}`)
      }
    }
    const migrations: MigrationStep[] = [], infrastructure: InfrastructureStep[] = [], deactivate = new Set<string>()
    const markDependents = (backendId: string, pluginId: string) => {
      const affected = new Set([pluginId]); let changed = true
      while (changed) {
        changed = false
        for (const [k, entry] of Object.entries(state.installations)) {
          if (JSON.parse(k)[0] !== backendId || affected.has(entry.release.id)) continue
          if (Object.keys(entry.release.dependencies ?? {}).some(d => affected.has(d))) { affected.add(entry.release.id); changed = true }
        }
      }
      for (const [k, a] of Object.entries(state.activations)) if (a.backendId === backendId && affected.has(a.pluginId)) deactivate.add(k)
    }
    if (changing) for (const contract of dataCatalog.contracts) {
      const identity = contract.migrationIdentity ?? `data-${contract.id}`
      const old = state.dataContracts?.[key(backend.databaseId, contract.id)]
      if (old && old.status !== 'installed') throw new Error(`Data contract requires reconciliation: ${contract.id}`)
      if (old && old.digest !== lifecycleDigest(contract)) {
        if (old.contract.version === contract.version) throw new Error(`Data contract changed without version bump: ${contract.id}`)
        if (lt(contract.version, old.contract.version)) throw new Error('Data contract downgrade requires explicit migration')
        if (canonical(contract.schema) !== canonical(old.contract.schema) && contract.migrations.length <= old.contract.migrations.length) throw new Error(`Schema changed without an appended migration: ${contract.id}`)
      }
      for (const [installationKey, installation] of Object.entries(state.installations)) {
        if (state.backends[JSON.parse(installationKey)[0]]?.databaseId !== backend.databaseId) continue
        const range = installation.release.schemaDependencies?.[contract.id]
        if (range && !satisfies(contract.version, range)) throw new Error(`Installed plugin requires incompatible data contract: ${installation.release.id}`)
      }
      for (const record of Object.values(state.migrations).filter(m => m.databaseId === backend.databaseId && m.pluginId === identity)) {
        const m = contract.migrations[record.position]
        if (!m || m.id !== record.migrationId || lifecycleDigest(m) !== record.checksum) throw new Error(`Applied contract migration changed or removed: ${record.migrationId}`)
        if (record.status !== 'applied') throw new Error(`Data contract migration requires reconciliation: ${record.migrationId}`)
      }
      for (const [position, m] of contract.migrations.entries()) {
        const statements = m.sql[backend.dialect]
        if (!statements?.length) throw new Error(`Data contract migration ${m.id} does not support ${backend.dialect}`)
        const tenantId = m.scope === 'tenant' ? request.tenantId : null
        const k = key(backend.databaseId, identity, m.id, tenantId ?? '*')
        if (!state.migrations[k]) migrations.push({ key: k, record: { databaseId: backend.databaseId, pluginId: identity, migrationId: m.id, position, tenantId, checksum: lifecycleDigest(m), status: 'running' }, statements })
      }
      if (!old || old.digest !== lifecycleDigest(contract) || contract.migrations.some(m => !state.migrations[key(backend.databaseId, identity, m.id, m.scope === 'tenant' ? request.tenantId : '*')])) {
        for (const activation of Object.values(state.activations)) {
          if (state.backends[activation.backendId]?.databaseId !== backend.databaseId) continue
          const release = state.installations[key(activation.backendId, activation.pluginId)]?.release
          if (release && this.catalog([release]).contracts.some(c => c.id === contract.id)) markDependents(activation.backendId, activation.pluginId)
        }
      }
    }
    if (changing) for (const p of plugins) {
      const digest = lifecycleDigest(p), old = state.installations[key(backend.id, p.id)]
      if (old && old.status !== 'installed') throw new Error(`Installation requires reconciliation: ${p.id}`)
      if (old && old.digest !== digest) {
        if (old.release.version === p.version) throw new Error(`Release changed without version bump: ${p.id}`)
        if (lt(p.version, old.release.version)) throw new Error('Plugin downgrade requires an explicit data migration')
        if (operation === 'install') throw new Error('Use update for an existing release')
        markDependents(backend.id, p.id)
      }
      for (const record of Object.values(state.migrations).filter(m => m.databaseId === backend.databaseId && m.pluginId === p.id && !this.isContractMigration(m))) {
        const m = p.migrations.find(m => m.id === record.migrationId)
        if (!m || p.migrations.indexOf(m) !== record.position || lifecycleDigest(m) !== record.checksum) throw new Error(`Applied migration changed or removed: ${record.migrationId}`)
        if (record.status !== 'applied') throw new Error(`Migration requires reconciliation: ${record.migrationId}`)
      }
      for (const m of p.migrations) {
        const statements = m.sql[backend.dialect]
        if (!statements?.length) throw new Error(`Migration ${m.id} does not support ${backend.dialect}`)
        const tenantId = m.scope === 'tenant' ? request.tenantId : null
        const k = key(backend.databaseId, p.id, m.id, tenantId ?? '*')
        if (!state.migrations[k]) {
          migrations.push({ key: k, record: { databaseId: backend.databaseId, pluginId: p.id, migrationId: m.id, position: p.migrations.indexOf(m), tenantId, checksum: lifecycleDigest(m), status: 'running' }, statements })
          // DDL can affect every running backend sharing this physical DB.
          if (m.scope === 'database') for (const b of Object.values(state.backends)) if (b.databaseId === backend.databaseId) markDependents(b.id, p.id)
        }
      }
      if (p.infrastructure) {
        const k = key(backend.id, p.id), digest = lifecycleDigest({ backend, plugin: p })
        if (state.infrastructure[k] && state.infrastructure[k].status !== 'applied') throw new Error('Infrastructure requires reconciliation')
        if (state.infrastructure[k]?.digest !== digest) infrastructure.push({ key: k, digest, plugin: p, backend })
      }
    }
    if (operation === 'disable' || operation === 'uninstall') {
      const dependents = Object.values(state.activations).filter(a => a.backendId === backend.id && a.tenantId === request.tenantId && a.enabled && a.pluginId !== request.pluginId && this.dependsOn(state, backend.id, a.pluginId, request.pluginId))
      if (dependents.length) throw new Error('Disable dependent plugins first')
      const activation = key(backend.id, request.tenantId, request.pluginId)
      if (operation === 'disable') deactivate.add(activation)
      else {
        if (Object.values(state.activations).some(a => a.backendId === backend.id && a.pluginId === request.pluginId && a.enabled)) throw new Error('Disable plugin for every tenant on this backend before uninstalling')
        if (Object.entries(state.installations).some(([k, i]) => JSON.parse(k)[0] === backend.id && i.release.id !== request.pluginId && this.dependsOn(state, backend.id, i.release.id, request.pluginId))) throw new Error('Uninstall dependent plugins first')
      }
    }
    if (operation === 'enable') for (const p of plugins) if (!this.ready(state, backend, request.tenantId, p)) throw new Error(`Install/migrate compatible release before enabling: ${p.id}`)
    const body = { format: 1 as const, revision: state.revision, frameworkVersion: this.frameworkVersion, request: { ...request }, backend, ...(dataCatalog.contracts.length ? { dataCatalog } : {}), plugins, migrations, infrastructure, deactivate: [...deactivate].sort(), infrastructureProvider: this.project.infrastructure?.identity ?? null, retainData: true as const }
    return JSON.parse(canonical({ ...body, id: lifecycleDigest(body) }))
  }
  private dependsOn(state: LifecycleState, backendId: string, pluginId: string, target: string, seen = new Set<string>()): boolean {
    if (seen.has(pluginId)) return false
    seen.add(pluginId)
    return Object.keys(state.installations[key(backendId, pluginId)]?.release.dependencies ?? {}).some(d => d === target || this.dependsOn(state, backendId, d, target, seen))
  }
  private ready(state: LifecycleState, backend: BackendTarget, tenantId: string, p: LifecyclePlugin): boolean {
    const installed = state.installations[key(backend.id, p.id)]
    if (installed?.status !== 'installed' || installed.digest !== lifecycleDigest(p)) return false
    if (Object.values(state.migrations).some(m => m.databaseId === backend.databaseId && m.pluginId === p.id && !this.isContractMigration(m) && (m.status !== 'applied' || !p.migrations.some(definition => definition.id === m.migrationId && p.migrations.indexOf(definition) === m.position && lifecycleDigest(definition) === m.checksum)))) return false
    return this.catalog([p]).contracts.every(c => this.contractReady(state, backend, tenantId, c)) && p.migrations.every(m => {
      const record = state.migrations[key(backend.databaseId, p.id, m.id, m.scope === 'tenant' ? tenantId : '*')]
      return record?.status === 'applied' && record.checksum === lifecycleDigest(m)
    }) && (!p.infrastructure || state.infrastructure[key(backend.id, p.id)]?.digest === lifecycleDigest({ backend, plugin: p }) && state.infrastructure[key(backend.id, p.id)]?.status === 'applied')
  }
  /**
   * Checks that a tenant activation and its entire registered dependency closure match ready ledger releases.
   * @param backendId - Registered execution backend ID.
   * @param tenantId - Verified concrete tenant ID.
   * @param pluginId - Registered feature ID to check.
   * @returns True only when matching installation, migrations, infrastructure and activation digests are all ready; false for missing/incompatible readiness.
   * @throws Rejects malformed IDs/state, unknown or mismatched backend/tenant and store failures.
   * 
   * @remarks
   * Read-only admission check; a later state change can revoke access. Host must still enforce current tenant/resource authorization.
   * 
   * @example
   * ```typescript
   * import { PluginLifecycle } from '@alneas/eaos-server/lifecycle-engine';
   * export function admitted(lifecycle: PluginLifecycle, backendId: string, tenantId: string, pluginId: string) { return lifecycle.isEnabled(backendId, tenantId, pluginId); }
   * ```
   */
  async isEnabled(backendId: string, tenantId: string, pluginId: string): Promise<boolean> {
    const state = await this.project.store.read(); assertState(state)
    return this.enabledInState(state, backendId, tenantId, pluginId)
  }
  private enabledInState(state: LifecycleState, backendId: string, tenantId: string, pluginId: string): boolean {
    const backend = this.target({ operation: 'enable', backendId, tenantId, pluginId })
    if (!state.backends[backend.id] || canonical(state.backends[backend.id]) !== canonical(backend)) return false
    let plugins: LifecyclePlugin[]
    try { plugins = this.order(pluginId) } catch { return false }
    return plugins.every(p => this.ready(state, backend, tenantId, p) && state.activations[key(backendId, tenantId, p.id)]?.enabled === true && state.activations[key(backendId, tenantId, p.id)]?.digest === lifecycleDigest(p))
  }
  /**
   * Reads inventory including registered uninstalled code and orphaned historical installations.
   * 
   * One read-only control-state snapshot; includes orphaned installation records and registered, uninstalled code.
   * @param options - Optional backendId and tenantId filters; omitted returns all known inventory.
   * @returns A revision-bound inventory with effective enabled state distinct from requested activation.
   * @throws Rejects invalid filter IDs, unknown backend, corrupt installation/activation records, dedicated tenant mismatch or store failure.
   * 
   * @remarks
   * Performs one ledger read without writes. Dedicated backends for another tenant are omitted unless explicitly requested, in which case the request rejects.
   * 
   * @example
   * ```typescript
   * import { PluginLifecycle } from '@alneas/eaos-server/lifecycle-engine';
   * export function inventory(lifecycle: PluginLifecycle) { return lifecycle.list(); }
   * ```
   */
  async list(options: { 
    /**
     * Optional exact backend filter; unknown backends reject.
     */
    backendId?: string; 
    /**
     * Optional concrete tenant filter; dedicated backend scope must match.
     */
    tenantId?: string } = {}): Promise<LifecycleInventory> {
    if (options.backendId !== undefined) id(options.backendId)
    if (options.tenantId !== undefined) id(options.tenantId)
    const state = await this.project.store.read(); assertState(state)
    const installations = Object.entries(state.installations).map(([entryKey, installation]) => {
      const parts = JSON.parse(entryKey)
      if (!Array.isArray(parts) || parts.length !== 2 || parts.some(p => typeof p !== 'string')) throw new Error('Invalid installation key')
      const [backendId, pluginId] = parts as [string, string]
      id(backendId); id(pluginId)
      if (installation.release?.id !== pluginId || !valid(installation.release.version) || !['installing', 'installed', 'failed'].includes(installation.status)) throw new Error('Invalid installation record')
      return { backendId, pluginId }
    })
    const activations = Object.values(state.activations)
    const backendIds = new Set([...this.backends.keys(), ...Object.keys(state.backends), ...installations.map(p => p.backendId), ...activations.map(p => p.backendId)])
    for (const backendId of backendIds) id(backendId)
    for (const activation of activations) {
      id(activation.tenantId); id(activation.pluginId)
      if (typeof activation.enabled !== 'boolean') throw new Error('Invalid activation record')
    }
    if (options.backendId && !backendIds.has(options.backendId)) throw new Error(`Unknown backend: ${options.backendId}`)
    const targets: (string | null)[] = options.backendId ? [options.backendId] : backendIds.size ? [...backendIds].sort() : [null]
    const plugins: LifecycleInventoryEntry[] = []
    for (const backendId of targets) {
      const backend = backendId ? this.backends.get(backendId) : undefined
      if (options.tenantId && backend?.mode === 'dedicated' && backend.tenantId !== options.tenantId) {
        if (options.backendId) throw new Error('Tenant does not belong to dedicated backend')
        continue
      }
      const pluginIds = new Set([...this.plugins.keys(), ...installations.filter(p => p.backendId === backendId).map(p => p.pluginId), ...activations.filter(p => p.backendId === backendId).map(p => p.pluginId)])
      for (const pluginId of [...pluginIds].sort()) {
        const registered = this.plugins.get(pluginId)
        const installed = backendId ? state.installations[key(backendId, pluginId)] : undefined
        const tenantIds = options.tenantId ? [options.tenantId] : [...new Set(activations.filter(p => p.backendId === backendId && p.pluginId === pluginId).map(p => p.tenantId))].sort()
        plugins.push({
          pluginId, backendId, backendConfigured: !!backend,
          registeredVersion: registered?.version ?? null, installedVersion: installed?.release.version ?? null,
          installationStatus: installed?.status ?? 'not-installed',
          releaseMatches: installed ? !!registered && installed.digest === lifecycleDigest(registered) : null,
          tenants: tenantIds.map(tenantId => ({
            tenantId, requestedEnabled: backendId ? state.activations[key(backendId, tenantId, pluginId)]?.enabled === true : false,
            enabled: !!backend && !!backendId && (backend.mode !== 'dedicated' || backend.tenantId === tenantId) && this.enabledInState(state, backendId, tenantId, pluginId),
          })),
        })
      }
    }
    return { format: 1, revision: state.revision, frameworkVersion: this.frameworkVersion, plugins }
  }
  /**
   * Runs a host callback only after the current plugin dependency closure passes lifecycle admission.
   * @typeParam T - Value resolved by the admitted callback.
   * @param backendId - Registered backend ID.
   * @param tenantId - Verified concrete tenant ID.
   * @param pluginId - Feature plugin ID.
   * @param callback - Async work invoked once after admission; must enforce tenant/resource authorization itself.
   * @returns The callback result without cloning.
   * @throws Rejects inactive plugin, lifecycle/store validation failure or callback rejection.
   * 
   * @remarks
   * The admission check does not hold a lock or pin activation throughout callback execution. Host quiesce/drain and live authorization remain required.
   * 
   * @example
   * ```typescript
   * import { PluginLifecycle } from '@alneas/eaos-server/lifecycle-engine';
   * export function runAdmitted<T>(lifecycle: PluginLifecycle, backendId: string, tenantId: string, pluginId: string, work: () => Promise<T>) { return lifecycle.run(backendId, tenantId, pluginId, work); }
   * ```
   */
  async run<T>(backendId: string, tenantId: string, pluginId: string, callback: () => Promise<T>): Promise<T> {
    if (!await this.isEnabled(backendId, tenantId, pluginId)) throw new Error('Plugin is inactive')
    return callback()
  }
  /**
   * Checks plan freshness and invokes host infrastructure previews without applying ledger changes.
   * @param plan - Unmodified lifecycle plan to preview.
   * @returns Preview results in infrastructure-step order, or an empty array when no infrastructure is needed.
   * @throws Rejects stale/modified plan, missing infrastructure adapter or propagated plan/preview errors.
   * 
   * @remarks
   * Infrastructure previews run concurrently through Promise.all. Host preview adapters own any external read/preview effects; this method executes no migrations.
   * 
   * @example
   * ```typescript
   * import { PluginLifecycle, type LifecyclePlan } from '@alneas/eaos-server/lifecycle-engine';
   * export function preview(lifecycle: PluginLifecycle, plan: LifecyclePlan) { return lifecycle.preview(plan); }
   * ```
   */
  async preview(plan: LifecyclePlan): Promise<unknown[]> {
    const fresh = await this.plan(plan.request)
    if (canonical(fresh) !== canonical(plan)) throw new Error('Stale or modified lifecycle plan')
    if (plan.infrastructure.length && !this.project.infrastructure) throw new Error('Infrastructure executor is required')
    return Promise.all(plan.infrastructure.map(s => this.project.infrastructure!.preview(s)))
  }
  /**
   * Revalidates and executes a reviewed lifecycle plan while holding the host's exclusive ledger lock.
   * @param plan - Unmodified plan bound to the current ledger revision and registered configuration.
   * @returns Resolves without a value after ledger updates and requested side effects complete.
   * @throws Rejects stale/modified plan, missing executors/quiesce, reconciliation conflicts or host store, migration, infrastructure or drain failures.
   * 
   * @remarks
   * Before upgrade side effects, affected activations are disabled durably and all-instance quiesce is required. Infrastructure/migration running/applied/failed receipts are persisted separately. Errors can follow partial external success; no automatic rollback/retry occurs. Uninstall retains business data and migration history.
   * 
   * @example
   * ```typescript
   * import { PluginLifecycle, type LifecyclePlan } from '@alneas/eaos-server/lifecycle-engine';
   * export function applyReviewed(lifecycle: PluginLifecycle, plan: LifecyclePlan) { return lifecycle.apply(plan); }
   * ```
   */
  async apply(plan: LifecyclePlan): Promise<void> {
    plan = JSON.parse(canonical(plan))
    await this.project.store.withLock(async writer => {
      const state = await writer.read(), fresh = this.makePlan(plan.request, state)
      if (canonical(fresh) !== canonical(plan)) throw new Error('Stale or modified lifecycle plan')
      if (plan.infrastructure.length && !this.project.infrastructure) throw new Error('Infrastructure executor is required')
      if (['install', 'update'].includes(plan.request.operation) && plan.deactivate.length && !this.project.quiesce) throw new Error('A quiesce executor is required for active deployments')
      const save = async () => { state.revision++; await writer.write(state) }
      const { request, backend } = plan
      state.backends[backend.id] = backend
      for (const k of plan.deactivate) if (state.activations[k]) state.activations[k].enabled = false
      if (request.operation === 'install' || request.operation === 'update') {
        for (const p of plan.plugins) state.installations[key(backend.id, p.id)] = { release: p, digest: lifecycleDigest(p), status: 'installing' }
        state.dataContracts ??= {}
        for (const contract of plan.dataCatalog?.contracts ?? []) state.dataContracts[key(backend.databaseId, contract.id)] = { contract, digest: lifecycleDigest(contract), status: 'installing' }
        // Persist inactive status BEFORE any DB or infrastructure effects.
        await save()
        try {
          if (plan.deactivate.length) await this.project.quiesce!(plan.deactivate.map(k => state.activations[k]))
          for (const step of plan.infrastructure) {
            state.infrastructure[step.key] = { digest: step.digest, status: 'running' }; await save()
            try { await this.project.infrastructure!.apply(step) }
            catch (error) { state.infrastructure[step.key].status = 'failed'; await save(); throw error }
            state.infrastructure[step.key].status = 'applied'; await save()
          }
          for (const step of plan.migrations) {
            state.migrations[step.key] = { ...step.record }; await save()
            try { await this.project.migrate(step, backend) }
            catch (error) { state.migrations[step.key].status = 'failed'; await save(); throw error }
            state.migrations[step.key].status = 'applied'; await save()
          }
          for (const contract of plan.dataCatalog?.contracts ?? []) state.dataContracts![key(backend.databaseId, contract.id)].status = 'installed'
          for (const p of plan.plugins) state.installations[key(backend.id, p.id)].status = 'installed'
        } catch (error) {
          for (const contract of plan.dataCatalog?.contracts ?? []) state.dataContracts![key(backend.databaseId, contract.id)].status = 'failed'
          for (const p of plan.plugins) state.installations[key(backend.id, p.id)].status = 'failed'
          await save(); throw error
        }
      } else if (request.operation === 'enable') {
        for (const p of plan.plugins) state.activations[key(backend.id, request.tenantId, p.id)] = { backendId: backend.id, tenantId: request.tenantId, pluginId: p.id, digest: lifecycleDigest(p), enabled: true }
      } else if (request.operation === 'uninstall') delete state.installations[key(backend.id, request.pluginId)]
      await save()
    })
  }
}
