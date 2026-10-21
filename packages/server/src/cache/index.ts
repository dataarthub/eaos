import type { Context } from 'hono'
/**
 * Per-fetch storage controls for {@link MemoryCacheManager.getOrSet}.
 */
export interface CacheOptions {
 /** Retention in milliseconds; finite and nonnegative. Zero disables storing; omission uses the manager default. */
 ttlMs?: number
 /** Tags attached to a newly stored entry for invalidation; defaults to none. */
 tags?: string[]
 /** Fetch even when a cached value exists; successful fetches may still populate the cache. @defaultValue false */
 bypass?: boolean
}
/**
 * Verified identity partition used by {@link MemoryCacheManager.forScope}.
 */
export interface CacheScope {
 /** Nonblank authenticated tenant ID. */
 tenantId: string
 /** Nonblank trusted plugin ID. */
 pluginId: string
 /** Nonblank authenticated user ID. */
 userId: string
 /** Permission revision included in the key partition; defaults to an empty string. */
 permissionVersion?: string
}
interface Entry { value: unknown; expiresAt: number; tags: Set<string> }
/**
 * Stores cloned values in a bounded process-local cache with TTL and tag invalidation.
 * @remarks Values must support structuredClone. Entries expire lazily on access; no timers, persistent storage, or cross-process invalidation are installed. Capacity eviction removes the oldest inserted entry. Concurrent misses run separate fetchers; only the latest fetch started for a key may populate it, and any invalidation prevents previously started fetches from repopulating entries.
 * @example
 * ```typescript
 * import { MemoryCacheManager } from "@alneas/eaos-server/cache";
 * const cache = new MemoryCacheManager();
 * const result = await cache.getOrSet("answer", async () => ({ value: 42 }));
 * console.log(result.value);
 * cache.clear();
 * ```
 */
