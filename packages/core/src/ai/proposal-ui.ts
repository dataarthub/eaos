import { validateProposalInput, proposalFieldTypes, prepareProposalBatch, type RecordProposal } from '@alneas/appkit-core/ai/proposal'
import { createGenerativeUIContract, type GenerativeUIDocument } from '@alneas/appkit-core/ai/generative-ui'
import type { CoreAiDraft } from './governance'
import type { ExecutionTarget } from '../agent/approved-execution'
import { canonicalJson } from '../serialization/json'

/**
 * A reviewed command and its Appkit proposal envelope, sent to a trusted Host.
 * @see {@link convertAiDraftToProposal}
 */
export interface AiDraftSubmission {
  /** Owning workspace or plugin namespace. */
  scope: string
  /** Registered owning command operation. */
  operation: string
  /** Exact schema-normalized command input after operator edits. */
  input: Record<string, unknown>
  /** Immutable Appkit envelope whose data change contains the exact input. */
  proposal: RecordProposal<StructuredProposalRecord>
  /** Bound resource identity and source revision; omitted for independent creation. */
  target?: ExecutionTarget
  /** Existing durable approval request to check before saving the same command. */
  approvalRequestId?: string
}

/**
 * Host response; pending approval never represents a saved domain record.
 * @typeParam T - Response from the owning domain save command.
 * @see {@link AiDraftSubmission}
 */
export type AiDraftReviewResult<T> =
  | {
    /** A durable approval exists but the domain command has not executed. */
    status: 'pending';
    /** Approval request to reconcile on the next save attempt. */
    approvalRequestId: string
  }
  | {
    /** The owning command returned its save response. */
    status: 'applied';
    /** Domain command response; the consumer still validates its scope. */
    result: T
  }

/**
 * Builds an Appkit proposal envelope for the exact reviewed command values.
 * @param draft - Reviewed values and optional source scope, target and revision.
 * @param options - Host-selected identity and the actual source envelope baseline.
 * @returns A validated proposal; persistence and approval belong to the Host.
 * @throws Rejects scope/target/version mismatches, missing edit baselines and non-JSON values.
 * @remarks The title/data fields describe a review envelope, not arbitrary domain record fields.
 * @example
 * ```typescript
 * import { convertAiDraftToProposal } from '@alneas/eaos-core/ai/proposal-ui';
 * const proposal = convertAiDraftToProposal({ mode: 'create', values: { name: 'Draft' } }, { scope: 'notes', targetId: 'command-1' });
 * ```
 */
export function convertAiDraftToProposal(
  draft: CoreAiDraft,
  options: {
    /** Host-selected workspace or plugin namespace. */
    scope: string;
    /** Existing record ID or stable proposed-command identity. */
    targetId: string;
    /** Actual source revision; zero represents independent creation. */
    baseVersion?: number;
    /** Proposal timestamp; defaults to the current ISO time. */
    createdAt?: string;
    /** Current title of the stored review envelope. */
    currentTitle?: string;
    /** Actual source values; required for nonzero revisions. */
    currentValues?: Readonly<Record<string, unknown>>
  }
): RecordProposal<StructuredProposalRecord> {
  const {scope, targetId} = options
  if (draft.scope !== undefined && draft.scope !== scope) throw new Error('Draft scope differs')
  if (draft.targetId !== undefined && draft.targetId !== targetId) throw new Error('Draft target differs')
  const baseVersion = options.baseVersion ?? 0
  if (draft.baseRevision !== undefined && draft.baseRevision !== baseVersion) throw new Error('Draft revision differs')
  if (baseVersion !== 0 && options.currentValues === undefined) throw new Error('Current edit baseline required')
  const createdAt = options.createdAt ?? new Date().toISOString()

  const checked = validateProposalInput<StructuredProposalRecord>(
    {
      id: `${scope}-draft:${targetId}:${createdAt}`,
      targetId,
      baseVersion,
      createdAt,
      changes: [
        { field: 'title', before: options.currentTitle ?? '', after: draft.summary ?? 'AI Draft Proposal', reason: 'AI draft proposal' },
        { field: 'data', before: canonicalJson(options.currentValues ?? {}), after: canonicalJson(draft.values), reason: 'AI draft proposal values' },
      ],
    },
    { fields: { title: proposalFieldTypes.string, data: proposalFieldTypes.string } }
  )
  if (!checked.ok) throw new Error(`Invalid ${scope} proposal: ${checked.errors?.[0]?.message ?? 'validation failed'}`)
  return checked.data
}

/**
 * Host identity and source baseline used to prepare a reviewed command submission.
 * @see {@link prepareAiDraftSubmission}
 */
export type AiDraftSubmissionOptions = Parameters<typeof convertAiDraftToProposal>[1] & {
  /** Registered operation whose exact input the operator has reviewed. */
  operation: string
  /** Existing resource and source revision; omitted for independent creation. */
  target?: ExecutionTarget
}

