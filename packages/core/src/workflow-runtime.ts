import { canonicalJsonHash } from './serialization/index'

/**
 * Durable workflow state is deliberately separate from LangGraph's execution
 * cursor. Hosts persist this record next to their domain/control data.
 * @see {@link createWorkflowEvent}
 */
export type WorkflowInstanceStatus =
  | 'queued'
  | 'running'
  | 'waiting_agent'
  | 'waiting_approval'
  | 'waiting_external'
  | 'retryable'
  | 'failed'
  | 'completed'
  | 'cancelled'

/**
 * Host-persisted workflow version/identity, domain correlation and current state.
 * @see {@link createWorkflowEvent}
 */
export interface WorkflowInstanceRecord {
  
/** Host-generated durable workflow instance identity. */
  instanceId: string
  
/** Workflow definition identity used to correlate execution and effects. */
  workflowId: string
  
/** Version of the workflow definition pinned to this runtime/display record. */
  workflowVersion: string
  
/** Integrity identity of the exact workflow definition pinned by the host. */
  workflowHash: string
  
/** Verified tenant boundary for the record or operation; host authorization must establish this scope. */
  tenantId: string
  
/** User identity within the tenant supplied by the trusted host. */
  userId: string
  
/** Host conversation/thread identity for correlation. */
  threadId: string
  
  /** Host-persisted durable workflow lifecycle separate from graph execution cursor. */
  status: WorkflowInstanceStatus
  
/** Optional domain aggregate category associated with the workflow instance. */
  domainAggregateType?: string
  
/** Optional domain aggregate identity associated with the workflow instance. */
  domainAggregateId?: string
  
/** Optional domain aggregate revision pinned by the host. */
  domainRevision?: number
  
/** Optional host checkpoint revision used for optimistic runtime progress. */
  checkpointRevision?: number
  
/** Timestamp of the latest host-recorded update; this contract does not persist changes. */
  updatedAt: string
  
/** Optional human-readable failure detail; absence does not independently establish success. */
  error?: string
}

/**
 * Tenant-scoped aggregate event with causation, replay identity and typed payload.
 * @see {@link createWorkflowEvent}
 * @typeParam TPayload - Domain event payload shape; defaults to unknown.
 */
export interface WorkflowEventEnvelope<TPayload = unknown> {
  
/** Stable event identity used for projection and causal correlation. */
  eventId: string
  
/** Verified tenant boundary for the record or operation; host authorization must establish this scope. */
  tenantId: string
  
/** Optional durable instance identity correlating this event/job with a workflow. */
  workflowInstanceId?: string
  
/** Domain aggregate category whose state change this event describes. */
  aggregateType: string
  
/** Domain aggregate identity within the tenant. */
  aggregateId: string
  
/** Nonnegative safe-integer domain revision associated with this event. */
  aggregateRevision: number
  
  /** Domain event type used for consumer/projector dispatch. */
  type: string
  
/** Stable component identity emitting the event. */
  producer: string
  
/** Identity grouping causally related workflow requests and events. */
  correlationId: string
  
/** Optional identity of the event/request that caused this event. */
  causationId?: string
  
/** Replay identity for the same admitted operation; the host must persist/deduplicate it before unsafe retries. */
  idempotencyKey: string
  
/** Event/effect occurrence timestamp; creation helpers normalize supported inputs to ISO text. */
  occurredAt: string
  
  /** Typed event/request body; constructors clone and strictly hash JSON where documented. */
  payload: TPayload
}

/**
 * Host agent-job category, including named built-ins and extensible strings.
 * @see {@link createWorkflowEvent}
 */
export type AgentJobKind =
  | 'workflow-proposal'
  | 'reconciliation'
  | 'anomaly-investigation'
  | 'document-analysis'
  | 'report-draft'
  | 'incident-triage'
  | 'retrieval-synthesis'
  | (string & {})

/**
 * Durable job lifecycle including approval, retry and cancellation states.
 * @see {@link createWorkflowEvent}
 */
export type AgentJobStatus = 'queued' | 'running' | 'waiting_approval' | 'succeeded' | 'retryable' | 'failed' | 'cancelled'

