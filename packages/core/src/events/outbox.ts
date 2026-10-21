import { canonicalJsonHash } from '../serialization/index'

/**
 * Persisted lifecycle states understood by an outbox store.
 * @see {@link createOutboxEvent}
 */
export type OutboxEventStatus = 'pending' | 'processing' | 'published' | 'failed'

/**
 * Tenant-scoped payload envelope plus host-owned claim and publication state.
 * @see {@link createOutboxEvent}
 * @typeParam T - JSON-safe event body type, default unknown; host persistence retains the envelope identity.
 */
export interface OutboxEvent<T = unknown> {
  
  /** Stable event identity; generated IDs hash tenant/producer/idempotency key, excluding topic/payload. */
  id: string
  
/** Verified tenant boundary for the record or operation; host authorization must establish this scope. */
  tenantId: string
  
/** Stable component identity emitting the event. */
  producer: string
  
  /** Exact event dispatch key used to locate a registered host handler. */
  topic: string
  
/** Replay identity for the same admitted operation; the host must persist/deduplicate it before unsafe retries. */
  idempotencyKey: string
  
  /** Typed event/request body; constructors clone and strictly hash JSON where documented. */
  payload: T
  
/** SHA-256 identity of the canonical JSON event payload. */
  payloadHash: string
  
/** Event/effect occurrence timestamp; creation helpers normalize supported inputs to ISO text. */
  occurredAt: string
  
/** Earliest timestamp at which the host scheduler may claim or execute this work. */
  availableAt: string
  
  /** Host outbox lifecycle; createOutboxEvent initializes pending. */
  status: OutboxEventStatus
  
/** Host-recorded outbox claim attempt count; new envelopes start at zero. */
  attempts: number
  
/** Optional timestamp at which the host store claimed the event. */
  claimedAt?: string
  
/** Host claim ownership token required when settling a claimed event. */
  claimToken?: string
  
/** Timestamp recorded after successful handler completion and host settlement. */
  publishedAt?: string
  
/** Most recent host-recorded failure detail, when available. */
  lastError?: string
}

/**
 * Inputs for constructing an event before host persistence.
 * @see {@link createOutboxEvent}
 * @typeParam T - JSON-safe payload type cloned into the constructed envelope; default unknown.
 */
export interface OutboxEventInput<T = unknown> {
  
/** Verified tenant boundary for the record or operation; host authorization must establish this scope. */
  tenantId: string
  
/** Stable component identity emitting the event. */
  producer: string
  
  /** Exact event dispatch key used to locate a registered host handler. */
  topic: string
  
/** Replay identity for the same admitted operation; the host must persist/deduplicate it before unsafe retries. */
  idempotencyKey: string
  
  /** Typed event/request body; constructors clone and strictly hash JSON where documented. */
  payload: T
  
  /** Optional explicit event identity; omission derives it from tenant/producer/idempotency key. */
  id?: string
  
/** Event/effect occurrence timestamp; creation helpers normalize supported inputs to ISO text. */
  occurredAt?: Date | string
  
/** Earliest timestamp at which the host scheduler may claim or execute this work. */
  availableAt?: Date | string
}

/**
 * Transactional host storage port for claiming and settling outbox records.
 * @see {@link createOutboxEvent}
 */
export interface OutboxStore {
  
  /**
   * Atomically claim a bounded set of due records for one host worker.
   * @param now - Host claim time used to determine due work.
   * @param limit - Maximum records requested; dispatcher supplies its validated batch size.
   * @returns Claimed records with host-owned claim/attempt metadata, possibly empty.
   * @throws Host claim failures reject the Promise.
   * @remarks Host owns transaction/CAS, leases, tenant isolation and claim tokens. Concurrent workers must not claim the same live record.
   * @example
   * ```typescript
   * import type { OutboxStore } from "@alneas/eaos-core/events/outbox";
   * async function claimHostEvents(store: OutboxStore) { return store.claim(new Date(), 20); }
   * ```
   */
  claim(now: Date, limit: number): Promise<readonly OutboxEvent[]>
  
