import { proposalFieldTypes, validateProposalInput } from '@alneas/appkit-core/ai/proposal'
import { approvalBindingMatches, canonicalJsonHash, createApprovalBinding, type ApprovalBinding, type ExecutionContract } from '@alneas/eaos-core'
import type { AiDraftReviewResult, AiDraftSubmission, StructuredProposalRecord } from '@alneas/eaos-core/ai/proposal-ui'
import { assertPrincipal, PluginError, type PluginPrincipal } from '@alneas/eaos-server/plugin-data'
import { ApprovalService, validateApprovalDecisionReceipt } from './service'

/**
 * Host authorization, durable proposal retention and domain command adapters for reviewed drafts.
 * @typeParam T - Result returned by the owning domain command.
 * @see {@link createReviewedDraftHandler}
 */
export interface ReviewedDraftHandlerOptions<T> {
  /** Existing tenant-scoped approval service with host binding verification configured. */
  approval: ApprovalService
  /** Host-selected approval template, resolved by ApprovalService at submission time. */
  templateId: string
  /**
   * Authorize the current principal and resolve the live operation contract on every invocation.
   * @param principal - Trusted current tenant principal.
   * @param submission - Exact review envelope and domain command input.
   * @returns The current authorized execution contract; reject to deny access.
   * @example
   * ```typescript
   * import type { ReviewedDraftHandlerOptions } from '@alneas/eaos-plugins/approval';
   * export function resolve(options: ReviewedDraftHandlerOptions<unknown>, ...args: Parameters<typeof options.resolveContract>) {
   *   return options.resolveContract(...args);
   * }
   * ```
   */
  resolveContract(principal: PluginPrincipal, submission: AiDraftSubmission): Promise<ExecutionContract>
  /**
   * Persist the exact proposal and binding in the host store before bound approval submission.
   * @param principal - Trusted requester and tenant boundary.
   * @param proposal - Validated review envelope encoding the exact domain input.
   * @param binding - Trusted scope and current input/contract identity to retain alongside the proposal.
   * @returns Resolves after durable host proposal retention; rejects on persistence failure.
   * @example
   * ```typescript
   * import type { ReviewedDraftHandlerOptions } from '@alneas/eaos-plugins/approval';
   * export function retain(options: ReviewedDraftHandlerOptions<unknown>, ...args: Parameters<typeof options.saveProposal>) {
   *   return options.saveProposal(...args);
   * }
   * ```
   */
  saveProposal(principal: PluginPrincipal, proposal: AiDraftSubmission['proposal'], binding: ApprovalBinding): Promise<void>
  /**
   * Reauthorize and perform the owning domain save with durable idempotency, CAS and transactions.
   * @param principal - Trusted current requester; recheck domain authorization at the actual write.
   * @param operation - Approved operation matching the live execution contract.
   * @param input - Exact reviewed domain input, requiring owning schema/domain validation.
   * @param approvalRequestId - Durable idempotency key for retries and concurrent execution attempts.
   * @returns The owning command result, including the previously persisted result on an idempotent retry.
   * @example
   * ```typescript
   * import type { ReviewedDraftHandlerOptions } from '@alneas/eaos-plugins/approval';
   * export function save<T>(options: ReviewedDraftHandlerOptions<T>, ...args: Parameters<typeof options.execute>) {
   *   return options.execute(...args);
   * }
   * ```
   */
  execute(principal: PluginPrincipal, operation: string, input: Record<string, unknown>, approvalRequestId: string): Promise<T>
}

/**
 * Connects reviewable structured drafts to the existing staged approval service and owning save command.
 * @typeParam T - Result returned by the host domain command.
 * @param options - Live host authorization, proposal persistence, approval service and idempotent command adapters.
 * @returns A principal-scoped handler that creates a pending request or executes an unchanged, finally approved request.
 * @throws Rejects invalid envelopes, unavailable host authorization and approvals that are pending, rejected, foreign or stale.
 * @remarks The host proposal store must support ApprovalService.verifyBinding. This helper does not supply durable command idempotency, domain validation, final authorization, CAS or a transaction across stores; execute owns those guarantees. An uncertain submission response may follow persisted proposal/approval writes, so the host must reconcile before resubmission.
 * @example
 * ```typescript
 * import { createReviewedDraftHandler, type ReviewedDraftHandlerOptions } from '@alneas/eaos-plugins/approval';
 * export function connectReviewedSave<T>(options: ReviewedDraftHandlerOptions<T>) {
 *   return createReviewedDraftHandler(options);
 * }
 * ```
 */