/**
 * Host-persisted agent request, retry/lease state and optional result or failure.
 * @see {@link createWorkflowEvent}
 * @typeParam TRequest - Persisted agent request shape; defaults to unknown.
 * @typeParam TResult - Optional persisted job output shape; defaults to unknown.
 */
export interface AgentJobRecord<TRequest = unknown, TResult = unknown> {
  
/** Durable host job identity, separate from workflow and replay identities. */
  jobId: string
  
/** Verified tenant boundary for the record or operation; host authorization must establish this scope. */
  tenantId: string
  
  /** Host job category; built-in names and custom strings are supported. */
  kind: AgentJobKind
  
  /** Host-persisted durable job lifecycle, including retries, cancellation and review. */
  status: AgentJobStatus
  
  /** Admitted domain request stored or passed to a host execution boundary. */
  request: TRequest
  
/** SHA-256 identity of the canonical agent-job request. */
  requestHash: string
  
/** Optional durable instance identity correlating this event/job with a workflow. */
  workflowInstanceId?: string
  
/** Identity grouping causally related workflow requests and events. */
  correlationId: string
  
/** Replay identity for the same admitted operation; the host must persist/deduplicate it before unsafe retries. */
  idempotencyKey: string
  
/** Host-recorded one-based execution attempt; helpers consuming it require a positive integer. */
  attempt: number
  
/** Maximum intended attempt count; delay calculators validate it but do not themselves stop retries. */
  maxAttempts: number
  
/** Earliest timestamp at which the host scheduler may claim or execute this work. */
  availableAt: string
  
/** Optional deadline until which the current worker claim remains live. */
  leaseUntil?: string
  
/** Optional host claim ownership token used for optimistic settlement. */
  leaseToken?: string
  
  
  /** Optional durable domain output written by host job settlement. */
  result?: TResult
  
/** Optional human-readable failure detail; absence does not independently establish success. */
  error?: string
  
/** Optional host/runtime classification used to choose durable retry behavior. */
  failureCode?: string
  
/** Creation timestamp supplied or generated by the owning API. */
  createdAt: string
  
/** Timestamp of the latest host-recorded update; this contract does not persist changes. */
  updatedAt: string
}

/**
 * Per-tenant graph projector progress, lag and failure state.
 * @see {@link createWorkflowEvent}
 */
export interface GraphProjectionCursor {
  
/** Host graph read-model/projector identity. */
  projectionId: string
  
/** Verified tenant boundary for the record or operation; host authorization must establish this scope. */
  tenantId: string
  
  /** Host projector health/rebuild state. */
  status: 'healthy' | 'lagging' | 'failed' | 'rebuilding'
  
/** Most recent source event applied by the projector, when known. */
  lastEventId?: string
  
/** Aggregate category associated with the recorded projector cursor. */
  lastAggregateType?: string
  
/** Aggregate identity associated with the recorded projector cursor. */
  lastAggregateId?: string
  
/** Aggregate revision associated with the recorded projector cursor. */
  lastAggregateRevision?: number
  
/** Host-reported count of pending source events behind the read model. */
  lagCount: number
  
/** Timestamp of the latest host-recorded update; this contract does not persist changes. */
  updatedAt: string
  
/** Most recent host-recorded failure detail, when available. */
  lastError?: string
}

/**
 * A tenant-scoped graph vertex exposed by a host read model.
 * @see {@link createWorkflowEvent}
 */
export interface GraphProjectionNode {
  
  /** Unique node identity within a tenant projection result, up to 256 nonblank characters. */
  id: string
  
/** Verified tenant boundary for the record or operation; host authorization must establish this scope. */
  tenantId: string
  
  /** Provider-neutral domain node category. */
  type: string
  
  /** Optional graph element metadata or table-schema properties; the host validates sensitive/domain fields. */
  properties?: Readonly<Record<string, unknown>>
}

/**
 * A tenant-scoped graph edge exposed by a host read model.
 * @see {@link createWorkflowEvent}
 */
export interface GraphProjectionEdge {
  
  /** Optional provider relationship identity; validation checks endpoints but does not require this field. */
  id?: string
  
/** Verified tenant boundary for the record or operation; host authorization must establish this scope. */
  tenantId: string
  
/** Stable retrieval source identity used to trace returned evidence. */
  sourceId: string
  
  /** Domain target record identity or graph edge destination; host validation enforces scope. */
  targetId: string
  
