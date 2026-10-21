import { defaultRuntimePlacementPolicy, McpGatekeeper, type AgentRuntimeResourcePolicy } from '@alneas/eaos-core'
import { ServerAgentExecutionError, type ServerAgentExecutor, type ServerAgentTaskRequest, type ServerAgentTaskResult, type ServerAgentWorkerType } from './types'
import { randomUUID } from 'node:crypto'
import { createCommandAgentExecutor, validateAgentRuntimePolicy } from './executor'

/**
 * Trusted gatekeeper, runtime endpoints/adapters, and execution limits for {@link ServerAutonomousWorker}.
 */
export interface ServerWorkerOptions {
  /** Host security/approval policies; defaults to a new McpGatekeeper. */
  gatekeeper?: McpGatekeeper
  /** Trusted executable path; defaults to GOOSE_BIN_PATH or goose. */
  gooseBinaryPath?: string
  /** Trusted executable path; defaults to HERMES_AGENT_BIN_PATH or hermes. */
  hermesAgentBinaryPath?: string
  /** Host LiteLLM base URL; defaults to LITELLM_ENDPOINT or http://localhost:4000/v1. */
  litellmEndpoint?: string
  /** Host model identifier; defaults to LITELLM_MODEL and is required for built-in LiteLLM execution. */
  litellmModel?: string
  /** Combined command output/string result ceiling, safe integer 1–10000000; defaults to 1000000. */
  maxOutputChars?: number
  /** Framework default is safe for the ARM agent host. Host adapters may tighten it. */
  runtimePolicy?: AgentRuntimeResourcePolicy
  /** Built-in Goose/Hermes execution is permitted only on the AI placement. */
  runtimeRole?: ServerRuntimeRole
  /** Host fetch implementation for built-in LiteLLM; defaults to global fetch. */
  fetch?: typeof fetch
  /** Host/plugin adapters for coding agents and other external runtimes. */
  executors?: Partial<Record<ServerAgentWorkerType, ServerAgentExecutor>>
}

/**
 * Host placement role controlling whether built-in Goose/Hermes processes may run locally.
 * @see ServerAutonomousWorker.
 */
export type ServerRuntimeRole = 'edge' | 'application-worker' | 'ai'

function inferRuntimeRole(): ServerRuntimeRole {
  const configured = process.env.EAOS_RUNTIME_ROLE
  if (configured === 'edge' || configured === 'application-worker' || configured === 'ai') return configured
  // The supported three-host topology places the AI runtime on the ARM host.
  // Unknown x64 hosts therefore fail closed as application-worker hosts.
  return process.arch === 'arm64' ? 'ai' : 'application-worker'
}

/**
 * Admits and executes host agent tasks through a gatekeeper and bounded runtime adapters.
 * @remarks This class runs only when runTask is called; it installs no scheduler. The host authenticates tenant/user claims before admission. Framework-managed tasks share a per-instance concurrency counter; injected executors own scheduling and are exempt from it. Built-in Goose/Hermes require the ai role and Node process/systemd support. Queue persistence, approvals, retries, and side-effect idempotency belong to the host.
 * @example
 * ```typescript
 * import { ServerAutonomousWorker, type ServerWorkerOptions } from "@alneas/eaos-server/agentic/autonomous-worker";
 * export function worker(options: ServerWorkerOptions) { return new ServerAutonomousWorker(options); }
 * ```
 */
export class ServerAutonomousWorker {
  private gatekeeper: McpGatekeeper
  private goosePath: string
  private hermesAgentPath: string
  private litellmUrl: string
  private litellmModel?: string
  private maxOutputChars: number
  private runtimePolicy: AgentRuntimeResourcePolicy
  private runtimeRole: ServerRuntimeRole
  private activeTasks = 0
  private fetchImpl: typeof fetch
  private executors: Partial<Record<ServerAgentWorkerType, ServerAgentExecutor>>

