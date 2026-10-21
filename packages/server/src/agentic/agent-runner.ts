import {
  parseWorkflowAgentProposal,
  type WorkflowAgentRequest,
  type WorkflowAgentRunResult,
  type WorkflowAgentRunner,
} from '@alneas/eaos-core'
import type { ServerAgentExecutor, ServerAgentTaskRequest } from './types'

/**
 * Host executor configuration for {@link createWorkflowAgentRunner}.
 */
export interface ServerWorkflowAgentRunnerOptions {
  /** Host-owned executor. It may be backed by Goose, Hermes or another runtime. */
  executor: ServerAgentExecutor
  /** Optional host runtime label copied into every normalized run result. */
  runtimeId?: string
}

/**
 * Bridges the host/server executor contract to the vendor-neutral workflow
 * runner contract. The executor output is parsed as a proposal; it is never
 * treated as an instruction to perform a side effect.
 * @param options - Host-owned executor and optional runtime label.
 * @returns A runner whose generic run method accepts a WorkflowAgentRequest and resolves a parsed proposal or a failure result. Executor errors become FAILED/UNAVAILABLE data; parse errors become nonretryable INVALID_PROPOSAL data.
 * @throws Synchronously when executor is missing. run may reject before execution when request serialization fails.
 * @remarks The runner forwards workflow/correlation/idempotency/tool context but does not independently authorize, retry, deduplicate, execute tools, or enforce timeouts. Those boundaries belong to the host executor. Runtime text must parse as a version 1.0 proposal; domain-specific output still needs plugin validation.
 * @example
 * ```typescript
 * import { createWorkflowAgentRunner } from "@alneas/eaos-server/agentic/agent-runner";
 * import type { ServerAgentExecutor } from "@alneas/eaos-server/agentic/types";
 * export function workflowRunner(executor: ServerAgentExecutor) {
 *   return createWorkflowAgentRunner({ executor, runtimeId: "host-runtime" });
 * }
 * ```
 */
export function createWorkflowAgentRunner(options: ServerWorkflowAgentRunnerOptions): WorkflowAgentRunner {
  if (typeof options?.executor !== 'function') throw new Error('Workflow agent executor is required')

  return {
    async run<TOutput>(request: WorkflowAgentRequest): Promise<WorkflowAgentRunResult<TOutput>> {
      const startedAt = Date.now()
      const task: ServerAgentTaskRequest = {
        id: request.taskId,
        tenantId: request.tenantId,
        userId: request.userId,
        title: request.purpose,
        workerType: 'custom',
        ...(request.jobKind === undefined ? {} : { jobKind: request.jobKind }),
        instructions: JSON.stringify({
          schemaVersion: '1.0',
          purpose: request.purpose,
          input: request.input,
          toolScope: request.toolScope,
          output: 'Return only a JSON WorkflowAgentProposal with schemaVersion 1.0.',
        }),
        executionContext: {
          workflowId: request.workflowId,
          correlationId: request.correlationId,
          idempotencyKey: request.idempotencyKey,
          toolMode: request.toolScope.mode,
          allowedToolNames: request.toolScope.allowedToolNames,
        },
        timeoutMs: request.timeoutMs,
      }

      let rawOutput: string
      try {
        rawOutput = await options.executor(task)
      } catch (error) {
        const failureCode = isAgentFailureCode(error) ? error.failureCode : 'RUNTIME_FAILED'
        const retryable = isAgentRetryable(error) ?? (failureCode === 'AGENT_UNAVAILABLE' || failureCode === 'TIMEOUT' || failureCode === 'RUNTIME_FAILED')
        return {
          status: failureCode === 'AGENT_UNAVAILABLE' ? 'UNAVAILABLE' : 'FAILED',
          error: error instanceof Error ? error.message : 'Workflow agent execution failed',
          failureCode,
          retryable,
          ...(options.runtimeId ? { runtimeId: options.runtimeId } : {}),
          durationMs: Date.now() - startedAt,
        }
      }

      try {
        const proposal = parseWorkflowAgentProposal<TOutput>(rawOutput)
        return { status: 'COMPLETED', proposal, ...(options.runtimeId ? { runtimeId: options.runtimeId } : {}), durationMs: Date.now() - startedAt }
      } catch (error) {
        return {
          status: 'FAILED',
          error: error instanceof Error ? error.message : 'Invalid workflow agent proposal',
          failureCode: 'INVALID_PROPOSAL',
          retryable: false,
          ...(options.runtimeId ? { runtimeId: options.runtimeId } : {}),
          durationMs: Date.now() - startedAt,
        }
      }
    },
  }
}

function isAgentFailureCode(error: unknown): error is { failureCode: NonNullable<WorkflowAgentRunResult['failureCode']> } {
  return typeof error === 'object' && error !== null && 'failureCode' in error && typeof error.failureCode === 'string'
}

function isAgentRetryable(error: unknown): boolean | undefined {
  return typeof error === 'object' && error !== null && 'retryable' in error && typeof error.retryable === 'boolean'
    ? error.retryable
    : undefined
}