  /** Provider-neutral directed relationship category. */
  type: string
  
  /** Optional graph element metadata or table-schema properties; the host validates sensitive/domain fields. */
  properties?: Readonly<Record<string, unknown>>
}

/**
 * Tenant-scoped graph traversal request with optional seed/type/size limits.
 * @see {@link createWorkflowEvent}
 */
export interface GraphProjectionQuery {
  
/** Verified tenant boundary for the record or operation; host authorization must establish this scope. */
  tenantId: string
  
/** Optional seed node IDs for graph traversal; omission is adapter-defined. */
  startNodeIds?: readonly string[]
  
/** Optional relationship-type filter for graph traversal. */
  edgeTypes?: readonly string[]
  
/** Optional traversal depth bound enforced by the graph provider. */
  maxHops?: number
  
/** Optional returned-node bound enforced by the graph provider. */
  maxNodes?: number
  
/** Optional returned-edge bound enforced by the graph provider. */
  maxEdges?: number
}

/**
 * Tenant-scoped graph read model with projection time and staleness metadata.
 * @see {@link createWorkflowEvent}
 */
export interface GraphProjectionQueryResult {
  
/** Verified tenant boundary for the record or operation; host authorization must establish this scope. */
  tenantId: string
  
  /** Graph vertices in supplied order; this metadata does not execute node handlers. */
  nodes: readonly GraphProjectionNode[]
  
  /** Directed graph relationships in supplied order; validation/rendering behavior follows the owning graph contract. */
  edges: readonly GraphProjectionEdge[]
  
/** Optional nonnegative safe-integer source revision represented by the graph result. */
  sourceRevision?: number
  
/** Parseable timestamp associated with the graph read-model snapshot. */
  projectedAt: string
  
/** Whether the host reports the projection as behind its source state. */
  stale: boolean
}

/**
 * Provider-neutral graph reads. Oracle Graph/PGQL, SQL recursive queries and Neo4j are host implementations.
 * @see {@link createWorkflowEvent}
 */
export interface GraphQueryAdapter {
  
  /**
   * Read a tenant-scoped graph projection through a host provider.
   * @param input - Verified tenant plus optional seed IDs, relationship filters and traversal/result bounds.
   * @returns Graph read model with staleness/projection metadata; nodes/edges may be empty.
   * @throws Host graph query failures reject the Promise.
   * @remarks Host owns authorization, query limits, result freshness and cancellation; validate with assertGraphProjectionResult.
   * @example
   * ```typescript
   * import type { GraphQueryAdapter } from "@alneas/eaos-core/workflow-runtime";
   * async function queryHost(adapter: GraphQueryAdapter) { return adapter.query({ tenantId: "tenant-demo", maxNodes: 100 }); }
   * ```
   */
  query(input: GraphProjectionQuery): Promise<GraphProjectionQueryResult>
}

/**
 * Host-owned projection update/rebuild and optional cursor port.
 * @see {@link createWorkflowEvent}
 */
export interface GraphProjectionAdapter {
  
  /**
   * Apply one workflow event to a host graph projection.
   * @param event - Tenant-scoped source event; host should deduplicate its identity/revision as appropriate.
   * @returns No value; host projection apply has completed.
   * @throws Host projection failures reject; partial updates depend on host atomicity.
   * @remarks Host owns isolation, durable cursor updates, ordering and idempotency. Core supplies no projector transaction.
   * @example
   * ```typescript
   * import type { GraphProjectionAdapter } from "@alneas/eaos-core/workflow-runtime";
   * async function applyHostEvent(adapter: GraphProjectionAdapter, event: Parameters<GraphProjectionAdapter["apply"]>[0]) { await adapter.apply(event); }
   * ```
   */
  apply(event: WorkflowEventEnvelope): Promise<void>
  
