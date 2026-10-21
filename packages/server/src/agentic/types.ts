import type { AgentJobKind, AgentRuntimeResourcePolicy, ApprovalLevel, RiskLevel, WorkflowAgentFailureCode, WorkflowAgentToolMode } from '@alneas/eaos-core'

/**
 * Runtime selector used to dispatch server tasks to built-in or host-provided executors.
 * @see ServerAgentExecutor for the host adapter contract.
 */
export type ServerAgentWorkerType = 'goose' | 'hermes_agent' | 'litellm' | 'local_cli' | 'local_mlx' | 'external_no_training' | 'custom'
/**
 * Selects server-side queue execution or authenticated local runner pull delivery.
 * @see ServerAgentExecutionContext.
 */
export type ServerAgentDispatchMode = 'server-queue' | 'local-pull'

/**
 * Host-admitted task passed to an agent runtime; tenant/user claims must already be verified.
 * @see ServerAgentExecutor for a complete adapter example.
 */
export interface ServerAgentTaskRequest {
  /** Stable task identifier used for result and checkpoint binding. */
  id: string
  /** Verified tenant ID; never accepted directly as an authenticated request-body claim. */
  tenantId: string
  /** Verified submitting user ID. */
  userId: string
  /** Nonblank task label; ServerAutonomousWorker limits this to 500 characters. */
  title: string
  /** Nonblank runtime instructions; ServerAutonomousWorker limits this to 1000000 characters. */
  instructions: string
  /** Selected built-in or host runtime adapter key. */
  workerType: ServerAgentWorkerType
  /** Why the agent is running; not limited to task-graph workflows. */
  jobKind?: AgentJobKind
  /** Optional domain context; interpretation belongs to the executor. */
  context?: Record<string, unknown>
  /** Host-verified workflow context propagated to the external runtime. */
  executionContext?: ServerAgentExecutionContext
  /** Framework-selected resource policy. Callers cannot loosen this policy. */
  runtimePolicy?: AgentRuntimeResourcePolicy
  /** Optional execution timeout in milliseconds; built-in executors default to 60000 and accept safe integers from 1 to 3600000. */
  timeoutMs?: number
}

/**
 * Host-selected workflow, correlation, tool scope, and local-runner bindings sent to the runtime.
 * @see ServerAgentTaskRequest.
 */
export interface ServerAgentExecutionContext {
  /** Optional workflow/session association. */
  workflowId?: string
  /** Optional host tracing identifier. */
  correlationId?: string
  /** Optional host deduplication key; propagation alone does not enforce idempotency. */
  idempotencyKey?: string
  /** Optional workflow tool-execution mode admitted by the host. */
  toolMode?: WorkflowAgentToolMode
  /** Optional allowlisted tool names; runtime adapters must enforce the intended boundary. */
  allowedToolNames?: readonly string[]
  /** Selected by the server broker; clients cannot override it. */
  routeId?: string
  /** Optional delivery mode; local-pull jobs are claimed by authenticated local runners. */
  dispatchMode?: ServerAgentDispatchMode
  /** User/runner binding for local subscription or MLX execution. */
  runnerId?: string
}

/**
 * Normalized runtime outcome; FAILED and PENDING_APPROVAL are returned data rather than successful output.
 * @see ServerAgentExecutor.
 */
export interface ServerAgentTaskResult {
  /** Task identifier to which this result belongs. */
  taskId: string
  /** COMPLETED has runtime output; PENDING_APPROVAL awaits a host decision; FAILED records a rejected or failed run. */
  status: 'COMPLETED' | 'PENDING_APPROVAL' | 'FAILED'
  /** Runtime text when available; omitted on failures and pending approval. */
  output?: string
  /** Optional failure message for FAILED results. */
  error?: string
  /** Stable failure classification for durable retry/circuit-breaker handling. */
  failureCode?: WorkflowAgentFailureCode
  /** Optional retry advice; absence leaves retry policy to the caller. */
  retryable?: boolean
  /** Optional generated approval binding for PENDING_APPROVAL. */
  approvalTicketId?: string
  /** Optional human-approval level returned by the gatekeeper. */
  approvalLevel?: ApprovalLevel
  /** Optional risk classification returned by the gatekeeper. */
  riskLevel?: RiskLevel
  /** Elapsed wall-clock milliseconds for this attempt. */
  durationMs: number
}

/**
 * Carries stable failure classification and retry advice from runtime adapters to queue coordination.
 * @example
 * ```typescript
 * import { ServerAgentExecutionError } from "@alneas/eaos-server/agentic/types";
 * const error = new ServerAgentExecutionError("Runtime unavailable", "AGENT_UNAVAILABLE", true);
 * console.log(error.failureCode, error.retryable);
 * ```
 */
export class ServerAgentExecutionError extends Error {
  /** Classification used by runner normalization and durable retry handling. */
  readonly failureCode: WorkflowAgentFailureCode
  /** Host retry advice; true does not itself retry or make execution idempotent. */
  readonly retryable: boolean

  /**
   * Creates a runtime failure retaining an optional underlying cause.
   * @param message - Human-readable failure description.
   * @param failureCode - Stable classification for caller retry policy.
   * @param retryable - Whether the caller may consider retrying this failure.
   * @param options - Optional cause; omission does not attach an error cause.
   */
  constructor(message: string, failureCode: WorkflowAgentFailureCode, retryable: boolean, options?: { 
  /**
   * Optional underlying error attached through the standard Error cause option; omission leaves the cause unset.
   */
  cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ServerAgentExecutionError'
    this.failureCode = failureCode
    this.retryable = retryable
  }
}

/**
 * Host- or plugin-owned agent execution adapter.
 *
 * The server owns admission, authorization and result normalization; the
 * adapter owns the configured runtime (OpenCode, Codex, Goose, LiteLLM, etc.).
 * @param request - Verified task and execution context; adapters must enforce host runtime/tool boundaries.
 * @returns Runtime text output, which is not permission to perform business side effects.
 * @throws Reject for unavailable, failed, timed-out, or invalid runtime work; ServerAgentExecutionError preserves classification and retry advice.
 * @example
 * ```typescript
 * import type { ServerAgentExecutor } from "@alneas/eaos-server/agentic/types";
 * export function instrument(execute: ServerAgentExecutor): ServerAgentExecutor {
 *   return async request => execute(structuredClone(request));
 * }
 * ```
 */
export type ServerAgentExecutor = (request: ServerAgentTaskRequest) => Promise<string>

/**
 * Host-verified approval decision submitted against a pending task checkpoint.
 * @remarks The host authenticates the approver and verifies role authority before passing this payload to a coordinator.
 * @see ServerAgentTaskResult.
 */
export interface ServerApprovalCallbackPayload {
  /** Task checkpoint identifier whose approval is being decided. */
  taskId: string
  /** Optional external ticket binding; when supplied it must match the checkpoint. */
  approvalId?: string
  /** Optional binding hash for clients that persist the approval payload. */
  bindingHash?: string
  /** True to approve; false to reject the pending work. */
  approved: boolean
  /** Authenticated host approver identifier. */
  approverId: string
  /** Verified role used for approval authorization. */
  approverRole: string
  /** Optional human decision note. */
  comment?: string
}
