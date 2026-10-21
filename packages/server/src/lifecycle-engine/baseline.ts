import { lt, valid, satisfies } from 'semver'
import { lifecycleDigest, resolveDataContracts, type DataContract, type LifecycleStore, type MigrationRecord } from './index'

/**
 * Hash-bound replacement of exact historical database migrations by equivalent baseline DDL.
 * 
 * @see createDataContractBaseline for canonical integration usage.
 */
export interface DataContractBaseline {
  /**
   * Baseline discriminator; currently 1.
   */
  format: 1
  /**
   * Canonical contract release whose fully applied history is replaced.
   */
  source: DataContract
  /**
   * Newer release retaining schema but using one database-scoped baseline migration.
   */
  target: DataContract
  /**
   * Ordered historical migration IDs, positions and checksums requiring exact ledger matches.
   */
  replaces: { 
    /**
     * Original immutable migration ID replaced by the baseline.
     */
    id: string; 
    /**
     * Original zero-based migration position.
     */
    position: number; 
    /**
     * Canonical original migration definition digest.
     */
    checksum: string }[]
  /**
   * Canonical digest of format/source/target/replaces.
   */
  hash: string
}
/**
 * Builds a newer single-migration contract release and hashes the exact historical migrations it replaces.
 * 
 * Final DDL comes from a schema compiler or an isolated database introspector, never concatenation.
 * @param source - Valid source contract with nonempty database-scoped migration history.
 * @param version - Valid semver strictly newer than source.version.
 * @param sql - Compiler/introspector-generated complete baseline DDL covering exactly the original dialect set.
 * @returns Source/target contract snapshots, replacement migration checksums and integrity hash.
 * @throws Error for nonnewer version, tenant-scoped/empty history, changed dialect set or invalid source/target contracts.
 * 
 * @remarks
 * Read-only; the host must establish final DDL equivalence using a schema compiler or isolated introspector. SQL is not concatenated or executed here.
 * 
 * @example
 * ```typescript
 * import { createDataContractBaseline, type DataContract } from '@alneas/eaos-server/lifecycle-engine';
 * export function reviewBaseline(source: DataContract, version: string, sql: DataContract['migrations'][number]['sql']) { return createDataContractBaseline(source, version, sql); }
 * ```
 */
export function createDataContractBaseline(source: DataContract, version: string, sql: DataContract['migrations'][number]['sql']): DataContractBaseline {
  if (!valid(version) || !lt(source.version, version) || !source.migrations.length || source.migrations.some(m => m.scope !== 'database')) throw Error('Baseline requires a newer contract version and database-scoped migrations')
  const dialects = [...new Set(source.migrations.flatMap(m => Object.keys(m.sql)))].sort()
  if (JSON.stringify(dialects) !== JSON.stringify(Object.keys(sql).sort())) throw Error('Baseline must preserve every declared dialect')
  const target: DataContract = { ...structuredClone(source), version, migrations: [{ id: `001_baseline_v${version.replaceAll('.', '_').replaceAll('-', '_')}`, scope: 'database', sql: structuredClone(sql) }] }
  resolveDataContracts([{ ...source, dependencies: undefined }], { [source.id]: source.version })
  resolveDataContracts([{ ...target, dependencies: undefined }], { [target.id]: version })
  const body = { format: 1 as const, source: structuredClone(source), target, replaces: source.migrations.map((m, position) => ({ id: m.id, position, checksum: lifecycleDigest(m) })) }
  return { ...body, hash: lifecycleDigest(body) }
}
/**
 * Replaces a completely applied exact contract history with its reviewed baseline ledger record without running DDL.
 * 
 * Rebase only a completely applied exact history. This function never executes DDL.
 * @param store - Durable cross-process exclusive lifecycle store.
 * @param databaseId - Physical database ledger identity whose contract history is rebased.
 * @param baseline - Unmodified baseline created by createDataContractBaseline.
 * @param options - Expected ledger revision and optional all-instance quiesce callback, required when affected consumers are active.
 * @returns Baseline hash, next revision, count of replaced records and ddlExecuted=false.
 * @throws Rejects integrity mismatch, stale revision, partial/dirty history, incompatible installed consumer range, absent drain or propagated store/quiesce failures.
 * 
 * @remarks
 * Runs under the store lock, archives old migration history and disables affected live consumers. Host drain happens before the final atomic state write; external drain may have occurred even if that write fails. No schema or data migration is executed.
 * 
 * @example
 * ```typescript
 * import { rebaseDataContractBaseline, type DataContractBaseline, type LifecycleStore } from '@alneas/eaos-server/lifecycle-engine';
 * export function rebaseReviewed(store: LifecycleStore, databaseId: string, baseline: DataContractBaseline, options: Parameters<typeof rebaseDataContractBaseline>[3]) { return rebaseDataContractBaseline(store, databaseId, baseline, options); }
 * ```
 */
