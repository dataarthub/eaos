import { assertTenantEntitlements, type PlatformPrincipal, type PluginManifest, type TenantEntitlements } from '@alneas/eaos-core'
import { PluginEntitlementRuntime, createSqlTenantEntitlementLoader } from './index'
import { createAtomicRepository, joinedAtomicSqlExecutor, atomicCommand, PluginError, type AtomicSqlDriver, type AtomicSession } from '../plugin-data/index'
/** Control-plane audit storage, applied only through a reviewed schema release.
 * @see createPlatformEntitlementService
 */
export const entitlementAuditSql = {
 sqlite: 'CREATE TABLE eaos_entitlement_records(tenant_id TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(tenant_id,id))',
 oracle: 'CREATE TABLE eaos_entitlement_records(tenant_id VARCHAR2(128) NOT NULL,id VARCHAR2(256) NOT NULL,revision NUMBER(19) NOT NULL,payload CLOB NOT NULL CHECK(payload IS JSON),PRIMARY KEY(tenant_id,id))',
}
/** Current control-plane contract and compare-and-swap revision.
 * @see createPlatformEntitlementService
 */
export interface EntitlementRevision {
 /** Zero means no stored contract; persisted contracts have positive revisions. */
 revision:number
 /** Verified current tenant contract, or null when absent. */
 contract:TenantEntitlements|null
}
/** Host connections used by the common contract service.
 * @see createPlatformEntitlementService
 */
export interface PlatformEntitlementServiceOptions {
 /** Durable atomic control-plane database; never a separate business database. */
 driver:AtomicSqlDriver
 /** Adopted manifests declaring accepted addon and quota identifiers. */
 manifests:readonly PluginManifest[]
 /** Current lifecycle admission, independently rechecked for runtime use.
  * @param p - Verified current tenant principal.
  * @param pluginId - Exact adopted plugin identifier.
  * @returns Whether this plugin is currently active for the principal.
  * @example
  * import type {PlatformEntitlementServiceOptions} from '@alneas/eaos-server/entitlements'
  * export const active=(ports:PlatformEntitlementServiceOptions)=>ports.isActive({tenantId:'one',userId:'user',roles:[]},'accounting')
  */
 isActive(p:PlatformPrincipal,pluginId:string):Promise<boolean>
}
/** Create durable contract reads/updates and entitlement admission over one control repository.
 * @param options - Atomic database driver, accepted manifests and live lifecycle callback.
 * @returns Contract service with shared runtime, repository, read and idempotent save operations.
 * @throws Invalid table/driver configuration can fail construction; operations reject invalid contracts, tenants, revisions, unknown addons/quotas, CAS conflicts and storage/audit failures.
 * @remarks Saves use atomic commands and durable audit. Replays return the original result; stale revisions return409. Schema installation and privileged caller authorization remain explicit Host responsibilities.
 * @example
 * import {createPlatformEntitlementService,type PlatformEntitlementServiceOptions} from '@alneas/eaos-server/entitlements'
 * export const contracts=(ports:PlatformEntitlementServiceOptions)=>createPlatformEntitlementService(ports)
 */
export function createPlatformEntitlementService(options:PlatformEntitlementServiceOptions) {
 const repository = createAtomicRepository('eaos_entitlement_records', options.driver)
 const bind = (n: number) => options.driver.dialect === 'oracle' ? `:${n}` : options.driver.dialect === 'postgres' ? `$${n}` : '?'
 async function readIn(tx: AtomicSession, p: PlatformPrincipal): Promise<EntitlementRevision> {
  const sql = joinedAtomicSqlExecutor(tx, p)
  const contract = await createSqlTenantEntitlementLoader({ dialect: sql.dialect, execute: (query, values) => sql.execute(p.tenantId, query, values) })(p.tenantId)
  const rows = (await sql.execute(p.tenantId, `SELECT revision FROM eaos_tenant_entitlements WHERE tenant_id=${bind(1)}`, [p.tenantId])).rows ?? []
  const revision = rows.length ? Number(rows[0].revision ?? rows[0].REVISION) : 0
  if ((contract && (!Number.isSafeInteger(revision) || revision < 1)) || (!contract && revision !== 0)) throw Error('Invalid entitlement revision')
  return { revision, contract }
 }
 const read = (p: PlatformPrincipal) => repository.run(p, tx => readIn(tx, p))
 const runtime = new PluginEntitlementRuntime({ repository, load: async tenantId => (await read({ tenantId, userId: 'platform-entitlement-reader', roles: [] })).contract, loadInTransaction: async (p, tx) => (await readIn(tx, p)).contract, isActive: options.isActive })
 return { runtime, repository, read,
  async save(p: PlatformPrincipal, input: { commandId: string; revision: number; contract: TenantEntitlements }) {
   assertTenantEntitlements(input.contract)
   if (input.contract.tenantId !== p.tenantId || !Number.isSafeInteger(input.revision) || input.revision < 0) throw new PluginError(400, 'Contract tenant or revision differs')
   const addons = new Set(options.manifests.flatMap(m => m.entitlement?.addonId ? [m.entitlement.addonId] : []))
   const quotas = new Set(options.manifests.filter(m => m.entitlement?.metering).map(m => m.entitlement!.addonId ?? m.id))
   if (input.contract.addons.some(id => !addons.has(id)) || Object.keys(input.contract.monthlyQuotas ?? {}).some(id => !quotas.has(id))) throw new PluginError(400, 'Unknown addon or quota')
   const value = structuredClone(input)
   return repository.run(p, tx => atomicCommand(tx, p, 'platform.entitlement.saved', value, async () => {
    const current = await readIn(tx, p)
    if (current.revision !== value.revision) throw new PluginError(409, 'Contract changed; reload before saving')
    const c = value.contract, next = value.revision + 1, sql = joinedAtomicSqlExecutor(tx, p)
    const fields = [c.plan,c.status,c.validUntil ?? null,JSON.stringify(c.addons),JSON.stringify(c.monthlyQuotas ?? {}),next,c.tenantId]
    try {
     const result = value.revision === 0
      ? await sql.execute(p.tenantId, `INSERT INTO eaos_tenant_entitlements(plan_tier,status,valid_until,addons_json,quotas_json,revision,tenant_id) VALUES(${fields.map((_,i)=>bind(i+1)).join(',')})`, fields)
      : await sql.execute(p.tenantId, `UPDATE eaos_tenant_entitlements SET plan_tier=${bind(1)},status=${bind(2)},valid_until=${bind(3)},addons_json=${bind(4)},quotas_json=${bind(5)},revision=${bind(6)} WHERE tenant_id=${bind(7)} AND revision=${bind(8)}`, [...fields,value.revision])
     if (result.affectedRows !== 1) throw new PluginError(409, 'Contract changed; reload before saving')
    } catch (error) { if ((error as {errorNum?:number}).errorNum===1 || String(error).includes('UNIQUE constraint')) throw new PluginError(409,'Contract changed; reload before saving'); throw error }
    return { revision: next, contract: c }
   }))
  },
 }
}
/** Common contract service returned by the canonical factory.
 * @see createPlatformEntitlementService
 */
export type PlatformEntitlementService = ReturnType<typeof createPlatformEntitlementService>