  /**
   * Settle a claimed event after its handler completes.
   * @param id - Claimed event identity.
   * @param claimToken - Exact live claim ownership token.
   * @param publishedAt - Host publication completion timestamp.
   * @returns No value; the host settlement has completed.
   * @throws Host settlement failures reject the Promise.
   * @remarks Host must enforce claim ownership and durable settlement. A rejection after the handler effect does not prove the effect failed.
   * @example
   * ```typescript
   * import type { OutboxStore } from "@alneas/eaos-core/events/outbox";
   * async function settleHostEvent(store: OutboxStore, id: string, claimToken: string) { await store.markPublished(id, claimToken, new Date()); }
   * ```
   */
  markPublished(id: string, claimToken: string, publishedAt: Date): Promise<void>
  
  /**
   * Settle a failed claim with either a retry schedule or terminal state.
   * @param id - Claimed event identity.
   * @param claimToken - Exact live claim ownership token.
   * @param error - Sanitized failure text; dispatcher truncates Error messages to 1000 characters.
   * @param retryAt - Future due time for a retry, or null for terminal failure.
   * @returns No value; the host failure/retry settlement has completed.
   * @throws Host settlement failures reject the Promise.
   * @remarks Host must enforce claim ownership and atomically release/reschedule the claim; Core does not implement storage.
   * @example
   * ```typescript
   * import type { OutboxStore } from "@alneas/eaos-core/events/outbox";
   * async function failHostEvent(store: OutboxStore, id: string, claimToken: string) { await store.markFailed(id, claimToken, "Temporary failure", new Date(Date.now() + 1000)); }
   * ```
   */
  markFailed(id: string, claimToken: string, error: string, retryAt: Date | null): Promise<void>
}

/**
 * Attempt limit and capped exponential delay configuration in milliseconds.
 * @see {@link createOutboxEvent}
 */
export interface OutboxRetryPolicy {
  
/** Maximum intended attempt count; delay calculators validate it but do not themselves stop retries. */
  maxAttempts: number
  
/** Initial retry delay in milliseconds before exponential scaling. */
  baseDelayMs: number
  
/** Upper bound for a calculated retry delay in milliseconds. */
  maxDelayMs: number
  
/** Exponential growth factor for successive retry delays, at least one for validated policies. */
  backoffMultiplier: number
}

/**
 * Counts from one worker pass, including retries and terminal failures.
 * @see {@link createOutboxEvent}
 */
export interface OutboxDispatchResult {
  
/** Number of records returned by the store claim for this pass. */
  claimed: number
  
/** Number of claimed records whose handler and markPublished completed. */
  published: number
  
/** Number of failed records rescheduled with a nonnull retry timestamp. */
  retried: number
  
/** Number of claimed records marked as terminal failures in this pass. */
  failed: number
}

/**
 * Mark a dispatch failure as retryable or terminal.
 *
 * @example
 * ```typescript
 * import { OutboxDispatchError } from "@alneas/eaos-core/events/outbox";
 * const error = new OutboxDispatchError("Receiver declined the event", { retryable: false });
 * console.log(error.retryable); // false
 * ```
 */
export class OutboxDispatchError extends Error {
  
  /**
   * Whether dispatch should be rescheduled; defaults to true when omitted at construction.
   */
  readonly retryable: boolean

  
  /**
   * Create a dispatch error with explicit retry classification.
   * @param message - Human-readable failure text; dispatcher truncates stored Error messages to 1000 characters.
   * @param options - retryable defaults to true; optional cause is forwarded to Error.
   * @example
   * ```typescript
   * import { OutboxDispatchError } from "@alneas/eaos-core/events/outbox";
   * const error = new OutboxDispatchError("Temporary delivery failure");
   * console.log(error.retryable); // true
   * ```
   */
  constructor(message: string, options: { 
/** Whether the recorded failure permits a host retry; callers must still account for possible completed effects. */
  retryable?: boolean; 
  /** Optional underlying error passed through the standard Error cause option. */
  cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'OutboxDispatchError'
    this.retryable = options.retryable ?? true
  }
}

function identifier(value: string, name: string, max = 128): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/.test(value) || value.length > max) throw new Error(`Invalid ${name}`)
  return value
}

