import { hashAgentJobRequest, type AgentJobRecord, type AgentJobStatus } from '@alneas/eaos-core'
import { randomUUID } from 'node:crypto'
import type { ServerAgentDispatchMode, ServerAgentTaskRequest, ServerAgentTaskResult } from './types'
import type { ServerAutonomousWorker } from './autonomous-worker'
import type { AtomicRepository, AtomicSession } from '../plugin-data/atomic'
import type { PluginPrincipal } from '../plugin-data/index'

/**
 * Host durable queue boundary with atomic claims and lease-checked transitions.
 * @see createAtomicAgentJobStore for the canonical implementation.
 */
export interface AgentJobStore {
  /**
   * Claims due/recoverable jobs using durable transaction/lease exclusion.
   * @param now - Claim clock used for due and stale checks.
   * @param limit - Maximum job count, validated by the implementation.
   * @param filter - Optional dispatch/user/runner/route eligibility.
   * @returns Leased jobs, or an empty array.
   * @throws Queue persistence or admission failures propagate.
   
   * @example
   * ```typescript
   * import type { AgentJobStore } from "@alneas/eaos-server";
   * export async function claimHostJobs(
   *   store: AgentJobStore, eligibility: Parameters<AgentJobStore["claim"]>[2],
   * ) {
   *   // Supply a store already scoped to verified tenant admission.
   *   return await store.claim(new Date(), 10, eligibility);
   * }
   * ```
   */
  claim(now: Date, limit: number, filter?: AgentJobClaimFilter): Promise<readonly AgentJobRecord<ServerAgentTaskRequest>[]>
  /**
   * Transitions the leased job to succeeded and persists its result.
   * @param jobId - Stored job ID.
   * @param leaseToken - Current claim token; stale tokens must be rejected.
   * @param result - Normalized task outcome to persist.
   * @param now - Transition clock; the atomic implementation uses its configured clock instead.
   * @returns No value; resolves after the durable transition.
   * @throws Lease/integrity/admission or persistence failures propagate.
   
   * @example
   * ```typescript
   * import type { AgentJobStore } from "@alneas/eaos-server";
   * export async function completeClaimedJob(
   *   store: AgentJobStore, jobId: string, currentLeaseToken: string,
   *   verifiedResult: Parameters<AgentJobStore["markCompleted"]>[2],
   * ) {
   *   await store.markCompleted(jobId, currentLeaseToken, verifiedResult, new Date());
   *   // Completion is durable under the host store contract; stale leases reject.
   * }
   * ```
   */
  markCompleted(jobId: string, leaseToken: string, result: ServerAgentTaskResult, now: Date): Promise<void>
  /**
   * Transitions the leased job to waiting_approval and persists approval result data.
   * @param jobId - Stored job ID.
   * @param leaseToken - Current claim token; stale tokens must be rejected.
   * @param result - Normalized task outcome to persist.
   * @param now - Transition clock; the atomic implementation uses its configured clock instead.
   * @returns No value; resolves after the durable transition.
   * @throws Lease/integrity/admission or persistence failures propagate.
   
   * @example
   * ```typescript
   * import type { AgentJobStore } from "@alneas/eaos-server";
   * export async function deferClaimedJobForReview(
   *   store: AgentJobStore, jobId: string, currentLeaseToken: string,
   *   approvalResult: Parameters<AgentJobStore["markWaitingApproval"]>[2],
   * ) {
   *   await store.markWaitingApproval(jobId, currentLeaseToken, approvalResult, new Date());
   *   // This records pending review; it does not approve or execute the proposed action.
   * }
   * ```
   */
  markWaitingApproval(jobId: string, leaseToken: string, result: ServerAgentTaskResult, now: Date): Promise<void>
  /**
   * Releases the lease and schedules the job for a later attempt.
   * @param jobId - Stored job ID.
   * @param leaseToken - Current claim token; stale tokens must be rejected.
   * @param error - Persisted failure description.
   * @param failureCode - Optional stable runtime classification.
   * @param retryAt - Earliest eligible next-claim timestamp.
   * @param now - Transition clock; the atomic implementation uses its configured clock instead.
   * @returns No value; resolves after the durable transition.
   * @throws Lease/integrity/admission or persistence failures propagate.
   
   * @example
   * ```typescript
   * import type { AgentJobStore } from "@alneas/eaos-server";
   * export async function rescheduleClaimedJob(
   *   store: AgentJobStore, jobId: string, currentLeaseToken: string,
   *   sanitizedError: string, failureCode: string | undefined, reviewedRetryAt: Date,
   * ) {
   *   // Reconcile any uncertain external effect before deciding a retry is safe.
   *   await store.markRetryable(
   *     jobId, currentLeaseToken, sanitizedError, failureCode, reviewedRetryAt, new Date(),
   *   );
   * }
   * ```
   */
  markRetryable(jobId: string, leaseToken: string, error: string, failureCode: string | undefined, retryAt: Date, now: Date): Promise<void>
  /**
   * Releases the lease and marks a terminal failed result.
   * @param jobId - Stored job ID.
   * @param leaseToken - Current claim token; stale tokens must be rejected.
   * @param error - Persisted failure description.
   * @param failureCode - Optional stable runtime classification.
   * @param now - Transition clock; the atomic implementation uses its configured clock instead.
   * @returns No value; resolves after the durable transition.
   * @throws Lease/integrity/admission or persistence failures propagate.
   
   * @example
   * ```typescript
   * import type { AgentJobStore } from "@alneas/eaos-server";
   * export async function failClaimedJob(
   *   store: AgentJobStore, jobId: string, currentLeaseToken: string,
   *   sanitizedError: string, failureCode: string | undefined,
   * ) {
   *   await store.markFailed(jobId, currentLeaseToken, sanitizedError, failureCode, new Date());
   *   // The host persisted terminal failure; no automatic retry is requested.
   * }
   * ```
   */
  markFailed(jobId: string, leaseToken: string, error: string, failureCode: string | undefined, now: Date): Promise<void>
}

