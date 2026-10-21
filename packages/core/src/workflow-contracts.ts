/**
 * Vendor-neutral contracts for running an external agent inside an EAOS
 * workflow.  Goose, Hermes and other runtimes are host implementations of
 * these contracts; core does not know how a runtime is started.
 * @see {@link parseWorkflowAgentProposal}
 */
export type WorkflowAgentToolMode = 'read' | 'preview' | 'action'
/**
 * Risk labels carried by workflow proposals and action intents.
 * @see {@link parseWorkflowAgentProposal}
 */
export type WorkflowAgentRiskLevel = 'low' | 'medium' | 'high' | 'critical'
/**
 * External runtime completion, unavailability or failure status.
 * @see {@link parseWorkflowAgentProposal}
 */
export type WorkflowAgentRunStatus = 'COMPLETED' | 'UNAVAILABLE' | 'FAILED'
/**
 * Host/runtime failure classification used by durable retry policy.
 * @see {@link parseWorkflowAgentProposal}
 */
export type WorkflowAgentFailureCode = 'AGENT_UNAVAILABLE' | 'TIMEOUT' | 'OUTPUT_LIMIT' | 'RUNTIME_FAILED' | 'INVALID_PROPOSAL'

/**
 * Requested tool mode and explicit allowed tool-name list.
 * @see {@link parseWorkflowAgentProposal}
 */
export interface WorkflowAgentToolScope {
  
  /** Selected operation/storage/execution variant; the owning discriminated union determines applicable fields. */
  mode: WorkflowAgentToolMode
  
/** Explicit tool-name allowlist to enforce at the host execution boundary. */
  allowedToolNames: readonly string[]
}

/**
 * Tenant-scoped agent task with replay identity, input and requested tool scope.
 * @see {@link parseWorkflowAgentProposal}
 * @typeParam TInput - Agent job input shape carried to the host runtime; defaults to unknown.
 */
export interface WorkflowAgentRequest<TInput = unknown> {
  
  /** Task identity correlating the agent/runtime operation with its owning workflow or task board. */
  taskId: string
  
/** Workflow definition identity used to correlate execution and effects. */
  workflowId: string
  
/** Verified tenant boundary for the record or operation; host authorization must establish this scope. */
  tenantId: string
  
/** User identity within the tenant supplied by the trusted host. */
  userId: string
  
/** Identity grouping causally related workflow requests and events. */
  correlationId: string
  
  /** Named consent or agent-task purpose used by host policy evaluation. */
  purpose: string
  /** General agent use-case; workflow proposals are only one supported kind. */
  jobKind?: import('./workflow-runtime').AgentJobKind
  
  /** Domain request value passed to the admitted operation; no domain-schema proof is implied solely by this type. */
  input: TInput
  
  /** Requested tool mode and exact allowed names; enforcement is host/runtime-owned. */
  toolScope: WorkflowAgentToolScope
  
/** Replay identity for the same admitted operation; the host must persist/deduplicate it before unsafe retries. */
  idempotencyKey: string
  
/** Optional execution deadline in milliseconds; enforcement belongs to the API/runtime consuming this metadata. */
  timeoutMs?: number
}

/**
 * Source reference and optional revision/excerpt supporting a proposal.
 * @see {@link parseWorkflowAgentProposal}
 */
export interface WorkflowAgentEvidence {
  
  /** Evidence source category validated by parseWorkflowAgentProposal. */
  kind: 'record' | 'tool' | 'event' | 'document' | 'other'
  
  
  /** Nonblank evidence source reference, at most 512 characters when proposal-parsed. */
  source: string
  
/** Optional source/target revision interpreted by the owning host; approval/effect target revisions must be positive integers. */
  revision?: number | string
  
/** Source text excerpt; callers should preserve provenance when presenting it. */
  excerpt?: string
}

/**
 * An action proposal is a plan. It is not authorization to execute it.
 * @see {@link parseWorkflowAgentProposal}
 */
export interface WorkflowAgentActionIntent {
  
/** Registered tool identity used to resolve host execution policy. */
  toolName: string
  
