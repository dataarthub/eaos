import type { DomainEventBus } from '@alneas/eaos-core'
import type { ServerAutonomousWorker } from './autonomous-worker'
import type { ServerAgentTaskRequest, ServerAgentTaskResult } from './types'

/**
 * Maps one domain event name to a verified host task specification.
 * @see EventAgentBridge.registerRule.
 */
export interface EventAgentRule {
  /** Exact domain event name to subscribe to. */
  eventName: string
  /** Filter or build task request from domain event payload. Return null to skip. */
  createTask: (payload: unknown) => Omit<ServerAgentTaskRequest, 'id'> | null
}

/**
 * Host error/audit notification for event conversion, queueing, execution, result, or approval delivery.
 * @see EventAgentBridgeOptions.onError.
 */
export interface EventAgentBridgeError {
  /** Domain event associated with the failure. */
  eventName: string
  /** Optional generated task identifier, absent before task creation. */
  taskId?: string
  /** Stage where the failure was observed. */
  phase: 'createTask' | 'queue' | 'runTask' | 'result' | 'notification'
  /** Original failure value, which may not be an Error. */
  error: unknown
  /** Optional normalized task result associated with the failure. */
  result?: ServerAgentTaskResult
}

/**
 * Event, generated task, and pending result delivered to the host approval sink.
 * @see EventAgentBridgeOptions.onPendingApproval.
 */
export interface EventAgentPendingApproval {
  /** Originating domain event name. */
  eventName: string
  /** Original event payload (cloned when durable queue mode is used). */
  payload: unknown
  /** Generated verified task whose runtime requested approval. */
  task: ServerAgentTaskRequest
  /** PENDING_APPROVAL result; the host must persist/deliver the approval request. */
  result: ServerAgentTaskResult
}

/**
 * In-process backpressure, host notifications, and optional durable delivery for {@link EventAgentBridge}.
 */
export interface EventAgentBridgeOptions {
  /** In-process worker concurrency, safe integer 1–1024. Defaults to 1; durable run passes use this as their claim ceiling but are not globally serialized. */
  maxConcurrent?: number
  /** In-process waiting queue ceiling while workers are fully occupied, safe integer 0–1000000. Defaults to 100. */
  maxQueueSize?: number
  /** Host-owned notification/audit sink for approval requests. */
  onPendingApproval?: (pending: EventAgentPendingApproval) => Promise<void> | void
  /** Host error/audit sink; returned Promise rejection is logged. Keep the callback itself nonthrowing because synchronous errors can escape reporting. */
  onError?: (error: EventAgentBridgeError) => Promise<void> | void
  /** Optional host-owned durable queue. When set, events are persisted until runDurableOnce drains them. */
  taskStore?: EventAgentTaskStore
}

/**
 * Domain event and generated task stored as one event queue item.
 * @see EventAgentTaskStore.
 */
export interface QueuedEventTask {
  /** Originating subscribed event name. */
  eventName: string
  /** Associated event payload; durable enqueue receives a structured clone. */
  payload: unknown
  /** Generated task with ID and execution idempotency context. */
  task: ServerAgentTaskRequest
}

/** Host-owned durable queue for event-triggered agent work.
 * @see EventAgentBridge.withDurableTaskStore for usage.
 */