/**
 * Optional eligibility constraints for durable queue claims; omitted fields impose no restriction.
 * @see AgentJobStore.claim.
 */
export interface AgentJobClaimFilter {
  /** Delivery mode; legacy jobs without a mode are treated as server-queue by the atomic implementation. */
  dispatchMode?: ServerAgentDispatchMode
  /** Eligible registered route IDs; jobs without a matching route are excluded. */
  routeIds?: readonly string[]
  /** Verified runner ID; jobs with a different explicit runner binding are excluded, unbound jobs remain eligible. */
  runnerId?: string
  /** Verified owning user ID to require. */
  userId?: string
}

/**
 * Host queue/worker and one-pass retry policy for {@link DurableAgentJobDispatcher}.
 */
export interface AgentJobDispatcherOptions {
  /** Durable queue enforcing claim leases and tenant admission. */
  store: AgentJobStore
  /** Worker executing each cloned claimed task. */
  worker: ServerAutonomousWorker
  /** Jobs requested per pass, safe integer 1–100; defaults to 1. */
  batchSize?: number
  /** Dispatcher attempt ceiling, safe integer 1–100; defaults to 5 and is combined with each job ceiling. */
  maxAttempts?: number
  /** Finite nonnegative initial exponential retry delay in milliseconds; defaults to 1000. */
  baseDelayMs?: number
  /** Finite retry delay ceiling at least baseDelayMs; defaults to 60000 milliseconds. */
  maxDelayMs?: number
  /** Clock for claims, transitions, and retry availability; defaults to fresh Date. */
  now?: () => Date
  /** Resume a LangGraph thread or publish a domain event after a successful agent result. */
  onCompleted?: (job: Readonly<AgentJobRecord<ServerAgentTaskRequest>>, result: ServerAgentTaskResult) => Promise<void>
}

/**
 * Counts of one dispatcher pass; jobs missing lease tokens increment failed without a store transition.
 * @see DurableAgentJobDispatcher.runOnce.
 */
