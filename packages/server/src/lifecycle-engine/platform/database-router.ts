import type { DatabaseAdapter, TenantSessionContext, ConnectionStats } from '@alneas/eaos-core/db/adapter'
import type { BackendTarget } from '../index'

/**
 * Routes verified tenant operations to isolated existing database pools without implicit fallback.
 * 
 * 
 * One execution host, isolated pools per DB. No implicit shared fallback or unscoped business access.
 * @remarks
 * All configured adapters must share one dialect. The host supplies membership-verified tenant context, trusted target resolution and real adapter pools. Unscoped business connections always reject; administration requires a separate control adapter. close owns and closes every distinct supplied adapter.
 * 
 * @example
 * ```typescript
 * import { TenantDatabaseRouter } from '@alneas/eaos-server/platform/database-router';
 * import type { DatabaseAdapter } from '@alneas/eaos-core/db/adapter';
 * import type { BackendTarget } from '@alneas/eaos-server/lifecycle-engine';
 * export function connectRouter(resolve: (verifiedTenantId: string) => BackendTarget, adapters: ReadonlyMap<string, DatabaseAdapter>) { return new TenantDatabaseRouter(resolve, adapters); }
 * ```
 */
export class TenantDatabaseRouter implements DatabaseAdapter {
  /**
   * The single SQL dialect shared by every configured adapter.
   */
  readonly type: DatabaseAdapter['type']
  private readonly adapters: Map<string, DatabaseAdapter>
  /**
   * Snapshots configured physical database adapters and requires a single shared dialect.
   * @param resolveTarget - Resolve the verified tenant to its trusted lifecycle backend; synchronous errors propagate.
   * @param adapters - Nonempty map keyed by physical databaseId; adapter objects are shared and later owned by close().
   * @throws Error for no adapters or multiple adapter dialects.
   * 
   * @example
   * ```typescript
   * import { TenantDatabaseRouter } from '@alneas/eaos-server/platform/database-router';
   * import type { DatabaseAdapter } from '@alneas/eaos-core/db/adapter';
   * import type { BackendTarget } from '@alneas/eaos-server/lifecycle-engine';
   * export function connectRouter(resolve: (verifiedTenantId: string) => BackendTarget, adapters: ReadonlyMap<string, DatabaseAdapter>) { return new TenantDatabaseRouter(resolve, adapters); }
   * ```
   */
  constructor(private readonly resolveTarget: (verifiedTenantId: string) => BackendTarget, adapters: ReadonlyMap<string, DatabaseAdapter>) {
    this.adapters = new Map(adapters)
    const types = new Set([...this.adapters.values()].map(adapter => adapter.type))
    if (!this.adapters.size || types.size !== 1) throw new Error('Tenant DB routing requires configured adapters of one dialect')
    this.type = types.values().next().value!
  }
  /**
   * Rejects unscoped business database access to require a verified tenant context.
   * @typeParam T - Callback result type required by DatabaseAdapter; this method always rejects.
   * @param _domain - Unused business domain; no connection is opened.
   * @param _callback - Unused callback; it is never invoked.
   * @returns A rejected Promise; this method never resolves a callback result.
   * @throws Always rejects with the verified-context requirement.
   * 
   * @example
   * ```typescript
   * import { TenantDatabaseRouter } from '@alneas/eaos-server/platform/database-router';
   * export async function rejectUnscoped(router: TenantDatabaseRouter) { await router.withConnection('reports', async () => undefined); }
   * ```
   */
  withConnection<T>(_domain: string, _callback: (connection: unknown) => Promise<T>): Promise<T> {
    return Promise.reject(new Error('Business DB routing requires a verified tenant context; use a separate control adapter for administration'))
  }
  /**
   * Delegates one verified tenant connection to its exact configured physical database adapter.
   * @typeParam T - Value resolved by work on the selected tenant connection.
   * @param domain - Business domain forwarded to the selected adapter.
   * @param callback - Async work invoked by the adapter with its connection; must enforce resource permission.
   * @param context - Verified nonblank trimmed tenant session; a copied context is forwarded.
   * @returns The selected adapter callback result.
   * @throws Rejects invalid tenant, dedicated mismatch, missing adapter or adapter/callback failure; target resolver errors may throw synchronously.
   * 
   * @remarks
   * Dedicated target tenant must match. Missing target adapters and dedicated failures never fall back to shared storage. Cancellation/transaction/connection cleanup follow the selected adapter contract.
   * 
   * @example
   * ```typescript
   * import { TenantDatabaseRouter } from '@alneas/eaos-server/platform/database-router';
   * export function withVerifiedTenant<T>(router: TenantDatabaseRouter, tenantId: string, work: (connection: unknown) => Promise<T>) { return router.withTenantConnection('reports', work, { tenantId }); }
   * ```
   */
  withTenantConnection<T>(domain: string, callback: (connection: unknown) => Promise<T>, context: TenantSessionContext): Promise<T> {
    if (!context?.tenantId || context.tenantId === '*' || context.tenantId !== context.tenantId.trim()) return Promise.reject(new Error('Verified tenant context is required'))
    const target = this.resolveTarget(context.tenantId)
    if (target.mode === 'dedicated' && target.tenantId !== context.tenantId) return Promise.reject(new Error('Dedicated database tenant mismatch'))
    const adapter = this.adapters.get(target.databaseId)
    if (!adapter) return Promise.reject(new Error('Tenant DB adapter is not configured; shared fallback is disabled'))
    return adapter.withTenantConnection(domain, callback, { ...context })
  }
  /**
   * Checks every distinct configured database adapter concurrently.
   * @returns True only when every adapter ping resolves true; false if any resolves false.
   * @throws Rejects if any adapter ping rejects.
   * 
   * @example
   * ```typescript
   * import { TenantDatabaseRouter } from '@alneas/eaos-server/platform/database-router';
   * export const health = (router: TenantDatabaseRouter) => router.ping();
   * ```
   */
  async ping(): Promise<boolean> { return (await Promise.all([...new Set(this.adapters.values())].map(adapter => adapter.ping()))).every(Boolean) }
  /**
   * Aggregates connection and pool counts from every distinct configured adapter.
   * @returns ConnectionStats with the router dialect and summed counts.
   * @throws Propagates adapter getStats errors.
   * 
   * @example
   * ```typescript
   * import { TenantDatabaseRouter } from '@alneas/eaos-server/platform/database-router';
   * export const stats = (router: TenantDatabaseRouter) => router.getStats();
   * ```
   */
  getStats(): ConnectionStats {
    const stats = [...new Set(this.adapters.values())].map(adapter => adapter.getStats())
    return { driver: this.type, activeConnections: stats.reduce((n, s) => n + s.activeConnections, 0), poolSize: stats.reduce((n, s) => n + s.poolSize, 0) }
  }
  /**
   * Closes all distinct configured adapters and collects asynchronous cleanup failures.
   * @returns Resolves without a value after every adapter close settles successfully.
   * @throws Rejects with AggregateError for one or more rejected close Promises; synchronous adapter errors may also reject.
   * 
   * @remarks
   * The router does not mark itself closed or make repeated calls idempotent; each adapter owns its lifecycle semantics. A synchronously throwing close implementation can interrupt initial dispatch.
   * 
   * @example
   * ```typescript
   * import { TenantDatabaseRouter } from '@alneas/eaos-server/platform/database-router';
   * export async function shutdown(router: TenantDatabaseRouter) { await router.close(); }
   * ```
   */
  async close(): Promise<void> {
    const results = await Promise.allSettled([...new Set(this.adapters.values())].map(adapter => adapter.close()))
    const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason)
    if (errors.length) throw new AggregateError(errors, 'Tenant DB adapters failed to close')
  }
}
