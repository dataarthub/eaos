import { getPlatformNamespaceDocumentContracts as getNamespaceDocumentContracts } from '@alneas/eaos-core/contracts/platform-records'
import { createValidatedRecordHost } from '@alneas/eaos-server/plugin-data'
import { randomUUID } from 'node:crypto'
import { validateApprovalBinding, type ApprovalBinding } from '@alneas/eaos-core'
import { assertPrincipal, PluginError, textInput, revisionInput, exactKeys, type PluginPrincipal, type PluginRecordStore, type PluginRecord } from '@alneas/eaos-server/plugin-data'
/**
 * One ordered approval stage assigned to explicit users or roles.
 *
 * @see ApprovalService for a complete host integration example.
 */
export interface ApprovalStage {
/**
 * Unique nonblank stage identifier within its template.
 */
  id: string;
/**
 * Nonblank presentation caption.
 */
  label: string;
/**
 * Optional explicit assigned users; at least one user or role assignment is required.
 */
  userIds?: string[];
/**
 * Optional assigned roles checked against current principal roles.
 */
  roles?: string[] }
/**
 * Host-selected immutable stage template copied into a submitted request.
 *
 * @see ApprovalService for a complete host integration example.
 */
export interface ApprovalTemplate {
/**
 * Host template identifier matching the requested templateId.
 */
  id: string;
/**
 * Ordered 1–50 stage assignments copied into the request.
 */
  stages: ApprovalStage[];
/**
 * Whether an assigned requester can approve their own request.
 * @defaultValue false
 */
  allowSelfApproval?: boolean }
/**
 * Final approval/rejection evidence identifying actor, stage and resulting revision.
 *
 * @see ApprovalService for a complete host integration example.
 */
export interface ApprovalDecisionReceipt {
  /**
 * Generated final-decision receipt identifier.
 */
  receiptId: string
  /**
 * Persisted approval request identifier.
 */
  approvalId: string
  /**
 * Tenant owning the decision.
 */
  tenantId: string
  /**
 * Final approved or rejected outcome; intermediate approvals have no receipt.
 */
  decision: 'approved' | 'rejected'
  /**
 * Authenticated deciding user.
 */
  actorId: string
  /**
 * Copied verified roles at decision time.
 */
  actorRoles: string[]
  /**
 * Stage producing the final outcome.
 */
  stageId: string
  /**
 * Parseable decision timestamp, generated as ISO UTC by the service.
 */
  decidedAt: string
  /**
 * Positive resulting request revision.
 */
  revision: number
  /**
 * Optional approved action binding hash copied from the bound request.
 */
  bindingHash?: string
  /**
 * Optional nonblank final comment, up to 4000 characters.
 */
  comment?: string
}
/**
 * Persisted approval state, stage assignments and append-only decision history.
 *
 * @see ApprovalService for a complete host integration example.
 */
export interface ApprovalDocument {
 /**
 * Host template selected at submission.
 */
  templateId: string;
/**
 * Nonblank request title, at most 1000 characters.
 */
  title: string;
/**
 * Host resource type being reviewed.
 */
  targetType: string;
/**
 * Host resource identifier being reviewed.
 */
  targetId: string;
/**
 * Authenticated original requester user ID.
 */
  requestedBy: string
 /**
 * Copied stage assignments, unaffected by later template edits.
 */
  stages: ApprovalStage[];
/**
 * Stored permission for requester approval, default false at submission.
 */
  allowSelfApproval: boolean;
/**
 * Zero-based current stage; equals stages.length after final approval.
 */
  currentStage: number
  /**
 * Optional host-verified action/proposal binding.
 */
  binding?: ApprovalBinding
  /**
 * Pending, final approved/rejected, or requester-withdrawn state.
 */
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn'
  /**
 * Final approved/rejected evidence; absent for pending and withdrawn requests.
 */
  decisionReceipt?: ApprovalDecisionReceipt
  /**
 * Ordered submitted/approved/rejected/withdrawn entries with actor/time and optional stage/comment.
 */
  history: {
/**
 * History transition: submitted, approved, rejected or withdrawn.
 */
  action: 'submitted' | 'approved' | 'rejected' | 'withdrawn';
/**
 * Authenticated user who performed this transition.
 */
  actorId: string;
/**
 * Stage acted upon; absent on submission/withdrawal.
 */
  stageId?: string;
/**
 * Optional decision comment.
 */
  comment?: string;
/**
 * ISO UTC transition timestamp.
 */
  at: string }[]
}
/**
 * Host-owned approval persistence, authorization and template/binding verification.
 *
 * @see ApprovalService for a complete host integration example.
 */
