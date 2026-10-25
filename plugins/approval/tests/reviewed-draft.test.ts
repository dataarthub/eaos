import { test, expect } from 'bun:test'
import { createStructuredDraftProposal, type AiDraftSubmission } from '@alneas/eaos-core/ai/proposal-ui'
import { approvalBindingMatches, type ApprovalBinding, type ExecutionContract } from '@alneas/eaos-core'
import type { PluginPrincipal, PluginRecord, PluginRecordStore } from '@alneas/eaos-server/plugin-data'
import { ApprovalService, type ApprovalDocument } from '../src/service'
import { createReviewedDraftHandler } from '../src/reviewed-draft'

const requester: PluginPrincipal = { tenantId: 'alpha', userId: 'author', roles: ['member'] }
const reviewer: PluginPrincipal = { tenantId: 'alpha', userId: 'reviewer', roles: ['reviewer'] }
function fixture() {
 // Workflow fixture only; durable transactions, CAS and idempotency belong to the host command/store.
 const events: string[] = []
 const rows = new Map<string, PluginRecord<ApprovalDocument>>()
 const key = (tenant: string, id: string) => `${tenant}:${id}`
 const store: PluginRecordStore<ApprovalDocument> = {
  async create(tenant, record) { events.push('approval'); rows.set(key(tenant, record.id), structuredClone(record)) },
  async read(tenant, id) { return structuredClone(rows.get(key(tenant, id)) ?? null) },
  async list(tenant, limit) { return [...rows].filter(([id]) => id.startsWith(`${tenant}:`)).map(([, row]) => structuredClone(row)).slice(0, limit) },
  async replace(tenant, record, expected) { const id = key(tenant, record.id); if (rows.get(id)?.revision !== expected) return false; rows.set(id, structuredClone(record)); return true },
 }
 let saved: ApprovalBinding | undefined
 let contract: ExecutionContract = { operation: 'notes.save', version: '1', permission: 'notes.write', sideEffect: 'write', riskLevel: 'high', approvalLevel: 'L2_LEAD', inputSchema: { type: 'object' } }
 let authorized = true, writes = 0, resolves = 0
 const completed = new Map<string, string>()
 const approval = new ApprovalService({ store, authorize: async () => true, resolveTemplate: async () => ({ id: 'review', stages: [{ id: 'review', label: 'Review', roles: ['reviewer'] }] }), verifyBinding: async (_p, binding) => Boolean(saved && approvalBindingMatches(binding, saved)) })
 const handler = createReviewedDraftHandler({ approval, templateId: 'review', resolveContract: async () => { resolves++; if (!authorized) throw new Error('Host access denied'); return structuredClone(contract) }, saveProposal: async (_p, _proposal, binding) => { saved = binding; events.push('proposal') }, execute: async (_p, _operation, _input, approvalId) => { if (!completed.has(approvalId)) { writes++; completed.set(approvalId, 'saved') }; return completed.get(approvalId)! } })
 const input = { id: 'note-1', revision: 2, title: 'Proposed' }
 const proposal = { ...createStructuredDraftProposal('notes', 'note-1', { title: 'Review note', data: input }, '2026-10-24T00:00:00Z'), baseVersion: 2 }
 const submission: AiDraftSubmission = { scope: 'notes', operation: 'notes.save', input, proposal, target: { type: 'notes', id: 'note-1', revision: 2 } }
 return { handler, approval, submission, rows, events, get writes() { return writes }, get resolves() { return resolves }, changeContract() { contract.version = '2' }, removeStoredProposal() { saved = undefined }, revoke() { authorized = false } }
}
async function submit(f: ReturnType<typeof fixture>) {
 const result = await f.handler(requester, f.submission)
 expect(result.status).toBe('pending')
 if (result.status !== 'pending') throw new Error('Expected pending')
 return { ...f.submission, approvalRequestId: result.approvalRequestId }
}
test('persists a proposal and real pending approval before any domain write; approved command owns retry idempotency', async () => {
 const f = fixture(), bound = await submit(f)
 expect(f.events).toEqual(['proposal', 'approval']); expect(f.writes).toBe(0)
 expect((await f.approval.read(requester, bound.approvalRequestId!)).value.binding?.requestedBy).toBe('author')
 await expect(f.handler(requester, bound)).rejects.toThrow('approved')
 await expect(f.approval.decide(requester, bound.approvalRequestId!, { revision: 1, action: 'approve' })).rejects.toThrow()
 expect(f.writes).toBe(0)
 await f.approval.decide(reviewer, bound.approvalRequestId!, { revision: 1, action: 'approve' })
 expect(await f.handler(requester, bound)).toEqual({ status: 'applied', result: 'saved' })
 expect(await f.handler(requester, bound)).toEqual({ status: 'applied', result: 'saved' })
 expect(f.writes).toBe(1); expect(f.resolves).toBe(4)
})
test('rejected approvals and foreign principals cannot invoke domain writes', async () => {
 const f = fixture(), bound = await submit(f)
 await f.approval.decide(reviewer, bound.approvalRequestId!, { revision: 1, action: 'reject' })
 await expect(f.handler(requester, bound)).rejects.toThrow()
 await expect(f.handler({ ...requester, tenantId: 'beta' }, bound)).rejects.toThrow()
 await expect(f.handler(reviewer, bound)).rejects.toThrow()
 expect(f.writes).toBe(0)
})
test('approved input, target revision and live policy are immutable review boundaries', async () => {
 const f = fixture(), bound = await submit(f)
 await f.approval.decide(reviewer, bound.approvalRequestId!, { revision: 1, action: 'approve' })
 const input = { ...bound.input, title: 'Changed' }
 const proposal = { ...bound.proposal, changes: bound.proposal.changes.map(change => change.field === 'data' ? { ...change, after: JSON.stringify(input) } : change) }
 await expect(f.handler(requester, { ...bound, input, proposal })).rejects.toThrow()
 await expect(f.handler(requester, { ...bound, target: { ...bound.target!, revision: 3 } })).rejects.toThrow()
 f.changeContract(); await expect(f.handler(requester, bound)).rejects.toThrow()
 f.revoke(); await expect(f.handler(requester, bound)).rejects.toThrow('Host access denied')
 expect(f.writes).toBe(0)
})
test('invalid proposal envelopes cannot create approvals or save proposals', async () => {
 const f = fixture()
 for (const submission of [
  { ...f.submission, input: { ...f.submission.input, title: 'hidden change' } },
  { ...f.submission, scope: 'other' },
  { ...f.submission, operation: 'notes.delete' },
  { ...f.submission, proposal: { ...f.submission.proposal, baseVersion: 1 } },
  { ...f.submission, input: { ...f.submission.input, id: 'other' } },
 ]) await expect(f.handler(requester, submission)).rejects.toThrow()
 expect(f.events).toEqual([]); expect(f.rows.size).toBe(0); expect(f.writes).toBe(0)
})
test('approved receipt identity must match tenant, request, binding and final revision', async () => {
 for (const field of ['approvalId', 'tenantId', 'bindingHash', 'revision', 'decision'] as const) {
  const f = fixture(), bound = await submit(f)
  await f.approval.decide(reviewer, bound.approvalRequestId!, { revision: 1, action: 'approve' })
  const row = f.rows.get(`alpha:${bound.approvalRequestId}`)!
  Object.assign(row.value.decisionReceipt!, { [field]: field === 'revision' ? 99 : field === 'decision' ? 'rejected' : 'wrong' })
  await expect(f.handler(requester, bound)).rejects.toThrow()
  expect(f.writes).toBe(0)
 }
})

