import { describe, expect, it } from 'bun:test'
import { createWorkflowEffectReceipt, createWorkflowEffectRequest, validateWorkflowEffectReceipt } from './workflow-effects'

describe('workflow effect receipts', () => {
  it('binds a provider result to the exact admitted request', () => {
    const request = createWorkflowEffectRequest({ tenantId: 't1', workflowId: 'wf-1', operation: 'publish', idempotencyKey: 'wf-1:publish', input: { revision: 3 } })
    const receipt = validateWorkflowEffectReceipt(request, { schemaVersion: '1', tenantId: 't1', workflowId: 'wf-1', operation: 'publish', idempotencyKey: 'wf-1:publish', inputHash: request.inputHash, adapterId: 'provider', receiptId: 'r-1', outcome: 'succeeded', occurredAt: '2026-09-21T00:00:00.000Z' })
    expect(receipt.outcome).toBe('succeeded')
    expect(() => validateWorkflowEffectReceipt(request, { ...receipt, inputHash: '0'.repeat(64) })).toThrow('does not match')
  })

  it('constructs receipts from the admitted request and rejects malformed metadata', () => {
    const receipt = createWorkflowEffectReceipt({
      request: { tenantId: 't1', workflowId: 'wf-1', operation: 'publish', idempotencyKey: 'wf-1:publish', input: { revision: 3 } },
      adapterId: 'cms-host',
      receiptId: 'receipt-1',
      outcome: 'unknown',
      occurredAt: new Date('2026-09-21T00:00:00.000Z'),
      metadata: { attempt: 1 },
    })
    expect(receipt.inputHash).toMatch(/^[a-f0-9]{64}$/)
    expect(receipt.outcome).toBe('unknown')
    expect(() => validateWorkflowEffectReceipt({ tenantId: 't1', workflowId: 'wf-1', operation: 'publish', idempotencyKey: 'wf-1:publish', input: { revision: 3 } }, { ...receipt, metadata: 'forged' })).toThrow('metadata')
  })
})