export interface ApprovalOptions {
  /**
 * Tenant-isolated durable approval record store with atomic compare-and-swap replace.
 */
  store: PluginRecordStore<ApprovalDocument>
  /**
 * Must check current lifecycle, membership and action/resource permission on every call; document is supplied when available.
 * @param principal - Verified tenant principal for this operation.
 * @param action - Requested plugin action to authorize against current state.
 * @param document - Current persisted approval document when available.
 * @returns True only when current host policy allows access; false denies access.
 * @throws Propagates host adapter or SDK failures; async methods reject their Promise.
 *
 * @remarks
 * Must check current lifecycle, membership and action/resource permission on EVERY call.
 *
 * @example
 * ```typescript
 * import type { ApprovalOptions, ApprovalDocument } from '@alneas/eaos-plugins/approval/service';
 * import type { PluginPrincipal } from '@alneas/eaos-server/plugin-data';
 * export function canReadApproval(options: ApprovalOptions, principal: PluginPrincipal, document: ApprovalDocument) {
 *  return options.authorize(principal, 'read', document);
 * }
 * ```
 */
  authorize(principal: PluginPrincipal, action: 'submit' | 'read' | 'decide' | 'withdraw', document?: ApprovalDocument): Promise<boolean>
  /**
 * Resolve a current authorized template for the principal and target; null makes submission unavailable.
 * @param principal - Verified tenant principal for this operation.
 * @param templateId - Host template key selected by the caller.
 * @param input - Operation input validated and authorized by the host.
 * @returns The authorized stage template, or null when unavailable.
 * @throws Propagates host adapter or SDK failures; async methods reject their Promise.
 *
 * @example
 * ```typescript
 * import type { ApprovalOptions } from '@alneas/eaos-plugins/approval/service';
 * import type { PluginPrincipal } from '@alneas/eaos-server/plugin-data';
 * export function resolveCurrentTemplate(options: ApprovalOptions, principal: PluginPrincipal, templateId: string, targetType: string, targetId: string) {
 *  return options.resolveTemplate(principal, templateId, { targetType, targetId }); // May resolve null.
 * }
 * ```
 */
resolveTemplate(principal: PluginPrincipal, templateId: string, input: { 
    /**
     * Host resource type being reviewed; resolve a template only for the principal's currently authorized target.
     */
    targetType: string; 
    /**
     * Exact host resource ID being reviewed; template selection must respect its current tenant/resource admission.
     */
    targetId: string }): Promise<ApprovalTemplate | null>
  /**
 * Required when submitting a bound request; verify input/contract hashes against the real host proposal/action and return true, rather than trusting request data.
 * @param principal - Verified tenant principal for this operation.
 * @param binding - Action binding to compare against the real host proposal/contract.
 * @returns True only when the real proposal/action matches the supplied binding.
 * @throws Propagates host adapter or SDK failures; async methods reject their Promise.
 *
 * @remarks
 * A request body cannot prove its own input/contract hash; the host verifies it against its proposal/action.
 *
 * @example
 * ```typescript
 * import type { ApprovalOptions } from '@alneas/eaos-plugins/approval/service';
 * import type { PluginPrincipal } from '@alneas/eaos-server/plugin-data';
 * export function verifyHostBinding(options: ApprovalOptions, principal: PluginPrincipal, binding: Parameters<NonNullable<ApprovalOptions['verifyBinding']>>[1]) {
 *  if (!options.verifyBinding) throw new Error('Host binding verification is required');
 *  return options.verifyBinding(principal, binding);
 * }
 * ```
 */
  verifyBinding?(principal: PluginPrincipal, binding: ApprovalBinding): Promise<boolean>
}

/**
 * Validates a final approval decision receipt and copies its accepted public fields.
 * @param value - Untrusted final approved/rejected receipt; requires positive revision, parseable time and nonblank bounded identifiers.
 * @returns A normalized receipt with a copied actorRoles array; unknown fields are omitted.
 * @throws Error for invalid shape, decision, roles, timing or bounded text fields.
 *
 * @remarks
 * This validates shape, not authenticity or host authorization. bindingHash is bounded text, not independently recomputed here.
 *
 * @example
 * ```typescript
 * import { validateApprovalDecisionReceipt } from '@alneas/eaos-plugins/approval/service';
 * const receipt = validateApprovalDecisionReceipt({ receiptId: 'receipt-1', approvalId: 'request-1', tenantId: 'sample', decision: 'approved', actorId: 'reviewer', actorRoles: ['reviewer'], stageId: 'review', decidedAt: '2026-01-01T00:00:00Z', revision: 2 });
 * ```
 */
