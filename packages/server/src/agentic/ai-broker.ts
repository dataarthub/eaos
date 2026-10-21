import {
  createAIExecutionBroker,
  type AIExecutionCandidate,
  type AIExecutionDecision,
  type AIExecutionRequest,
  type AgentJobKind,
  type AgentJobRecord,
} from '@alneas/eaos-core'
import type { AtomicSession } from '../plugin-data/atomic'
import { createAgentJob, enqueueAgentJob } from './agent-jobs'
import type {
  ServerAgentDispatchMode,
  ServerAgentExecutionContext,
  ServerAgentTaskRequest,
  ServerAgentWorkerType,
} from './types'

/**
 * Host-advertised AI candidate with server worker and queue/local-runner delivery binding.
 * @see DurableAIExecutionBroker.
 */
export interface ServerAIExecutionRoute extends AIExecutionCandidate {
  /** Executor key bound to the selected host route. */
  workerType: ServerAgentWorkerType
  /** Local CLI/MLX candidates must use local-pull; nonlocal candidates cannot use local-pull. */
  dispatchMode: ServerAgentDispatchMode
  /** Pin a route to one registered local runner when the host requires it. */
  runnerId?: string
}

/**
 * Verified task input before the broker chooses immutable runtime routing fields.
 * @see DurableAIExecutionBroker.plan.
 */
export interface AIJobTaskInput {
  /** Stable task identifier. */
  id: string
  /** Verified tenant, required to match routing context. */
  tenantId: string
  /** Verified user, required to match routing context. */
  userId: string
  /** Human task label forwarded to runtime. */
  title: string
  /** Runtime instructions forwarded without domain validation here. */
  instructions: string
  /** Optional domain execution context. */
  context?: Record<string, unknown>
  /** Optional workflow/tool context; broker-owned routing fields are replaced. */
  executionContext?: ServerAgentExecutionContext
  /** Optional runtime timeout in milliseconds, forwarded for executor validation. */
  timeoutMs?: number
}

/**
 * Verified routing request, task, and queue deduplication/retry metadata.
 * @see DurableAIExecutionBroker.plan.
 */
export interface AIJobSubmission {
  /** Core execution requirements and verified context used for route allocation. */
  routing: AIExecutionRequest
  /** Verified task before worker/routing binding. */
  task: AIJobTaskInput
  /** Queue job kind and idempotency partition. */
  kind: AgentJobKind
  /** Optional associated workflow instance. */
  workflowInstanceId?: string
  /** Optional queue correlation ID; defaults to routing.context.operation. */
  correlationId?: string
  /** Optional durable deduplication key; absent uses task execution key then task.id. */
  idempotencyKey?: string
  /** Optional job attempt ceiling; defaults to 5 through createAgentJob. */
  maxAttempts?: number
}

/**
 * Selected runtime decision and unpersisted or saved queue job.
 * @see DurableAIExecutionBroker.enqueue.
 */
export interface AIJobPlan {
  /** Current selector decision, even when enqueue returns an existing deduplicated job. */
  decision: AIExecutionDecision
  /** Created or deduplicated queue record with persisted runtime routing. */
  job: AgentJobRecord<ServerAgentTaskRequest>
}

/**
 * Micro2 controller for dynamic model/runtime allocation.
 *
 * It selects only host-advertised routes and persists the selected route in
 * the durable job. It never reads a subscription credential or starts a local
 * process. A local-pull route is later claimed by LocalRunnerPullCoordinator.
 * @remarks Route selection and planning are process-local. The host verifies identity and supplies current candidate availability/policy; authorization, runtime execution, and safe retries remain separate responsibilities.
 * @example
 * ```typescript
 * import { DurableAIExecutionBroker } from "@alneas/eaos-server/agentic/ai-broker";
 * export function broker(options: ConstructorParameters<typeof DurableAIExecutionBroker>[0]) {
 *   return new DurableAIExecutionBroker(options);
 * }
 * ```
 */
export class DurableAIExecutionBroker {
  private readonly routesById: ReadonlyMap<string, ServerAIExecutionRoute>
  private readonly selector: ReturnType<typeof createAIExecutionBroker>
  private readonly now: () => Date

  /**
   * Validates and clones server routes and configures the core allocation selector.
   * @param options - Nonempty routes list; optional policyVersion labels selector decisions and now supplies job timestamps, defaulting to fresh Date.
   * @throws Invalid/missing routes, incompatible local dispatch bindings, core selector validation, or clone failures.
   */
  constructor(options: { 
  /**
   * Nonempty host-approved execution routes, validated/cloned before configuring the selector; route IDs and runtime dispatch bindings must be compatible.
   */
  routes: readonly ServerAIExecutionRoute[]; 
  /**
   * Optional decision policy label forwarded to the Core selector; omission selects ai-execution-policy-v1.
   */
  policyVersion?: string; 
  /**
   * Optional clock used when constructing agent job records; omission creates a new current Date per call.
   * @returns A valid Date used for planned job timestamps; clock failures propagate from planning.
   * @see {@link DurableAIExecutionBroker.plan}
   */
  now?: () => Date }) {
    if (!options || !Array.isArray(options.routes) || options.routes.length === 0) throw new Error('AI execution routes are required')
    const routes = options.routes.map(validateServerRoute)
    this.routesById = new Map(routes.map(route => [route.routeId, structuredClone(route)]))
    this.selector = createAIExecutionBroker({ routes, policyVersion: options.policyVersion })
    this.now = options.now ?? (() => new Date())
  }

