import { validateProposalInput, proposalFieldTypes, type RecordProposal } from '@alneas/appkit-core/ai/proposal'
import { createGenerativeUIContract, type GenerativeUIDocument } from '@alneas/appkit-core/ai/generative-ui'
import type { CoreAiDraft } from './governance'

/**
 * Converts a CoreAiDraft to a durable platform RecordProposal for human-in-the-loop audit and approval.
 */
export function convertAiDraftToProposal(
  draft: CoreAiDraft,
  options: { scope: string; targetId: string; baseVersion?: number; createdAt?: string }
): RecordProposal<StructuredProposalRecord> {
  const scope = draft.scope ?? options.scope
  const targetId = draft.targetId ?? options.targetId
  const createdAt = options.createdAt ?? new Date().toISOString()
  const baseVersion = draft.baseRevision ?? options.baseVersion ?? 0

  const checked = validateProposalInput<StructuredProposalRecord>(
    {
      id: `${scope}-draft:${targetId}:${createdAt}`,
      targetId,
      baseVersion,
      createdAt,
      changes: [
        { field: 'title', before: '', after: draft.summary ?? 'AI Draft Proposal', reason: 'AI draft proposal' },
        { field: 'data', before: '', after: JSON.stringify(draft.values), reason: 'AI draft proposal values' },
      ],
    },
    { fields: { title: proposalFieldTypes.string, data: proposalFieldTypes.string } }
  )
  if (!checked.ok) throw new Error(`Invalid ${scope} proposal: ${checked.errors?.[0]?.message ?? 'validation failed'}`)
  return checked.data
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
type StructuredProposalRecord = Record<string, unknown> & { title: string; data: string }

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
