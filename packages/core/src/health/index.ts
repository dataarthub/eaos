/**
 * Per-probe success, failure or timeout result without exposed adapter error details.
 * @see {@link runReadinessChecks}
 */
export type HealthCheckState = 'ok' | 'failed' | 'timed_out'
/**
 * Aggregate readiness based on critical and noncritical probe outcomes.
 * @see {@link runReadinessChecks}
 */
export type ReadinessState = 'ready' | 'degraded' | 'not_ready'

/**
 * Read-only host probe with an identifier, criticality and optional deadline.
 * @see {@link runReadinessChecks}
 */
export interface HealthCheck {
  
  /** Unique lowercase probe identity, at most 128 characters, used for result correlation. */
  id: string
  
  
  /** Whether failure makes readiness not_ready; defaults to true. False failures only degrade readiness. */
  critical?: boolean
  
/** Optional execution deadline in milliseconds; enforcement belongs to the API/runtime consuming this metadata. */
  timeoutMs?: number
  
  /**
   * Run a read-only host readiness probe when aggregation starts.
   * @returns True only when the checked condition is healthy, directly or asynchronously; false/throws/rejections become failed probe results.
   * @remarks Called concurrently with other probes. Timeout stops waiting without cancelling this callback; the host owns resource cleanup.
   * @example
   * ```typescript
   * import type { HealthCheck } from "@alneas/eaos-core/health";
   * const configuration = { initialized: true };
   * const check: HealthCheck = { id: "configuration", run: () => configuration.initialized };
   * console.log(await check.run());
   * ```
   */
  run: () => boolean | Promise<boolean>
}

/**
 * Probe identity, criticality, outcome and elapsed duration.
 * @see {@link runReadinessChecks}
 */
export interface HealthCheckResult {
  
  /** Identity copied from the probe that produced this result. */
  id: string
  
  
  /** Resolved criticality copied from the check, true unless it explicitly declared false. */
  critical: boolean
  
  /** ok only when the probe resolves exactly true; failed or timed_out otherwise. */
  state: HealthCheckState
  
/** Measured elapsed duration in milliseconds. */
  durationMs: number
}

/**
 * Timestamped aggregate availability and ordered probe results.
 * @see {@link runReadinessChecks}
 */
export interface ReadinessReport {
  
  /** not_ready for critical failure, degraded for noncritical failure, otherwise ready. */
  state: ReadinessState
  
/** Timestamp associated with the reported evaluation or measurement. */
  checkedAt: string
  
  /** Ordered probe results or procedure check requirements; the owning host performs the actual checks. */
  checks: readonly HealthCheckResult[]
}

/**
 * Timestamped indication that report creation code is alive.
 * @see {@link runReadinessChecks}
 */
export interface LivenessReport {
  
  /** Always alive when a liveness report is constructed. */
  state: 'alive'
  
/** Timestamp associated with the reported evaluation or measurement. */
  checkedAt: string
}

const validId = (id: string): boolean => /^[a-z][a-z0-9_.:-]{0,127}$/.test(id)

function validateCheck(check: HealthCheck): void {
  if (!check || typeof check.id !== 'string' || !validId(check.id) || typeof check.run !== 'function') throw new Error('Invalid health check')
  if (check.timeoutMs !== undefined && (!Number.isSafeInteger(check.timeoutMs) || check.timeoutMs < 1 || check.timeoutMs > 30_000)) throw new Error('Invalid health check timeout')
}

async function runCheck(check: HealthCheck): Promise<HealthCheckResult> {
  const started = Date.now()
  const timeoutMs = check.timeoutMs ?? 2_000
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => check.run()),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('health check timeout')), timeoutMs) }),
    ])
    return { id: check.id, critical: check.critical !== false, state: result === true ? 'ok' : 'failed', durationMs: Math.max(0, Date.now() - started) }
  } catch (error) {
    return { id: check.id, critical: check.critical !== false, state: error instanceof Error && error.message === 'health check timeout' ? 'timed_out' : 'failed', durationMs: Math.max(0, Date.now() - started) }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Pure readiness aggregation. It never exposes adapter errors or secrets.
 * @param checks - Unique checks; critical defaults to true and timeoutMs to 2000 (allowed 1–30000 ms). Probes should be read-only.
 * @param now - Timestamp for the report; defaults to current time.
 * @returns Report in input order: not_ready for any failed critical check, degraded for noncritical failures, otherwise ready; an empty set is ready.
 * @throws Rejects invalid/duplicate check definitions or an invalid report timestamp. Probe errors become failed results rather than rejections.
 * @remarks Timeouts stop waiting but do not cancel a probe. Probes may still run after the report resolves; the host owns probe cancellation and resources.
 * @example
 * ```typescript
 * import { runReadinessChecks } from "@alneas/eaos-core/health";
 * const report = await runReadinessChecks([{ id: "configuration", run: () => true }]);
 * console.log(report.state); // ready
 * ```
 */
export async function runReadinessChecks(checks: readonly HealthCheck[], now = new Date()): Promise<ReadinessReport> {
  const ids = new Set<string>()
  for (const check of checks) {
    validateCheck(check)
    if (ids.has(check.id)) throw new Error(`Duplicate health check: ${check.id}`)
    ids.add(check.id)
  }
  const results = await Promise.all(checks.map(runCheck))
  const criticalFailed = results.some(result => result.critical && result.state !== 'ok')
  const anyFailed = results.some(result => result.state !== 'ok')
  return { state: criticalFailed ? 'not_ready' : anyFailed ? 'degraded' : 'ready', checkedAt: now.toISOString(), checks: results }
}

/**
 * Create a timestamped process-liveness response without probing dependencies.
 * @param now - Report time; defaults to current Date.
 * @returns A fresh alive report with an ISO timestamp.
 * @throws RangeError when now is an invalid Date.
 * @example
 * ```typescript
 * import { createLivenessReport } from "@alneas/eaos-core/health";
 * console.log(createLivenessReport(new Date("2026-10-19T00:00:00Z")));
 * ```
 */
export function createLivenessReport(now = new Date()): LivenessReport {
  return { state: 'alive', checkedAt: now.toISOString() }
}
