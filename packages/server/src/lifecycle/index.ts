import { mkdir, readFile, open, rename, unlink, rmdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { emptyLifecycleState, normalizeLifecycleState, type LifecycleStore, type LifecycleWriter, type LifecycleState, type PluginLifecycle } from '@alneas/eaos-server/lifecycle-engine'

/** Single control-plane filesystem. All backend processes must read the same ledger.
 * A crashed writer leaves its lock in place: reconcile DB/infra before operator recovery.
 * For independent hosts, implement LifecycleStore using a shared transactional control DB.
 * @example
 * ```typescript
 * import { FileLifecycleStore } from "@alneas/eaos-server/lifecycle";
 * const store = new FileLifecycleStore("./state/lifecycle.json");
 * console.log((await store.read()).platform);
 * ```
 */
export class FileLifecycleStore implements LifecycleStore {
  /** Absolute ledger path resolved at construction; lock directory is path + ".lock". */
  readonly path: string
  /**
   * Resolves a host-selected ledger filename without reading or creating it.
   * @param path - Ledger filename, resolved relative to the current process directory.
   */
  constructor(path: string) { this.path = resolve(path) }
  /**
   * Reads and normalizes the JSON lifecycle ledger.
   * @returns Stored lifecycle state, or a fresh empty state if the file does not exist.
   * @throws Rejects filesystem, JSON parsing, or state-normalization failures other than ENOENT.
   * @example
   * ```typescript
   * import { FileLifecycleStore } from "@alneas/eaos-server/lifecycle";
   * const state = await new FileLifecycleStore("./state/lifecycle.json").read();
   * console.log(state.platform);
   * ```
   */
  async read(): Promise<LifecycleState> {
    try { return normalizeLifecycleState(JSON.parse(await readFile(this.path, 'utf8')) as LifecycleState) }
    catch (error: any) { if (error.code === 'ENOENT') return emptyLifecycleState(); throw error }
  }
  /**
   * Runs one writer callback under an exclusive filesystem lock directory.
   * @typeParam T - Callback result passed through unchanged.
   * @param fn - Called after lock acquisition with ledger read and durable write operations; must await its writes before returning.
   * @returns The callback result after lock directory removal. Writer.write resolves without a value after temporary-file fsync, rename, and directory fsync.
   * @throws Rejects an existing lock, filesystem failures, callback failures, or final lock-removal failures.
   * @remarks Lock acquisition does not wait or retry. Ordinary callback failure removes the lock; a process crash can leave it behind and requires operator reconciliation. Writes may have committed before a later failure. The store does not enforce that all external writers use this lock.
   * @example
   * ```typescript
   * import { FileLifecycleStore } from "@alneas/eaos-server/lifecycle";
   * const store = new FileLifecycleStore("./state/lifecycle.json");
   * const state = await store.withLock(async writer => writer.read());
   * console.log(state.platform);
   * ```
   */
  async withLock<T>(fn: (writer: LifecycleWriter) => Promise<T>): Promise<T> {
    await mkdir(dirname(this.path), { recursive: true })
    const lock = this.path + '.lock'
    try { await mkdir(lock, { mode: 0o700 }) }
    catch (error: any) { if (error.code === 'EEXIST') throw new Error('Lifecycle writer is locked; a crashed operation requires reconciliation', { cause: error }); throw error }
    try {
      return await fn({ read: () => this.read(), write: state => this.write(state) })
    } finally { await rmdir(lock) }
  }
  private async write(state: LifecycleState): Promise<void> {
    const temporary = this.path + '.' + randomUUID() + '.tmp'
    try {
      const handle = await open(temporary, 'wx', 0o600)
      try { await handle.writeFile(JSON.stringify(state) + '\n'); await handle.sync() } finally { await handle.close() }
      await rename(temporary, this.path)
      const directory = await open(dirname(this.path), 'r')
      try { await directory.sync() } finally { await directory.close() }
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
  }
}
/**
 * Host identity, backend routing, and lifecycle admission used by jobs and HTTP guards.
 * @see createLifecycleGuard.
 */
export interface LifecycleRuntime {
  /** Lifecycle engine consulted for current plugin admission. */
  lifecycle: PluginLifecycle
  /** Fallback registered backend ID used only when resolveBackend is absent. */
  backendId: string
  /** Resolve the registered target for a verified tenant; null denies admission without fallback. */
  resolveBackend?: (tenantId: string) => Promise<string | null>
  /** Must resolve authenticated identity / verified webhook signature, never a raw tenant header alone. */
  resolveTenant: (context: Context) => Promise<string | null>
}
/**
 * Resolves the host-selected backend for a verified tenant without falling back after a resolver denial.
 * @param runtime - Lifecycle runtime with either a backend resolver or fixed backend ID.
 * @param tenantId - Verified tenant whose placement is being resolved.
 * @returns Nonempty resolved backend ID, or runtime.backendId when no callback exists.
 * @throws Rejects an empty/null backend result or propagated resolver errors.
 * @example
 * ```typescript
 * import { resolveLifecycleBackend, type LifecycleRuntime } from "@alneas/eaos-server/lifecycle";
 * export async function backend(runtime: LifecycleRuntime, tenantId: string) {
 *   return resolveLifecycleBackend(runtime, tenantId);
 * }
 * ```
 */
export async function resolveLifecycleBackend(runtime: LifecycleRuntime, tenantId: string): Promise<string> {
  const backendId = runtime.resolveBackend ? await runtime.resolveBackend(tenantId) : runtime.backendId
  if (!backendId) throw new Error('Tenant lifecycle target is unavailable')
  return backendId
}
/**
 * Runs a host job through lifecycle admission for its verified tenant and plugin.
 * @typeParam T - Result resolved by the admitted callback.
 * @param runtime - Backend routing and lifecycle engine.
 * @param job - Trusted tenantId/pluginId binding of the queued job.
 * @param callback - Invoked without arguments by lifecycle.run after admission; resolves the job result.
 * @returns The callback result after lifecycle.run completes.
 * @throws Rejects unavailable backend, lifecycle admission/store failure, or callback failure.
 * @remarks Persistence, retries, and idempotency of the job body belong to the host. This wrapper delegates concurrency/drain behavior to lifecycle.run.
 * @example
 * ```typescript
 * import { runLifecycleJob, type LifecycleRuntime } from "@alneas/eaos-server/lifecycle";
 * export async function runJob<T>(runtime: LifecycleRuntime, tenantId: string, pluginId: string, execute: () => Promise<T>) {
 *   return runLifecycleJob(runtime, { tenantId, pluginId }, execute);
 * }
 * ```
 */
export async function runLifecycleJob<T>(runtime: LifecycleRuntime, job: {
  /**
 * Verified tenant identity of the queued job, used to select its lifecycle backend.
 */
tenantId: string;
  /**
 * Exact plugin ID whose current lifecycle admission gates this job body.
 */
pluginId: string }, callback: () => Promise<T>): Promise<T> {
  return runtime.lifecycle.run(await resolveLifecycleBackend(runtime, job.tenantId), job.tenantId, job.pluginId, callback)
}
/**
 * Creates a request guard requiring a verified tenant and currently enabled plugin placement.
 * @param runtime - Host tenant verification, backend routing, and lifecycle engine.
 * @param pluginId - Exact installed plugin ID required by the route.
 * @returns Hono middleware returning 401 for absent tenant, 403 for unavailable backend/inactive plugin, or completing downstream handling without a value after setting tenantId.
 * @throws Request handling propagates host resolver, lifecycle store, and downstream failures.
 * @remarks Authenticate webhook signatures or browser identity in resolveTenant; a raw header is insufficient. This guard performs a point-in-time isEnabled check and does not hold a lifecycle.run execution lease across downstream work.
 * @example
 * ```typescript
 * import { Hono } from "hono";
 * import { createLifecycleGuard, type LifecycleRuntime } from "@alneas/eaos-server/lifecycle";
 * export function pluginRoutes(runtime: LifecycleRuntime) {
 *   const app = new Hono();
 *   app.use("*", createLifecycleGuard(runtime, "example-plugin"));
 *   app.get("/", c => c.json({ available: true }));
 *   return app;
 * }
 * ```
 */
export function createLifecycleGuard(runtime: LifecycleRuntime, pluginId: string) {
  return createMiddleware(async (c, next) => {
    const tenantId = await runtime.resolveTenant(c)
    if (!tenantId) return c.json({ error: 'Unauthorized' }, 401)
    const backendId = runtime.resolveBackend ? await runtime.resolveBackend(tenantId) : runtime.backendId
    if (!backendId || !await runtime.lifecycle.isEnabled(backendId, tenantId, pluginId)) return c.json({ error: 'Plugin is inactive' }, 403)
    c.set('tenantId', tenantId)
    await next()
  })
}