export interface EventAgentTaskStore {
  /**
   * Persists accepted event work before a scheduler drains it.
   * @param task - Verified generated task and cloneable event payload.
   * @returns No value; resolves after host persistence.
   * @throws Queue failures propagate to bridge error reporting.
   
   * @example
   * ```typescript
   * import type { EventAgentTaskStore } from "@alneas/eaos-server";
   * export async function enqueueAdmittedEventTask(
   *   store: EventAgentTaskStore, task: Parameters<EventAgentTaskStore["enqueue"]>[0],
   * ) {
   *   // Host admission and the event-to-task mapping run before queue insertion.
   *   await store.enqueue(task);
   * }
   * ```
   */
  enqueue(task: QueuedEventTask): Promise<void>
  /**
   * Exclusively claims work for one drain pass.
   * @param limit - Requested maximum item count.
   * @returns Claimed queue items, or an empty array.
   * @throws Queue failures reject the drain pass.
   
   * @example
   * ```typescript
   * import type { EventAgentTaskStore } from "@alneas/eaos-server";
   * export async function claimEventTasks(store: EventAgentTaskStore) {
   *   const tasks = await store.claim(10);
   *   return tasks; // Empty when no eligible tasks are available.
   * }
   * ```
   */
  claim(limit: number): Promise<readonly QueuedEventTask[]>
  /**
   * Persists the normalized result for a claimed task.
   * @param taskId - Claimed task identifier.
   * @param result - Runtime outcome, including failed/pending statuses.
   * @returns No value; resolves after persistence.
   * @throws Completion failure causes the bridge to call fail.
   
   * @example
   * ```typescript
   * import type { EventAgentTaskStore } from "@alneas/eaos-server";
   * export async function completeEventTask(
   *   store: EventAgentTaskStore, claimedTaskId: string,
   *   result: Parameters<EventAgentTaskStore["complete"]>[1],
   * ) {
   *   await store.complete(claimedTaskId, result);
   *   // The host decides persistence and result retention for this queue.
   * }
   * ```
   */
  complete(taskId: string, result: ServerAgentTaskResult): Promise<void>
  /**
   * Records or handles a claimed execution/persistence failure.
   * @param taskId - Claimed task identifier.
   * @param error - Underlying execution or completion failure.
   * @returns No value; completion/retry semantics belong to the host store.
   * @throws Failures reject the drain pass.
   
   * @example
   * ```typescript
   * import type { EventAgentTaskStore } from "@alneas/eaos-server";
   * export async function recordEventTaskFailure(
   *   store: EventAgentTaskStore, claimedTaskId: string, observedError: unknown,
   * ) {
   *   await store.fail(claimedTaskId, observedError);
   *   // Failure/retry policy belongs to the host store; this does not retry execution.
   * }
   * ```
   */
  fail(taskId: string, error: unknown): Promise<void>
}

/**
 * Small process-local TaskStore for development, tests and a single short-
 * lived host. It deliberately has no lease recovery or persistence and must
 * not be used as the production workflow/checkpoint store.
 * @remarks Duplicate IDs compare JSON serialization exactly. Completed history/results are retained without the active-task capacity limit. No retry, lease recovery, or durable failure history exists.
 * @example
 * ```typescript
 * import { InMemoryEventAgentTaskStore } from "@alneas/eaos-server/agentic/event-bridge";
 * const store = new InMemoryEventAgentTaskStore();
 * console.log(await store.claim(1)); // []
 * ```
 */
export class InMemoryEventAgentTaskStore implements EventAgentTaskStore {
  private readonly pending = new Map<string, QueuedEventTask>()
  private readonly claimed = new Map<string, QueuedEventTask>()
  private readonly completed = new Map<string, QueuedEventTask>()
  private readonly results = new Map<string, ServerAgentTaskResult>()
  private readonly maxTasks: number

  /**
   * Creates an empty local queue with an active pending/claimed capacity limit.
   * @param options - maxTasks defaults to 10000 and must be a safe integer 1–1000000.
   * @throws Invalid capacity.
   */
  constructor(options: { 
  /**
   * Maximum pending plus claimed tasks retained at once; defaults to 10000 and must be a safe integer from 1 to 1000000. Completed history/results are outside this limit.
   */
  maxTasks?: number } = {}) {
    this.maxTasks = options.maxTasks ?? 10_000
    if (!Number.isSafeInteger(this.maxTasks) || this.maxTasks < 1 || this.maxTasks > 1_000_000) throw new Error('Invalid in-memory agent task store limit')
  }