export async function rebaseDataContractBaseline(store: LifecycleStore, databaseId: string, baseline: DataContractBaseline, options: {
  
  /**
   * Exact current ledger revision reviewed by the caller; mismatch rejects before mutation.
   */
  expectedRevision: number
  /** Host drains all instances before disabling the affected live consumers. */
  quiesce?: (input: { 
    /**
     * Exact physical database identity whose live consumers must drain.
     */
    databaseId: string; 
    /**
     * Distinct affected feature IDs consuming the rebased contract.
     */
    pluginIds: string[] }) => Promise<void>
}) {
  const { hash, ...body } = baseline
  if (hash !== lifecycleDigest(body) || hash !== createDataContractBaseline(baseline.source, baseline.target.version, baseline.target.migrations[0]?.sql ?? {}).hash) throw Error('Baseline integrity differs')
  return store.withLock(async writer => {
    const state = await writer.read()
    if (state.revision !== options.expectedRevision) throw Error('Baseline plan is stale')
    const key = JSON.stringify([databaseId, baseline.source.id]), installed = state.dataContracts?.[key]
    if (!installed || installed.status !== 'installed' || installed.digest !== lifecycleDigest(baseline.source)) throw Error('Baseline source contract is not completely installed')
    const identity = baseline.source.migrationIdentity ?? `data-${baseline.source.id}`
    const history = Object.entries(state.migrations).filter(([, r]) => r.databaseId === databaseId && r.pluginId === identity)
    if (history.length !== baseline.replaces.length || baseline.replaces.some(replaced => !history.some(([, r]) => r.migrationId === replaced.id && r.position === replaced.position && r.checksum === replaced.checksum && r.tenantId === null && r.status === 'applied'))) throw Error('Baseline history is partial, changed or dirty')
    for (const [key, installed] of Object.entries(state.installations)) {
      const range = installed.release.schemaDependencies?.[baseline.source.id]
      if (state.backends[JSON.parse(key)[0]]?.databaseId === databaseId && range && !satisfies(baseline.target.version, range)) throw Error('Baseline violates an installed plugin contract range')
    }
    const live = Object.values(state.activations).filter(a => a.enabled && state.backends[a.backendId]?.databaseId === databaseId && state.installations[JSON.stringify([a.backendId, a.pluginId])]?.release.schemaDependencies?.[baseline.source.id])
    if (live.length && !options.quiesce) throw Error('Baseline requires all-instance drain')
    if (live.length) await options.quiesce!({ databaseId, pluginIds: [...new Set(live.map(a => a.pluginId))] })
    for (const a of live) a.enabled = false
    state.baselineHistory ??= {}
    const archiveKey = JSON.stringify([databaseId, identity, hash])
    if (state.baselineHistory[archiveKey]) throw Error('Baseline history already exists')
    state.baselineHistory[archiveKey] = { hash, source: baseline.source, migrations: Object.fromEntries(history) }
    for (const [key] of history) delete state.migrations[key]
    const m = baseline.target.migrations[0]
    state.migrations[JSON.stringify([databaseId, identity, m.id, '*'])] = { databaseId, pluginId: identity, migrationId: m.id, position: 0, tenantId: null, checksum: lifecycleDigest(m), status: 'applied' }
    state.dataContracts![key] = { contract: structuredClone(baseline.target), digest: lifecycleDigest(baseline.target), status: 'installed' }
    state.revision++
    await writer.write(state)
    return { baselineHash: hash, revision: state.revision, rebased: history.length, ddlExecuted: false as const }
  })
}
