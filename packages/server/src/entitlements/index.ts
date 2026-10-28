import { Hono, type Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { assertPlatformPrincipal, assertTenantEntitlements, evaluatePluginEntitlement, type PlatformPrincipal, type PluginEntitlement, type TenantEntitlements, type EntitlementDecision } from '@alneas/eaos-core'
import { appendAtomicAudit, type AtomicRepository, type AtomicSession } from '../plugin-data/index'
export * from './sql'

/**
 * Carries a denied entitlement decision for HTTP or host failure handling.
 * @example
 * ```typescript
 * import { EntitlementError } from "@alneas/eaos-server/entitlements";
 * const error = new EntitlementError({ allowed: false, status: 402, reason: "quota-exceeded" });
 * console.log(error.decision.status);
 * ```
 */
export class EntitlementError extends Error {
  /**
   * Creates an error whose message is the denial reason.
   * @param decision - Denied decision retained as a public readonly property for status/reason mapping.
   */
  constructor(readonly decision: Exclude<EntitlementDecision, { 
  /** Type-level allowed-branch discriminator removed by Exclude; this constructor accepts only denied decisions with allowed false. */
  allowed: true }>) { super(decision.reason) }
}
/**
 * Trusted control-plane reads, lifecycle policy, and reservation persistence for {@link PluginEntitlementRuntime}.
 */
export interface EntitlementRuntimeOptions {
  /** Shared durable control-plane repository, with transaction/CAS and tenant isolation. */
  repository: AtomicRepository
  /** Read current contracts from eaos_tenant_entitlements; never from request headers/body. */
  load: (tenantId: string) => Promise<TenantEntitlements | null>
  /** Optional joined control-plane read; quota and contract observe the same host transaction. */
  loadInTransaction?: (principal: PlatformPrincipal, session: AtomicSession) => Promise<TenantEntitlements | null>
  /** Same live lifecycle admission for HTTP, MCP, jobs, webhooks and asset delivery. */
  isActive: (principal: PlatformPrincipal, pluginId: string) => Promise<boolean>
  /** Clock for validity and UTC monthly metering period; defaults to a fresh Date per read. */
  clock?: () => Date
}
/**
 * Checks live plugin entitlements and durably reserves metered admission attempts.
 * @remarks A durable quota reservation counts admitted attempts, including failed handler attempts. No refund, cancellation, retry, or business-handler transaction is supplied. Shared concurrency/CAS and tenant isolation depend on the host AtomicRepository. For a contract snapshot consistent with reservation writes, supply loadInTransaction.
 * @example
 * ```typescript
 * import { PluginEntitlementRuntime, type EntitlementRuntimeOptions } from "@alneas/eaos-server/entitlements";
 * export function entitlementRuntime(options: EntitlementRuntimeOptions) {
 *   return new PluginEntitlementRuntime(options);
 * }
 * ```
 */
export class PluginEntitlementRuntime {
  /**
   * Retains host control-plane callbacks and repository without opening a connection.
   * @param options - Trusted entitlement persistence, active-plugin checks, and optional clock.
   */
  constructor(private readonly options: EntitlementRuntimeOptions) {}
  /**
   * Loads and validates current tenant contract data for a verified principal.
   * @param principal - Verified platform principal validated by assertPlatformPrincipal.
   * @param session - Optional active atomic session; loadInTransaction is used only when both are supplied.
   * @returns A structured clone of current entitlements, or null when absent.
   * @throws Rejects invalid principal/contract, mismatched tenant, clone errors, or host load failures.
   * @example
   * ```typescript
   * import { PluginEntitlementRuntime, type EntitlementRuntimeOptions } from "@alneas/eaos-server/entitlements";
   * import type { PlatformPrincipal } from "@alneas/eaos-core";
   * export async function snapshot(options: EntitlementRuntimeOptions, principal: PlatformPrincipal) {
   *   return new PluginEntitlementRuntime(options).snapshot(principal);
   * }
   * ```
   */
  async snapshot(principal: PlatformPrincipal, session?: AtomicSession): Promise<TenantEntitlements | null> {
    assertPlatformPrincipal(principal)
    const result = session && this.options.loadInTransaction ? await this.options.loadInTransaction(principal, session) : await this.options.load(principal.tenantId)
    if (result) assertTenantEntitlements(result)
    if (result && result.tenantId !== principal.tenantId) throw Error('Entitlement tenant differs')
    return result && structuredClone(result)
  }
  /**
   * Evaluates lifecycle and subscription policy without consuming quota.
   * @param principal - Verified user/tenant principal.
   * @param pluginId - Exact plugin ID used by lifecycle and entitlement evaluation.
   * @param rule - Plugin access tier, allowed tenants, and optional metering declaration.
   * @param session - Optional reservation transaction for a joined contract read.
   * @returns Allowed/denied decision; inactive lifecycle returns denied 404 tenant-locked. This check does not reserve usage.
   * @throws Rejects invalid data or propagated lifecycle/load/clock errors.
   * @example
   * ```typescript
   * import { PluginEntitlementRuntime, type EntitlementRuntimeOptions } from "@alneas/eaos-server/entitlements";
   * import type { PlatformPrincipal, PluginEntitlement } from "@alneas/eaos-core";
   * export async function check(options: EntitlementRuntimeOptions, principal: PlatformPrincipal, pluginId: string, rule: PluginEntitlement) {
   *   return new PluginEntitlementRuntime(options).check(principal, pluginId, rule);
   * }
   * ```
   */
  async check(principal: PlatformPrincipal, pluginId: string, rule: PluginEntitlement, session?: AtomicSession): Promise<EntitlementDecision> {
    assertPlatformPrincipal(principal)
    if (!await this.options.isActive(principal, pluginId)) return { allowed: false, status: 404, reason: 'tenant-locked' }
    return evaluatePluginEntitlement(pluginId, rule, principal.tenantId, await this.snapshot(principal, session), this.options.clock?.() ?? new Date())
  }
  /**
   * Rechecks entitlement under the repository transaction and reserves one metered attempt with an audit entry.
   * @param principal - Verified principal used for tenant-scoped repository admission.
   * @param pluginId - Plugin whose live entitlement is required.
   * @param rule - Current plugin entitlement policy; unmetered rules perform no counter write.
   * @param operation - Host operation label recorded in metering audit data.
   * @returns No value; resolves after entitlement admission and any quota/audit persistence.
   * @throws Rejects EntitlementError for denied policy/quota, invalid stored usage counter, or host transaction/load/lifecycle/audit failures.
   * @remarks Counters use a UTC YYYY-MM period and count admitted attempts, not successful work. Calling admit repeatedly consumes repeatedly; no idempotency key is applied.
   * @example
   * ```typescript
   * import { PluginEntitlementRuntime, type EntitlementRuntimeOptions } from "@alneas/eaos-server/entitlements";
   * import type { PlatformPrincipal, PluginEntitlement } from "@alneas/eaos-core";
   * export async function admit(options: EntitlementRuntimeOptions, principal: PlatformPrincipal, pluginId: string, rule: PluginEntitlement) {
   *   await new PluginEntitlementRuntime(options).admit(principal, pluginId, rule, "example:execute");
   * }
   * ```
   */
  async admit(principal: PlatformPrincipal, pluginId: string, rule: PluginEntitlement, operation: string): Promise<void> {
    // Read again inside the serialized reservation; a discovery check never reserves quota.
    await this.options.repository.run(principal, async tx => {
      const decision = await this.check(principal, pluginId, rule, tx)
      if (!decision.allowed) throw new EntitlementError(decision)
      if (!rule.metering) return
      const month = (this.options.clock?.() ?? new Date()).toISOString().slice(0, 7)
      const key = `metering/${pluginId}/${rule.metering.unit}/${month}`
      const old = await tx.get<{ used: number }>(key)
      const used = old?.value.used ?? 0
      if (!Number.isSafeInteger(used) || used < 0) throw Error('Invalid durable usage counter')
      if (used >= decision.quota!) throw new EntitlementError({ allowed: false, status: 402, reason: 'quota-exceeded' })
      await tx.put(key, { used: used + 1 }, old?.revision ?? 0)
      await appendAtomicAudit(tx, principal, 'plugin.metered', { pluginId, unit: rule.metering.unit, month, operation }, { used: used + 1 })
    })
  }
  /**
   * Reserves admission before executing host work outside the reservation transaction.
   * @typeParam T - Resolved host work result.
   * @param principal - Verified tenant/user principal.
   * @param pluginId - Required plugin ID.
   * @param rule - Plugin entitlement policy.
   * @param operation - Host operation label for metering audit.
   * @param work - Called without arguments only after admission; resolves the business result.
   * @returns The host work result.
   * @throws Rejects admission or work failures; failed work does not refund a reservation.
   * @example
   * ```typescript
   * import { PluginEntitlementRuntime, type EntitlementRuntimeOptions } from "@alneas/eaos-server/entitlements";
   * import type { PlatformPrincipal, PluginEntitlement } from "@alneas/eaos-core";
   * export async function execute<T>(options: EntitlementRuntimeOptions, principal: PlatformPrincipal, pluginId: string, rule: PluginEntitlement, work: () => Promise<T>) {
   *   return new PluginEntitlementRuntime(options).run(principal, pluginId, rule, "example:execute", work);
   * }
   * ```
   */
  async run<T>(principal: PlatformPrincipal, pluginId: string, rule: PluginEntitlement, operation: string, work: () => Promise<T>): Promise<T> {
    await this.admit(principal, pluginId, rule, operation)
    return work()
  }
}
/**
 * Host callback resolving authenticated user/tenant membership from a request.
 * @param context - Hono request context after host authentication.
 * @returns Verified platform principal, or null to deny authentication.
 * @throws Host failures propagate through request handling.
 * @see createPluginEntitlementGuard for usage.
 */
export type EntitlementPrincipalResolver = (context: Context) => Promise<PlatformPrincipal | null>
/**
 * Resolves the engine context principal only when user.tenantId matches tenantId and userId exists.
 * @param c - Hono context populated exclusively by trusted host authentication middleware.
 * @returns Principal using context IDs and user roles, or null for missing/mismatched identity.
 * @remarks Does not independently query live membership or authenticate headers.
 * @example
 * ```typescript
 * import { Hono } from "hono";
 * import { resolveEngineEntitlementPrincipal } from "@alneas/eaos-server/entitlements";
 * const app = new Hono();
 * app.get("/identity-state", async c => c.json({ authenticated: !!await resolveEngineEntitlementPrincipal(c) }));
 * ```
 */
export const resolveEngineEntitlementPrincipal: EntitlementPrincipalResolver = async c => {
  const user = c.get('user'), tenantId = c.get('tenantId'), userId = c.get('userId')
  return tenantId && userId && user?.tenantId === tenantId ? { tenantId, userId, roles: user.roles } : null
}
/**
 * Determines whether a plugin rule needs the external entitlement runtime.
 * @param rule - Declared plugin entitlement policy.
 * @returns True for nonpublic tier, any metering, or any allowedTenants property; otherwise false.
 * @remarks Public unmetered rules still require authentication and host lifecycle/resource admission.
 * @example
 * ```typescript
 * import { requiresEntitlementRuntime } from "@alneas/eaos-server/entitlements";
 * import type { PluginEntitlement } from "@alneas/eaos-core";
 * export function needsSubscription(rule: PluginEntitlement) { return requiresEntitlementRuntime(rule); }
 * ```
 */
export function requiresEntitlementRuntime(rule: PluginEntitlement): boolean {
  return rule.tier !== 'public' || !!rule.metering || !!rule.allowedTenants
}
/**
 * Creates a request guard reserving current restricted/metered plugin admission before downstream work.
 * @param pluginId - Exact plugin ID to admit.
 * @param rule - Declared plugin access and metering policy.
 * @param runtime - Required for restricted/metered/allowed-tenant rules; absence returns 503.
 * @param resolvePrincipal - Verified request principal callback; defaults to resolveEngineEntitlementPrincipal.
 * @returns Hono middleware returning 401 for absent identity, policy status for EntitlementError, or completing downstream work without a value.
 * @throws Request handling propagates invalid principal, host runtime, resolver, and downstream errors outside normalized entitlement denial.
 * @remarks Public unmetered rules skip runtime checks after principal validation; host lifecycle/resource authorization remains required. Metered admission counts failed downstream attempts.
 * @example
 * ```typescript
 * import { Hono } from "hono";
 * import { createPluginEntitlementGuard, type PluginEntitlementRuntime, type EntitlementPrincipalResolver } from "@alneas/eaos-server/entitlements";
 * import type { PluginEntitlement } from "@alneas/eaos-core";
 * export function protectedApp(rule: PluginEntitlement, runtime: PluginEntitlementRuntime, resolvePrincipal: EntitlementPrincipalResolver) {
 *   const app = new Hono();
 *   app.use("*", createPluginEntitlementGuard("example-plugin", rule, runtime, resolvePrincipal));
 *   return app;
 * }
 * ```
 */
export function createPluginEntitlementGuard(pluginId: string, rule: PluginEntitlement, runtime?: PluginEntitlementRuntime, resolvePrincipal: EntitlementPrincipalResolver = resolveEngineEntitlementPrincipal) {
  return createMiddleware(async (c, next) => {
    const p = await resolvePrincipal(c)
    if (!p) return c.json({ error: 'Unauthorized' }, 401)
    assertPlatformPrincipal(p)
    if (!requiresEntitlementRuntime(rule)) { await next(); return }
    if (!runtime) return c.json({ error: 'Entitlement service unavailable' }, 503)
    try { await runtime.admit(p, pluginId, rule, `${c.req.method} ${c.req.path}`) }
    catch (error) { if (error instanceof EntitlementError) return c.json({ error: error.message }, error.decision.status); throw error }
    await next()
  })
}
/**
 * Trusted downloadable asset catalog entry; client input selects IDs rather than object keys.
 * @see createPluginAssetRouter.
 */
export interface ProtectedPluginAsset {
 /** Public asset ID unique within a plugin catalog. */
 id: string
 /** Owning plugin ID. */
 pluginId: string
 /** Host storage object key passed to the signing port. */
 key: string
 /** Lowercase 64-hex checksum validated before signing. */
 sha256: string
 /** Host-declared media type returned as metadata. */
 contentType: string
}
/**
 * Creates entitled asset URL delivery using a trusted catalog and host signing transport.
 * @param options - runtime checks current entitlement; resolvePrincipal authenticates the request; plugins supplies rules; assets supplies trusted object metadata; sign receives cloned asset, verified principal, and expiresIn=60 seconds and resolves a capability URL.
 * @returns A router serving GET /:pluginId/:assetId with URL/checksum/contentType/60-second lifetime, or 401/404/policy denial responses. Successful responses use private, no-store caching.
 * @throws Request handling propagates resolver/runtime/signing errors or invalid trusted checksums.
 * @remarks Entitlement is checked before and after external signing, but no quota is reserved by this route. Signed URLs may remain usable after later revocation until expiry; the signing port must enforce private access and the requested lifetime. Catalogs, keys, and credentials must remain host-controlled.
 * @example
 * ```typescript
 * import { createPluginAssetRouter } from "@alneas/eaos-server/entitlements";
 * export function assetRoutes(options: Parameters<typeof createPluginAssetRouter>[0]) {
 *   return createPluginAssetRouter(options);
 * }
 * ```
 */
export function createPluginAssetRouter(options: {
  /**
   * Current lifecycle/subscription policy checker; URL delivery checks it before signing and immediately before returning the capability.
   */
  runtime: PluginEntitlementRuntime
  /**
   * Authenticates each asset request and resolves a verified tenant/user principal or null to return 401; errors propagate through Hono.
   */
  resolvePrincipal: EntitlementPrincipalResolver
  /**
   * Trusted plugin-ID to entitlement-policy catalog; an unknown plugin is returned as unavailable.
   */
  plugins: Readonly<Record<string, PluginEntitlement>>
  /**
   * Trusted asset catalog looked up by plugin ID and asset ID; client input never supplies storage object keys.
   */
  assets: readonly ProtectedPluginAsset[]
  /**
   * Host signing callback invoked after initial admission with exact asset/principal and a 60-second lifetime; resolves a private capability URL and may reject.
   */
  sign: (input: {
  /**
   * Structured clone of the trusted catalog asset, including storage key and validated lowercase SHA-256.
   */
  asset: ProtectedPluginAsset;
  /**
   * Verified principal for the current asset request; use it for host signing authorization.
   */
  principal: PlatformPrincipal;
  /**
   * Requested signed URL lifetime in seconds; this router always supplies 60.
   */
  expiresIn: number }) => Promise<string>
}) {
  const router = new Hono()
  router.get('/:pluginId/:assetId', async c => {
    const p = await options.resolvePrincipal(c)
    if (!p) return c.json({ error: 'Unauthorized' }, 401)
    const pluginId = c.req.param('pluginId'), assetId = c.req.param('assetId'), rule = options.plugins[pluginId]
    const asset = options.assets.find(a => a.pluginId === pluginId && a.id === assetId)
    if (!rule || !asset) return c.json({ error: 'Asset unavailable' }, 404)
    const decision = await options.runtime.check(p, pluginId, rule)
    if (!decision.allowed) return c.json({ error: decision.reason }, decision.status)
    if (!/^[a-f0-9]{64}$/.test(asset.sha256)) throw Error('Invalid trusted asset checksum')
    const url = await options.sign({ asset: structuredClone(asset), principal: p, expiresIn: 60 })
    // Signing may call an external service; recheck revocation before returning the capability.
    const current = await options.runtime.check(p, pluginId, rule)
    if (!current.allowed) return c.json({ error: current.reason }, current.status)
    c.header('Cache-Control', 'private, no-store')
    return c.json({ url, sha256: asset.sha256, contentType: asset.contentType, expiresIn: 60 })
  })
  return router
}

export * from './service'
export * from './admin-routes'
