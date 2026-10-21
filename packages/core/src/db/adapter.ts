/**
 * Unified Database Adapter Interface for EAOS
 * Allows seamless switching between Oracle ADB (OCI VPD), PostgreSQL/Neon (RLS) and local SQLite.
 *
 * This file defines the contract only. Implementations live in the consuming app
 * (e.g. apps/backend/server/db/) to avoid pulling driver dependencies into core.
 * @see {@link createPlatformContext}
 */
export type DbDriverType = 'oracle' | 'supabase' | 'postgres'

/**
 * Tenant and optional user claims installed on a host-managed database session.
 * @see {@link createPlatformContext}
 */
export interface TenantSessionContext {
  
/** Verified tenant boundary for the record or operation; host authorization must establish this scope. */
  tenantId: string
  
/** User identity within the tenant supplied by the trusted host. */
  userId?: string
}

/**
 * Current connection count, configured pool size and driver family.
 * @see {@link createPlatformContext}
 */
export interface ConnectionStats {
  
/** Host-reported number of connections currently active. */
  activeConnections: number
  
/** Host-reported configured connection-pool capacity. */
  poolSize: number
  
/** Database driver family reporting these statistics. */
  driver: DbDriverType
}

/**
 * Core database adapter contract.
 * Implementations must handle connection lifecycle, multi-tenant isolation,
 * and driver-specific details internally.
 * @see {@link createPlatformContext}
 */
export interface DatabaseAdapter {
  
  /** Driver family implemented by this host connection adapter. */
  readonly type: DbDriverType

  
  /**
   * Run an asynchronous callback with a host-managed unscoped database connection.
   * @typeParam T - Resolved callback result type retained by the Promise.
   * @param domain - Logical connection/pool routing key interpreted by the host adapter.
   * @param callback - Called after acquisition with the driver-specific connection; resolve the desired result before the host releases the connection.
   * @returns The resolved callback result.
   * @throws Acquisition, callback and cleanup failures may reject according to the host implementation.
   * @remarks Host implementation owns acquisition/release and transaction behavior; this operation installs no tenant context. Do not retain the connection beyond callback completion.
   * @example
   * ```typescript
   * import type { DatabaseAdapter } from "@alneas/eaos-core/db/adapter";
   * async function inspectHostDatabase(adapter: DatabaseAdapter) { return adapter.withConnection("health", async connection => typeof connection.execute === "function"); }
   * ```
   */
  withConnection<T>(
    domain: string,
    callback: (connection: any) => Promise<T>
  ): Promise<T>

  
  /**
   * Run a callback under host-installed tenant session context.
   * @typeParam T - Resolved callback output preserved through the connection Promise.
   * @param domain - Logical host pool/domain routing key.
   * @param callback - Asynchronous operation receiving a driver connection only while its tenant context is installed; do not retain the connection.
   * @param context - Verified tenant and optional user claims the adapter installs and cleans up on the session.
   * @returns The resolved callback result after host-managed connection work.
   * @throws Host acquisition/context setup, callback and cleanup failures may reject.
   * @remarks Host implementation must enforce session isolation, release/reset connections and define transaction behavior; the caller establishes identity trust.
   * @example
   * ```typescript
   * import type { DatabaseAdapter } from "@alneas/eaos-core/db/adapter";
   * async function inspectTenantDatabase(adapter: DatabaseAdapter) { return adapter.withTenantConnection("notes", async connection => typeof connection.execute === "function", { tenantId: "tenant-demo", userId: "user-demo" }); }
   * ```
   */
  withTenantConnection<T>(
    domain: string,
    callback: (connection: any) => Promise<T>,
    context: TenantSessionContext
  ): Promise<T>

  
  /**
   * Probe host database connection health.
   * @returns True when the host probe reports available, false when it reports unavailable.
   * @throws Host probe failures may reject rather than resolve false.
   * @remarks Timeout, retries and network behavior are adapter-defined.
   * @example
   * ```typescript
   * import type { DatabaseAdapter } from "@alneas/eaos-core/db/adapter";
   * async function pingHost(adapter: DatabaseAdapter) { return adapter.ping(); }
   * ```
   */
  ping(): Promise<boolean>

  
  /**
   * Read the host connection-pool statistics.
   * @returns Active connection count, pool capacity and driver family.
   * @throws Host statistics errors may be thrown.
   * @remarks Snapshot timing and ownership follow the host implementation.
   * @example
   * ```typescript
   * import type { DatabaseAdapter } from "@alneas/eaos-core/db/adapter";
   * function inspectPool(adapter: DatabaseAdapter) { return adapter.getStats(); }
   * ```
   */
  getStats(): ConnectionStats

  
  /**
   * Release host-managed database connections and pools.
   * @returns No value; Promise completion means the host shutdown operation completed.
   * @throws Host shutdown failures reject the Promise.
   * @remarks Call when the owning host no longer needs the adapter; idempotency and handling of in-flight operations are implementation-specific.
   * @example
   * ```typescript
   * import type { DatabaseAdapter } from "@alneas/eaos-core/db/adapter";
   * async function closeHostDatabase(adapter: DatabaseAdapter) { await adapter.close(); }
   * ```
   */
  close(): Promise<void>
}
