import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { defaultRuntimePlacementPolicy, type AgentRuntimeResourcePolicy } from '@alneas/eaos-core'
import { ServerAgentExecutionError, type ServerAgentExecutor, type ServerAgentTaskRequest } from './types'

/**
 * Chooses Linux systemd-run, direct spawning, or automatic platform selection.
 * @see createCommandAgentExecutor.
 */
export type CommandAgentSandboxMode = 'auto' | 'systemd' | 'direct'

/**
 * Host sandbox selection for {@link createCommandAgentExecutor}.
 */
export interface CommandAgentSandboxOptions {
  /** auto uses transient systemd on Linux and direct execution on local development hosts. */
  mode?: CommandAgentSandboxMode
  /** Resource policy is framework-owned by default; consumers may only tighten it in a host adapter. */
  policy?: AgentRuntimeResourcePolicy
}

/**
 * Trusted executable, argument/environment builders, and limits for {@link createCommandAgentExecutor}.
 */
export interface CommandAgentExecutorOptions {
  /** Host-configured executable. It is never taken from a task request. */
  command: string
  /** Called once per task with a structured clone; must return string arguments. Arguments are passed without a shell, and callback errors reject execution. */
  buildArgs: (request: ServerAgentTaskRequest) => readonly string[]
  /** Process working directory; omitted uses the host process directory. Under systemd this directory is also explicitly writable. */
  cwd?: string
  /** Per-task environment callback receiving a clone; its entries override framework EAOS variables. Defaults to no additional variables. */
  env?: (request: ServerAgentTaskRequest) => Record<string, string | undefined>
  /** Inherit host process environment before framework/custom variables. @defaultValue false */
  includeProcessEnv?: boolean
  /** Default task timeout in milliseconds, safe integer 1–3600000; task.timeoutMs overrides it. @defaultValue 60000 */
  timeoutMs?: number
  /** Combined stdout/stderr string-length ceiling, safe integer 1–10000000. @defaultValue 1000000 */
  maxOutputChars?: number
  /** Sandbox selection; defaults to auto and a validated task/framework policy. Direct mode does not apply systemd resource/filesystem restrictions. */
  sandbox?: CommandAgentSandboxOptions
}

/**
 * Validates that resource-policy fields retain or tighten the current framework baseline.
 * @param policy - Runtime resource policy with AI placement, read-only root, private-only network, and bounded resources.
 * @returns A structured clone of the accepted policy.
 * @throws For weaker/invalid fields; malformed nested fields can also throw property-access errors.
 * @remarks Validation does not itself apply operating-system isolation, concurrency, or network controls.
 * @example
 * ```typescript
 * import { defaultRuntimePlacementPolicy } from "@alneas/eaos-core";
 * import { validateAgentRuntimePolicy } from "@alneas/eaos-server/agentic/executor";
 * const policy = validateAgentRuntimePolicy(defaultRuntimePlacementPolicy().ai.agentRuntime);
 * console.log(policy.placement); // "ai"
 * ```
 */
export function validateAgentRuntimePolicy(policy: AgentRuntimeResourcePolicy): AgentRuntimeResourcePolicy {
  const baseline = defaultRuntimePlacementPolicy().ai.agentRuntime
  if (!policy || policy.placement !== 'ai' || policy.rootFilesystem !== 'read-only' || policy.network !== 'private-only' ||
      !Number.isSafeInteger(policy.maxConcurrent) || policy.maxConcurrent < 1 || policy.maxConcurrent > baseline.maxConcurrent ||
      !Number.isSafeInteger(policy.maxRuntimeMs) || policy.maxRuntimeMs < 1 || policy.maxRuntimeMs > baseline.maxRuntimeMs ||
      !Number.isSafeInteger(policy.memoryLimitMb) || policy.memoryLimitMb < 1 || policy.memoryLimitMb > baseline.memoryLimitMb ||
      !Number.isSafeInteger(policy.pidsLimit) || policy.pidsLimit < 1 || policy.pidsLimit > baseline.pidsLimit ||
      policy.tmpfs.path !== '/tmp' || policy.tmpfs.noexec !== true || policy.tmpfs.nosuid !== true || policy.tmpfs.nodev !== true ||
      !Number.isSafeInteger(policy.tmpfs.maxBytes) || policy.tmpfs.maxBytes < 1 || policy.tmpfs.maxBytes > baseline.tmpfs.maxBytes ||
      policy.workspace.path !== '/workspace' || policy.workspace.mode !== baseline.workspace.mode || policy.workspace.persistent !== false ||
      !Number.isSafeInteger(policy.workspace.maxBytes) || policy.workspace.maxBytes < 1 || policy.workspace.maxBytes > baseline.workspace.maxBytes) {
    throw new Error('Agent runtime policy may only tighten the framework default')
  }
  return structuredClone(policy)
}