export function createReviewedDraftHandler<T>(options: ReviewedDraftHandlerOptions<T>): (principal: PluginPrincipal, submission: AiDraftSubmission) => Promise<AiDraftReviewResult<T>> {
  return async (principal, submission) => {
    assertPrincipal(principal)
    // Isolate every adapter from caller mutation and from the values used in subsequent checks.
    const p = structuredClone(principal), draft = structuredClone(submission)
    const invalid = (message: string): never => { throw new PluginError(400, message) }
    if (typeof draft.scope !== 'string' || !draft.scope.trim() || typeof draft.operation !== 'string' || !draft.operation.trim() || !draft.input || typeof draft.input !== 'object' || Array.isArray(draft.input)) invalid('Invalid draft scope, operation or input')
    const checked = validateProposalInput<StructuredProposalRecord>(draft.proposal, { fields: { title: proposalFieldTypes.string, data: proposalFieldTypes.string } })
    if (!checked.ok) throw new PluginError(400, 'Invalid draft proposal')
    const proposal = checked.data
    if (!proposal.id.startsWith(`${draft.scope}-draft:`) || !Number.isSafeInteger(proposal.baseVersion) || Number(proposal.baseVersion) < 0) invalid('Draft proposal scope or base version does not match')
    const title = proposal.changes.find(change => change.field === 'title')?.after
    const data = proposal.changes.find(change => change.field === 'data')?.after
    if (typeof title !== 'string' || !title.trim() || typeof data !== 'string') invalid('Draft proposal requires title and data changes')
    let proposedInput: unknown
    try { proposedInput = JSON.parse(data as string) } catch { invalid('Invalid draft proposal data') }
    if (canonicalJsonHash(proposedInput) !== canonicalJsonHash(draft.input)) invalid('Draft proposal data does not match input')
    if (proposal.metadata?.scope !== undefined && proposal.metadata.scope !== draft.scope) invalid('Draft proposal scope does not match')
    if (proposal.metadata?.operation !== undefined && proposal.metadata.operation !== draft.operation) invalid('Draft proposal operation does not match')
    if (draft.target && (draft.target.type !== draft.scope || draft.target.id !== proposal.targetId)) invalid('Draft proposal target does not match')
    if (proposal.baseVersion !== (draft.target?.revision ?? 0)) invalid('Draft proposal revision does not match')
    if (draft.input.id !== undefined && draft.input.id !== proposal.targetId) invalid('Draft input target does not match')
    if (draft.input.revision !== undefined && draft.input.revision !== proposal.baseVersion) invalid('Draft input revision does not match')
    const contract = await options.resolveContract(structuredClone(p), structuredClone(draft))
    if (contract.operation !== draft.operation) invalid('Draft operation does not match current contract')
    const binding = createApprovalBinding({ tenantId: p.tenantId, requestedBy: p.userId, operation: draft.operation, input: draft.input, contract, ...(draft.target ? { target: draft.target } : {}) })
    if (draft.approvalRequestId === undefined) {
      await options.saveProposal(structuredClone(p), structuredClone(proposal), structuredClone(binding))
      const request = await options.approval.submit(structuredClone(p), { templateId: options.templateId, title, targetType: draft.scope, targetId: proposal.targetId, binding })
      return { status: 'pending', approvalRequestId: request.id }
    }
    const request = await options.approval.read(structuredClone(p), draft.approvalRequestId, { verifyBinding: true })
    const document = request.value
    if (document.status !== 'approved' || document.templateId !== options.templateId || document.requestedBy !== p.userId || document.targetType !== draft.scope || document.targetId !== proposal.targetId || !document.binding || !approvalBindingMatches(document.binding, binding)) throw new PluginError(409, 'Draft approval must be approved and match the current request')
    const receipt = validateApprovalDecisionReceipt(document.decisionReceipt)
    const finalStage = document.stages.at(-1)
    if (receipt.decision !== 'approved' || receipt.approvalId !== request.id || receipt.tenantId !== p.tenantId || receipt.revision !== request.revision || receipt.bindingHash !== binding.bindingHash || receipt.stageId !== finalStage?.id || document.currentStage !== document.stages.length) throw new PluginError(409, 'Draft approval receipt does not match')
    return { status: 'applied', result: await options.execute(structuredClone(p), draft.operation, structuredClone(draft.input), request.id) }
  }
}