export interface AgentJobDispatchResult {
  /** Number of rows returned by the claim. */
  claimed: number
  /** Jobs whose completion callback and completed transition succeeded. */
  succeeded: number
  /** Jobs transitioned to waiting_approval. */
  waitingApproval: number
  /** Jobs scheduled for a later retry. */
  retried: number
  /** Jobs marked terminal failure plus claimed jobs missing a lease token. */
  failed: number
}

/**
 * Durable boundary between Micro 2 and an ARM agent runtime.
 *
 * The store is host-owned and must persist leases, attempts and results. This
 * class owns only one bounded pass; a host scheduler calls runOnce again.
 * @remarks Jobs execute sequentially within each pass, but concurrent runOnce calls are not serialized here. Leases and admission must be enforced by the host store. Completion callbacks run before markCompleted and can be repeated after retry; make external effects idempotent.
 * @example
 * ```typescript
 * import { DurableAgentJobDispatcher, type AgentJobDispatcherOptions } from "@alneas/eaos-server/agentic/agent-jobs";
 * export async function dispatch(options: AgentJobDispatcherOptions) {
 *   return new DurableAgentJobDispatcher(options).runOnce();
 * }
 * ```
 */
export class DurableAgentJobDispatcher {
  private readonly options: Required<Pick<AgentJobDispatcherOptions, 'batchSize' | 'maxAttempts' | 'baseDelayMs' | 'maxDelayMs' | 'now'>> & AgentJobDispatcherOptions

  /**
   * Validates one-pass claim and exponential retry settings.
   * @param options - Store/worker plus bounded batch, attempt, delay, clock, and completion settings.
   * @throws Missing store/worker, batchSize/maxAttempts outside safe integer 1–100, or nonfinite/negative/inverted retry delays.
   */
  constructor(options: AgentJobDispatcherOptions) {
    if (!options?.store || !options.worker) throw new Error('Durable agent job store and worker are required')
    const batchSize = options.batchSize ?? 1
    const maxAttempts = options.maxAttempts ?? 5
    const baseDelayMs = options.baseDelayMs ?? 1_000
    const maxDelayMs = options.maxDelayMs ?? 60_000
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new Error('Invalid agent job batch size')
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) throw new Error('Invalid agent job max attempts')
    if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0 || !Number.isFinite(maxDelayMs) || maxDelayMs < baseDelayMs) throw new Error('Invalid agent job retry policy')
    this.options = { ...options, batchSize, maxAttempts, baseDelayMs, maxDelayMs, now: options.now ?? (() => new Date()) }
  }

  /**
   * Claims one batch and executes jobs sequentially, persisting completion, approval wait, retry, or failure.
   * @returns Per-outcome counts after all claimed jobs have been processed.
   * @throws Rejects claim/transition/clock failures; worker errors become retryable failure results. Completion callback/markCompleted errors trigger retry-or-fail handling.
   * @remarks Retry delay is min(maxDelayMs, baseDelayMs * 2^(attempt-1)), using job.attempt + 1 for the attempt calculation. No timer or automatic second pass is installed. Results marked PENDING_APPROVAL do not count as success.
   * @example
   * ```typescript
   * import { DurableAgentJobDispatcher, type AgentJobDispatcherOptions } from "@alneas/eaos-server/agentic/agent-jobs";
   * export async function runOnce(options: AgentJobDispatcherOptions) { return new DurableAgentJobDispatcher(options).runOnce(); }
   * ```
   */
  async runOnce(): Promise<AgentJobDispatchResult> {
    const now = this.options.now()
    const jobs = await this.options.store.claim(now, this.options.batchSize)
    const result: AgentJobDispatchResult = { claimed: jobs.length, succeeded: 0, waitingApproval: 0, retried: 0, failed: 0 }
    for (const job of jobs) {
      const leaseToken = job.leaseToken
      if (!leaseToken) {
        result.failed++
        continue
      }
      let taskResult: ServerAgentTaskResult
      try {
        taskResult = await this.options.worker.runTask(structuredClone(job.request))
      } catch (error) {
        taskResult = {
          taskId: job.request.id,
          status: 'FAILED',
          error: error instanceof Error ? error.message : 'Agent job failed',
          retryable: true,
          durationMs: 0,
        }
      }

      if (taskResult.status === 'PENDING_APPROVAL') {
        await this.options.store.markWaitingApproval(job.jobId, leaseToken, taskResult, this.options.now())
        result.waitingApproval++
        continue
      }
      if (taskResult.status === 'COMPLETED') {
        try {
          await this.options.onCompleted?.(structuredClone(job), taskResult)
          await this.options.store.markCompleted(job.jobId, leaseToken, taskResult, this.options.now())
          result.succeeded++
        } catch (error) {
          await this.retryOrFail(job, leaseToken, error instanceof Error ? error.message : 'Agent completion callback failed', 'RUNTIME_FAILED', result)
        }
        continue
      }

      await this.retryOrFail(job, leaseToken, taskResult.error ?? 'Agent job failed', taskResult.failureCode, result, taskResult.retryable)
    }
    return result
  }

  private async retryOrFail(
    job: AgentJobRecord<ServerAgentTaskRequest>,
    leaseToken: string,
    error: string,
    failureCode: string | undefined,
    result: AgentJobDispatchResult,
    retryable = true,
  ): Promise<void> {
    const attempt = job.attempt + 1
    if (!retryable || attempt >= Math.min(job.maxAttempts, this.options.maxAttempts)) {
      await this.options.store.markFailed(job.jobId, leaseToken, error.slice(0, 1_000), failureCode, this.options.now())
      result.failed++
      return
    }
    const delay = Math.min(this.options.maxDelayMs, this.options.baseDelayMs * (2 ** Math.max(0, attempt - 1)))
    await this.options.store.markRetryable(job.jobId, leaseToken, error.slice(0, 1_000), failureCode, new Date(this.options.now().getTime() + delay), this.options.now())
    result.retried++
  }
}