/**
 * Builds systemd-run arguments for transient process resource and filesystem restrictions.
 * @param command - Trusted executable passed after the systemd option terminator.
 * @param args - Executable arguments, passed unchanged without a shell.
 * @param policy - Already validated resource policy; this helper does not validate it.
 * @param cwd - Working directory, resolved absolutely; absent/empty uses process.cwd().
 * @param unit - Host-selected transient unit name, used for later stop requests.
 * @returns A new argument array, using --user for a nonroot host user and rounding runtime milliseconds upward to at least one second.
 * @remarks Requires a host with systemd-run and appropriate service-manager permissions when executed. This array does not implement network allowlisting, workspace capacity, or a concurrency scheduler; those policy fields require host enforcement.
 * @example
 * ```typescript
 * import { defaultRuntimePlacementPolicy } from "@alneas/eaos-core";
 * import { buildSystemdRunArgs } from "@alneas/eaos-server/agentic/executor";
 * const args = buildSystemdRunArgs("agent-runtime", ["--version"], defaultRuntimePlacementPolicy().ai.agentRuntime, undefined, "example-agent");
 * console.log(args.includes("--wait")); // true
 * ```
 */
export function buildSystemdRunArgs(command: string, args: readonly string[], policy: AgentRuntimeResourcePolicy, cwd: string | undefined, unit: string): string[] {
  const workingDirectory = resolve(cwd || process.cwd())
  const runtimeSeconds = Math.max(1, Math.ceil(policy.maxRuntimeMs / 1000))
  const user = typeof process.getuid === 'function' && process.getuid() !== 0
  return [
    ...(user ? ['--user'] : []),
    '--wait', '--collect', '--pipe', '--quiet', `--unit=${unit}`,
    `--property=MemoryMax=${policy.memoryLimitMb}M`,
    `--property=TasksMax=${policy.pidsLimit}`,
    `--property=RuntimeMaxSec=${runtimeSeconds}s`,
    '--property=ProtectSystem=strict',
    '--property=NoNewPrivileges=yes',
    '--property=PrivateTmp=yes',
    `--property=TemporaryFileSystem=${policy.tmpfs.path}:rw,noexec,nosuid,nodev,size=${policy.tmpfs.maxBytes}`,
    `--property=ReadWritePaths=${workingDirectory}`,
    `--working-directory=${workingDirectory}`,
    '--', command, ...args,
  ]
}

function sandboxMode(options: CommandAgentSandboxOptions | undefined): CommandAgentSandboxMode {
  return options?.mode || 'auto'
}

function useSystemd(mode: CommandAgentSandboxMode): boolean {
  if (mode === 'direct') return false
  if (mode === 'systemd') return true
  return process.platform === 'linux'
}

function stopSystemdUnit(unit: string) {
  const user = typeof process.getuid === 'function' && process.getuid() !== 0
  const child = spawn('systemctl', [...(user ? ['--user'] : []), 'stop', unit], { stdio: 'ignore' })
  child.once('error', () => undefined)
}

/**
 * Creates a shell-free executor for OpenCode, Codex, Goose or another trusted
 * CLI. Authorization and approval happen before this adapter is called.
 * @param options - Trusted executable, argument/environment callbacks, output/timeout limits, and sandbox settings.
 * @returns A per-task async executor resolving stdout on exit code zero, including an empty string when no output was produced.
 * @throws Synchronously for invalid factory settings. Execution rejects callback/clone/policy errors and ServerAgentExecutionError for spawn, timeout, output-limit, or nonzero-exit failures.
 * @remarks Requires Node child_process. auto selects systemd on Linux and direct execution elsewhere. No task concurrency limit is enforced here. stdin is ignored, stdout/stderr are bounded together, and stderr is excluded from successful output. On timeout/output/spawn failure the timer is cleared, SIGTERM is sent, and systemd stop is requested when managed; termination is not awaited and descendants may outlive direct-mode failure. Idempotency is only propagated through environment variables; host/runtime code must enforce safe retries.
 * @example
 * ```typescript
 * import { createCommandAgentExecutor, type CommandAgentExecutorOptions } from "@alneas/eaos-server/agentic/executor";
 * export function hostExecutor(configuration: CommandAgentExecutorOptions) {
 *   // The host provisions the executable and performs admission/approval first.
 *   return createCommandAgentExecutor(configuration);
 * }
 * ```
 */