  /**
   * Clones a queued task unless its ID is already identically retained.
   * @param task - Nonempty task ID and event name with structured-cloneable payload/task.
   * @returns No value; resolves after local insertion or matching duplicate detection.
   * @throws Missing identifiers, conflicting duplicate, active capacity exhaustion, or clone/JSON failure.
   * @example
   * ```typescript
   * import { InMemoryEventAgentTaskStore } from "@alneas/eaos-server/agentic/event-bridge";
   * import type { QueuedEventTask } from "@alneas/eaos-server/agentic/event-bridge";
   * export async function enqueue(store: InMemoryEventAgentTaskStore, task: QueuedEventTask) { await store.enqueue(task); }
   * ```
   */
  async enqueue(task: QueuedEventTask): Promise<void> {
    if (!task?.task?.id || !task.eventName) throw new Error('Invalid queued event task')
    const existing = this.pending.get(task.task.id) ?? this.claimed.get(task.task.id) ?? this.completed.get(task.task.id)
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(task)) throw new Error('Conflicting duplicate event agent task')
      return
    }
    if (this.pending.size + this.claimed.size >= this.maxTasks) throw new Error('In-memory agent task store is full')
    this.pending.set(task.task.id, structuredClone(task))
  }

  /**
   * Moves pending items into the claimed map in insertion order.
   * @param limit - Positive safe-integer maximum item count.
   * @returns Cloned claimed items, or an empty array.
   * @throws Invalid limit or clone failure; an item may already have moved before clone failure.
   * @example
   * ```typescript
   * import { InMemoryEventAgentTaskStore } from "@alneas/eaos-server/agentic/event-bridge";
   * const store = new InMemoryEventAgentTaskStore();
   * console.log(await store.claim(1)); // []
   * ```
   */
  async claim(limit: number): Promise<readonly QueuedEventTask[]> {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid in-memory agent task claim limit')
    const claimed: QueuedEventTask[] = []
    for (const [taskId, task] of this.pending) {
      this.pending.delete(taskId)
      this.claimed.set(taskId, task)
      claimed.push(structuredClone(task))
      if (claimed.length >= limit) break
    }
    return claimed
  }

  /**
   * Moves a claimed task into retained completion history and clones its result.
   * @param taskId - Current claimed task identifier.
   * @param result - Normalized runtime outcome, including FAILED or PENDING_APPROVAL data.
   * @returns No value; completes after retaining history and result.
   * @throws Unknown/already completed task or clone failure; history can already have changed.
   * @example
   * ```typescript
   * import { InMemoryEventAgentTaskStore } from "@alneas/eaos-server/agentic/event-bridge";
   * import type { ServerAgentTaskResult } from "@alneas/eaos-server/agentic/types";
   * export async function complete(store: InMemoryEventAgentTaskStore, taskId: string, result: ServerAgentTaskResult) { await store.complete(taskId, result); }
   * ```
   */
  async complete(taskId: string, result: ServerAgentTaskResult): Promise<void> {
    const task = this.claimed.get(taskId)
    if (!task) throw new Error('Unknown or already completed event agent task')
    this.claimed.delete(taskId)
    this.completed.set(taskId, task)
    this.results.set(taskId, structuredClone(result))
  }

  /**
   * Removes a claimed task without retaining failure history or rescheduling it.
   * @param taskId - Current claimed task identifier.
   * @param _error - Failure value accepted for interface compatibility and ignored.
   * @returns No value; resolves after removal.
   * @throws Unknown/already failed task.
   * @example
   * ```typescript
   * import { InMemoryEventAgentTaskStore } from "@alneas/eaos-server/agentic/event-bridge";
   * export async function fail(store: InMemoryEventAgentTaskStore, taskId: string, error: unknown) { await store.fail(taskId, error); }
   * ```
   */
  async fail(taskId: string, _error: unknown): Promise<void> {
    if (!this.claimed.delete(taskId)) throw new Error('Unknown or already failed event agent task')
  }

  /**
 * Inspects a cloned retained completion result for local tests/development.
 * @param taskId - Previously completed task identifier.
 * @returns Cloned result, or undefined if no completion result exists.
 * @throws If a retained result cannot be cloned.
 * @example
 * ```typescript
 * import { InMemoryEventAgentTaskStore } from "@alneas/eaos-server/agentic/event-bridge";
 * console.log(new InMemoryEventAgentTaskStore().getResult("missing")); // undefined
 * ```
 */
  getResult(taskId: string): ServerAgentTaskResult | undefined {
    const result = this.results.get(taskId)
    return result ? structuredClone(result) : undefined
  }
}

