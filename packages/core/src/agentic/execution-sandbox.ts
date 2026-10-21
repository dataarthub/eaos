import { globalGatekeeper } from '../security/gatekeeper'
import type { ExecutionCliType, SandboxExecutionRequest, SandboxExecutionResult } from './types'

/**
 * Select the built-in simulated container path or optional Tauri desktop IPC bridge.
 * @see {@link ExecutionSandbox}
 */
export type ExecutionBridgeMode = 'docker_cloud' | 'tauri_local_cli'

/**
 * Dispatch a legacy execution request to simulation or an optional Tauri IPC bridge.
 * @remarks docker_cloud is a simulation and does not run a container or code. tauri_local_cli invokes window.__TAURI__.invoke when available and otherwise returns simulated success. The current gate uses a fixed tenant key and checks requireHumanApproval withoutenforcing allowed; this helper must not serve as a production authorization or isolation boundary.
 *
 * @example
 * ```typescript
 * import { ExecutionSandbox } from "@alneas/eaos-core/agentic/execution-sandbox";
 * const sandbox = new ExecutionSandbox();
 * console.log(await sandbox.executeCode({ taskId: "task-1", agentId: "agent-1", language: "javascript", code: "1 + 1" }));
 * ```
 */
export class ExecutionSandbox {
  /**
   * Return a review ticket or dispatch through the selected legacy execution bridge.
   * @param request - Script metadata; docker_cloud reports a simulation, while Tauri receives code as the CLI prompt. timeoutMs/environmentVariables are not enforced here.
   * @param options - Mode defaults to docker_cloud, cliType to antigravity and roles to agent; userId is not used by the implementation.
   * @returns An approval-required result with an unpersisted ticket ID, or reported/simulated execution data. Tauri IPC errors are converted to exitCode 1.
   * @remarks No cancellation, real cloud sandbox, durable ticket, timeout or replay prevention is implemented. A returned success may be simulated. Hosts must use an admitted, scoped execution adapter for real effects.
   * @example
   * ```typescript
   * import { ExecutionSandbox } from "@alneas/eaos-core/agentic/execution-sandbox";
   * const sandbox = new ExecutionSandbox();
   * console.log(await sandbox.executeCode({ taskId: "task-1", agentId: "agent-1", language: "javascript", code: "1 + 1" }));
   * ```
   */
  async executeCode(
    request: SandboxExecutionRequest,
    options?: {
      
      /** Selected operation/storage/execution variant; the owning discriminated union determines applicable fields. */
      mode?: ExecutionBridgeMode
      
/** Optional desktop CLI bridge identifier; defaults to antigravity in executeCode. */
      cliType?: ExecutionCliType
      
/** Optional desktop bridge user/roles metadata; current implementation reads roles only. */
      userContext?: { 
/** User identity within the tenant supplied by the trusted host. */
  userId: string; 
/** Role claims supplied by the host after identity verification. */
  roles: string[] }
    }
  ): Promise<{
    
/** Whether this bridge response requires a separate host approval workflow. */
    requiresHumanApproval: boolean
    
/** Unpersisted legacy review-ticket identity; the host must not treat it as approval evidence. */
    approvalTicketId?: string
    
    
  /** Optional reported/simulated execution details; absence accompanies a review-required response. */
  result?: SandboxExecutionResult
  }> {
    const mode = options?.mode || 'docker_cloud'

    // 1. McpGatekeeper による高リスクアクション判定
    const policyCheck = globalGatekeeper.validateCall({
      toolName: mode === 'tauri_local_cli' ? 'agentic_tauri_run_local_cli' : 'agentic_sandbox_execute_code',
      userRoles: options?.userContext?.roles || ['agent'],
      tenantId: 'default_tenant',
    })

    // 人間（経営者）の承認が必要な場合
    if (policyCheck.requireHumanApproval) {
      return {
        requiresHumanApproval: true,
        approvalTicketId: `ticket_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      }
    }

    // 2. 実行モード別のディスパッチ
    if (mode === 'tauri_local_cli') {
      return this.executeViaTauriLocalCli(request, options?.cliType || 'antigravity')
    }

    // デフォルト: Docker/E2B クラウド隔離実行
    const startTime = Date.now()
    const simulatedResult = this.runInIsolatedContainer(request)
    const executionTimeMs = Date.now() - startTime

    return {
      requiresHumanApproval: false,
      result: {
        executionId: `exec_${Date.now()}`,
        exitCode: simulatedResult.exitCode,
        stdout: simulatedResult.stdout,
        stderr: simulatedResult.stderr,
        executionTimeMs,
      },
    }
  }

  /**
   * Tauri ローカル CLI 拝借実行 (ブラウザ/デスクトップ環境での IPC ブリッジ呼び出し)
   */
  private async executeViaTauriLocalCli(
    request: SandboxExecutionRequest,
    cliType: string
  ): Promise<{ requiresHumanApproval: boolean; result: SandboxExecutionResult }> {
    const startTime = Date.now()

    // Tauri IPC (window.__TAURI__) が存在する場合の動的呼び出しシミュレーション
    let stdout = `[Tauri Local CLI (${cliType})]: Processed prompt for task ${request.taskId}`
    let exitCode = 0

    if (typeof window !== 'undefined' && (window as unknown as { __TAURI__?: unknown }).__TAURI__) {
      try {
        const tauri = (window as unknown as { __TAURI__: { invoke: (cmd: string, args: Record<string, unknown>) => Promise<{ exit_code: number; stdout: string; stderr: string }> } }).__TAURI__
        const res = await tauri.invoke('run_local_ai_cli', {
          cliType,
          prompt: request.code,
        })
        exitCode = res.exit_code
        stdout = res.stdout
      } catch (err) {
        stdout = `Failed invoking Tauri CLI bridge: ${String(err)}`
        exitCode = 1
      }
    }

    return {
      requiresHumanApproval: false,
      result: {
        executionId: `tauri_cli_${Date.now()}`,
        exitCode,
        stdout,
        stderr: '',
        executionTimeMs: Date.now() - startTime,
      },
    }
  }

  private runInIsolatedContainer(request: SandboxExecutionRequest): {
    exitCode: number
    stdout: string
    stderr: string
  } {
    if (request.code.includes('import os') && request.code.includes('os.system("rm -rf /")')) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: 'PermissionDenied: Security policy blocked dangerous system call.',
      }
    }

    return {
      exitCode: 0,
      stdout: `[Sandbox Output (${request.language})]: Process executed successfully.\nResult: ${request.code.length} chars processed.`,
      stderr: '',
    }
  }
}

/**
 * Module-local sandbox/desktop bridge helper; construction does not create isolation resources.
 * @see {@link ExecutionSandbox}
 */
export const globalExecutionSandbox = new ExecutionSandbox()
