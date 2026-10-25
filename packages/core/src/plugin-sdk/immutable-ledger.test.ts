import { describe, expect, it } from 'bun:test'
import * as ledger from './immutable-ledger'
import { assertBalancedLines, invertJournalLines, type ImmutableLedgerLine } from './immutable-ledger'

const lines: ImmutableLedgerLine[] = [
  { accountId: 'acc-debit', side: 'D', amount: 1200 },
  { accountId: 'acc-credit', side: 'C', amount: 1200 },
]

describe('Ledger pure helpers', () => {
  it('does not implement posting or reversal lifecycle commands', () => {
    expect('assertImmutableTransition' in ledger).toBe(false)
    expect('createReversingEntry' in ledger).toBe(false)
  })
  it('balances lines and rejects unequal or invalid minor-unit amounts', () => {
    expect(() => assertBalancedLines(lines)).not.toThrow()
    expect(() => assertBalancedLines([lines[0], { ...lines[1], amount: 1199 }])).toThrow('not balanced')
    for (const amount of [0, -1, 1.1, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => assertBalancedLines(lines.map(line => ({ ...line, amount })))).toThrow()
    }
  })
  it('inverts sides without mutating input or assigning posting state', () => {
    const before = structuredClone(lines)
    const inverted = invertJournalLines(lines)
    expect(inverted).toEqual([{ ...lines[0], side: 'C' }, { ...lines[1], side: 'D' }])
    expect(lines).toEqual(before)
    expect(invertJournalLines(inverted)).toEqual(lines)
    expect(() => invertJournalLines([lines[0]])).toThrow()
  })
  it('compares totals exactly near safe integer bounds', () => {
    expect(() => assertBalancedLines([
      { ...lines[0], amount: Number.MAX_SAFE_INTEGER },
      { ...lines[1], amount: Number.MAX_SAFE_INTEGER - 1 },
    ])).toThrow('not balanced')
  })
})