  /** Operation arguments passed to hooks or bound into a proposed action; authorization and schema checks remain host-owned. */
  args: Record<string, unknown>
  
/** Replay identity for the same admitted operation; the host must persist/deduplicate it before unsafe retries. */
  idempotencyKey: string
  
/** Optional optimistic target revision the host must check before applying an action. */
  expectedRevision?: number
  
/** Declared operation risk used to determine review requirements; it does not itself grant authorization. */
  riskLevel?: WorkflowAgentRiskLevel
}

/**
 * Versioned reviewable agent output with evidence, proposed actions and risk.
 * @see {@link parseWorkflowAgentProposal}
 * @typeParam TOutput - Domain output shape requiring caller validation; defaults to unknown.
 */
export interface WorkflowAgentProposal<TOutput = unknown> {
  
  /** Envelope format discriminator accepted by the corresponding parser/validator. */
  schemaVersion: '1.0'
  
  /** Human-readable review/result description suitable for host presentation. */
  summary: string
  
  /** Optional domain output; validate it separately and inspect the accompanying status/receipt. */
  output: TOutput
  
  /** Source references or audit rationale supporting review; evidence is data and does not grant execution authority. */
  evidence: readonly WorkflowAgentEvidence[]
  
  /** Ordered proposed actions; the host must validate and authorize them before any side effect. */
  actions: readonly WorkflowAgentActionIntent[]
  
/** Declared operation risk used to determine review requirements; it does not itself grant authorization. */
  riskLevel: WorkflowAgentRiskLevel
  
/** Reported confidence ratio, conventionally from zero to one; validate at the consuming boundary. */
  confidence?: number
  
/** Optional request that a host obtain review; this flag is not approval evidence. */
  requestedApproval?: boolean
}

/**
 * Optional runtime-reported token counts and US-dollar cost.
 * @see {@link parseWorkflowAgentProposal}
 */
export interface WorkflowAgentUsage {
  
/** Optional count of tokens consumed as model/runtime input. */
  inputTokens?: number
  
/** Optional count of generated model/runtime tokens. */
  outputTokens?: number
  
/** Optional total token count reported by the provider/runtime. */
  totalTokens?: number
  
/** Optional runtime-reported cost in US dollars. */
  costUsd?: number
}

/**
 * Runtime status, optional proposal/failure metadata and elapsed duration.
 * @see {@link parseWorkflowAgentProposal}
 * @typeParam TOutput - Proposed domain output type; defaults to unknown and does not imply schema validation.
 */
export interface WorkflowAgentRunResult<TOutput = unknown> {
  
  /** Runtime completed/unavailable/failed outcome; output remains separately validated. */
  status: WorkflowAgentRunStatus
  
/** Optional reviewable output produced by the agent runtime. */
  proposal?: WorkflowAgentProposal<TOutput>
  
/** Optional host/runtime implementation identity. */
  runtimeId?: string
  
/** Optional human-readable failure detail; absence does not independently establish success. */
  error?: string
  /** Host/runtime classification for circuit breakers and durable retry policy. */
  failureCode?: WorkflowAgentFailureCode
  
/** Whether the recorded failure permits a host retry; callers must still account for possible completed effects. */
  retryable?: boolean
  
/** Measured elapsed duration in milliseconds. */
  durationMs: number
  
  /** Optional token/cost telemetry reported by a host/runtime; absence does not mean zero use. */
  usage?: WorkflowAgentUsage
}

/**
 * Host-owned runtime port. The implementation may be Goose, Hermes or another agent.
 * @see {@link parseWorkflowAgentProposal}
 */
export interface WorkflowAgentRunner {
  
