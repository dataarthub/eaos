import type { ApprovalLevel } from '../security/gatekeeper'
import type { RiskLevel } from '../plugin-sdk/types'
import { canonicalJsonHash } from '../serialization/index'
import { createOutboxEvent, type OutboxEvent } from '../events/outbox'

/**
 * Whether an operation reads, writes local state or causes an external effect.
 * @see {@link createApprovalBinding}
 */
export type ExecutionSideEffect = 'read' | 'write' | 'external'

/**
 * The versioned meaning of an operation at the moment an approval is created.
 * Hosts may add fields to the schemas, but must keep the value JSON-safe.
 * @see {@link createApprovalBinding}
 */
export interface ExecutionContract {
  
/** Operation identity whose meaning and permission are controlled by the host. */
  operation: string
  
  /** Operation semantic version text captured in approval identity, at most 64 nonblank characters. */
  version: string
  
/** Host permission identity required for this operation. */
  permission: string
  
/** Classify whether the operation reads, writes local state or affects an external service. */
  sideEffect: ExecutionSideEffect
  
/** Declared operation risk used to determine review requirements; it does not itself grant authorization. */
  riskLevel: RiskLevel
  
/** Required organizational review category; a level declaration is not proof of approval. */
  approvalLevel: ApprovalLevel
  
/** JSON Schema describing admitted operation input. */
  inputSchema: Record<string, unknown>
  
/** Optional JSON Schema describing operation output; absent means no output contract is declared here. */
  outputSchema?: Record<string, unknown>
}

/**
 * Optional resource identity and optimistic revision included in an approval binding.
 * @see {@link createApprovalBinding}
 */
export interface ExecutionTarget {
  
  /** Resource category used with its ID and optional revision to bind the exact execution target. */
  type: string
  
  /** Target resource identity; at most 512 nonblank characters when approval-validated. */
  id: string
  
/** Optional source/target revision interpreted by the owning host; approval/effect target revisions must be positive integers. */
  revision?: number
}

/**
 * Scope, request and contract whose exact identities an approval must bind.
 * @see {@link createApprovalBinding}
 */
export interface ApprovalBindingInput {
  
/** Verified tenant boundary for the record or operation; host authorization must establish this scope. */
  tenantId: string
  
/** Verified identity of the requester whose approval binding is being constructed. */
  requestedBy: string
  
/** Operation identity whose meaning and permission are controlled by the host. */
  operation: string
  
  /** Approved resource identity or execution placement; this metadata does not independently enforce access. */
  target?: ExecutionTarget
  
  /** Domain request value passed to the admitted operation; no domain-schema proof is implied solely by this type. */
  input: unknown
  
  /** Versioned operation metadata captured for input/policy compatibility and approval binding. */
  contract: ExecutionContract
  /** Optional absolute expiry for approvals that must be decided within a bounded window. */
  expiresAt?: Date | string
}

/**
 * A compact, non-secret identity for an approved operation. The input itself
 * is deliberately not stored here; the host may retain it in its scoped
 * proposal/job store and use inputHash to prove that it is unchanged.
 * @see {@link createApprovalBinding}
 */
export interface ApprovalBinding {
  
/** Verified tenant boundary for the record or operation; host authorization must establish this scope. */
  tenantId: string
  
/** Verified identity of the requester whose approval binding is being constructed. */
  requestedBy: string
  
/** Operation identity whose meaning and permission are controlled by the host. */
  operation: string
  
  /** Approved resource identity or execution placement; this metadata does not independently enforce access. */
  target?: ExecutionTarget
  
/** SHA-256 identity of the canonical JSON request input. */
  inputHash: string
  
/** SHA-256 identity of the captured versioned execution contract. */
  contractHash: string
  
/** Optional absolute expiry; the owning validation/evaluation API determines whether it remains live. */
  expiresAt?: string
  
/** SHA-256 integrity identity of the normalized approval binding. */
  bindingHash: string
}

/**
 * Validated binding paired with the execution input carried by an outbox event.
 * @see {@link createApprovalBinding}
 * @typeParam T - Execution input type carried alongside the binding; defaults to unknown.
 */
export interface ApprovedExecutionEvent<T = unknown> {
  
  
  /** Validated request/contract identity whose bindingHash is the outbox idempotency key. */
  binding: ApprovalBinding
  
  /** Domain request value passed to the admitted operation; no domain-schema proof is implied solely by this type. */
  input: T
}

