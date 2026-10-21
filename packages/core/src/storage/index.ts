/**
 * Logical storage categories for host measurement and capacity policy.
 * @see {@link assertStorageUsage}
 */
export type StoragePlane = 'database' | 'object' | 'vector' | 'graph'

/**
 * Tenant soft byte limits and optional warning ratio; absent planes have no default limit.
 * @see {@link assertStorageUsage}
 */
export interface StorageBudget {
  
/** Verified tenant boundary for the record or operation; host authorization must establish this scope. */
  tenantId: string
  /** Soft byte limits are host policy; omitted planes have no framework default. */
  limits: Partial<Record<StoragePlane, number>>
  
/** Optional warning fraction greater than zero and at most one; no warning is sent by validation. */
  warnAtRatio?: number
}

/**
 * Tenant usage snapshot with byte counts and optional item counts by plane.
 * @see {@link assertStorageUsage}
 */
export interface StorageUsage {
  
/** Verified tenant boundary for the record or operation; host authorization must establish this scope. */
  tenantId: string
  
/** Parseable timestamp at which host usage was measured. */
  measuredAt: string
  
/** Measured nonnegative safe-integer bytes for each available storage plane. */
  bytes: Partial<Record<StoragePlane, number>>
  
/** Optional nonnegative safe-integer item counts for measurable planes. */
  items?: Partial<Record<StoragePlane, number>>
}

/**
 * Tenant-level capacity and item-count snapshot; the host may omit planes it cannot measure.
 * @see {@link assertStorageUsage}
 */
export type TenantStorageMetrics = StorageUsage

/**
 * Host measurement and optional-budget lookup port.
 * @see {@link assertStorageUsage}
 */
export interface StorageUsageAdapter {
  
  /**
   * Read an optional tenant storage budget from host policy.
   * @param tenantId - Verified tenant whose budget is requested.
   * @returns Budget or null when the host has none; omitted planes have no framework default limit.
   * @throws Host lookup failures reject the Promise.
   * @remarks Host owns authorization, freshness and persistence.
   * @example
   * ```typescript
   * import type { StorageUsageAdapter } from "@alneas/eaos-core/storage";
   * async function inspectBudget(adapter: StorageUsageAdapter) { return adapter.getBudget("tenant-demo"); }
   * ```
   */
  getBudget(tenantId: string): Promise<StorageBudget | null>
  
  /**
   * Measure tenant storage usage through the host provider.
   * @param tenantId - Verified tenant whose storage planes are measured.
   * @returns Usage snapshot; hosts may omit planes they cannot measure.
   * @throws Host measurement failures reject the Promise.
   * @remarks Measurement accuracy, cost and freshness are host-defined; validate returned shape with assertStorageUsage before quota decisions.
   * @example
   * ```typescript
   * import type { StorageUsageAdapter } from "@alneas/eaos-core/storage";
   * async function inspectUsage(adapter: StorageUsageAdapter) { return adapter.measure("tenant-demo"); }
   * ```
   */
  measure(tenantId: string): Promise<StorageUsage>
}

/**
 * Alias of the host usage/budget measurement port.
 * @see {@link assertStorageUsage}
 */
export type TenantStorageMetricsAdapter = StorageUsageAdapter

/**
 * Proposed per-tenant storage growth in one plane.
 * @see {@link assertStorageUsage}
 */
export interface StorageCapacityCheck {
  
/** Verified tenant boundary for the record or operation; host authorization must establish this scope. */
  tenantId: string
  
/** Logical storage plane whose capacity is being checked. */
  plane: StoragePlane
  
/** Estimated additional bytes requested before a storage write; host policy decides admission. */
  estimatedBytes: number
}

/**
 * The host owns metering and enforcement; plugins receive a stable capacity boundary.
 * @see {@link assertStorageUsage}
 */
export interface StorageCapacityPolicy {
  