function timestamp(value: Date | string | undefined, name: string, fallback: Date): string {
  const date = value instanceof Date ? value : value === undefined ? fallback : new Date(value)
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new Error(`Invalid ${name}`)
  return date.toISOString()
}

/**
 * Build a validated, immutable event envelope. Persistence is supplied by the host.
 * @typeParam T - JSON-safe event payload type retained in the returned envelope.
 * @param input - Scope, topic, idempotency key and JSON payload. ID defaults to a hash of tenant/producer/key; occurredAt and availableAt default to the current time.
 * @returns A shallow-frozen pending event with cloned payload, payload hash and zero attempts.
 * @throws Error for invalid identifiers/timestamps or non-JSON/uncloneable payload.
 * @remarks Requires node:crypto. Idempotency identity excludes topic and payload; the host store must enforce key uniqueness and the intended tenant boundary.
 * @example
 * ```typescript
 * import { createOutboxEvent } from "@alneas/eaos-core/events/outbox";
 * const event = createOutboxEvent({ tenantId: "tenant-demo", producer: "notes", topic: "note.created", idempotencyKey: "request-1", payload: { id: "note-1" } });
 * console.log(event.status); // pending
 * ```
 */
export function createOutboxEvent<T>(input: OutboxEventInput<T>): OutboxEvent<T> {
  const now = new Date()
  const tenantId = identifier(input.tenantId, 'tenantId')
  const producer = identifier(input.producer, 'producer')
  const topic = identifier(input.topic, 'topic')
  const idempotencyKey = identifier(input.idempotencyKey, 'idempotencyKey', 256)
  const payload = structuredClone(input.payload)
  const payloadHash = canonicalJsonHash(payload)
  const id = input.id === undefined ? `event-${canonicalJsonHash([tenantId, producer, idempotencyKey]).slice(0, 64)}` : identifier(input.id, 'event id', 240)
  const occurredAt = timestamp(input.occurredAt, 'occurredAt', now)
  const availableAt = timestamp(input.availableAt, 'availableAt', now)
  return Object.freeze({
    id,
    tenantId,
    producer,
    topic,
    idempotencyKey,
    payload,
    payloadHash,
    occurredAt,
    availableAt,
    status: 'pending' as const,
    attempts: 0,
  })
}

/**
 * Compute a capped exponential outbox retry delay.
 * @param attempt - Positive one-based attempt number.
 * @param policy - Positive maxAttempts and multiplier at least 1; nonnegative finite delay values in milliseconds.
 * @returns Delay in milliseconds, capped at maxDelayMs; maxAttempts does not itself suppress further attempts.
 * @throws Error for invalid attempt or retry policy.
 * @remarks Does not sleep, schedule or enforce idempotency.
 * @example
 * ```typescript
 * import { retryDelayMs } from "@alneas/eaos-core/events/outbox";
 * console.log(retryDelayMs(2, { maxAttempts: 5, baseDelayMs: 1000, maxDelayMs: 60000, backoffMultiplier: 2 })); // 2000
 * ```
 */
export function retryDelayMs(attempt: number, policy: OutboxRetryPolicy): number {
  if (!Number.isSafeInteger(attempt) || attempt < 1 || !Number.isSafeInteger(policy.maxAttempts) || policy.maxAttempts < 1 || !Number.isFinite(policy.baseDelayMs) || policy.baseDelayMs < 0 || !Number.isFinite(policy.maxDelayMs) || policy.maxDelayMs < 0 || !Number.isFinite(policy.backoffMultiplier) || policy.backoffMultiplier < 1) throw new Error('Invalid outbox retry policy')
  return Math.min(policy.maxDelayMs, Math.max(0, policy.baseDelayMs * Math.pow(policy.backoffMultiplier, attempt - 1)))
}