export function validateApprovalDecisionReceipt(value: unknown): ApprovalDecisionReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid approval decision receipt')
  const source = value as Record<string, unknown>
  const text = (input: unknown, name: string, max = 512) => {
   if (typeof input !== 'string' || !input.trim() || input.length > max) throw new Error(`Invalid approval decision ${name}`)
   return input
  }
  if (!['approved', 'rejected'].includes(String(source.decision))) throw new Error('Invalid approval decision outcome')
  if (!Array.isArray(source.actorRoles) || source.actorRoles.some(role => typeof role !== 'string' || !role.trim() || role.length > 256)) throw new Error('Invalid approval decision roles')
  if (!Number.isSafeInteger(source.revision) || Number(source.revision) < 1 || !Number.isFinite(Date.parse(String(source.decidedAt)))) throw new Error('Invalid approval decision receipt timing')
  return {
   receiptId: text(source.receiptId, 'receipt id'),
   approvalId: text(source.approvalId, 'approval id'),
   tenantId: text(source.tenantId, 'tenant'),
   decision: source.decision as ApprovalDecisionReceipt['decision'],
   actorId: text(source.actorId, 'actor'),
   actorRoles: [...source.actorRoles] as string[],
   stageId: text(source.stageId, 'stage'),
   decidedAt: text(source.decidedAt, 'time', 64),
   revision: Number(source.revision),
   ...(source.bindingHash === undefined ? {} : { bindingHash: text(source.bindingHash, 'binding hash', 64) }),
   ...(source.comment === undefined ? {} : { comment: text(source.comment, 'comment', 4000) }),
  }
}
/**
 * Persists tenant-scoped staged approvals with live host authorization and optimistic revision checks.
 *
 * @remarks
 * Requires server runtime, canonical platform-records validation and a tenant-isolated durable store. No automatic retries or idempotency keys are added. Failed responses may follow committed writes; reload before retrying. Templates, role assignments and binding verification belong to the host.
 *
 * @example
 * ```typescript
 * import { ApprovalService, type ApprovalOptions } from '@alneas/eaos-plugins/approval/service';
 * export function connectApproval(options: ApprovalOptions) { return new ApprovalService(options); }
 * ```
 */