/**
 * Converts subscribed domain events into bounded local execution or host-persisted agent work.
 * @remarks Without taskStore, accepted work is process-local and can be lost on restart. With taskStore, the host explicitly calls runDurableOnce; event subscription callbacks still do not await durable persistence from the publisher's perspective. Authorize identity in createTask before creating specifications. Generated task IDs/idempotency defaults are per emission, so repeated events are not automatically deduplicated. Dispose every registerRule callback to release subscriptions; no global destroy is provided.
 * @example
 * ```typescript
 * import { EventAgentBridge } from "@alneas/eaos-server/agentic/event-bridge";
 * import type { DomainEventBus } from "@alneas/eaos-core";
 * import type { ServerAutonomousWorker } from "@alneas/eaos-server/agentic/autonomous-worker";
 * export function bridge(eventBus: DomainEventBus, worker: ServerAutonomousWorker) { return new EventAgentBridge(eventBus, worker); }
 * ```
 */
export class EventAgentBridge {
  private eventBus: DomainEventBus
  private worker: ServerAutonomousWorker
  private rules: Map<string, EventAgentRule[]> = new Map()
  private subscriptions: Map<string, (payload: unknown) => void> = new Map()
  private queue: QueuedEventTask[] = []
  private activeCount = 0
  private readonly maxConcurrent: number
  private readonly maxQueueSize: number
  private readonly onPendingApproval?: EventAgentBridgeOptions['onPendingApproval']
  private readonly onError?: EventAgentBridgeOptions['onError']
  private taskStore?: EventAgentTaskStore
  private taskCounter = 0

  /**
   * Captures an event bus and worker and validates local backpressure limits.
   * @param eventBus - Host domain bus; subscriptions begin only on registerRule.
   * @param worker - Host worker performing gatekeeper/runtime execution.
   * @param options - Queue limits, notification/error callbacks, and optional durable store.
   * @throws Invalid limits or malformed durable store.
   */
  constructor(eventBus: DomainEventBus, worker: ServerAutonomousWorker, options: EventAgentBridgeOptions = {}) {
    this.eventBus = eventBus
    this.worker = worker
    // Safe defaults for a 1 GB application-worker and an ARM agent runtime.
    // Hosts with measured capacity may raise these explicitly.
    this.maxConcurrent = options.maxConcurrent ?? 1
    this.maxQueueSize = options.maxQueueSize ?? 100
    if (!Number.isSafeInteger(this.maxConcurrent) || this.maxConcurrent < 1 || this.maxConcurrent > 1_024) throw new Error('Invalid EventAgentBridge maxConcurrent')
    if (!Number.isSafeInteger(this.maxQueueSize) || this.maxQueueSize < 0 || this.maxQueueSize > 1_000_000) throw new Error('Invalid EventAgentBridge maxQueueSize')
    this.onPendingApproval = options.onPendingApproval
    this.onError = options.onError
    if (options.taskStore) this.withDurableTaskStore(options.taskStore)
  }

  /**
   * Persisted event work is deliberately drained by the host scheduler. The
   * bridge never treats its in-memory queue as a durable workflow checkpoint.
   * @param store - Host durable queue with enqueue/claim/complete/fail functions.
   * @returns This bridge after replacing its store reference.
   * @throws Missing/malformed store functions.
   * @remarks Existing local queued work is not migrated by changing this store.
   * @example
   * ```typescript
   * import { EventAgentBridge } from "@alneas/eaos-server/agentic/event-bridge";
   * import type { EventAgentTaskStore } from "@alneas/eaos-server/agentic/event-bridge";
   * export function persist(bridge: EventAgentBridge, store: EventAgentTaskStore) { return bridge.withDurableTaskStore(store); }
   * ```
   */
  withDurableTaskStore(store: EventAgentTaskStore): this {
    if (!store || typeof store.enqueue !== 'function' || typeof store.claim !== 'function' || typeof store.complete !== 'function' || typeof store.fail !== 'function') throw new Error('Invalid durable event agent task store')
    this.taskStore = store
    return this
  }

