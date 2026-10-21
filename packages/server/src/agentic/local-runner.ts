import type { AgentJobRecord, AgentJobKind } from '@alneas/eaos-core'
import type { AgentJobClaimFilter, AgentJobStore } from './agent-jobs'
import type { ServerAgentTaskRequest, ServerAgentTaskResult } from './types'

/**
 * Verified local-runner identity and routes admitted by the host.
 * @see LocalRunnerPullCoordinator.
 */
export interface LocalRunnerIdentity {
  /** Nonblank authenticated runner identifier. */
  runnerId: string
  /** Nonblank authenticated user to whom claimed jobs must belong. */
  userId: string
  /** Nonempty array of nonblank host-authorized route identifiers. */
  supportedRouteIds: readonly string[]
}

/**
 * Durable queue and completion notification for {@link LocalRunnerPullCoordinator}.
 */
export interface LocalRunnerPullCoordinatorOptions {
  /** Host job store enforcing atomic claims and lease ownership. */
  store: AgentJobStore
  /** Clock read once per claim/submit; defaults to a fresh Date. */
  now?: () => Date
  /** Retry delay in milliseconds, finite from 0 to 86400000. @defaultValue 5000 */
  retryDelayMs?: number
  /** Called with cloned job/result only after markCompleted succeeds; rejection propagates after the persisted completion. */
  onCompleted?: (job: Readonly<AgentJobRecord<ServerAgentTaskRequest>>, result: ServerAgentTaskResult) => Promise<void>
}

/**
 * Server-side queue boundary for a local CLI/MLX runner.
 *
 * The runner authenticates to the host and pulls jobs; the server never needs
 * the subscription credential. The host must perform authentication and
 * tenant/user authorization before calling claim or submit.
 * @example
 * ```typescript
 * import { LocalRunnerPullCoordinator, type LocalRunnerPullCoordinatorOptions } from "@alneas/eaos-server/agentic/local-runner";
 * export function localRunnerQueue(options: LocalRunnerPullCoordinatorOptions) {
 *   return new LocalRunnerPullCoordinator(options);
 * }
 * ```
 */
export class LocalRunnerPullCoordinator {
  private readonly now: () => Date
  private readonly retryDelayMs: number

  /**
   * Creates a coordinator retaining the host store and callbacks.
   * @param options - Queue persistence, clock, retry delay, and optional post-completion callback.
   * @throws If store is absent or retry delay is outside finite 0–86400000 milliseconds.
   */
  constructor(private readonly options: LocalRunnerPullCoordinatorOptions) {
    if (!options?.store) throw new Error('Local runner job store is required')
    this.now = options.now ?? (() => new Date())
    this.retryDelayMs = options.retryDelayMs ?? 5_000
    if (!Number.isFinite(this.retryDelayMs) || this.retryDelayMs < 0 || this.retryDelayMs > 86_400_000) throw new Error('Invalid local runner retry delay')
  }

  /**
   * Atomically claims local-pull jobs bound to this verified user, runner, and supported routes.
   * @param identity - Host-authenticated runner identity; see {@link LocalRunnerIdentity}.
   * @param limit - Maximum jobs requested, safe integer 1–100; defaults to 1.
   * @returns Store-claimed jobs with leases, or an empty array when none qualify.
   * @throws Rejects invalid identity/limit and propagated store/clock failures.
   * @example
   * ```typescript
   * import { LocalRunnerPullCoordinator, type LocalRunnerPullCoordinatorOptions, type LocalRunnerIdentity } from "@alneas/eaos-server/agentic/local-runner";
   * export async function pull(options: LocalRunnerPullCoordinatorOptions, identity: LocalRunnerIdentity) {
   *   return new LocalRunnerPullCoordinator(options).claim(identity);
   * }
   * ```
   */
  async claim(identity: LocalRunnerIdentity, limit = 1): Promise<readonly AgentJobRecord<ServerAgentTaskRequest>[]> {
    validateIdentity(identity)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid local runner claim limit')
    const filter: AgentJobClaimFilter = {
      dispatchMode: 'local-pull',
      routeIds: identity.supportedRouteIds,
      runnerId: identity.runnerId,
      userId: identity.userId,
    }
    return this.options.store.claim(this.now(), limit, filter)
  }