  /**
   * Ask host policy whether estimated storage growth is allowed.
   * @param input - Verified tenant, logical plane and estimated additional bytes.
   * @returns Allowed/denied data with an optional explanation.
   * @throws Host capacity-policy failures reject the Promise.
   * @remarks A decision is not a framework reservation; host must define concurrency, metering and enforcement at the write boundary.
   * @example
   * ```typescript
   * import type { StorageCapacityPolicy } from "@alneas/eaos-core/storage";
   * async function inspectCapacity(policy: StorageCapacityPolicy) { return policy.check({ tenantId: "tenant-demo", plane: "object", estimatedBytes: 1024 }); }
   * ```
   */
  check(input: StorageCapacityCheck): Promise<{ 
  /** Admission/check decision; consumers must inspect it before using the associated result or performing an effect. */
  allowed: boolean; 
/** Human-readable explanation of the decision or requested action. */
  reason?: string }>
}

function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) throw new Error(`Invalid ${name}`)
  return value
}

function bytes(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`Invalid ${name}`)
  return Number(value)
}

/**
 * Validate host-reported usage before it is used for quota or cost decisions.
 * @param value - Tenant-scoped usage with a parseable measuredAt and nonnegative safe-integer byte/item counts for known planes.
 * @returns The original object, without copying or freezing it.
 * @throws Error for an invalid tenant, timestamp, plane or count.
 * @remarks Does not measure storage or authorize the tenant scope.
 * @example
 * ```typescript
 * import { assertStorageUsage } from "@alneas/eaos-core/storage";
 * const usage = assertStorageUsage({ tenantId: "tenant-demo", measuredAt: "2026-10-19T00:00:00Z", bytes: { database: 1024 } });
 * console.log(usage.bytes.database);
 * ```
 */
export function assertStorageUsage(value: StorageUsage): StorageUsage {
  if (!value || typeof value !== 'object' || !value.bytes || typeof value.bytes !== 'object') throw new Error('Invalid storage usage')
  text(value?.tenantId, 'storage tenantId')
  if (!Number.isFinite(Date.parse(value.measuredAt))) throw new Error('Invalid storage measuredAt')
  for (const [plane, amount] of Object.entries(value.bytes ?? {})) {
    if (!['database', 'object', 'vector', 'graph'].includes(plane)) throw new Error('Invalid storage plane')
    bytes(amount, `${plane} bytes`)
  }
  for (const [plane, amount] of Object.entries(value.items ?? {})) {
    if (!['database', 'object', 'vector', 'graph'].includes(plane)) throw new Error('Invalid storage plane')
    bytes(amount, `${plane} items`)
  }
  return value
}

/**
 * Validate host-defined per-plane byte limits and a warning threshold.
 * @param value - Tenant budget with nonnegative safe-integer limits; optional warnAtRatio must be greater than zero and at most one.
 * @returns The original budget object.
 * @throws Error for an invalid tenant, plane, byte limit or warning ratio.
 * @remarks Missing planes have no framework limit; validation does not enforce capacity.
 * @example
 * ```typescript
 * import { assertStorageBudget } from "@alneas/eaos-core/storage";
 * console.log(assertStorageBudget({ tenantId: "tenant-demo", limits: { object: 1048576 }, warnAtRatio: 0.8 }));
 * ```
 */
export function assertStorageBudget(value: StorageBudget): StorageBudget {
  if (!value || typeof value !== 'object' || !value.limits || typeof value.limits !== 'object') throw new Error('Invalid storage budget')
  text(value?.tenantId, 'budget tenantId')
  for (const [plane, amount] of Object.entries(value.limits ?? {})) {
    if (!['database', 'object', 'vector', 'graph'].includes(plane)) throw new Error('Invalid storage plane')
    bytes(amount, `${plane} limit`)
  }
  if (value.warnAtRatio !== undefined && (!Number.isFinite(value.warnAtRatio) || value.warnAtRatio <= 0 || value.warnAtRatio > 1)) throw new Error('Invalid storage warning ratio')
  return value
}