  /**
   * Claims one bounded durable batch and processes it sequentially.
   * @param limit - Safe integer 1–maxConcurrent; defaults to maxConcurrent.
   * @returns Claim/completion/failure persistence counts; a worker FAILED result counts completed if stored successfully.
   * @throws Missing store, invalid limit, claim/fail persistence errors, or synchronous error-sink errors.
   * @remarks Calls are not globally serialized. Notification failures are reported after result persistence. No periodic scheduler or automatic retry is installed.
   * @example
   * ```typescript
   * import { EventAgentBridge } from "@alneas/eaos-server/agentic/event-bridge";
   * export async function drain(bridge: EventAgentBridge) { return bridge.runDurableOnce(); }
   * ```
   */
  async runDurableOnce(limit = this.maxConcurrent): Promise<{ 
  /** Number of queued tasks returned by the host claim for this pass, including tasks later recorded as completed or failed. */
  claimed: number; 
  /** Number of task results successfully passed to store.complete; a returned worker FAILED or PENDING_APPROVAL status still counts when its result is stored. */
  completed: number; 
  /** Number of worker throws or store.complete failures handled through store.fail; this counts persistence/execution handling failures rather than every returned worker FAILED status. */
  failed: number }> {
    if (!this.taskStore) throw new Error('Durable event agent task store is not configured')
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > this.maxConcurrent) throw new Error('Invalid durable event agent task limit')
    const tasks = await this.taskStore.claim(limit)
    let completed = 0, failed = 0
    for (const queued of tasks) {
      let result: ServerAgentTaskResult
      try {
        result = await this.worker.runTask(queued.task)
      } catch (error) {
        failed++
        await this.taskStore.fail(queued.task.id, error)
        this.reportError({ eventName: queued.eventName, taskId: queued.task.id, phase: 'runTask', error })
        continue
      }
      try {
        await this.taskStore.complete(queued.task.id, result)
        completed++
      } catch (error) {
        failed++
        await this.taskStore.fail(queued.task.id, error)
        this.reportError({ eventName: queued.eventName, taskId: queued.task.id, phase: 'result', error, result })
        continue
      }
      if (result.status === 'PENDING_APPROVAL' && this.onPendingApproval) {
        try { await this.onPendingApproval({ eventName: queued.eventName, payload: queued.payload, task: queued.task, result }) }
        catch (error) { this.reportError({ eventName: queued.eventName, taskId: queued.task.id, phase: 'notification', error, result }) }
      }
      if (result.status === 'FAILED') this.reportError({ eventName: queued.eventName, taskId: queued.task.id, phase: 'result', error: result.error ?? new Error('Agent task failed'), result })
    }
    return { claimed: tasks.length, completed, failed }
  }

  /**
   * Subscribes a task-conversion rule and returns its individual unsubscribe callback.
   * @param rule - Exact event name and synchronous createTask callback; callback receives payload and returns verified task fields or null to skip.
   * @returns A no-argument callback returning no value; removes this rule and unsubscribes the bus handler when no rules remain.
   * @throws Event bus subscription/unsubscription errors can propagate. Event conversion errors are reported through onError.
   * @remarks The rule is retained by reference; do not mutate its eventName after registration. Already accepted tasks keep running after unsubscribe.
   * @example
   * ```typescript
   * import { EventAgentBridge } from "@alneas/eaos-server/agentic/event-bridge";
   * import type { EventAgentRule } from "@alneas/eaos-server/agentic/event-bridge";
   * export function listen(bridge: EventAgentBridge, rule: EventAgentRule) { return bridge.registerRule(rule); }
   * ```
   */
  registerRule(rule: EventAgentRule): () => void {
    if (!this.rules.has(rule.eventName)) {
      this.rules.set(rule.eventName, [])
      const handler = (payload: unknown) => {
        void this.handleEvent(rule.eventName, payload).catch(error => {
          this.reportError({ eventName: rule.eventName, phase: 'createTask', error })
        })
      }
      this.subscriptions.set(rule.eventName, handler)
      this.eventBus.subscribe(rule.eventName, handler)
    }
    this.rules.get(rule.eventName)!.push(rule)
    return () => {
      const list = this.rules.get(rule.eventName)
      if (list) {
        const index = list.indexOf(rule)
        if (index >= 0) list.splice(index, 1)
        if (list.length === 0) {
          this.rules.delete(rule.eventName)
          const handler = this.subscriptions.get(rule.eventName)
          if (handler) this.eventBus.unsubscribe(rule.eventName, handler)
          this.subscriptions.delete(rule.eventName)
        }
      }
    }
  }

  /**
 * Waits until the bridge's local active count and waiting queue are empty.
 * @returns No value; resolves when local work is idle. It does not wait for durable queue persistence/draining or asynchronous error sinks.
 * @remarks Polls with zero-delay timers and has no timeout/cancellation; continuously arriving work can delay completion indefinitely.
 * @example
 * ```typescript
 * import { EventAgentBridge } from "@alneas/eaos-server/agentic/event-bridge";
 * export async function idle(bridge: EventAgentBridge) { await bridge.whenIdle(); }
 * ```
 */
  async whenIdle(): Promise<void> {
    while (this.activeCount > 0 || this.queue.length > 0) await new Promise(resolve => setTimeout(resolve, 0))
  }

  private async handleEvent(eventName: string, payload: unknown): Promise<void> {
    const list = this.rules.get(eventName)
    if (!list || list.length === 0) return

    for (const rule of [...list]) {
      let taskSpec: Omit<ServerAgentTaskRequest, 'id'> | null
      try {
        taskSpec = rule.createTask(payload)
      } catch (error) {
        this.reportError({ eventName, phase: 'createTask', error })
        continue
      }
      if (!taskSpec) continue

      const taskId = `evt_${Date.now()}_${++this.taskCounter}`
      const task: ServerAgentTaskRequest = {
        ...taskSpec,
        id: taskId,
        executionContext: {
          ...taskSpec.executionContext,
          idempotencyKey: taskSpec.executionContext?.idempotencyKey ?? `event-agent:${eventName}:${taskId}`,
        },
      }
      if (this.taskStore) {
        try { await this.taskStore.enqueue({ eventName, payload: structuredClone(payload), task: structuredClone(task) }) }
        catch (error) { this.reportError({ eventName, taskId: task.id, phase: 'queue', error }) }
        continue
      }
      if (this.queue.length >= this.maxQueueSize && this.activeCount >= this.maxConcurrent) {
        this.reportError({ eventName, taskId: task.id, phase: 'queue', error: new Error('EventAgentBridge queue is full') })
        continue
      }
      this.queue.push({ eventName, payload, task })
    }
    this.drain()
  }

  private drain(): void {
    while (this.activeCount < this.maxConcurrent && this.queue.length > 0) {
      const queued = this.queue.shift()!
      this.activeCount += 1
      void this.execute(queued).finally(() => {
        this.activeCount -= 1
        this.drain()
      })
    }
  }

  private async execute(queued: QueuedEventTask): Promise<void> {
    let result: ServerAgentTaskResult
    try {
      result = await this.worker.runTask(queued.task)
    } catch (error) {
      this.reportError({ eventName: queued.eventName, taskId: queued.task.id, phase: 'runTask', error })
      return
    }

    if (result.status === 'PENDING_APPROVAL') {
      try {
        if (this.onPendingApproval) await this.onPendingApproval({ eventName: queued.eventName, payload: queued.payload, task: queued.task, result })
        else console.warn('[EventAgentBridge] Agent task pending approval', { eventName: queued.eventName, taskId: queued.task.id, approvalTicketId: result.approvalTicketId })
      } catch (error) {
        this.reportError({ eventName: queued.eventName, taskId: queued.task.id, phase: 'notification', error, result })
      }
      return
    }
    if (result.status === 'FAILED') this.reportError({ eventName: queued.eventName, taskId: queued.task.id, phase: 'result', error: result.error ?? new Error('Agent task failed'), result })
  }

  private reportError(detail: EventAgentBridgeError): void {
    if (this.onError) {
      void Promise.resolve(this.onError(detail)).catch(error => console.error('[EventAgentBridge] Error sink failed', error))
      return
    }
    console.error('[EventAgentBridge] Event task failed', {
      eventName: detail.eventName,
      taskId: detail.taskId,
      phase: detail.phase,
      error: detail.error instanceof Error ? detail.error.message : String(detail.error),
    })
  }
}