/**
 * Creates a cloned, hashed queued job record without persisting or executing it.
 * @param input - request supplies verified task identity; kind groups idempotency; workflowInstanceId is optional; correlationId defaults to request executionContext correlation then request.id; idempotencyKey defaults to executionContext key then request.id; maxAttempts defaults to 5; now defaults to the current Date.
 * @returns A new queued record with generated jobId, attempt zero, request hash, and matching available/created/updated timestamps.
 * @throws Clone/hash/invalid Date failures; this factory does not independently validate every task or attempt field.
 * @example
 * ```typescript
 * import { createAgentJob } from "@alneas/eaos-server/agentic/agent-jobs";
 * import type { ServerAgentTaskRequest } from "@alneas/eaos-server/agentic/types";
 * export function queued(request: ServerAgentTaskRequest) { return createAgentJob({ request, kind: "workflow" }); }
 * ```
 */
export function createAgentJob(input: {
  /**
   * Host-verified task cloned into the durable job and hashed for idempotency integrity.
   */
  request: ServerAgentTaskRequest
  /**
   * Queue kind used together with tenant and idempotencyKey to partition durable deduplication.
   */
  kind: string
  /**
   * Optional companion workflow instance ID retained in the queued record.
   */
  workflowInstanceId?: string
  /**
   * Queue trace label; defaults to request.executionContext.correlationId, then request.id.
   */
  correlationId?: string
  /**
   * Durable deduplication identity; defaults to request.executionContext.idempotencyKey, then request.id.
   */
  idempotencyKey?: string
  /**
   * Job attempt ceiling retained without validation here; defaults to 5 and is later combined with dispatcher policy.
   */
  maxAttempts?: number
  /**
   * Timestamp for availableAt, createdAt, and updatedAt; defaults to a fresh Date and must support toISOString.
   */
  now?: Date
}): AgentJobRecord<ServerAgentTaskRequest> {
  const now = input.now ?? new Date()
  const request = structuredClone(input.request)
  const requestHash = hashAgentJobRequest(request)
  const idempotencyKey = input.idempotencyKey ?? request.executionContext?.idempotencyKey ?? request.id
  return {
    jobId: `agent-job-${randomUUID()}`,
    tenantId: request.tenantId,
    kind: input.kind,
    status: 'queued' as AgentJobStatus,
    request,
    requestHash,
    ...(input.workflowInstanceId === undefined ? {} : { workflowInstanceId: input.workflowInstanceId }),
    correlationId: input.correlationId ?? request.executionContext?.correlationId ?? request.id,
    idempotencyKey,
    attempt: 0,
    maxAttempts: input.maxAttempts ?? 5,
    availableAt: now.toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }
}