export function createCommandAgentExecutor(options: CommandAgentExecutorOptions): ServerAgentExecutor {
  if (typeof options.command !== 'string' || !options.command.trim() || typeof options.buildArgs !== 'function') throw new Error('Invalid command agent executor')
  const timeoutDefault = options.timeoutMs ?? 60_000
  const maxOutputChars = options.maxOutputChars ?? 1_000_000
  if (!Number.isSafeInteger(timeoutDefault) || timeoutDefault < 1 || timeoutDefault > 3_600_000 || !Number.isSafeInteger(maxOutputChars) || maxOutputChars < 1 || maxOutputChars > 10_000_000) throw new Error('Invalid command agent executor limits')

  return async request => {
    const args = options.buildArgs(structuredClone(request))
    if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string')) throw new Error('Command agent arguments must be strings')
    const timeoutMs = request.timeoutMs ?? timeoutDefault
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) throw new Error('Invalid command agent timeout')
    const customEnv = options.env?.(structuredClone(request)) ?? {}
    const env = {
      ...(options.includeProcessEnv ? process.env : {}),
      EAOS_TENANT_ID: request.tenantId,
      EAOS_TASK_ID: request.id,
      ...(request.executionContext?.workflowId ? { EAOS_WORKFLOW_ID: request.executionContext.workflowId } : {}),
      ...(request.executionContext?.correlationId ? { EAOS_CORRELATION_ID: request.executionContext.correlationId } : {}),
      ...(request.executionContext?.idempotencyKey ? { EAOS_IDEMPOTENCY_KEY: request.executionContext.idempotencyKey } : {}),
      ...(request.executionContext?.toolMode ? { EAOS_TOOL_MODE: request.executionContext.toolMode } : {}),
      ...(request.executionContext?.allowedToolNames ? { EAOS_ALLOWED_TOOL_NAMES: JSON.stringify(request.executionContext.allowedToolNames) } : {}),
      ...customEnv,
    }
    const policy = validateAgentRuntimePolicy(options.sandbox?.policy || request.runtimePolicy || defaultRuntimePlacementPolicy().ai.agentRuntime)
    const unit = `eaos-agent-${randomUUID()}`
    const managed = useSystemd(sandboxMode(options.sandbox))
    const launchCommand = managed ? 'systemd-run' : options.command
    const launchArgs = managed ? buildSystemdRunArgs(options.command, args, policy, options.cwd, unit) : args

    return new Promise((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      let settled = false
      const child = spawn(launchCommand, launchArgs, { cwd: options.cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
      const timer = setTimeout(() => {
        fail(new ServerAgentExecutionError('Agent runtime timed out', 'TIMEOUT', true))
      }, timeoutMs)
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (managed) stopSystemdUnit(unit)
        child.kill('SIGTERM')
        reject(error)
      }
      const append = (target: 'stdout' | 'stderr', data: Buffer | string) => {
        if (settled) return
        if (target === 'stdout') stdout += data.toString()
        else stderr += data.toString()
        if (stdout.length + stderr.length > maxOutputChars) fail(new ServerAgentExecutionError('Agent output exceeds configured limit', 'OUTPUT_LIMIT', false))
      }
      child.stdout?.on('data', data => append('stdout', data))
      child.stderr?.on('data', data => append('stderr', data))
      child.once('error', error => fail(new ServerAgentExecutionError(`Agent runtime unavailable: ${error.message}`, 'AGENT_UNAVAILABLE', true, { cause: error })))
      child.once('close', code => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (code !== 0) {
          const sandboxUnavailable = managed && /(?:systemd-run|Failed to (?:connect|start|find executable)|No medium found)/i.test(stderr)
          const message = sandboxUnavailable
            ? `Agent runtime unavailable: ${stderr.slice(0, 1000)}`
            : `Agent runtime exited with code ${code}: ${stderr.slice(0, 1000)}`
          return reject(new ServerAgentExecutionError(
            message,
            sandboxUnavailable ? 'AGENT_UNAVAILABLE' : 'RUNTIME_FAILED',
            true,
          ))
        }
        resolve(stdout)
      })
    })
  }
}