  /**
   * Captures runtime settings and validates resource policy, role, and output ceiling.
   * @param options - Trusted host configuration; omitted gatekeeper uses a new McpGatekeeper and runtime role uses EAOS_RUNTIME_ROLE, then ai on arm64 or application-worker otherwise.
   * @throws Invalid resource policy, role, or output limit.
   */
  constructor(options?: ServerWorkerOptions) {
    this.gatekeeper = options?.gatekeeper || new McpGatekeeper()
    this.goosePath = options?.gooseBinaryPath || process.env.GOOSE_BIN_PATH || 'goose'
    this.hermesAgentPath = options?.hermesAgentBinaryPath || process.env.HERMES_AGENT_BIN_PATH || 'hermes'
    this.litellmUrl = options?.litellmEndpoint || process.env.LITELLM_ENDPOINT || 'http://localhost:4000/v1'
    this.litellmModel = options?.litellmModel || process.env.LITELLM_MODEL
    this.maxOutputChars = options?.maxOutputChars ?? 1_000_000
    this.runtimePolicy = validateAgentRuntimePolicy(options?.runtimePolicy || defaultRuntimePlacementPolicy().ai.agentRuntime)
    this.runtimeRole = options?.runtimeRole || inferRuntimeRole()
    if (!['edge', 'application-worker', 'ai'].includes(this.runtimeRole)) throw new Error('Invalid agent runtime role')
    this.fetchImpl = options?.fetch || fetch
    this.executors = options?.executors || {}
    if (!Number.isSafeInteger(this.maxOutputChars) || this.maxOutputChars < 1 || this.maxOutputChars > 10_000_000) throw new Error('Invalid worker output limit')
  }

  /**
   * Checks task limits and gatekeeper policy before dispatching one runtime attempt.
   * @param request - Verified task identity and instructions; required strings must be nonblank, title at most 500 characters, instructions at most 1000000, and timeout a safe integer 1–3600000 milliseconds when provided.
   * @returns COMPLETED text output, PENDING_APPROVAL ticket data without execution, or FAILED data with error and optional classification/retry advice. Duration is measured in wall-clock milliseconds.
   * @throws Can reject a throwing gatekeeper or malformed gatekeeper interaction before dispatch; runtime execution errors are normally returned as FAILED data.
   * @remarks Gatekeeper receives fixed agent/server_bot roles rather than request user roles. Approval tickets are generated but not persisted here. The configured framework policy overrides request.runtimePolicy before execution. Injected executors and built-in LiteLLM outputs are bounded by maxOutputChars; LiteLLM response bodies are parsed before text length is checked.
   * @example
   * ```typescript
   * import { ServerAutonomousWorker, type ServerWorkerOptions } from "@alneas/eaos-server/agentic/autonomous-worker";
   * import type { ServerAgentTaskRequest } from "@alneas/eaos-server/agentic/types";
   * export async function execute(options: ServerWorkerOptions, request: ServerAgentTaskRequest) {
   *   return new ServerAutonomousWorker(options).runTask(request);
   * }
   * ```
   */
  async runTask(request: ServerAgentTaskRequest): Promise<ServerAgentTaskResult> {
    const startTime = Date.now()

    if (!request || [request.id, request.tenantId, request.userId, request.title, request.instructions].some(value => typeof value !== 'string' || !value.trim())) {
      return { taskId: typeof request?.id === 'string' ? request.id : 'unknown', status: 'FAILED', error: 'Invalid agent task request', durationMs: Date.now() - startTime }
    }
    if (request.instructions.length > 1_000_000 || request.title.length > 500 || request.timeoutMs !== undefined && (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > 3_600_000)) {
      return { taskId: request.id, status: 'FAILED', error: 'Agent task exceeds configured limits', durationMs: Date.now() - startTime }
    }

    // 1. Evaluate security and gatekeeper policies
    const policy = this.gatekeeper.validateCall({
      toolName: `server_agent_${request.workerType}`,
      userRoles: ['agent', 'server_bot'],
      tenantId: request.tenantId,
    })

    if (!policy.allowed) {
      return {
        taskId: request.id,
        status: 'FAILED',
        error: `Task execution blocked by security policy: ${policy.reason}`,
        riskLevel: policy.riskLevel,
        durationMs: Date.now() - startTime,
      }
    }

    if (policy.requireHumanApproval) {
      return {
        taskId: request.id,
        status: 'PENDING_APPROVAL',
        approvalTicketId: randomUUID(),
        approvalLevel: policy.approvalLevel,
        riskLevel: policy.riskLevel,
        durationMs: Date.now() - startTime,
      }
    }

    // Explicitly injected executors are host-owned adapters and may implement
    // their own queue/scheduler. The framework-managed Goose/Hermes path is
    // bounded by the default policy so a forgotten host setting cannot create
    // unbounded local agent concurrency.
    const frameworkManaged = !this.executors[request.workerType]
    if (frameworkManaged && (request.workerType === 'goose' || request.workerType === 'hermes_agent') && this.runtimeRole !== 'ai') {
      return {
        taskId: request.id,
        status: 'FAILED',
        error: `Built-in ${request.workerType} execution is restricted to the AI runtime placement`,
        failureCode: 'AGENT_UNAVAILABLE',
        retryable: true,
        durationMs: Date.now() - startTime,
      }
    }
    if (frameworkManaged && this.activeTasks >= this.runtimePolicy.maxConcurrent) {
      return {
        taskId: request.id,
        status: 'FAILED',
        error: 'Agent runtime concurrency limit reached',
        failureCode: 'AGENT_UNAVAILABLE',
        retryable: true,
        durationMs: Date.now() - startTime,
      }
    }

    // 2. Dispatch according to worker type
    if (frameworkManaged) this.activeTasks += 1
    try {
      const output = await this.execute({ ...structuredClone(request), runtimePolicy: structuredClone(this.runtimePolicy) })
      return {
        taskId: request.id,
        status: 'COMPLETED',
        output,
        durationMs: Date.now() - startTime,
      }
    } catch (err) {
      return {
        taskId: request.id,
        status: 'FAILED',
        error: (err as Error).message,
        ...(err instanceof ServerAgentExecutionError ? { failureCode: err.failureCode, retryable: err.retryable } : {}),
        durationMs: Date.now() - startTime,
      }
    } finally {
      if (frameworkManaged) this.activeTasks -= 1
    }
  }