const jobKey = (id: string) => `agent-job/${id}`
const idempotencyKey = (tenantId: string, kind: string, key: string) => `agent-job-idempotency/${hashAgentJobRequest([tenantId, kind, key])}`

/**
 * Persists a job and tenant/kind/idempotency index in the caller's atomic transaction.
 * @param tx - Authorized active atomic session; the caller owns commit/rollback.
 * @param job - Created job whose tenant/kind/key define deduplication and whose requestHash binds input.
 * @returns A clone of the saved job, or existing indexed job when its request hash matches; existing lifecycle state is preserved.
 * @throws Reused idempotency key with a different request hash, missing indexed job, or propagated transaction/clone errors.
 * @remarks This helper neither executes the job nor opens a transaction; host transaction isolation/CAS must prevent concurrent index creation races.
 * @example
 * ```typescript
 * import { enqueueAgentJob, createAgentJob } from "@alneas/eaos-server/agentic/agent-jobs";
 * import type { AtomicSession } from "@alneas/eaos-server/plugin-data/atomic";
 * import type { ServerAgentTaskRequest } from "@alneas/eaos-server/agentic/types";
 * export async function enqueue(tx: AtomicSession, request: ServerAgentTaskRequest) {
 *   return enqueueAgentJob(tx, createAgentJob({ request, kind: "workflow" }));
 * }
 * ```
 */
export async function enqueueAgentJob(tx: AtomicSession, job: AgentJobRecord<ServerAgentTaskRequest>): Promise<AgentJobRecord<ServerAgentTaskRequest>> {
  const index = idempotencyKey(job.tenantId, job.kind, job.idempotencyKey)
  const existing = await tx.get<{ jobId: string; requestHash: string }>(index)
  if (existing) {
    if (existing.value.requestHash !== job.requestHash) throw new Error('Agent job idempotency key reused with different input')
    const saved = await tx.get<AgentJobRecord<ServerAgentTaskRequest>>(jobKey(existing.value.jobId))
    if (!saved) throw new Error('Agent job idempotency index is corrupt')
    return structuredClone(saved.value)
  }
  await tx.put(jobKey(job.jobId), job, 0)
  await tx.put(index, { jobId: job.jobId, requestHash: job.requestHash }, 0)
  return structuredClone(job)
}

/**
 * Tenant-scoped CAS persistence, lease timing, admission, and transactional completion hook.
 * @see createAtomicAgentJobStore.
 */
export interface AtomicAgentJobStoreOptions {
  /** Host atomic repository enforcing durable CAS and tenant isolation. */
  repository: AtomicRepository
  /** Verified tenant/plugin/user repository scope, retained by reference. */
  principal: PluginPrincipal
  /** Additional stale grace after lease expiry in milliseconds; finite and at least 1000, defaults to 300000. */
  staleAfterMs?: number
  /** Lease duration in milliseconds; finite and at least 1000, defaults to 900000. */
  leaseMs?: number
  /** Clock for state transitions; defaults to fresh Date. */
  now?: () => Date
  /** Current host admission is checked before and after durable mutations. */
  verifyCurrent?: () => Promise<void>
  /** Persist the domain result in the same transaction as the succeeded job state. */
  onCompleted?: (tx: AtomicSession, job: Readonly<AgentJobRecord<ServerAgentTaskRequest>>, result: Readonly<ServerAgentTaskResult>) => Promise<void>
}