  /**
   * Rebuild a tenant projection from a host source snapshot.
   * @param input - Verified tenant, source revision and complete snapshot interpreted by the host.
   * @returns No value; host rebuild has completed.
   * @throws Host rebuild failures reject and may leave a partial/old projection depending on host atomicity.
   * @remarks Host defines atomic replacement, concurrent event handling, resource limits and recovery; this method can replace persisted read-model data.
   * @example
   * ```typescript
   * import type { GraphProjectionAdapter } from "@alneas/eaos-core/workflow-runtime";
   * async function rebuildHost(adapter: GraphProjectionAdapter, snapshot: unknown) { await adapter.rebuild({ tenantId: "tenant-demo", sourceRevision: 1, snapshot }); }
   * ```
   */
  rebuild(input: { 
/** Verified tenant boundary for the record or operation; host authorization must establish this scope. */
  tenantId: string; 
/** Optional nonnegative safe-integer source revision represented by the graph result. */
  sourceRevision: number; 
  /** Host-provided source snapshot used for projection rebuild; the adapter owns atomic replacement and isolation. */
  snapshot: unknown }): Promise<void>
  
  /**
   * Read optional host projector progress for a tenant.
   * @param tenantId - Verified tenant whose cursor is requested.
   * @returns Cursor or null when no progress is available.
   * @throws Host cursor-read failures reject.
   * @remarks Optional capability; absent lookup does not establish projector health.
   * @example
   * ```typescript
   * import type { GraphProjectionAdapter } from "@alneas/eaos-core/workflow-runtime";
   * async function inspectCursor(adapter: GraphProjectionAdapter) {
   *  if (!adapter.getCursor) throw new Error("Host cursor lookup is unavailable");
   *  return adapter.getCursor("tenant-demo");
   * }
   * ```
   */
  getCursor?(tenantId: string): Promise<GraphProjectionCursor | null>
}

function graphText(value: unknown, name: string, max = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid graph ${name}`)
  return value
}

/**
 * Fail closed when a graph provider returns a foreign tenant or malformed projection.
 * @param result - Provider result with a parseable projection timestamp, unique nodes, tenant-matching edges and endpoints present in nodes.
 * @param tenantId - Expected nonempty tenant ID, up to 256 characters.
 * @returns The same result object, without a defensive clone.
 * @throws Error for malformed scope/timestamp/nodes/edges, foreign tenants, duplicate nodes or invalid optional source revision.
 * @example
 * ```typescript
 * import { assertGraphProjectionResult } from "@alneas/eaos-core/workflow-runtime";
 * console.log(assertGraphProjectionResult({ tenantId: "tenant-demo", nodes: [], edges: [], projectedAt: "2026-10-19T00:00:00Z", stale: false }, "tenant-demo"));
 * ```
 */
export function assertGraphProjectionResult(result: GraphProjectionQueryResult, tenantId: string): GraphProjectionQueryResult {
  graphText(tenantId, 'tenantId')
  if (!result || result.tenantId !== tenantId || !Array.isArray(result.nodes) || !Array.isArray(result.edges) || typeof result.stale !== 'boolean' || !Number.isFinite(Date.parse(result.projectedAt))) throw new Error('Invalid graph projection result')
  const nodeIds = new Set<string>()
  for (const node of result.nodes) {
    if (node.tenantId !== tenantId || !graphText(node.id, 'node ID') || !graphText(node.type, 'node type') || nodeIds.has(node.id)) throw new Error('Invalid graph node')
    nodeIds.add(node.id)
  }
  for (const edge of result.edges) {
    if (edge.tenantId !== tenantId || !graphText(edge.sourceId, 'edge source') || !graphText(edge.targetId, 'edge target') || !graphText(edge.type, 'edge type') || !nodeIds.has(edge.sourceId) || !nodeIds.has(edge.targetId)) throw new Error('Invalid graph edge')
  }
  if (result.sourceRevision !== undefined && (!Number.isSafeInteger(result.sourceRevision) || result.sourceRevision < 0)) throw new Error('Invalid graph source revision')
  return result
}

/**
 * Host append boundary for typed workflow event envelopes.
 * @see {@link createWorkflowEvent}
 */
export interface WorkflowEventSink {
  
  /**
   * Append a tenant-scoped workflow event through host persistence.
   * @typeParam TPayload - Domain payload type retained by the supplied event envelope.
   * @param event - Complete event envelope with stable identity, revision and replay key.
   * @returns No value; host append has completed.
   * @throws Host append failures reject; a rejection may follow a committed write.
   * @remarks Host defines persistence transactions, deduplication, event ordering and partial-append reconciliation.
   * @example
   * ```typescript
   * import type { WorkflowEventSink } from "@alneas/eaos-core/workflow-runtime";
   * async function appendHostEvent(sink: WorkflowEventSink, event: Parameters<WorkflowEventSink["append"]>[0]) { await sink.append(event); }
   * ```
   */
  append<TPayload>(event: WorkflowEventEnvelope<TPayload>): Promise<void>
}

function text(value: unknown, name: string, max = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${name}`)
  return value
}

