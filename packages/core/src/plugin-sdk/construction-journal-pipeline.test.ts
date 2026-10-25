import { describe, expect, it } from 'bun:test'
import * as pipeline from './construction-journal-pipeline'
import { generateJournalDraftFromDocument } from './journal-draft'
import type { ParsedDocumentResult } from '../ai/document-parser'

const parsedDoc: ParsedDocumentResult = {
  name: 'source.pdf', markdown: 'Date: 2026-10-24',
  tables: [{ headers: ['項目', '数量', '単価', '金額'], rows: [['Service A', '2', '100', '200'], ['Service B', '1', '300', '300']] }],
}

describe('Generic journal draft pipeline', () => {
  it('exposes no construction account resolver', () => {
    expect('generateConstructionJournalDraft' in pipeline).toBe(false)
  })
  it('creates a balanced unposted draft using host account mapping', () => {
    const result = generateJournalDraftFromDocument({
      tenantId: 'tenant-demo', periodId: 'period-1', parsedDoc,
      mapping: { debitAccountId: 'acc-debit', creditAccountId: 'acc-credit' }, createdBy: 'actor-1',
    })
    expect(result.draftEntry.status).toBe('DRAFT')
    expect(result.draftEntry.createdBy).toBe('actor-1')
    expect(result.draftEntry.lines).toEqual([
      { accountId: 'acc-debit', side: 'D', amount: 500 }, { accountId: 'acc-credit', side: 'C', amount: 500 },
    ])
    expect(result.draftEntry.date).toBe('2026-10-24')
    expect(result.uiDraft.values.lines).toEqual(result.draftEntry.lines)
    expect(result.uiDraft.simulation?.metrics[0].label).toBe('借方合計')
    expect(result.uiDraft.simulation?.metrics.map(metric => metric.after)).toEqual([500, 0])
    expect(result.uiDraft.summary).not.toMatch(/[¥￥]/u)
  })
  it('delegates account selection to an injected resolver and context', () => {
    const result = generateJournalDraftFromDocument({
      tenantId: 'tenant-demo', periodId: 'period-1', parsedDoc, createdBy: 'actor-1',
      context: { debit: 'acc-host-choice' },
      mapping: context => ({ debitAccountId: context.debit, creditAccountId: 'acc-credit' }),
    })
    expect(result.draftEntry.lines[0].accountId).toBe('acc-host-choice')
  })
  it('rejects a table with only a unit-price amount column', () => {
    expect(() => generateJournalDraftFromDocument({
      tenantId: 'tenant-demo', periodId: 'period-1', createdBy: 'actor-1',
      parsedDoc: { ...parsedDoc, tables: [{ headers: ['項目', '数量', '単価金額'], rows: [['Service', '2', '100']] }] },
      mapping: { debitAccountId: 'acc-debit', creditAccountId: 'acc-credit' },
    })).toThrow('No valid billable line items')
  })
  it('rejects documents without positive whole minor-unit line amounts', () => {
    expect(() => generateJournalDraftFromDocument({
      tenantId: 'tenant-demo', periodId: 'period-1', createdBy: 'actor-1',
      parsedDoc: { ...parsedDoc, tables: [] }, mapping: { debitAccountId: 'acc-debit', creditAccountId: 'acc-credit' },
    })).toThrow('No valid billable line items')
  })
})