/**
 * Creates a lease-checked agent queue over an existing tenant-scoped atomic repository.
 * @param options - Repository/principal plus clocks, leases, optional current-admission checks, and transactional result persistence.
 * @returns Store operations validating tenant/request integrity and lease token before transitions. claim increments attempt and leases due queued/retryable jobs or sufficiently stale running jobs.
 * @throws Synchronously for missing dependencies or lease/stale durations below 1000 ms/nonfinite. Operations reject integrity/tenant/lease/admission errors, invalid claim limits, bounded-scan exhaustion, or propagated repository/hook errors.
 * @remarks claim scans at most 100 pages of 100 rows and permits safe-integer limits 1–100. Running jobs recover only when leaseUntil is at least staleAfterMs before the claim clock. Transition timestamps use options.now, ignoring the interface-supplied now argument. No lease renewal or worker cancellation exists; stale execution can overlap a reclaimed attempt, so side effects need host idempotency. verifyCurrent runs around durable mutations when supplied. Transactional onCompleted runs before succeeded state persistence in the same session.
 * @example
 * ```typescript
 * import { createAtomicAgentJobStore, type AtomicAgentJobStoreOptions } from "@alneas/eaos-server/agentic/agent-jobs";
 * export function jobStore(options: AtomicAgentJobStoreOptions) { return createAtomicAgentJobStore(options); }
 * ```
 */
export function createAtomicAgentJobStore(options: AtomicAgentJobStoreOptions): AgentJobStore {
  const staleAfterMs = options.staleAfterMs ?? 5 * 60_000
  const leaseMs = options.leaseMs ?? 15 * 60_000
  const now = options.now ?? (() => new Date())
  if (!options?.repository || !options.principal || !Number.isFinite(staleAfterMs) || staleAfterMs < 1_000 || !Number.isFinite(leaseMs) || leaseMs < 1_000) throw new Error('Invalid atomic agent job store options')
  const update = async (jobId: string, token: string, mutate: (job: AgentJobRecord<ServerAgentTaskRequest>, current: Date, tx: AtomicSession) => AgentJobRecord<ServerAgentTaskRequest> | Promise<AgentJobRecord<ServerAgentTaskRequest>>) => options.repository.run(options.principal, async tx => {
    const row = await tx.get<AgentJobRecord<ServerAgentTaskRequest>>(jobKey(jobId))
    if (!row || row.value.tenantId !== options.principal.tenantId || row.value.leaseToken !== token) throw new Error('Agent job lease changed')
    if(row.value.requestHash!==hashAgentJobRequest(row.value.request))throw new Error('Agent job request integrity differs')
    await options.verifyCurrent?.()
    const next = await mutate(structuredClone(row.value), now(), tx)
    await tx.put(row.id, next, row.revision)
    await options.verifyCurrent?.()
  })
  return {
    async claim(current, limit, filter) {
      return options.repository.run(options.principal, async tx => {
        await options.verifyCurrent?.()
        if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('Invalid claim limit')
        const claimed: AgentJobRecord<ServerAgentTaskRequest>[] = []
        let after=''
        for(let page=0;page<100&&claimed.length<limit;page++){
          const rows=await tx.list<AgentJobRecord<ServerAgentTaskRequest>>('agent-job/',after,100)
          if(!rows.length)break
          for(const row of rows){
            after=row.id
            const value = row.value
            if(value.tenantId!==options.principal.tenantId||value.request.tenantId!==options.principal.tenantId)throw new Error('Foreign agent job')
            if(value.requestHash!==hashAgentJobRequest(value.request))throw new Error('Agent job request integrity differs')
            if (!matchesClaimFilter(value, filter)) continue
            const due = (value.status === 'queued' || value.status === 'retryable') && Date.parse(value.availableAt) <= current.getTime()
            const stale = value.status === 'running' && Date.parse(value.leaseUntil ?? '') <= current.getTime() - staleAfterMs
            if (!due && !stale) continue
            const next = { ...value, status: 'running' as const, attempt: value.attempt + 1, leaseToken: randomUUID(), leaseUntil: new Date(current.getTime() + leaseMs).toISOString(), updatedAt: current.toISOString(), error: undefined, failureCode: undefined }
            await tx.put(row.id, next, row.revision)
            claimed.push(structuredClone(next))
            if(claimed.length===limit)break
          }
          if(rows.length<100)break
          if(page===99&&claimed.length<limit)throw new Error('Agent job scan exceeds bounded capacity; archive completed jobs before retrying')
        }
        await options.verifyCurrent?.()
        return claimed
      })
    },
    markCompleted(jobId, token, result, _current) { return update(jobId, token, async(job, nowValue, tx) => {await options.onCompleted?.(tx,structuredClone(job),structuredClone(result));return{ ...job, status: 'succeeded', result, updatedAt: nowValue.toISOString(), leaseToken: undefined, leaseUntil: undefined }}) },
    markWaitingApproval(jobId, token, result, _current) { return update(jobId, token, (job, nowValue) => ({ ...job, status: 'waiting_approval', result, updatedAt: nowValue.toISOString(), leaseToken: undefined, leaseUntil: undefined })) },
    markRetryable(jobId, token, error, failureCode, retryAt, _current) { return update(jobId, token, (job, nowValue) => ({ ...job, status: 'retryable', error, failureCode, availableAt: retryAt.toISOString(), updatedAt: nowValue.toISOString(), leaseToken: undefined, leaseUntil: undefined })) },
    markFailed(jobId, token, error, failureCode, _current) { return update(jobId, token, (job, nowValue) => ({ ...job, status: 'failed', error, failureCode, updatedAt: nowValue.toISOString(), leaseToken: undefined, leaseUntil: undefined })) },
  }
}