  /**
   * Persists a leased local-runner outcome after checking its user, route, and runner bindings.
   * @param identity - Host-authenticated runner identity.
   * @param job - Host-loaded leased job; must belong to the same user, local-pull mode, supported route, and optional runner binding.
   * @param result - Runtime result; COMPLETED marks completion, PENDING_APPROVAL waits, other results retry unless retryable is exactly false.
   * @returns No value; resolves after the selected store transition and any completion callback.
   * @throws Rejects invalid binding, store/clock/clone errors, or completion callback errors. Callback failure occurs after completion persistence.
   * @remarks The host loads the authoritative job and authorizes tenant/user access before calling. Error text is truncated to 1000 characters for retries/failures. Store lease validation is the concurrency boundary; no remote runtime cancellation or automatic retry execution is performed here.
   * @example
   * ```typescript
   * import { LocalRunnerPullCoordinator, type LocalRunnerPullCoordinatorOptions, type LocalRunnerIdentity } from "@alneas/eaos-server/agentic/local-runner";
   * import type { AgentJobRecord } from "@alneas/eaos-core";
   * import type { ServerAgentTaskRequest, ServerAgentTaskResult } from "@alneas/eaos-server/agentic/types";
   * export async function submit(options: LocalRunnerPullCoordinatorOptions, identity: LocalRunnerIdentity, job: AgentJobRecord<ServerAgentTaskRequest>, result: ServerAgentTaskResult) {
   *   await new LocalRunnerPullCoordinator(options).submit(identity, job, result);
   * }
   * ```
   */
  async submit(identity: LocalRunnerIdentity, job: Readonly<AgentJobRecord<ServerAgentTaskRequest>>, result: ServerAgentTaskResult): Promise<void> {
    validateIdentity(identity)
    if (!job?.leaseToken || job.request.userId !== identity.userId || job.request.executionContext?.dispatchMode !== 'local-pull' || !job.request.executionContext.routeId || !identity.supportedRouteIds.includes(job.request.executionContext.routeId) || job.request.executionContext.runnerId !== undefined && job.request.executionContext.runnerId !== identity.runnerId) throw new Error('Local runner is not bound to this job')
    const now = this.now()
    if (result.status === 'COMPLETED') {
      await this.options.store.markCompleted(job.jobId, job.leaseToken, structuredClone(result), now)
      await this.options.onCompleted?.(structuredClone(job), structuredClone(result))
      return
    }
    if (result.status === 'PENDING_APPROVAL') {
      await this.options.store.markWaitingApproval(job.jobId, job.leaseToken, structuredClone(result), now)
      return
    }
    const error = result.error ?? 'Local runner failed'
    if (result.retryable !== false) {
      await this.options.store.markRetryable(job.jobId, job.leaseToken, error.slice(0, 1_000), result.failureCode, new Date(now.getTime() + this.retryDelayMs), now)
      return
    }
    await this.options.store.markFailed(job.jobId, job.leaseToken, error.slice(0, 1_000), result.failureCode, now)
  }
}

function validateIdentity(identity: LocalRunnerIdentity): void {
  if (!identity || !identity.runnerId?.trim() || !identity.userId?.trim() || !Array.isArray(identity.supportedRouteIds) || identity.supportedRouteIds.length === 0) throw new Error('Invalid local runner identity')
  if (identity.supportedRouteIds.some(routeId => typeof routeId !== 'string' || !routeId.trim())) throw new Error('Invalid local runner route binding')
}

/**
 * Alias of core job kinds accepted by local runner coordination.
 * @see LocalRunnerPullCoordinator.
 */
export type LocalRunnerJobKind = AgentJobKind