  /**
   * Execute a tenant-scoped agent request through a host runtime.
   * @typeParam TOutput - Expected proposal output type; host/caller validates the domain shape.
   * @param request - Verified scope, input, allowed tools and replay identity; optional timeout is milliseconds.
   * @returns Runtime status and optional proposal/failure/usage; domain output remains caller-validated.
   * @throws Host runtime failures may reject; classified failures can also be returned as result data.
   * @remarks Host owns process lifecycle, timeout/cancellation, tool authorization, resources and replay safety. An action proposal is never approval.
   * @example
   * ```typescript
   * import type { WorkflowAgentRunner } from "@alneas/eaos-core/workflow-contracts";
   * async function runHostAgent(runner: WorkflowAgentRunner, request: Parameters<WorkflowAgentRunner["run"]>[0]) { return runner.run(request); }
   * ```
   */
  run<TOutput>(request: WorkflowAgentRequest): Promise<WorkflowAgentRunResult<TOutput>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown, name: string, max = 2_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid workflow agent ${name}`)
  return value
}

function riskLevel(value: unknown): WorkflowAgentRiskLevel {
  if (value === 'low' || value === 'medium' || value === 'high' || value === 'critical') return value
  throw new Error('Invalid workflow agent riskLevel')
}

/**
 * Parse the bounded JSON envelope emitted by a host runtime. Domain-specific
 * validation of `output` remains in the plugin workflow.
 * @typeParam TOutput - Expected domain output type; this assertion does not validate that shape and defaults to unknown.
 * @param raw - JSON text or an object with schemaVersion 1.0, nonempty summary, evidence/actions arrays and a valid risk level.
 * @returns A structured clone of the normalized proposal; output is carried through without domain-schema validation.
 * @throws Error for invalid JSON, envelope or bounded text; structuredClone errors propagate for uncloneable output/arguments.
 * @remarks A proposal never authorizes execution. Domain output validation and action authorization belong to the host.
 * @example
 * ```typescript
 * import { parseWorkflowAgentProposal } from "@alneas/eaos-core/workflow-contracts";
 * const proposal = parseWorkflowAgentProposal({ schemaVersion: "1.0", summary: "No changes", output: { count: 0 }, evidence: [], actions: [], riskLevel: "low" });
 * console.log(proposal.summary);
 * ```
 */
export function parseWorkflowAgentProposal<TOutput = unknown>(raw: unknown): WorkflowAgentProposal<TOutput> {
  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      throw new Error('Workflow agent output must be valid JSON')
    }
  }
  if (!isRecord(value) || value.schemaVersion !== '1.0') throw new Error('Invalid workflow agent proposal schemaVersion')

  const evidence = value.evidence
  if (!Array.isArray(evidence) || evidence.some(item => !isRecord(item) || !['record', 'tool', 'event', 'document', 'other'].includes(item.kind as string) || typeof item.source !== 'string' || !item.source.trim())) {
    throw new Error('Invalid workflow agent evidence')
  }

  const actions = value.actions
  if (!Array.isArray(actions) || actions.some(item => !isRecord(item) || typeof item.toolName !== 'string' || !item.toolName.trim() || !isRecord(item.args) || typeof item.idempotencyKey !== 'string' || !item.idempotencyKey.trim())) {
    throw new Error('Invalid workflow agent actions')
  }

  if (value.confidence !== undefined && (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1)) throw new Error('Invalid workflow agent confidence')
  if (value.requestedApproval !== undefined && typeof value.requestedApproval !== 'boolean') throw new Error('Invalid workflow agent requestedApproval')

  return structuredClone({
    schemaVersion: '1.0' as const,
    summary: requiredString(value.summary, 'summary'),
    output: value.output as TOutput,
    evidence: evidence.map(item => ({
      kind: item.kind as WorkflowAgentEvidence['kind'],
      source: requiredString(item.source, 'evidence source', 512),
      ...(item.revision === undefined ? {} : { revision: item.revision as number | string }),
      ...(item.excerpt === undefined ? {} : { excerpt: requiredString(item.excerpt, 'evidence excerpt', 4_000) }),
    })),
    actions: actions.map(item => ({
      toolName: requiredString(item.toolName, 'action toolName', 256),
      args: item.args as Record<string, unknown>,
      idempotencyKey: requiredString(item.idempotencyKey, 'action idempotencyKey', 256),
      ...(item.expectedRevision === undefined ? {} : { expectedRevision: item.expectedRevision as number }),
      ...(item.riskLevel === undefined ? {} : { riskLevel: riskLevel(item.riskLevel) }),
    })),
    riskLevel: riskLevel(value.riskLevel),
    ...(value.confidence === undefined ? {} : { confidence: value.confidence as number }),
    ...(value.requestedApproval === undefined ? {} : { requestedApproval: value.requestedApproval as boolean }),
  })
}
