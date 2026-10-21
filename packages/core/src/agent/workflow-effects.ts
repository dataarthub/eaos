import { canonicalJsonHash } from '../serialization/index'

/**
 * Reported effect result; unknown requires reconciliation rather than assuming success or safe retry.
 * @see {@link createWorkflowEffectReceipt}
 */
export type WorkflowEffectOutcome = 'succeeded' | 'failed' | 'unknown'

/**
 * Admitted tenant/workflow operation and replay identity supplied to an effect adapter.
 * @see {@link createWorkflowEffectReceipt}
 * @typeParam TInput - Domain input type supplied to the effect adapter; defaults to unknown.
 */
export interface WorkflowEffectRequest<TInput = unknown> {
  
/** Verified tenant boundary for the record or operation; host authorization must establish this scope. */
  tenantId: string
  
/** Workflow definition identity used to correlate execution and effects. */
  workflowId: string
  
/** Operation identity whose meaning and permission are controlled by the host. */
  operation: string
  
/** Replay identity for the same admitted operation; the host must persist/deduplicate it before unsafe retries. */
  idempotencyKey: string
  
  /** Domain request value passed to the admitted operation; no domain-schema proof is implied solely by this type. */
  input: TInput
  
  /** Approved resource identity or execution placement; this metadata does not independently enforce access. */
  target?: { 
  /** Resource category used with its ID and optional revision to bind the exact execution target. */
  type: string; 
  /** Effect target resource identity; at most 512 nonblank characters when normalized. */
  id: string; 
/** Optional source/target revision interpreted by the owning host; approval/effect target revisions must be positive integers. */
  revision?: number }
}

/**
 * Provider outcome bound to the exact admitted request and its input hash.
 * @see {@link createWorkflowEffectReceipt}
 */
export interface WorkflowEffectReceipt {
  
  /** Envelope format discriminator accepted by the corresponding parser/validator. */
  schemaVersion: '1'
  
/** Verified tenant boundary for the record or operation; host authorization must establish this scope. */
  tenantId: string
  
/** Workflow definition identity used to correlate execution and effects. */
  workflowId: string
  
/** Operation identity whose meaning and permission are controlled by the host. */
  operation: string
  
/** Replay identity for the same admitted operation; the host must persist/deduplicate it before unsafe retries. */
  idempotencyKey: string
  
/** SHA-256 identity of the canonical JSON request input. */
  inputHash: string
  
/** Host adapter identity that binds routing/receipts to the implementation actually used. */
  adapterId: string
  
/** Provider/host identity of the effect receipt. */
  receiptId: string
  
  /** Reported success/failure/denial/unknown category; reconcile uncertain effects before retrying. */
  outcome: WorkflowEffectOutcome
  
/** Event/effect occurrence timestamp; creation helpers normalize supported inputs to ISO text. */
  occurredAt: string
  
/** Optional external resource identity reported by the provider. */
  externalId?: string
  
/** Optional machine-readable provider failure code. */
  errorCode?: string
  
/** Optional host/provider metadata; callers remain responsible for sensitive content and validation. */
  metadata?: Readonly<Record<string, unknown>>
}

/**
 * A provider receipt and optional domain output; receipt outcome remains authoritative.
 * @see {@link createWorkflowEffectReceipt}
 * @typeParam TOutput - Optional provider output type; default unknown, with success determined by receipt outcome.
 */
export interface WorkflowEffectResult<TOutput = unknown> {
  
/** Authoritative host operation receipt; inspect its status/outcome before treating optional output as successful. */
  receipt: WorkflowEffectReceipt
  
  /** Optional domain output; validate it separately and inspect the accompanying status/receipt. */
  output?: TOutput
}

/**
 * Host execution and optional reconciliation port for effects with replay identity.
 * @see {@link createWorkflowEffectReceipt}
 * @typeParam TInput - Admitted domain request shape; default unknown.
 * @typeParam TOutput - Domain output accompanying the authoritative receipt; default unknown.
 */
export interface WorkflowEffectAdapter<TInput = unknown, TOutput = unknown> {
  
  /**
   * Execute an admitted workflow effect through the connected host adapter.
   * @param request - Exact tenant/workflow/operation/input and replay key admitted by host policy.
   * @returns Provider receipt and optional output; failed/unknown outcomes remain data and must be reconciled.
   * @throws Host adapter errors/rejections propagate.
   * @remarks Host owns idempotency, authorization, provider persistence and deadlines; Core does not implement an adapter or retry. A rejection can follow a partially completed effect.
   * @example
   * ```typescript
   * import type { WorkflowEffectAdapter } from "@alneas/eaos-core/agent/workflow-effects";
   * async function executeHost(adapter: WorkflowEffectAdapter, request: Parameters<WorkflowEffectAdapter["execute"]>[0]) { return adapter.execute(request); }
   * ```
   */
  execute(request: WorkflowEffectRequest<TInput>): Promise<WorkflowEffectResult<TOutput>>
  