function matchesClaimFilter(job: AgentJobRecord<ServerAgentTaskRequest>, filter?: AgentJobClaimFilter): boolean {
  if (!filter) return true
  const context = job.request.executionContext
  if (filter.dispatchMode !== undefined && (context?.dispatchMode ?? 'server-queue') !== filter.dispatchMode) return false
  if (filter.userId !== undefined && job.request.userId !== filter.userId) return false
  if (filter.runnerId !== undefined && context?.runnerId !== undefined && context.runnerId !== filter.runnerId) return false
  if (filter.routeIds !== undefined && (!context?.routeId || !filter.routeIds.includes(context.routeId))) return false
  return true
}

/**
 * Marks an owned unstarted job cancelled in the caller's atomic session.
 * @param tx - Authorized atomic session; caller commits/rolls back.
 * @param principal - Verified tenant/user who owns the job.
 * @param jobId - Stored queue job identifier.
 * @param now - Cancellation timestamp; defaults to a fresh Date.
 * @returns A cloned cancelled job, unchanged when already cancelled.
 * @throws Missing/foreign job, request integrity mismatch, status other than queued/retryable/waiting_approval/cancelled, or transaction/clock errors.
 * @remarks Running leases cannot be interrupted by this edit. This function performs no external runtime cancellation, approval-ticket revocation, or live admission callback.
 * @example
 * ```typescript
 * import { cancelAgentJob } from "@alneas/eaos-server/agentic/agent-jobs";
 * import type { AtomicSession } from "@alneas/eaos-server/plugin-data/atomic";
 * import type { PluginPrincipal } from "@alneas/eaos-server/plugin-data";
 * export async function cancel(tx: AtomicSession, principal: PluginPrincipal, jobId: string) { return cancelAgentJob(tx, principal, jobId); }
 * ```
 */
export async function cancelAgentJob(tx:AtomicSession,principal:PluginPrincipal,jobId:string,now=new Date()):Promise<AgentJobRecord<ServerAgentTaskRequest>>{
 const row=await tx.get<AgentJobRecord<ServerAgentTaskRequest>>(jobKey(jobId))
 if(!row||row.value.tenantId!==principal.tenantId||row.value.request.userId!==principal.userId)throw new Error('Agent job unavailable')
 if(row.value.request.tenantId!==principal.tenantId||row.value.requestHash!==hashAgentJobRequest(row.value.request))throw new Error('Agent job request integrity differs')
 if(row.value.status==='cancelled')return structuredClone(row.value)
 if(!['queued','retryable','waiting_approval'].includes(row.value.status))throw new Error('Only an unstarted agent job can be cancelled')
 const next={...row.value,status:'cancelled' as const,updatedAt:now.toISOString(),leaseToken:undefined,leaseUntil:undefined}
 await tx.put(row.id,next,row.revision);return structuredClone(next)
}