/**
 * Prepares an EAOS command through Appkit's proposal consistency and candidate engine.
 * @param draft - Values after the operator has edited and submitted the owning form.
 * @param options - Owning operation, target and actual source baseline.
 * @returns Detached command input from Appkit's prepared candidate and its validated proposal.
 * @throws Rejects invalid JSON, conflicting scope/target/version or failed proposal preflight.
 * @remarks Calling this helper does not grant approval or save a record. The Host verifies durable approval and current authorization before its owning command executes.
 * @example
 * ```typescript
 * import { prepareAiDraftSubmission } from '@alneas/eaos-core/ai/proposal-ui';
 * const request = prepareAiDraftSubmission({ mode: 'create', scope: 'notes', values: { title: 'Reviewed' } }, { scope: 'notes', operation: 'create', targetId: 'command-1' });
 * ```
 */
export function prepareAiDraftSubmission(draft: CoreAiDraft, options: AiDraftSubmissionOptions): AiDraftSubmission {
  const version = options.baseVersion ?? 0
  if (options.target && (options.target.type !== options.scope || options.target.id !== options.targetId || options.target.revision !== version)) throw new Error('Draft target or revision differs')
  const proposal = convertAiDraftToProposal(draft, options)
  const prepared = prepareProposalBatch<StructuredProposalRecord>([{
    proposal, selected: true, decisions: {title: 'accepted', data: 'accepted'}, currentVersion: version,
    currentRecord: {title: options.currentTitle ?? '', data: canonicalJson(options.currentValues ?? {})},
  }])
  if (!prepared.canApply) throw new Error('Draft proposal preflight failed')
  return {
    scope: options.scope, operation: options.operation, proposal,
    input: JSON.parse(prepared.payloads[0].candidateRecord.data),
    ...(options.target ? {target: structuredClone(options.target)} : {}),
  }
}

/**
 * Reviewable draft title and structured JSON data prior to persistence.
 * @see {@link createStructuredDraftProposal}
 */
export interface StructuredDraft { 
  /** Human-readable draft, task, file or event title displayed by the host. */
  title: string; 
  /** Structured draft/event data or cached result; serialization and validation occur at the owning API boundary. */
  data: Record<string, unknown> }
/**
 * Primitive Appkit review envelope for a structured JSON command.
 * @see {@link convertAiDraftToProposal}
 */
export type StructuredProposalRecord = Record<string, unknown> & {
  /** Human-readable review title. */
  title: string;
  /** Canonical JSON command or source snapshot represented as a primitive field. */
  data: string
}

/**
 * Shared reviewable AI draft contract for official plugins.
 * @param scope - Prefix used for proposal identity and error messages.
 * @param targetId - Record identity targeted by the proposal.
 * @param draft - Title and JSON-serializable structured draft data.
 * @param createdAt - Creation timestamp accepted by the app-core proposal validator; also included in proposal identity.
 * @returns A validated RecordProposal with title/data changes from empty values at baseVersion zero.
 * @throws Error if proposal validation fails; JSON serialization and peer validator errors propagate.
 * @remarks Requires Appkit Core proposal peer. Produces review data only; no record is written and human acceptance remains host-owned.
 * @example
 * ```typescript
 * import { createStructuredDraftProposal } from "@alneas/eaos-core/ai/proposal-ui";
 * console.log(createStructuredDraftProposal("notes", "note-1", { title: "Draft", data: { text: "hello" } }, "2026-10-19T00:00:00Z").id);
 * ```
 */
export function createStructuredDraftProposal(scope: string, targetId: string, draft: StructuredDraft, createdAt: string): RecordProposal<StructuredProposalRecord> {
  const checked = validateProposalInput<StructuredProposalRecord>({ id: `${scope}-draft:${targetId}:${createdAt}`, targetId, baseVersion: 0, createdAt, changes: [{ field: 'title', before: '', after: draft.title, reason: 'AI draft; human review required' }, { field: 'data', before: '', after: JSON.stringify(draft.data), reason: 'AI draft; human review required' }] }, { fields: { title: proposalFieldTypes.string, data: proposalFieldTypes.string } })
  if (!checked.ok) throw new Error(`Invalid ${scope} proposal`)
  return checked.data
}

/**
 * Shared bounded generative UI response contract; component registration remains host-owned.
 * @param scope - Prefix used for the registered summary block type and document identity.
 * @param draft - Title and JSON-serializable data; serialized data is limited to 20000 characters by the generated contract.
 * @returns A validated version-one document containing one summary block.
 * @throws Error on generative UI validation failure; serialization/peer errors propagate.
 * @remarks Requires Appkit Core generative-ui peer. Rendering and registration of the summary component remain host-owned.
 * @example
 * ```typescript
 * import { createStructuredDraftUIDocument } from "@alneas/eaos-core/ai/proposal-ui";
 * console.log(createStructuredDraftUIDocument("notes", { title: "Draft", data: { text: "hello" } }).version); // 1
 * ```
 */
export function createStructuredDraftUIDocument(scope: string, draft: StructuredDraft): GenerativeUIDocument {
  const contract = createGenerativeUIContract([{ type: `${scope}-summary`, dataSchema: { type: 'object', properties: { title: { type: 'string' }, data: { type: 'string', maxLength: 20000 } }, required: ['title', 'data'], additionalProperties: false } }])
  const checked = contract.validate({ version: 1, id: `${scope}-ui:${draft.title}`, blocks: [{ id: 'summary', type: `${scope}-summary`, data: { title: draft.title, data: JSON.stringify(draft.data) } }] })
  if (!checked.ok) throw new Error(checked.error)
  return checked.data
}