export class ApprovalService {
 /**
 * Wraps a host store with canonical approval document validation.
 * @param options - Live authorization/template callbacks and tenant-isolated store; optional binding verifier is mandatory for bound submissions.
 */
constructor(private readonly options: ApprovalOptions) { this.options = createValidatedRecordHost(options, getNamespaceDocumentContracts('platform-records', 'approval'));}
 private async allow(p: PluginPrincipal, action: Parameters<ApprovalOptions['authorize']>[1], doc?: ApprovalDocument) {
  assertPrincipal(p); if (!await this.options.authorize(p, action, doc)) throw new PluginError(403, 'Approval access denied')
 }
 /**
 * Creates a pending approval by copying the host-resolved stage template and recording its requester.
 * @param p - Verified current tenant principal.
 * @param input - Exactly templateId/title/targetType/targetId plus optional binding; title is limited to 1000 characters.
 * @returns The newly stored record with generated ID and revision 1.
 * @throws Rejects malformed input/template (400), denied authorization/binding (403), and host resolver/store failures.
 *
 * @remarks
 * A provided binding must match requester/tenant/target and pass verifyBinding. Templates contain 1–50 unique stages with user/role assignments; self approval defaults to false. Submission is not idempotent.
 *
 * @example
 * ```typescript
 * import { ApprovalService } from '@alneas/eaos-plugins/approval/service';
 * import type { PluginPrincipal } from '@alneas/eaos-server/plugin-data';
 * export function request(service: ApprovalService, principal: PluginPrincipal, templateId: string) { return service.submit(principal, { templateId, title: 'Review report', targetType: 'report', targetId: 'sample' }); }
 * ```
 */
async submit(p: PluginPrincipal, input: Record<string, unknown>): Promise<PluginRecord<ApprovalDocument>> {
  exactKeys(input, ['templateId', 'title', 'targetType', 'targetId', 'binding'])
  const templateId = textInput(input.templateId, 'template'), title = textInput(input.title, 'title', 1000), targetType = textInput(input.targetType, 'target type'), targetId = textInput(input.targetId, 'target')
  let binding: ApprovalBinding | undefined
  if (input.binding !== undefined) {
   try { binding = validateApprovalBinding(input.binding) } catch { throw new PluginError(400, 'Invalid approval binding') }
   if (binding.tenantId !== p.tenantId || binding.requestedBy !== p.userId || (binding.target && (binding.target.type !== targetType || binding.target.id !== targetId))) throw new PluginError(400, 'Approval binding does not match requester scope')
   if (!this.options.verifyBinding || await this.options.verifyBinding(structuredClone(p), structuredClone(binding)) !== true) throw new PluginError(403, 'Approval binding could not be verified by host')
  }
  await this.allow(p, 'submit')
  const resolved = await this.options.resolveTemplate(p, templateId, { targetId, targetType })
  if (!resolved || resolved.id !== templateId || !resolved.stages.length || resolved.stages.length > 50) throw new PluginError(400, 'Approval template unavailable')
  const template = structuredClone(resolved), ids = new Set<string>()
  for (const s of template.stages) {
   textInput(s.id, 'stage'); textInput(s.label, 'stage label')
   if (ids.has(s.id) || (!s.userIds?.length && !s.roles?.length) || [...s.userIds ?? [], ...s.roles ?? []].some(v => typeof v !== 'string' || !v.trim())) throw new PluginError(400, 'Invalid approval assignments')
   ids.add(s.id)
  }
  const record: PluginRecord<ApprovalDocument> = { id: randomUUID(), revision: 1, value: { templateId, title, targetType, targetId, requestedBy: p.userId, stages: template.stages, allowSelfApproval: template.allowSelfApproval === true, currentStage: 0, status: 'pending', ...(binding ? { binding } : {}), history: [{ action: 'submitted', actorId: p.userId, at: new Date().toISOString() }] } }
  await this.allow(p, 'submit', record.value)
  await this.options.store.create(p.tenantId, record); return record
 }
 /**
 * Reads one approval after both general and document-level authorization.
 * @param p - Verified current principal.
 * @param id - Nonblank approval record ID.
 * @returns The persisted approval record.
 * @throws Rejects missing record (404), denied access (403), invalid ID or propagated store/authorization failures.
 *
 * @example
 * ```typescript
 * import { ApprovalService } from '@alneas/eaos-plugins/approval/service';
 * import type { PluginPrincipal } from '@alneas/eaos-server/plugin-data';
 * export function read(service: ApprovalService, principal: PluginPrincipal, id: string) { return service.read(principal, id); }
 * ```
 */
async read(p: PluginPrincipal, id: string) {
  await this.allow(p, 'read'); const record = await this.options.store.read(p.tenantId, textInput(id, 'request'))
  if (!record) throw new PluginError(404, 'Approval not found')
  await this.allow(p, 'read', record.value); return record
 }
 /**
 * Lists approval records and filters out documents denied by live host authorization.
 * @param p - Verified current principal.
 * @param limit - Store list bound; defaults to 50 and is validated by the host store.
 * @returns Authorized records in store order, possibly empty or fewer than limit.
 * @throws Rejects denied general access or propagated store/authorization failures.
 *
 * @remarks
 * General read access is checked before and after filtering. This method does not expose pagination metadata.
 *
 * @example
 * ```typescript
 * import { ApprovalService } from '@alneas/eaos-plugins/approval/service';
 * import type { PluginPrincipal } from '@alneas/eaos-server/plugin-data';
 * export function list(service: ApprovalService, principal: PluginPrincipal) { return service.list(principal, 25); }
 * ```
 */
async list(p: PluginPrincipal, limit = 50) {
  await this.allow(p, 'read'); const records = await this.options.store.list(p.tenantId, limit), visible = []
  for (const record of records) if (await this.options.authorize(p, 'read', record.value)) visible.push(record)
  await this.allow(p, 'read'); return visible
 }
 /**
 * Applies one authorized current-stage decision and persists it with compare-and-swap.
 * @param p - Verified current principal.
 * @param id - Approval record ID.
 * @param input - Exactly positive revision, action approve/reject and optional nonblank comment up to 4000 characters.
 * @returns The next-revision record; final decisions include a validated decisionReceipt, intermediate approvals advance currentStage.
 * @throws Rejects invalid input (400), denied/self/unassigned decision (403), missing record (404), stale/finalized state or CAS conflict (409), and host failures.
 *
 * @remarks
 * Only assigned users/roles can decide; self approval requires template permission. A stale retry can conflict after a successful write.
 *
 * @example
 * ```typescript
 * import { ApprovalService } from '@alneas/eaos-plugins/approval/service';
 * import type { PluginPrincipal } from '@alneas/eaos-server/plugin-data';
 * export function approve(service: ApprovalService, principal: PluginPrincipal, id: string, revision: number) { return service.decide(principal, id, { revision, action: 'approve' }); }
 * ```
 */
async decide(p: PluginPrincipal, id: string, input: Record<string, unknown>) {
  exactKeys(input, ['revision', 'action', 'comment']); const expected = revisionInput(input.revision)
  if (!['approve', 'reject'].includes(String(input.action))) throw new PluginError(400, 'Invalid decision')
  const comment = input.comment === undefined ? undefined : textInput(input.comment, 'comment', 4000)
  await this.allow(p, 'decide'); const record = await this.options.store.read(p.tenantId, textInput(id, 'request'))
  if (!record) throw new PluginError(404, 'Approval not found')
  await this.allow(p, 'decide', record.value)
  const doc = structuredClone(record.value), stage = doc.stages[doc.currentStage]
  if (record.revision !== expected || doc.status !== 'pending' || !stage) throw new PluginError(409, 'Approval state changed')
  if ((!doc.allowSelfApproval && doc.requestedBy === p.userId) || (!stage.userIds?.includes(p.userId) && !stage.roles?.some(r => p.roles.includes(r)))) throw new PluginError(403, 'Not the current approver')
  doc.history.push({ action: input.action === 'approve' ? 'approved' : 'rejected', actorId: p.userId, stageId: stage.id, ...(comment ? { comment } : {}), at: new Date().toISOString() })
  if (input.action === 'reject') doc.status = 'rejected'
  else { doc.currentStage++; if (doc.currentStage === doc.stages.length) doc.status = 'approved' }
  const nextRevision = expected + 1
  if (doc.status !== 'pending') {
   doc.decisionReceipt = validateApprovalDecisionReceipt({
    receiptId: randomUUID(), approvalId: record.id, tenantId: p.tenantId, decision: doc.status, actorId: p.userId,
    actorRoles: [...p.roles], stageId: stage.id, decidedAt: new Date().toISOString(), revision: nextRevision,
    ...(doc.binding ? { bindingHash: doc.binding.bindingHash } : {}), ...(comment ? { comment } : {}),
   })
  }
  return this.save(p, record.id, expected, doc)
 }
 /**
 * Withdraws a pending request only for its original requester and expected revision.
 * @param p - Verified requester principal.
 * @param id - Approval record ID.
 * @param expected - Positive persisted revision to compare-and-swap.
 * @returns The next-revision record with withdrawn status and a history entry.
 * @throws Rejects invalid revision, denied/nonrequester access (403), missing record (404), changed/finalized state or CAS conflict (409), and host failures.
 *
 * @example
 * ```typescript
 * import { ApprovalService } from '@alneas/eaos-plugins/approval/service';
 * import type { PluginPrincipal } from '@alneas/eaos-server/plugin-data';
 * export function withdraw(service: ApprovalService, principal: PluginPrincipal, id: string, revision: number) { return service.withdraw(principal, id, revision); }
 * ```
 */
async withdraw(p: PluginPrincipal, id: string, expected: number) {
  revisionInput(expected); await this.allow(p, 'withdraw')
  const record = await this.options.store.read(p.tenantId, textInput(id, 'request'))
  if (!record) throw new PluginError(404, 'Approval not found')
  await this.allow(p, 'withdraw', record.value)
  if (record.value.requestedBy !== p.userId) throw new PluginError(403, 'Only the requester may withdraw')
  if (record.revision !== expected || record.value.status !== 'pending') throw new PluginError(409, 'Approval state changed')
  const doc = structuredClone(record.value); doc.status = 'withdrawn'; doc.history.push({ action: 'withdrawn', actorId: p.userId, at: new Date().toISOString() })
  return this.save(p, id, expected, doc)
 }
 private async save(p: PluginPrincipal, id: string, expected: number, value: ApprovalDocument) {
  const record = { id, revision: expected + 1, value }
  if (!await this.options.store.replace(p.tenantId, record, expected)) throw new PluginError(409, 'Approval state changed')
  return record
 }
}
