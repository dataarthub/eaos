import { expect, test } from 'bun:test'
import { createStructuredDraftProposal, createStructuredDraftUIDocument } from '../src/ai/proposal-ui'

test('shared AI draft helpers produce reviewable proposal and bounded UI document', () => {
  const draft = { title: '候補', data: { score: 0.8 } }
  const proposal = createStructuredDraftProposal('estate-leads', 'lead-1', draft, '2026-01-01T00:00:00.000Z')
  expect(proposal.changes).toHaveLength(2)
  const document = createStructuredDraftUIDocument('estate-leads', draft)
  expect(document.blocks[0]?.type).toBe('estate-leads-summary')
})