function text(value: unknown, name: string, max = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${name}`)
  return value
}

function target(value: ExecutionTarget | undefined): ExecutionTarget | undefined {
  if (value === undefined) return undefined
  const result = structuredClone(value)
  text(result.type, 'target type')
  text(result.id, 'target id', 512)
  if (result.revision !== undefined && (!Number.isSafeInteger(result.revision) || result.revision < 1)) throw new Error('Invalid target revision')
  return result
}

function contract(value: ExecutionContract): ExecutionContract {
  const result = structuredClone(value)
  text(result.operation, 'contract operation')
  text(result.version, 'contract version', 64)
  text(result.permission, 'contract permission')
  if (!['read', 'write', 'external'].includes(result.sideEffect)) throw new Error('Invalid contract side effect')
  if (!['low', 'medium', 'high', 'critical'].includes(result.riskLevel)) throw new Error('Invalid contract risk level')
  if (!['L1_AUTO', 'L2_LEAD', 'L3_MANAGER', 'L4_EXECUTIVE'].includes(result.approvalLevel)) throw new Error('Invalid contract approval level')
  if (!result.inputSchema || typeof result.inputSchema !== 'object' || Array.isArray(result.inputSchema)) throw new Error('Invalid contract input schema')
  if (result.outputSchema !== undefined && (!result.outputSchema || typeof result.outputSchema !== 'object' || Array.isArray(result.outputSchema))) throw new Error('Invalid contract output schema')
  return result
}

function liveExpiry(value: Date | string | undefined, now: Date): string | undefined {
  if (value === undefined) return undefined
  const result = value instanceof Date ? value.toISOString() : value
  if (typeof result !== 'string' || !Number.isFinite(Date.parse(result)) || Date.parse(result) <= now.getTime()) throw new Error('Approval binding expired or has an invalid expiry')
  return new Date(result).toISOString()
}

/**
 * Bind an operation, request and versioned contract to a stable approval hash.
 * @param input - Approval scope, JSON-safe input and execution contract; optional expiry must be after options.now and target revision positive.
 * @param options - Optional evaluation clock; now defaults to current Date.
 * @returns A shallow-frozen identity containing hashes rather than the request input.
 * @throws Error for invalid scope, target, contract, expired/invalid expiry or non-JSON hash input; clone/date errors propagate.
 * @remarks Hash identity does not prove approval or authorization. No approval is stored, signed or executed.
 * @example
 * ```typescript
 * import { createApprovalBinding } from "@alneas/eaos-core/agent/approved-execution";
 * const input = { tenantId: "tenant-demo", requestedBy: "user-demo", operation: "note.read", input: { id: "note-1" }, contract: { operation: "note.read", version: "1.0.0", permission: "notes:read", sideEffect: "read", riskLevel: "low", approvalLevel: "L1_AUTO", inputSchema: { type: "object" } } } as const;
 * console.log(createApprovalBinding(input).bindingHash);
 * ```
 */
export function createApprovalBinding(input: ApprovalBindingInput, options: { 
  /**
   * Optional reference time used to reject expired bindings; omission uses a new current Date.
   */
  now?: Date } = {}): ApprovalBinding {
  const expiresAt = liveExpiry(input.expiresAt, options.now ?? new Date())
  const normalized = {
    tenantId: text(input.tenantId, 'tenantId'),
    requestedBy: text(input.requestedBy, 'requester'),
    operation: text(input.operation, 'operation'),
    ...(input.target ? { target: target(input.target) } : {}),
    inputHash: canonicalJsonHash(input.input),
    contractHash: canonicalJsonHash(contract(input.contract)),
    ...(expiresAt ? { expiresAt } : {}),
  }
  return Object.freeze({ ...normalized, bindingHash: canonicalJsonHash(normalized) })
}

/**
 * Validate binding shape, live expiry and the hash of its normalized contents.
 * @param value - Stored binding to validate; all hash fields must be lowercase 64-character hexadecimal.
 * @param options - Optional evaluation clock; now defaults to current Date.
 * @returns A fresh normalized binding, with a cloned target when present.
 * @throws Error for malformed/expired binding or a content hash mismatch; cloning/date errors propagate.
 * @remarks A matching unkeyed hash is an integrity check, not proof that a person approved the request.
 * @example
 * ```typescript
 * import { validateApprovalBinding } from "@alneas/eaos-core/agent/approved-execution";
 * import { createApprovalBinding } from "@alneas/eaos-core/agent/approved-execution";
 * const input = { tenantId: "tenant-demo", requestedBy: "user-demo", operation: "note.read", input: { id: "note-1" }, contract: { operation: "note.read", version: "1.0.0", permission: "notes:read", sideEffect: "read", riskLevel: "low", approvalLevel: "L1_AUTO", inputSchema: { type: "object" } } } as const;
 * console.log(validateApprovalBinding(createApprovalBinding(input)).operation);
 * ```
 */
export function validateApprovalBinding(value: unknown, options: { 
  /**
   * Optional reference time used to check the stored expiry; omission uses a new current Date.
   */
  now?: Date } = {}): ApprovalBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid approval binding')
  const source = value as Record<string, unknown>, result = {
    tenantId: text(source.tenantId, 'binding tenant'),
    requestedBy: text(source.requestedBy, 'binding requester'),
    operation: text(source.operation, 'binding operation'),
    ...(source.target ? { target: target(source.target as ExecutionTarget) } : {}),
    inputHash: text(source.inputHash, 'binding input hash', 64),
    contractHash: text(source.contractHash, 'binding contract hash', 64),
    ...(source.expiresAt === undefined ? {} : { expiresAt: liveExpiry(source.expiresAt as string, options.now ?? new Date()) }),
    bindingHash: text(source.bindingHash, 'binding hash', 64),
  }
  if (![result.inputHash, result.contractHash, result.bindingHash].every(hash => /^[a-f0-9]{64}$/.test(hash))) throw new Error('Invalid approval binding hash')
  const normalized = {
    tenantId: result.tenantId,
    requestedBy: result.requestedBy,
    operation: result.operation,
    ...(result.target ? { target: result.target } : {}),
    inputHash: result.inputHash,
    contractHash: result.contractHash,
    ...(result.expiresAt ? { expiresAt: result.expiresAt } : {}),
  }
  if (result.bindingHash !== canonicalJsonHash(normalized)) throw new Error('Approval binding hash does not match its contents')
  return result
}

/**
 * Build an outbox event whose idempotency identity is the approval binding.
 * @typeParam T - Payload type retained as the execution event input.
 * @param input - Live binding, producer/topic and payload; optional event/availability timestamps are forwarded to createOutboxEvent.
 * @returns A new pending outbox event containing the validated binding and cloned payload.
 * @throws Error for invalid binding or outbox metadata, non-JSON/uncloneable payload or invalid timestamps.
 * @remarks Does not persist, publish, execute or independently establish that approval was granted.
 * @example
 * ```typescript
 * import { createApprovedExecutionEvent } from "@alneas/eaos-core/agent/approved-execution";
 * import { createApprovalBinding } from "@alneas/eaos-core/agent/approved-execution";
 * const input = { tenantId: "tenant-demo", requestedBy: "user-demo", operation: "note.read", input: { id: "note-1" }, contract: { operation: "note.read", version: "1.0.0", permission: "notes:read", sideEffect: "read", riskLevel: "low", approvalLevel: "L1_AUTO", inputSchema: { type: "object" } } } as const;
 * const binding = createApprovalBinding(input);
 * console.log(createApprovedExecutionEvent({ binding, producer: "notes", topic: "notes.read.approved", payload: input.input }).idempotencyKey);
 * ```
 */
export function createApprovedExecutionEvent<T>(input: {
  
  /**
   * Live validated approval identity; its tenant and bindingHash determine the outbox tenant and idempotency key. Identity alone does not prove approval was granted.
   */
  binding: ApprovalBinding
  
  /**
   * Host component identity emitting the approved-execution outbox event, validated by createOutboxEvent.
   */
  producer: string
  
  /**
   * Exact outbox dispatch topic identifying the host execution handler.
   */
  topic: string
  
  /**
   * JSON-safe execution input cloned into the event alongside the validated binding; no domain input-schema validation is performed here.
   */
  payload: T
  
  /**
   * Optional occurrence Date or parseable timestamp; omission uses the current time in createOutboxEvent.
   */
  occurredAt?: Date | string
  
  /**
   * Optional earliest-delivery Date or parseable timestamp; omission uses current time, without scheduling delivery itself.
   */
  availableAt?: Date | string
}): OutboxEvent<ApprovedExecutionEvent<T>> {
  const binding = validateApprovalBinding(input.binding)
  return createOutboxEvent({
    tenantId: binding.tenantId,
    producer: input.producer,
    topic: input.topic,
    idempotencyKey: binding.bindingHash,
    payload: { binding, input: structuredClone(input.payload) },
    ...(input.occurredAt === undefined ? {} : { occurredAt: input.occurredAt }),
    ...(input.availableAt === undefined ? {} : { availableAt: input.availableAt }),
  })
}

/**
 * Compare a stored approval identity with the operation that is about to run.
 * @param stored - Stored identity to validate.
 * @param expected - Expected binding or source input from which a binding is constructed.
 * @param options - Optional evaluation clock shared by both validations; defaults to current Date.
 * @returns True when validated identities and request/contract hashes match; false on any validation or hashing error.
 * @remarks No authorization, persistence or execution occurs.
 * @example
 * ```typescript
 * import { approvalBindingMatches } from "@alneas/eaos-core/agent/approved-execution";
 * import { createApprovalBinding } from "@alneas/eaos-core/agent/approved-execution";
 * const input = { tenantId: "tenant-demo", requestedBy: "user-demo", operation: "note.read", input: { id: "note-1" }, contract: { operation: "note.read", version: "1.0.0", permission: "notes:read", sideEffect: "read", riskLevel: "low", approvalLevel: "L1_AUTO", inputSchema: { type: "object" } } } as const;
 * console.log(approvalBindingMatches(createApprovalBinding(input), input)); // true
 * ```
 */
export function approvalBindingMatches(stored: ApprovalBinding, expected: ApprovalBindingInput | ApprovalBinding, options: { 
  /**
   * Optional reference time shared by both binding validations; omission evaluates expiry against current Date values.
   */
  now?: Date } = {}): boolean {
  try {
    const saved = validateApprovalBinding(stored, options)
    const candidate = 'bindingHash' in expected ? validateApprovalBinding(expected, options) : createApprovalBinding(expected, options)
    return saved.bindingHash === candidate.bindingHash && saved.tenantId === candidate.tenantId && saved.operation === candidate.operation && saved.inputHash === candidate.inputHash && saved.contractHash === candidate.contractHash
  } catch {
    return false
  }
}
