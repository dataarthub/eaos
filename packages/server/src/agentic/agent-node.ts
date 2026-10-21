import type { WorkflowAgentProposal, WorkflowAgentRequest, WorkflowAgentRunner } from '@alneas/eaos-core'
import type { AgentGraphState, GraphNodeHandler } from './graph'

/**
 * Host runner, request construction, and output validation for {@link createWorkflowAgentNode}.
 * @typeParam TOutput - Domain output expected from the proposal; defaults to unknown and runtime validation remains plugin-owned.
 */
export interface WorkflowAgentNodeOptions<TOutput = unknown> {
  /** Host-owned runner that returns proposals; this node performs no proposed action. */
  runner: WorkflowAgentRunner
  /** Called per node invocation with a structured clone of state; must resolve a request matching tenantId, userId, and sessionId/workflowId. */
  createRequest: (state: AgentGraphState) => WorkflowAgentRequest | Promise<WorkflowAgentRequest>
  /** Called after a completed proposal with output, full proposal, and original current state; resolves the domain-validated output stored beside the proposal. Errors reject node execution. */
  validateOutput?: (output: TOutput, proposal: WorkflowAgentProposal<TOutput>, state: AgentGraphState) => TOutput | Promise<TOutput>
  /** Context property receiving cloned proposal and validated output; existing data at this key is overwritten. @defaultValue "agentProposal" */
  contextKey?: string
}

/**
 * Creates a LangGraph node that records an agent proposal in workflow state.
 * It deliberately does not execute proposed actions or create approvals.
 * @typeParam TOutput - Domain-specific proposal output passed to optional plugin validation; defaults to unknown.
 * @param options - Runner, request builder, output validator, and context key.
 * @returns An async graph handler resolving merged context and history with an agent summary entry.
 * @throws Synchronously if runner or request builder is missing. Node execution rejects principal/workflow mismatch, noncompleted runner results, and callback or structuredClone failures.
 * @remarks validateOutput receives proposal output, proposal, and the current state after a completed run; its result is stored alongside the proposal. Unlike createRequest, this callback receives the original state. Host admission, durable checkpointing, and action approval remain outside this node.
 * @example
 * ```typescript
 * import { createWorkflowAgentNode } from "@alneas/eaos-server/agentic/agent-node";
 * import type { WorkflowAgentNodeOptions } from "@alneas/eaos-server/agentic/agent-node";
 * export function proposalNode(options: WorkflowAgentNodeOptions) {
 *   // Host callbacks build authorized requests and validate domain output.
 *   return createWorkflowAgentNode(options);
 * }
 * ```
 */
export function createWorkflowAgentNode<TOutput = unknown>(options: WorkflowAgentNodeOptions<TOutput>): GraphNodeHandler {
  if (!options?.runner || typeof options.runner.run !== 'function' || typeof options.createRequest !== 'function') throw new Error('Workflow agent node requires a runner and request builder')

  return async state => {
    const request = await options.createRequest(structuredClone(state))
    if (request.tenantId !== state.tenantId || request.userId !== state.userId) throw new Error('Workflow agent request principal does not match graph state')
    if (request.workflowId !== state.sessionId) throw new Error('Workflow agent request workflowId does not match graph session')

    const result = await options.runner.run<TOutput>(request)
    if (result.status !== 'COMPLETED' || !result.proposal) throw new Error(result.error || `Workflow agent runtime ${result.status.toLowerCase()}`)
    const output = options.validateOutput ? await options.validateOutput(result.proposal.output, result.proposal, state) : result.proposal.output
    const contextKey = options.contextKey ?? 'agentProposal'
    return {
      context: {
        ...(state.context ?? {}),
        [contextKey]: structuredClone({ proposal: result.proposal, output }),
      },
      history: [
        ...state.history,
        { role: 'agent', content: result.proposal.summary, timestamp: new Date().toISOString() },
      ],
    }
  }
}