/**
 * Host persistence, handlers, scheduling clock and optional admission wrapper for a worker pass.
 * @see {@link createOutboxEvent}
 */
export interface OutboxDispatcherOptions {
  
  /** Transactional host outbox port; claiming and settlement must enforce claim ownership and tenant scope. */
  store: OutboxStore
  
  /**
   * Map exact event topics to asynchronous effect handlers.
   * @remarks Each callback receives a cloned readonly event and resolves without a value after its effect completes. Rejections normally schedule retries, so handlers must be replay-safe; use OutboxDispatchError with retryable false for terminal failures.
   * @see {@link OutboxDispatcher.runOnce}
   */
  handlers: Record<string, (event: Readonly<OutboxEvent>) => Promise<void>>
  
  /**
   * Provide the worker clock used for claiming and settlement timestamps.
   * @returns Current valid Date; omission uses a new Date for each clock call.
   * @see {@link OutboxDispatcher.runOnce}
   *
   * @example
   * ```typescript
   * import type { OutboxDispatcherOptions } from "@alneas/eaos-core/events/outbox";
   * function readHostClock(options: OutboxDispatcherOptions) {
   *  return options.now?.() ?? new Date();
   * }
   * ```
   */
  now?: () => Date
  
/** Optional retry overrides; dispatcher defaults to 5 attempts, 1000 ms base, 60000 ms maximum and multiplier 2. */
  retryPolicy?: Partial<OutboxRetryPolicy>
  
/** Maximum claim size for one pass, from 1 to 100; defaults to 20. */
  batchSize?: number
  
  /**
   * Optionally enforce live host admission immediately before the handler side effect.
   * @param event - Claimed readonly event whose tenant/plugin lifecycle must still permit execution.
   * @param handler - Deferred callback invoking the registered effect handler; await it only after admission succeeds.
   * @returns No value; completion means the wrapper and any invoked handler have completed.
   * @throws Wrapper/handler failures enter dispatcher retry/failure settlement.
   * @remarks Omission calls handler directly. Host owns authorization, replay safety and partial-outcome reconciliation.
   * @see {@link OutboxDispatcher.runOnce}
   *
   * @example
   * ```typescript
   * import type { OutboxDispatcherOptions, OutboxEvent } from "@alneas/eaos-core/events/outbox";
   * async function invokeHostWrapper(options: OutboxDispatcherOptions, event: OutboxEvent) {
   *  const handler = options.handlers[event.topic];
   *  if (!handler || !options.execute) throw new Error("Configure a handler and live host admission wrapper");
   *  await options.execute(event, () => handler(event));
   * }
   * ```
   */
  execute?: (event: Readonly<OutboxEvent>, handler: () => Promise<void>) => Promise<void>
}

/**
 * Claim and settle one bounded batch through host-owned storage and topic handlers.
 * @remarks No timers, cancellation or automatic looping. Hosts own scheduling, atomic claims/claim tokens, tenant admission and idempotent effects. Records are handled sequentially; handler success followed by settlement failure can cause a retry of an already-completed effect.
 *
 * @example
 * ```typescript
 * import { OutboxDispatcher } from "@alneas/eaos-core/events/outbox";
 * import type { OutboxDispatcherOptions } from "@alneas/eaos-core/events/outbox";
 * async function dispatchHostBatch(options: OutboxDispatcherOptions) {
 *  return new OutboxDispatcher(options).runOnce();
 * }
 * ```
 */