  /**
   * Lists registered server route bindings without exposing mutable stored objects.
   * @returns Cloned route records in registration map order.
   * @example
   * ```typescript
   * import { DurableAIExecutionBroker } from "@alneas/eaos-server/agentic/ai-broker";
   * export function routes(broker: DurableAIExecutionBroker) { return broker.listRoutes(); }
   * ```
   */
  listRoutes(): readonly ServerAIExecutionRoute[] {
    return [...this.routesById.values()].map(route => structuredClone(route))
  }

  /**
   * Selects an eligible host-advertised runtime using the core routing policy.
   * @param request - Verified AI execution requirements and context.
   * @returns The core selector decision; no job is persisted or runtime started.
   * @throws Propagates core routing validation/no-eligible-route errors.
   * @example
   * ```typescript
   * import { DurableAIExecutionBroker } from "@alneas/eaos-server/agentic/ai-broker";
   * import type { AIExecutionRequest } from "@alneas/eaos-core";
   * export function decide(broker: DurableAIExecutionBroker, request: AIExecutionRequest) { return broker.decide(request); }
   * ```
   */
  decide(request: AIExecutionRequest): AIExecutionDecision {
    return this.selector.decide(request)
  }

  /**
   * Selects a route and creates a queue record with host-controlled worker/dispatch/runner bindings.
   * @param input - Routing and task must have matching tenantId/userId; queue metadata follows AIJobSubmission.
   * @returns Decision and newly created job; caller-supplied broker route/dispatch/runner execution fields are stripped before selected bindings are written.
   * @throws Principal mismatch, unavailable route, invalid core routing, clone/hash/clock, or job creation failures.
   * @remarks No persistence or deduplication occurs until enqueue; repeated plan calls generate different job IDs.
   * @example
   * ```typescript
   * import { DurableAIExecutionBroker } from "@alneas/eaos-server/agentic/ai-broker";
   * import type { AIJobSubmission } from "@alneas/eaos-server/agentic/ai-broker";
   * export function plan(broker: DurableAIExecutionBroker, input: AIJobSubmission) { return broker.plan(input); }
   * ```
   */
  plan(input: AIJobSubmission): AIJobPlan {
    if (!input?.routing || !input.task || input.routing.context.tenantId !== input.task.tenantId || input.routing.context.userId !== input.task.userId) throw new Error('AI routing context does not match task context')
    const decision = this.decide(input.routing)
    const binding = this.routesById.get(decision.route.routeId)
    if (!binding) throw new Error('Selected AI execution route is not registered')
    const request: ServerAgentTaskRequest = {
      ...structuredClone(input.task),
      workerType: binding.workerType,
      jobKind: input.kind,
      executionContext: {
        ...withoutBrokerFields(input.task.executionContext),
        routeId: binding.routeId,
        dispatchMode: binding.dispatchMode,
        ...(binding.runnerId === undefined ? {} : { runnerId: binding.runnerId }),
      },
    }
    const job = createAgentJob({
      request,
      kind: input.kind,
      workflowInstanceId: input.workflowInstanceId,
      correlationId: input.correlationId ?? input.routing.context.operation,
      idempotencyKey: input.idempotencyKey,
      maxAttempts: input.maxAttempts,
      now: this.now(),
    })
    return { decision, job }
  }

  /**
   * Plans routing and atomically inserts or deduplicates the queue job in a caller-owned session.
   * @param tx - Authorized atomic transaction/session; caller owns commit/rollback.
   * @param input - Verified routing/task and queue metadata.
   * @returns Decision plus the newly saved or existing idempotent job.
   * @throws Planning errors, conflicting deduplication input, corrupt index, or session failures.
   * @remarks Selection still runs before deduplication; the returned existing job is authoritative for its persisted routing. No runtime execution occurs.
   * @example
   * ```typescript
   * import { DurableAIExecutionBroker } from "@alneas/eaos-server/agentic/ai-broker";
   * import type { AIJobSubmission } from "@alneas/eaos-server/agentic/ai-broker";
   * import type { AtomicSession } from "@alneas/eaos-server/plugin-data/atomic";
   * export async function enqueue(broker: DurableAIExecutionBroker, tx: AtomicSession, input: AIJobSubmission) { return broker.enqueue(tx, input); }
   * ```
   */
  async enqueue(tx: AtomicSession, input: AIJobSubmission): Promise<AIJobPlan> {
    const plan = this.plan(input)
    const saved = await enqueueAgentJob(tx, plan.job)
    return { ...plan, job: saved }
  }
}

function validateServerRoute(route: ServerAIExecutionRoute): ServerAIExecutionRoute {
  if (!route || typeof route.workerType !== 'string' || !route.workerType.trim()) throw new Error('Invalid AI route worker type')
  if (route.dispatchMode === 'local-pull' && route.target !== 'local-subscription-cli' && route.target !== 'local-mlx') throw new Error('Only local routes may use local-pull dispatch')
  if ((route.target === 'local-subscription-cli' || route.target === 'local-mlx') && route.dispatchMode !== 'local-pull') throw new Error('Local CLI and MLX routes must use local-pull dispatch')
  return structuredClone(route)
}

function withoutBrokerFields(context: ServerAgentExecutionContext | undefined): ServerAgentExecutionContext {
  if (!context) return {}
  const { routeId: _routeId, dispatchMode: _dispatchMode, runnerId: _runnerId, ...callerFields } = context
  return callerFields
}
