import { AgentGraphEngine, type AgentGraphState } from './graph'
import type { ServerApprovalCallbackPayload } from './types'

/**
 * Host notification and approval authority callbacks used by {@link ServerWorkflowManager}.
 */
export interface ServerWorkflowOptions {
  /** Called after runStep returns pendingApproval; receives the returned state. Notification failures are warned and do not fail runWorkflow. */
  onApprovalRequired?: (state: AgentGraphState) => Promise<void>
  /** Live host approval check receiving workflow state and verified approver/decision; must resolve true to permit resume. Errors are delegated to graph resume handling. */
  authorizeResume?: (state: AgentGraphState, input: {
  /**
   * Host-authenticated approver identifier attached to the pending decision.
   */
  approverId: string;
  /**
   * Host-verified approver role to recheck against current resource/approval policy.
   */
  approverRole: string;
  /**
   * True requests continuation; false requests rejection, and a supplied authorizer also checks that decision.
   */
  approved: boolean }) => Promise<boolean>
}

/**
 * Coordinates graph execution and host approval notifications without choosing a notification transport.
 * @remarks Checkpoint persistence and approval binding are delegated to AgentGraphEngine; the host authenticates approval callbacks. No webhook listener, retry queue, or delivery guarantee is installed.
 * @example
 * ```typescript
 * import { ServerWorkflowManager, type ServerWorkflowOptions } from "@alneas/eaos-server/agentic/workflow-manager";
 * export function workflowManager(options: ServerWorkflowOptions) {
 *   return new ServerWorkflowManager(options);
 * }
 * ```
 */
export class ServerWorkflowManager {
  private onApprovalRequired?: (state: AgentGraphState) => Promise<void>
  private authorizeResume?: ServerWorkflowOptions['authorizeResume']

  /**
   * Captures optional host approval notification and authorization callbacks.
   * @param options - Host callbacks; omitted options perform no external notification and supply no resume authorizer.
   */
  constructor(options?: ServerWorkflowOptions) {
    this.onApprovalRequired = options?.onApprovalRequired
    this.authorizeResume = options?.authorizeResume
  }

  /**
   * Runs the graph and notifies the host if execution pauses for approval.
   * @param graph - Configured graph with appropriate durable checkpointer/admission.
   * @param initialState - Verified workflow identity and starting state.
   * @returns Graph state after runStep, including any pending approval; notification failures do not change it.
   * @throws Rejects graph execution failures; notification errors are caught and warned.
   * @example
   * ```typescript
   * import { ServerWorkflowManager } from "@alneas/eaos-server/agentic/workflow-manager";
   * import type { AgentGraphEngine, AgentGraphState } from "@alneas/eaos-server/agentic/graph";
   * export async function run(graph: AgentGraphEngine, initialState: AgentGraphState) {
   *   return new ServerWorkflowManager().runWorkflow(graph, initialState);
   * }
   * ```
   */
  async runWorkflow(graph: AgentGraphEngine, initialState: AgentGraphState): Promise<AgentGraphState> {
    const state = await graph.runStep(initialState)

    if (state.pendingApproval) {
      if (this.onApprovalRequired) {
        try {
          await this.onApprovalRequired(state)
        } catch (err) {
          console.warn(`[ServerWorkflowManager] Approval notification failed: ${(err as Error).message}`)
        }
      }
    }

    return state
  }

  /**
   * Delegates an authenticated approval decision to graph checkpoint/binding verification and resume.
   * @param graph - Graph owning the pending task checkpoint.
   * @param payload - Verified approver decision with optional approval/hash bindings; taskId selects the graph session.
   * @returns Resume outcome, optional updated state, or failure data from resumeAfterApproval.
   * @throws Propagates graph/checkpointer errors not normalized by resumeAfterApproval.
   * @remarks The host verifies caller identity and role before constructing payload. This wrapper does not send a second approval notification after resume.
   * @example
   * ```typescript
   * import { ServerWorkflowManager, type ServerWorkflowOptions } from "@alneas/eaos-server/agentic/workflow-manager";
   * import type { AgentGraphEngine } from "@alneas/eaos-server/agentic/graph";
   * import type { ServerApprovalCallbackPayload } from "@alneas/eaos-server/agentic/types";
   * export async function approve(graph: AgentGraphEngine, options: ServerWorkflowOptions, payload: ServerApprovalCallbackPayload) {
   *   return new ServerWorkflowManager(options).handleApproval(graph, payload);
   * }
   * ```
   */
  async handleApproval(
    graph: AgentGraphEngine,
    payload: ServerApprovalCallbackPayload
  ): Promise<{ 
  /** Whether graph approval verification/resumption produced a saved state; false can follow partial effects and is not proof that nothing ran. */
  resumed: boolean; 
  /** Optional graph checkpoint state returned after successful resumption; absent on the normalized failure paths. */
  state?: AgentGraphState; 
  /** Optional normalized checkpoint, approval, authorization or invocation failure detail when resumed is false; other errors can still reject the Promise. */
  error?: string }> {
    return graph.resumeAfterApproval({ sessionId: payload.taskId, approvalId: payload.approvalId, bindingHash: payload.bindingHash, approved: payload.approved, approverId: payload.approverId, approverRole: payload.approverRole, comment: payload.comment, authorizeResume: this.authorizeResume })
  }
}