export class MemoryCacheManager {
 private readonly values = new Map<string, Entry>()
 private readonly tags = new Map<string, Set<string>>()
 private readonly pending = new Map<string, symbol>()
 private epoch = 0
 private readonly maxEntries: number
 private readonly ttl: number
 /**
  * Creates an independent cache with validated capacity and default retention.
  * @param options - maxEntries defaults to 1000 and must be a positive safe integer; defaultTtlMs defaults to 60000 milliseconds and must be finite and nonnegative.
  * @throws If capacity or default retention is invalid.
  */
 constructor(options: { 
  /**
   * Maximum retained cache entries; defaults to 1000 and must be a positive safe integer. Capacity eviction removes the oldest inserted entry.
   */
  maxEntries?: number; 
  /**
   * Default retention in milliseconds, finite and nonnegative; defaults to 60000. Zero disables retaining newly fetched/set entries.
   */
  defaultTtlMs?: number } = {}) {
  this.maxEntries = options.maxEntries ?? 1000; this.ttl = options.defaultTtlMs ?? 60_000
  if (!Number.isSafeInteger(this.maxEntries) || this.maxEntries < 1 || !Number.isFinite(this.ttl) || this.ttl < 0) throw new Error('Invalid cache limits')
 }
 /** Request bypass detector; see {@link isNoCacheRequested} for parameter semantics and example. */
 isNoCacheRequested = isNoCacheRequested
 private remove(key: string) {
  const entry = this.values.get(key)
  if (entry) for (const tag of entry.tags) { const keys = this.tags.get(tag)!; keys.delete(key); if (!keys.size) this.tags.delete(tag) }
  this.values.delete(key)
 }
 private prune() { const now = Date.now(); for (const [key, entry] of this.values) if (entry.expiresAt <= now) this.remove(key) }
 /**
  * Stores a cloned value, replacing an existing key and invalidating its in-flight fetch token.
  * @typeParam T - Structured-cloneable value type.
  * @param key - Exact cache key, without automatic authorization or partitioning.
  * @param value - Value to clone for storage.
  * @param ttlMs - Nonnegative finite milliseconds from the current clock; defaults to the manager retention. Zero removes the prior entry without storing.
  * @param tags - Invalidation tags; duplicates are collapsed and omission uses none.
  * @returns No value; completes after cloning and inserting or removing the entry.
  * @throws For invalid TTL or a value that cannot be structured-cloned. A previous entry may already have been removed when cloning fails.
  * @example
  * ```typescript
  * import { MemoryCacheManager } from "@alneas/eaos-server/cache";
  * const cache = new MemoryCacheManager();
  * cache.set("answer", { value: 42 }, 1000, ["answers"]);
  * ```
  */
 set<T>(key: string, value: T, ttlMs = this.ttl, tags: string[] = []) {
  if (!Number.isFinite(ttlMs) || ttlMs < 0) throw new Error('Invalid cache TTL')
  this.pending.delete(key); this.remove(key); this.prune()
  if (ttlMs === 0) return
  const entry = { value: structuredClone(value), expiresAt: Date.now() + ttlMs, tags: new Set(tags) }
  while (this.values.size >= this.maxEntries) this.remove(this.values.keys().next().value!)
  this.values.set(key, entry)
  for (const tag of entry.tags) { let keys = this.tags.get(tag); if (!keys) this.tags.set(tag, keys = new Set()); keys.add(key) }
 }
 /**
  * Returns a cloned cached value or fetches and conditionally caches a new value.
  * @typeParam T - Structured-cloneable value returned by fetcher and this method.
  * @param key - Exact cache key; use forScope for authenticated partitions.
  * @param fetcher - Called without arguments on a miss or bypass; resolves a cloneable value. Concurrent misses are not coalesced.
  * @param options - Retention, tags, and bypass settings; see {@link CacheOptions}.
  * @returns A separate clone of the cached or fetched value, including when invalidation prevents storage.
  * @throws Rejects on fetcher failure, invalid TTL used for insertion, or structuredClone failure.
  * @example
  * ```typescript
  * import { MemoryCacheManager } from "@alneas/eaos-server/cache";
  * const cache = new MemoryCacheManager();
  * console.log(await cache.getOrSet("answer", async () => 42));
  * ```
  */
 async getOrSet<T>(key: string, fetcher: () => Promise<T>, options: CacheOptions = {}): Promise<T> {
  this.prune()
  const cached = this.values.get(key)
  if (!options.bypass && cached) return structuredClone(cached.value) as T
  const token = Symbol(), epoch = this.epoch; this.pending.set(key, token)
  try {
   const value = await fetcher()
   if (epoch === this.epoch && this.pending.get(key) === token) this.set(key, value, options.ttlMs ?? this.ttl, options.tags)
   return structuredClone(value)
  } finally { if (this.pending.get(key) === token) this.pending.delete(key) }
 }
 /**
  * Removes entries carrying any requested tag and prevents pending fetches from populating the cache.
  * @param tags - One exact tag or multiple tags; an empty array removes no stored entries but still invalidates pending writes.
  * @returns No value; removal completes synchronously.
  * @example
  * ```typescript
  * import { MemoryCacheManager } from "@alneas/eaos-server/cache";
  * const cache = new MemoryCacheManager();
  * cache.set("answer", 42, 1000, ["answers"]);
  * cache.invalidateTags("answers");
  * ```
  */
 invalidateTags(tags: string | string[]) {
  this.epoch++
  for (const tag of typeof tags === 'string' ? [tags] : tags) for (const key of [...(this.tags.get(tag) ?? [])]) this.remove(key)
 }
 /**
  * Removes entries whose exact keys start with the supplied prefix and invalidates pending writes.
  * @param prefix - Case-sensitive key prefix; an empty prefix matches every entry.
  * @returns No value; removal completes synchronously.
  * @example
  * ```typescript
  * import { MemoryCacheManager } from "@alneas/eaos-server/cache";
  * const cache = new MemoryCacheManager();
  * cache.invalidatePrefix("reports:");
  * ```
  */
 invalidatePrefix(prefix: string) { this.epoch++; for (const key of this.values.keys()) if (key.startsWith(prefix)) this.remove(key) }
 /**
  * Removes every cached entry, tag index, and pending write token.
  * @returns No value; clearing completes synchronously without cancelling fetchers already running.
  * @example
  * ```typescript
  * import { MemoryCacheManager } from "@alneas/eaos-server/cache";
  * const cache = new MemoryCacheManager();
  * cache.clear();
  * ```
  */
 clear() { this.epoch++; this.values.clear(); this.tags.clear(); this.pending.clear() }
 /**
  * Prunes expired entries and counts the remaining stored values.
  * @returns Current number of unexpired entries, excluding pending fetches.
  * @example
  * ```typescript
  * import { MemoryCacheManager } from "@alneas/eaos-server/cache";
  * const cache = new MemoryCacheManager();
  * console.log(cache.size()); // 0
  * ```
  */
 size() { this.prune(); return this.values.size }
 /**
 * Creates a tenant/plugin/user partition with authorization before and after asynchronous work.
 * @param scope - Verified nonblank identity IDs and optional permission revision; see {@link CacheScope}.
 * @param authorize - Called without arguments on every lookup, including hits, and after fetching and before returning. Any truthy result permits access; errors propagate.
 * @returns A scoped getOrSet using the same key/fetcher/options semantics as this manager, plus invalidate(), which removes this partition without returning a value or calling authorize.
 * @throws Synchronously for missing/blank scope IDs. Scoped lookups reject for denied access or propagated authorization/fetch/clone errors.
 * @remarks Tenant and plugin tags are added to fetched entries. The host must supply trusted identity and live authorization; partitioning does not authenticate callers. Invalidating a scope also prevents other in-flight manager fetches from populating entries.
 * @example
 * ```typescript
 * import { MemoryCacheManager, type CacheScope } from "@alneas/eaos-server/cache";
 * export function userCache(scope: CacheScope, authorize: () => Promise<boolean>) {
 *   return new MemoryCacheManager().forScope(scope, authorize);
 * }
 * ```
 */
 forScope(scope: CacheScope, authorize: () => boolean | Promise<boolean>) {
  for (const id of [scope.tenantId, scope.pluginId, scope.userId]) if (typeof id !== 'string' || !id.trim()) throw new Error('Verified cache scope required')
  const prefix = JSON.stringify([scope.tenantId, scope.pluginId, scope.userId, scope.permissionVersion ?? '']) + ':'
  const tenantTag = `tenant:${scope.tenantId}`, pluginTag = `plugin:${scope.pluginId}`
  const allowed = async () => { if (!await authorize()) throw new Error('Cache access denied') }
  return { getOrSet: async <T>(key: string, fetcher: () => Promise<T>, options: CacheOptions = {}) => {
   await allowed()
   const value = await this.getOrSet(prefix + key, async () => { const result = await fetcher(); await allowed(); return result }, { ...options, tags: [...(options.tags ?? []), tenantTag, pluginTag] })
   await allowed(); return value
  }, invalidate: () => this.invalidatePrefix(prefix) }
 }
}
/**
 * Detects request directives or query flags asking to bypass cached values.
 * @param c - Hono request context; reads Cache-Control, Pragma, refresh, and nocache.
 * @returns True for no-cache, max-age=0 (optionally quoted), or refresh/nocache equal to true or 1; false otherwise. Header directives are case-insensitive; query flag values are case-sensitive.
 * @example
 * ```typescript
 * import { Hono } from "hono";
 * import { isNoCacheRequested } from "@alneas/eaos-server/cache";
 * const app = new Hono();
 * app.get("/cache-policy", c => c.json({ bypass: isNoCacheRequested(c) }));
 * console.log(await (await app.request("/cache-policy?refresh=1")).json());
 * ```
 */
export function isNoCacheRequested(c: Pick<Context, 'req'>): boolean {
 const directives = `${c.req.header('cache-control') ?? ''},${c.req.header('pragma') ?? ''}`.toLowerCase().split(',').map(v => v.trim())
 return directives.some(v => v === 'no-cache' || /^max-age\s*=\s*"?0"?$/.test(v)) || ['refresh', 'nocache'].some(key => ['true', '1'].includes(c.req.query(key) ?? ''))
}