  /**
   * Reconcile a previous uncertain or failed effect using the exact admitted request.
   * @param request - Original admitted request, including its unchanged replay identity/input.
   * @param previous - Previous receipt to reconcile rather than blindly replaying an effect.
   * @returns Current provider receipt and optional output; outcome can remain unknown.
   * @throws Host reconciliation errors/rejections propagate; external state may remain uncertain.
   * @remarks Optional host capability; absence is not evidence that a retry is safe.
   * @example
   * ```typescript
   * import type { WorkflowEffectAdapter } from "@alneas/eaos-core/agent/workflow-effects";
   * async function reconcileHost(adapter: WorkflowEffectAdapter, request: Parameters<WorkflowEffectAdapter["execute"]>[0], previous: Parameters<NonNullable<WorkflowEffectAdapter["reconcile"]>>[1]) {
   *  if (!adapter.reconcile) throw new Error("Host reconciliation is unavailable");
   *  return adapter.reconcile(request, previous);
   * }
   * ```
   */
  reconcile?(request: WorkflowEffectRequest<TInput>, previous: WorkflowEffectReceipt): Promise<WorkflowEffectResult<TOutput>>
}

function text(value: unknown, name: string, max = 512): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid workflow effect ${name}`)
  return value
}

function target(value: WorkflowEffectRequest['target']) {
  if (value === undefined) return undefined
  const result = structuredClone(value)
  text(result.type, 'target type', 128)
  text(result.id, 'target id', 512)
  if (result.revision !== undefined && (!Number.isSafeInteger(result.revision) || result.revision < 1)) throw new Error('Invalid workflow effect target revision')
  return result
}

/**
 * Normalize a workflow effect request and compute its input hash.
 * @typeParam TInput - Domain input type preserved in the normalized request.
 * @param input - Admitted scope and JSON-safe input; optional target revision must be positive and idempotency key at most 256 characters.
 * @returns A new request with cloned input/target and an additional SHA-256 inputHash.
 * @throws Error for invalid scope/target, unsupported JSON or uncloneable input.
 * @remarks Does not execute an effect, establish authorization or persist the key.
 * @example
 * ```typescript
 * import { createWorkflowEffectRequest } from "@alneas/eaos-core/agent/workflow-effects";
 * const request = { tenantId: "tenant-demo", workflowId: "notes", operation: "note.create", idempotencyKey: "request-1", input: { text: "hello" } };
 * console.log(createWorkflowEffectRequest(request).inputHash);
 * ```
 */
export function createWorkflowEffectRequest<TInput>(input: WorkflowEffectRequest<TInput>): WorkflowEffectRequest<TInput> & { 
  /**
   * Lowercase SHA-256 digest of the original strict canonical JSON input, used to bind provider receipts to this admitted request.
   */
  inputHash: string } {
  return {
    tenantId: text(input.tenantId, 'tenantId'),
    workflowId: text(input.workflowId, 'workflowId'),
    operation: text(input.operation, 'operation'),
    idempotencyKey: text(input.idempotencyKey, 'idempotency key', 256),
    input: structuredClone(input.input),
    ...(input.target ? { target: target(input.target) } : {}),
    inputHash: canonicalJsonHash(input.input),
  }
}

/**
 * Build a provider receipt without allowing the adapter to change the admitted request identity.
 * @typeParam TInput - Input type of the request bound to the receipt.
 * @param input - Admitted request, adapter and receipt IDs, outcome and optional metadata; occurredAt defaults to current time.
 * @returns A validated receipt containing the request identity and input hash.
 * @throws Error for invalid request, receipt identity/outcome/time/metadata or uncloneable data.
 * @remarks A receipt records a reported outcome. Unknown outcomes require host reconciliation before a retry that could duplicate an effect; no execution or persistence occurs here.
 * @example
 * ```typescript
 * import { createWorkflowEffectReceipt } from "@alneas/eaos-core/agent/workflow-effects";
 * const request = { tenantId: "tenant-demo", workflowId: "notes", operation: "note.create", idempotencyKey: "request-1", input: { text: "hello" } };
 * console.log(createWorkflowEffectReceipt({ request, adapterId: "notes-store", receiptId: "receipt-1", outcome: "unknown" }).outcome);
 * ```
 */
export function createWorkflowEffectReceipt<TInput>(input: {
  
  /**
   * Exact admitted tenant/workflow/operation/input and replay identity whose normalized input hash is copied into the receipt.
   */
  request: WorkflowEffectRequest<TInput>
  
  /**
   * Nonblank host/provider adapter identity, at most 256 characters, recorded as the source of this outcome.
   */
  adapterId: string
  
  /**
   * Nonblank provider/host receipt identity, at most 512 characters.
   */
  receiptId: string
  
  /**
   * Reported succeeded, failed or unknown result; construction does not execute or independently verify the effect.
   */
  outcome: WorkflowEffectOutcome
  
  /**
   * Optional Date or parseable timestamp; omission uses the current ISO timestamp. Date inputs are normalized to ISO text.
   */
  occurredAt?: string | Date
  
  /**
   * Optional nonblank provider resource identity, at most 512 characters.
   */
  externalId?: string
  
  /**
   * Optional nonblank provider failure classification, at most 256 characters; failed/unknown outcomes remain receipt data.
   */
  errorCode?: string
  
  /**
   * Optional object-valued structured-cloneable receipt context; a detached copy is returned and the host must exclude secrets.
   */
  metadata?: Readonly<Record<string, unknown>>
}): WorkflowEffectReceipt {
  const request = createWorkflowEffectRequest(input.request)
  const occurredAt = input.occurredAt instanceof Date ? input.occurredAt.toISOString() : input.occurredAt ?? new Date().toISOString()
  const receipt = {
    schemaVersion: '1' as const,
    tenantId: request.tenantId,
    workflowId: request.workflowId,
    operation: request.operation,
    idempotencyKey: request.idempotencyKey,
    inputHash: request.inputHash,
    adapterId: text(input.adapterId, 'receipt adapter', 256),
    receiptId: text(input.receiptId, 'receipt id', 512),
    outcome: input.outcome,
    occurredAt,
    ...(input.externalId === undefined ? {} : { externalId: text(input.externalId, 'external id', 512) }),
    ...(input.errorCode === undefined ? {} : { errorCode: text(input.errorCode, 'error code', 256) }),
    ...(input.metadata === undefined ? {} : { metadata: structuredClone(input.metadata) }),
  }
  return validateWorkflowEffectReceipt(request, receipt)
}

/**
 * Validate a provider result against the exact request that was admitted.
 * @typeParam TInput - Expected domain input type used to recompute request identity.
 * @param request - Expected tenant/workflow/operation/idempotency key and JSON-safe input.
 * @param receipt - Untrusted receipt; identity and input hash must match request and outcome must be succeeded, failed or unknown.
 * @returns A new normalized receipt with cloned metadata; failed/unknown are returned as data.
 * @throws Error for mismatched/malformed receipt or request; cloning/hashing errors propagate.
 * @remarks No provider reconciliation or authorization occurs.
 * @example
 * ```typescript
 * import { validateWorkflowEffectReceipt } from "@alneas/eaos-core/agent/workflow-effects";
 * import { createWorkflowEffectReceipt } from "@alneas/eaos-core/agent/workflow-effects";
 * const request = { tenantId: "tenant-demo", workflowId: "notes", operation: "note.create", idempotencyKey: "request-1", input: { text: "hello" } };
 * const receipt = createWorkflowEffectReceipt({ request, adapterId: "notes-store", receiptId: "receipt-1", outcome: "unknown" });
 * console.log(validateWorkflowEffectReceipt(request, receipt).outcome);
 * ```
 */
export function validateWorkflowEffectReceipt<TInput>(
  request: WorkflowEffectRequest<TInput>,
  receipt: unknown,
): WorkflowEffectReceipt {
  const expected = createWorkflowEffectRequest(request)
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw new Error('Invalid workflow effect receipt')
  const value = receipt as Record<string, unknown>
  if (value.schemaVersion !== '1' || value.tenantId !== expected.tenantId || value.workflowId !== expected.workflowId || value.operation !== expected.operation || value.idempotencyKey !== expected.idempotencyKey || value.inputHash !== expected.inputHash) {
    throw new Error('Workflow effect receipt does not match the admitted request')
  }
  if (!['succeeded', 'failed', 'unknown'].includes(String(value.outcome))) throw new Error('Invalid workflow effect outcome')
  const result: WorkflowEffectReceipt = {
    schemaVersion: '1',
    tenantId: text(value.tenantId, 'receipt tenantId'),
    workflowId: text(value.workflowId, 'receipt workflowId'),
    operation: text(value.operation, 'receipt operation'),
    idempotencyKey: text(value.idempotencyKey, 'receipt idempotency key', 256),
    inputHash: text(value.inputHash, 'receipt input hash', 64),
    adapterId: text(value.adapterId, 'receipt adapter', 256),
    receiptId: text(value.receiptId, 'receipt id', 512),
    outcome: value.outcome as WorkflowEffectOutcome,
    occurredAt: text(value.occurredAt, 'receipt time', 64),
    ...(value.externalId === undefined ? {} : { externalId: text(value.externalId, 'external id', 512) }),
    ...(value.errorCode === undefined ? {} : { errorCode: text(value.errorCode, 'error code', 256) }),
    ...(value.metadata === undefined ? {} : { metadata: structuredClone(value.metadata) as Record<string, unknown> }),
  }
  if (value.metadata !== undefined && (!value.metadata || typeof value.metadata !== 'object' || Array.isArray(value.metadata))) throw new Error('Invalid workflow effect metadata')
  if (!/^[a-f0-9]{64}$/.test(result.inputHash) || !Number.isFinite(Date.parse(result.occurredAt))) throw new Error('Invalid workflow effect receipt identity')
  return result
}
