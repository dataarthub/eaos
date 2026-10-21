/**
 * Optional process-local daily and cumulative monthly call limits.
 * @see {@link McpCacheManager}
 */
export interface QuotaConfig {
  
/** Optional UTC daily call limit; zero is treated as no limit by McpCacheManager. */
  maxCallsPerDay?: number
  
/** Optional cumulative call limit; the current cache manager does not reset it at month boundaries, and zero is unenforced. */
  maxCallsPerMonth?: number
}

/**
 * Cached result reference and absolute expiry in Unix epoch milliseconds.
 * @see {@link McpCacheManager}
 */
export interface CacheEntry {
  
  /** Structured draft/event data or cached result; serialization and validation occur at the owning API boundary. */
  data: unknown
  
/** Optional absolute expiry; the owning validation/evaluation API determines whether it remains live. */
  expiresAt: number
}

/**
 * Store process-local tool cache entries and manually incremented tenant call counts.
 * @remarks No persistence, eviction timer or cross-process coordination. Cache keys use JSON.stringify argument order. Daily counts reset by UTC date; the monthly count is retained across date changes and has no implemented month reset. Quota checks do not increment usage; zero limits are treated as absent.
 *
 * @example
 * ```typescript
 * import { McpCacheManager } from "@alneas/eaos-core/agent/cache-manager";
 * const cache = new McpCacheManager();
 * cache.setCache("tenant-demo", "notes.list", {}, ["note-1"], 60);
 * console.log(cache.getCache("tenant-demo", "notes.list", {}));
 * ```
 */
export class McpCacheManager {
  private cache = new Map<string, CacheEntry>()
  private quotaUsage = new Map<string, { dailyCount: number; monthlyCount: number; lastResetDate: string }>()
  private quotaLimits = new Map<string, QuotaConfig>()

  /**
   * Replace the quota configuration stored for a tenant.
   * @param tenantId - Tenant quota lookup key.
   * @param config - Daily/monthly call limits stored by reference; omitted or zero limits are not enforced.
   * @returns No value; limits have been set.
   * @example
   * ```typescript
   * import { McpCacheManager } from "@alneas/eaos-core/agent/cache-manager";
   * const cache = new McpCacheManager();
   * cache.setTenantQuota("tenant-demo", { maxCallsPerDay: 100 });
   * ```
   */
  setTenantQuota(tenantId: string, config: QuotaConfig): void {
    this.quotaLimits.set(tenantId, config)
  }

  /**
   * Check configured call counts without reserving or consuming quota.
   * @param tenantId - Tenant quota key; tenants without limits are allowed.
   * @returns Allowed or denied with a reason; checking may initialize/reset the UTC daily counter.
   * @example
   * ```typescript
   * import { McpCacheManager } from "@alneas/eaos-core/agent/cache-manager";
   * const cache = new McpCacheManager();
   * console.log(cache.checkQuota("tenant-demo").allowed); // true
   * ```
   */
  checkQuota(tenantId: string): { 
  /** Admission/check decision; consumers must inspect it before using the associated result or performing an effect. */
  allowed: boolean; 
/** Human-readable explanation of the decision or requested action. */
  reason?: string } {
    const limit = this.quotaLimits.get(tenantId)
    if (!limit) return { allowed: true }

    const today = new Date().toISOString().split('T')[0]
    let usage = this.quotaUsage.get(tenantId)

    if (!usage || usage.lastResetDate !== today) {
      usage = {
        dailyCount: 0,
        monthlyCount: usage ? usage.monthlyCount : 0,
        lastResetDate: today,
      }
      this.quotaUsage.set(tenantId, usage)
    }

    if (limit.maxCallsPerDay && usage.dailyCount >= limit.maxCallsPerDay) {
      return { allowed: false, reason: `Tenant '${tenantId}' exceeded daily MCP quota (${limit.maxCallsPerDay} calls/day)` }
    }

    if (limit.maxCallsPerMonth && usage.monthlyCount >= limit.maxCallsPerMonth) {
      return { allowed: false, reason: `Tenant '${tenantId}' exceeded monthly MCP quota (${limit.maxCallsPerMonth} calls/month)` }
    }

    return { allowed: true }
  }

  /**
   * Increment both call counters for a tenant.
   * @param tenantId - Tenant whose usage increases; works even without a configured limit.
   * @returns No value; daily/monthly counters have increased.
   * @remarks Resets daily count on a new UTC date, retaining monthly count. No atomic admission reservation occurs with checkQuota.
   * @example
   * ```typescript
   * import { McpCacheManager } from "@alneas/eaos-core/agent/cache-manager";
   * const cache = new McpCacheManager();
   * cache.incrementQuota("tenant-demo");
   * ```
   */
  incrementQuota(tenantId: string): void {
    const today = new Date().toISOString().split('T')[0]
    let usage = this.quotaUsage.get(tenantId)
    if (!usage || usage.lastResetDate !== today) {
      usage = { dailyCount: 0, monthlyCount: usage ? usage.monthlyCount : 0, lastResetDate: today }
    }
    usage.dailyCount += 1
    usage.monthlyCount += 1
    this.quotaUsage.set(tenantId, usage)
  }

  /**
   * Read a tool result and lazily remove an expired entry.
   * @param tenantId - Tenant key.
   * @param toolName - Exact tool name.
   * @param args - Arguments serialized in insertion order to form the cache key.
   * @returns The original cached data reference, or undefined on miss/expiry; cached undefined is indistinguishable from a miss.
   * @throws JSON serialization errors for unsupported argument values, including cycles and bigint.
   * @example
   * ```typescript
   * import { McpCacheManager } from "@alneas/eaos-core/agent/cache-manager";
   * const cache = new McpCacheManager();
   * console.log(cache.getCache("tenant-demo", "notes.list", {}));
   * ```
   */
  getCache(tenantId: string, toolName: string, args: Record<string, unknown>): unknown | undefined {
    const key = `${tenantId}:${toolName}:${JSON.stringify(args)}`
    const entry = this.cache.get(key)
    if (!entry) return undefined

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return undefined
    }
    return entry.data
  }

  /**
   * Replace a cached tool result with an expiration time.
   * @param tenantId - Tenant key.
   * @param toolName - Exact tool name.
   * @param args - Arguments serialized in insertion order to form the cache key.
   * @param data - Result stored by reference.
   * @param ttlSeconds - Lifetime in seconds relative to Date.now; defaults to 60 and is not validated.
   * @returns No value; the entry has been stored.
   * @throws JSON serialization errors for unsupported argument values, including cycles and bigint.
   * @example
   * ```typescript
   * import { McpCacheManager } from "@alneas/eaos-core/agent/cache-manager";
   * const cache = new McpCacheManager();
   * cache.setCache("tenant-demo", "notes.list", {}, ["note-1"]);
   * ```
   */
  setCache(tenantId: string, toolName: string, args: Record<string, unknown>, data: unknown, ttlSeconds = 60): void {
    const key = `${tenantId}:${toolName}:${JSON.stringify(args)}`
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttlSeconds * 1000,
    })
  }
}

/**
 * Module-local shared cache/quota tracker with no persistence or eviction timer.
 * @see {@link McpCacheManager}
 */
export const globalMcpCacheManager = new McpCacheManager()