export class OutboxDispatcher {
  private readonly options: {
    store: OutboxStore
    handlers: Record<string, (event: Readonly<OutboxEvent>) => Promise<void>>
    now: () => Date
    retryPolicy: OutboxRetryPolicy
    batchSize: number
    execute?: (event: Readonly<OutboxEvent>, handler: () => Promise<void>) => Promise<void>
  }

  
  /**
   * Configure a bounded worker with host storage and effect handlers.
   * @param options - Required store/handlers and optional admission wrapper/clock/retry settings; defaults are 20 records, 5 attempts, 1000 ms base, 60000 ms cap and multiplier 2.
   * @throws Error for missing store/handlers or batchSize outside integer range 1–100.
   * @remarks Constructing the dispatcher performs no claim, handler call or scheduling. Retry settings are validated when retryDelayMs is used.
   * @example
   * ```typescript
   * import { OutboxDispatcher } from "@alneas/eaos-core/events/outbox";
   * import type { OutboxDispatcherOptions } from "@alneas/eaos-core/events/outbox";
   * function createHostDispatcher(options: OutboxDispatcherOptions) { return new OutboxDispatcher(options); }
   * ```
   */
  constructor(options: OutboxDispatcherOptions) {
    if (!options?.store || !options.handlers) throw new Error('Outbox store and handlers are required')
    const retryPolicy = { maxAttempts: 5, baseDelayMs: 1_000, maxDelayMs: 60_000, backoffMultiplier: 2, ...options.retryPolicy }
    this.options = { ...options, now: options.now ?? (() => new Date()), retryPolicy, batchSize: options.batchSize ?? 20 }
    if (!Number.isSafeInteger(this.options.batchSize) || this.options.batchSize < 1 || this.options.batchSize > 100) throw new Error('Invalid outbox batch size')
  }

  /**
   * Claim due events and execute/settle each one sequentially.
   * @returns Counts of claimed, published, rescheduled and terminally failed records; empty batches return zero counts.
   * @throws Rejects on store claim/markFailed errors, invalid retry calculations or clock failures. Handler/admission/markPublished failures normally become failed/rescheduled records.
   * @remarks Unknown topic errors are terminal; other errors retry unless OutboxDispatchError says otherwise or attempts are exhausted. Concurrent runOnce safety depends on atomic host claims; no exactly-once guarantee is provided.
   * @example
   * ```typescript
   * import { OutboxDispatcher } from "@alneas/eaos-core/events/outbox";
   * import type { OutboxDispatcherOptions } from "@alneas/eaos-core/events/outbox";
   * async function dispatchHostBatch(options: OutboxDispatcherOptions) {
   *  const dispatcher = new OutboxDispatcher(options);
   *  return dispatcher.runOnce();
   * }
   * ```
   */
  async runOnce(): Promise<OutboxDispatchResult> {
    const now = this.options.now()
    const events = await this.options.store.claim(now, this.options.batchSize)
    const result: OutboxDispatchResult = { claimed: events.length, published: 0, retried: 0, failed: 0 }
    for (const event of events) {
      const handler = this.options.handlers[event.topic]
      try {
        if (!handler) throw new OutboxDispatchError(`No handler registered for ${event.topic}`, { retryable: false })
        const execute = this.options.execute ?? ((_event, operation) => operation())
        await execute(event, () => handler(structuredClone(event)))
        await this.options.store.markPublished(event.id, event.claimToken ?? '', this.options.now())
        result.published++
      } catch (error) {
        const retryable = error instanceof OutboxDispatchError ? error.retryable : true
        const exhausted = !retryable || event.attempts >= this.options.retryPolicy.maxAttempts
        const retryAt = exhausted ? null : new Date(this.options.now().getTime() + retryDelayMs(event.attempts, this.options.retryPolicy))
        const message = error instanceof Error ? error.message.slice(0, 1000) : 'Outbox handler failed'
        await this.options.store.markFailed(event.id, event.claimToken ?? '', message, retryAt)
        if (retryAt) result.retried++
        else result.failed++
      }
    }
    return result
  }
}