  private async execute(request: ServerAgentTaskRequest): Promise<string> {
    const injected = this.executors[request.workerType]
    if (injected) return this.boundOutput(await injected(structuredClone(request)))
    if (request.workerType === 'goose') return this.executeHeadlessGoose(request)
    if (request.workerType === 'hermes_agent') return this.executeHeadlessHermesAgent(request)
    if (request.workerType === 'litellm') return this.executeLiteLlm(request)
    throw new Error(`No executor configured for worker type '${request.workerType}'`)
  }

  /**
   * Execute Goose in headless batch mode
   */
  private async executeHeadlessGoose(request: ServerAgentTaskRequest): Promise<string> {
    return createCommandAgentExecutor({
      command: this.goosePath,
      buildArgs: task => ['run', '--text', task.instructions],
      includeProcessEnv: true,
      maxOutputChars: this.maxOutputChars,
      sandbox: { mode: 'auto', policy: this.runtimePolicy },
    })(request)
  }

  /**
   * Execute NousResearch Hermes Agent in headless mode (-z / non-interactive)
   * Hermes Agent provides persistent cross-session memory and self-improving skill extraction.
   */
  private async executeHeadlessHermesAgent(request: ServerAgentTaskRequest): Promise<string> {
    return createCommandAgentExecutor({
      command: this.hermesAgentPath,
      buildArgs: task => ['run', '-z', task.instructions],
      includeProcessEnv: true,
      maxOutputChars: this.maxOutputChars,
      sandbox: { mode: 'auto', policy: this.runtimePolicy },
    })(request)
  }

  /**
   * Execute a host-selected model through LiteLLM.
   */
  private async executeLiteLlm(request: ServerAgentTaskRequest): Promise<string> {
    if (!this.litellmModel) throw new Error('LiteLLM model is not configured')
    const endpoint = new URL(this.litellmUrl)
    if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('Invalid LiteLLM endpoint')
    endpoint.pathname = `${endpoint.pathname.replace(/\/$/, '')}/chat/completions`
    const response = await this.fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.litellmModel,
        messages: [{ role: 'user', content: request.instructions }],
        metadata: { tenantId: request.tenantId, taskId: request.id },
      }),
      signal: AbortSignal.timeout(request.timeoutMs ?? 60_000),
      redirect: 'error',
    })
    if (!response.ok) throw new Error(`LiteLLM request failed (${response.status})`)
    const body = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> }
    const output = body.choices?.[0]?.message?.content
    if (typeof output !== 'string') throw new Error('LiteLLM returned no assistant content')
    return this.boundOutput(output)
  }

  private boundOutput(output: string): string {
    if (output.length > this.maxOutputChars) throw new Error('Agent output exceeds configured limit')
    return output
  }
}