function revision(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`Invalid ${name}`)
  return Number(value)
}

/**
 * Create a stable, tenant-scoped event envelope for outbox/projector use.
 * @typeParam TPayload - JSON-safe event payload retained by type in the returned envelope.
 * @param input - Envelope data; aggregateRevision must be a nonnegative safe integer. Omitted idempotencyKey hashes tenant, aggregate identity/revision, type and payload; omitted eventId hashes tenant and idempotencyKey; occurredAt defaults to current time.
 * @returns A shallow-frozen envelope containing a cloned payload and normalized ISO timestamp.
 * @throws Error for invalid required text/revision or non-JSON hashed payload; invalid timestamps and uncloneable payloads propagate native errors.
 * @remarks Does not append or publish events. A caller-supplied idempotency key controls identity independently of payload.
 * @example
 * ```typescript
 * import { createWorkflowEvent } from "@alneas/eaos-core/workflow-runtime";
 * const event = createWorkflowEvent({ tenantId: "tenant-demo", aggregateType: "note", aggregateId: "note-1", aggregateRevision: 1, type: "note.created", producer: "notes", correlationId: "request-1", payload: { text: "hello" } });
 * console.log(event.eventId);
 * ```
 */
export function createWorkflowEvent<TPayload>(input: Omit<WorkflowEventEnvelope<TPayload>, 'eventId' | 'occurredAt' | 'idempotencyKey'> & Partial<Pick<WorkflowEventEnvelope<TPayload>, 'eventId' | 'occurredAt' | 'idempotencyKey'>>): WorkflowEventEnvelope<TPayload> {
  const tenantId = text(input.tenantId, 'tenantId')
  const aggregateType = text(input.aggregateType, 'aggregateType', 128)
  const aggregateId = text(input.aggregateId, 'aggregateId', 512)
  const type = text(input.type, 'event type', 160)
  const producer = text(input.producer, 'producer', 160)
  const correlationId = text(input.correlationId, 'correlationId', 256)
  const aggregateRevision = revision(input.aggregateRevision, 'aggregateRevision')
  const payload = structuredClone(input.payload)
  const idempotencyKey = text(input.idempotencyKey ?? canonicalJsonHash([tenantId, aggregateType, aggregateId, aggregateRevision, type, payload]), 'idempotencyKey', 256)
  const occurredAt = input.occurredAt === undefined ? new Date().toISOString() : new Date(input.occurredAt).toISOString()
  if (!Number.isFinite(Date.parse(occurredAt))) throw new Error('Invalid occurredAt')
  return Object.freeze({
    eventId: input.eventId ?? `evt-${canonicalJsonHash([tenantId, idempotencyKey]).slice(0, 64)}`,
    tenantId,
    ...(input.workflowInstanceId === undefined ? {} : { workflowInstanceId: text(input.workflowInstanceId, 'workflowInstanceId', 256) }),
    aggregateType,
    aggregateId,
    aggregateRevision,
    type,
    producer,
    correlationId,
    ...(input.causationId === undefined ? {} : { causationId: text(input.causationId, 'causationId', 256) }),
    idempotencyKey,
    occurredAt,
    payload,
  })
}

/**
 * Hash a strict JSON agent request for stable job identity.
 * @param request - Acyclic, finite JSON data accepted by canonicalJson.
 * @returns A lowercase SHA-256 hexadecimal hash.
 * @throws Error for unsupported JSON values or cycles.
 * @remarks Requires node:crypto and performs no persistence.
 * @example
 * ```typescript
 * import { hashAgentJobRequest } from "@alneas/eaos-core/workflow-runtime";
 * console.log(hashAgentJobRequest({ task: "summarize", documentId: "doc-1" }));
 * ```
 */
export function hashAgentJobRequest(request: unknown): string {
  return canonicalJsonHash(request)
}