test('creation drafts without a resource revision bind a local command target and require review', async () => {
 const f = fixture(), input = { title: 'New note', commandId: 'command-1' }
 const proposal = createStructuredDraftProposal('notes', 'command-1', { title: 'Create note', data: input }, '2026-10-24T00:00:00Z')
 const submission = { scope: 'notes', operation: 'notes.save', input, proposal }
 const result = await f.handler(requester, submission)
 if (result.status !== 'pending') throw new Error('Expected pending')
 const request = await f.approval.read(requester, result.approvalRequestId)
 expect(request.value.targetId).toBe('command-1'); expect(f.writes).toBe(0)
 await f.approval.decide(reviewer, result.approvalRequestId, { revision: 1, action: 'approve' })
 expect(await f.handler(requester, { ...submission, approvalRequestId: result.approvalRequestId })).toEqual({ status: 'applied', result: 'saved' })
 expect(f.writes).toBe(1)
})

test('matching JSON cannot override the envelope resource identity or revision', async () => {
 for (const changed of [{ id: 'another-note' }, { revision: 5 }]) {
  const f = fixture(), input = { ...f.submission.input, ...changed }
  const proposal = { ...f.submission.proposal, changes: f.submission.proposal.changes.map(change => change.field === 'data' ? { ...change, after: JSON.stringify(input) } : change) }
  await expect(f.handler(requester, { ...f.submission, input, proposal })).rejects.toThrow()
  expect(f.events).toEqual([]); expect(f.rows.size).toBe(0); expect(f.writes).toBe(0)
 }
})

test('approved requests still require the durable host proposal to verify at execution time', async () => {
 const f = fixture(), bound = await submit(f)
 await f.approval.decide(reviewer, bound.approvalRequestId!, { revision: 1, action: 'approve' })
 f.removeStoredProposal()
 await expect(f.handler(requester, bound)).rejects.toThrow()
 expect(f.writes).toBe(0)
})
