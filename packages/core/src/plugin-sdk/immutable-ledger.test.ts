import { describe, expect, it } from 'bun:test'
import {
  assertBalancedLines,
  assertImmutableTransition,
  createReversingEntry,
  type ImmutableLedgerEntry,
} from './immutable-ledger'

describe('ImmutableLedger contract & rules', () => {
  it('validates double-entry balancing (貸借一致)', () => {
    // Balanced
    expect(() =>
      assertBalancedLines([
        { accountId: 'acc-1', side: 'D', amount: 1000 },
        { accountId: 'acc-2', side: 'C', amount: 1000 },
      ])
    ).not.toThrow()

    // Unbalanced
    expect(() =>
      assertBalancedLines([
        { accountId: 'acc-1', side: 'D', amount: 1000 },
        { accountId: 'acc-2', side: 'C', amount: 900 },
      ])
    ).toThrow('Debit sum must equal Credit sum')

    // Invalid non-positive amount
    expect(() =>
      assertBalancedLines([
        { accountId: 'acc-1', side: 'D', amount: 0 },
        { accountId: 'acc-2', side: 'C', amount: 0 },
      ])
    ).toThrow()
  })

  it('enforces immutable state transitions and forbids direct mutation of POSTED entries', () => {
    // Allowed transitions
    expect(() => assertImmutableTransition('DRAFT', 'PENDING')).not.toThrow()
    expect(() => assertImmutableTransition('DRAFT', 'POSTED')).not.toThrow()
    expect(() => assertImmutableTransition('PENDING', 'POSTED')).not.toThrow()
    expect(() => assertImmutableTransition('POSTED', 'REVERSED')).not.toThrow()

    // Forbidden mutation on POSTED entry
    expect(() => assertImmutableTransition('POSTED', 'DRAFT')).toThrow('immutable')
    expect(() => assertImmutableTransition('POSTED', 'PENDING')).toThrow('immutable')

    // Finalized REVERSED entry cannot transition further
    expect(() => assertImmutableTransition('REVERSED', 'POSTED')).toThrow('finalized')
  })

  it('creates an exact reversing entry (赤伝票) with inverted sides and audit provenance', () => {
    const original: ImmutableLedgerEntry = {
      id: 'journal-101',
      tenantId: 'tenant-demo',
      periodId: 'period-2026-10',
      date: '2026-10-20',
      description: 'Consulting services fee',
      sourceKey: 'inv-999',
      lines: [
        { accountId: 'acc-receivable', side: 'D', amount: 55000 },
        { accountId: 'acc-revenue', side: 'C', amount: 50000 },
        { accountId: 'acc-tax', side: 'C', amount: 5000 },
      ],
      status: 'POSTED',
      provenance: {
        createdBy: 'ai-agent',
        riskLevel: 2,
        aiGenerated: true,
      },
    }

    const reversing = createReversingEntry(original, '2026-10-24', 'operator-auditor', 'Erroneous invoice cancellation')

    expect(reversing.reversesEntryId).toBe('journal-101')
    expect(reversing.status).toBe('POSTED')
    expect(reversing.lines).toEqual([
      { accountId: 'acc-receivable', side: 'C', amount: 55000 },
      { accountId: 'acc-revenue', side: 'D', amount: 50000 },
      { accountId: 'acc-tax', side: 'D', amount: 5000 },
    ])
    expect(reversing.provenance.riskLevel).toBe(3)
    expect(reversing.provenance.createdBy).toBe('operator-auditor')
  })

  it('rejects unbalanced lines even when amounts approach or exceed MAX_SAFE_INTEGER bounds', () => {
    const maxSafe = Number.MAX_SAFE_INTEGER
    const lines = [
      { accountId: 'acc-debit', side: 'D' as const, amount: maxSafe },
      { accountId: 'acc-credit', side: 'C' as const, amount: maxSafe - 1 },
    ]
    expect(() => assertBalancedLines(lines)).toThrow('Journal lines are not balanced')
  })
})
