import { describe, expect, it } from 'bun:test'
import {
  validateHybridDocument,
  type HybridDocument,
} from './hybrid-document'

describe('Hybrid Block Document (Unstructured Text + Immutable ERP Ledger Block)', () => {
  it('validates a combined document with markdown meeting notes and balanced financial ledger block', () => {
    const doc: HybridDocument = {
      id: 'doc-hybrid-001',
      tenantId: 'tenant-demo',
      title: '第3四半期 工事進捗会議及び変更見積',
      createdAt: '2026-10-24T10:00:00Z',
      updatedAt: '2026-10-24T10:00:00Z',
      blocks: [
        {
          id: 'blk-01',
          type: 'markdown',
          title: '会議メモ',
          content: '## 本日の協議事項\n- 施主よりエントランスホールのタイル仕様変更依頼を受領。\n- 追加工事費用 2,200,000円（税込）で合意。',
        },
        {
          id: 'blk-02',
          type: 'attachment',
          fileName: 'タイル変更見積書.pdf',
          fileUrl: 'https://storage.eaos.internal/tenants/demo/estimates/20261024.pdf',
          mimeType: 'application/pdf',
        },
        {
          id: 'blk-03',
          type: 'erp_record_table',
          title: '追加仕訳伝票',
          entitySchema: 'accounting_journal',
          records: [
            {
              id: 'entry-tile-01',
              tenantId: 'tenant-demo',
              sourceKey: 'doc:doc-hybrid-001:blk-03',
              date: '2026-10-24',
              description: 'エントランスタイル変更追加工事',
              status: 'DRAFT',
              periodId: 'period-1',
              createdBy: 'actor-1',
              provenance: { createdBy: 'actor-1', riskLevel: 2, aiGenerated: true },
              lines: [
                { accountId: 'acc-receivable', side: 'D', amount: 2200000 },
                { accountId: 'acc-sales', side: 'C', amount: 2000000 },
                { accountId: 'acc-tax-payable', side: 'C', amount: 200000 },
              ],
            },
          ],
        },
      ],
    }

    const result = validateHybridDocument(doc)
    expect(result.valid).toBe(true)
    expect(result.errors.length).toBe(0)
    expect(result.verifiedBlocksCount).toBe(3)
  })

  it('rejects a document if the embedded ERP ledger block violates double-entry equality', () => {
    const invalidDoc: HybridDocument = {
      id: 'doc-hybrid-invalid',
      tenantId: 'tenant-demo',
      title: '貸借不一致の伝票を含むドキュメント',
      createdAt: '2026-10-24T10:00:00Z',
      updatedAt: '2026-10-24T10:00:00Z',
      blocks: [
        {
          id: 'blk-memo',
          type: 'markdown',
          content: 'メモ部分',
        },
        {
          id: 'blk-ledger-bad',
          type: 'erp_record_table',
          entitySchema: 'accounting_journal',
          records: [
            {
              id: 'entry-unbalanced',
              tenantId: 'tenant-demo',
              sourceKey: 'test',
              date: '2026-10-24',
              description: '不一致仕訳',
              status: 'DRAFT',
              periodId: 'period-1',
              createdBy: 'actor-1',
              provenance: { createdBy: 'actor-1', riskLevel: 2, aiGenerated: true },
              lines: [
                { accountId: 'acc-debit', side: 'D', amount: 100000 },
                { accountId: 'acc-credit', side: 'C', amount: 99999 }, // 1円不一致！
              ],
            },
          ],
        },
      ],
    }

    const result = validateHybridDocument(invalidDoc)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBe(1)
    expect(result.errors[0]).toContain('failed ledger balancing')
  })
})

const minimalDocument = {
  id: 'doc-1', tenantId: 'tenant-demo', title: 'Memo',
  createdAt: '2026-10-24T00:00:00Z', updatedAt: '2026-10-24T00:00:00Z',
  blocks: [{ id: 'block-1', type: 'markdown' as const, content: '# Memo' }],
}

describe('Hybrid document JSON boundary', () => {
  it('rejects malformed root values and block containers without throwing', () => {
    const invalidInputs = [null, undefined, [], {}, { ...minimalDocument, blocks: null },
      { ...minimalDocument, blocks: {} }, { ...minimalDocument, blocks: [null] }]
    for (const input of invalidInputs) {
      const result = validateHybridDocument(input)
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.verifiedBlocksCount).toBe(0)
    }
  })
  it('rejects unknown discriminators and invalid block field types without coercion', () => {
    const invalidBlocks = [
      { id: 'block-1', type: 'unknown', content: 'Memo' },
      { id: 'block-1', type: 'markdown', content: 123 },
      { id: 'block-1', type: 'attachment', fileUrl: 123, mimeType: 'text/plain', fileName: 'memo.txt' },
      { id: 'block-1', type: 'erp_record_table', entitySchema: 'journal', records: [null] },
    ]
    for (const block of invalidBlocks) {
      const input = { ...minimalDocument, blocks: [block] }
      const before = structuredClone(input)
      expect(validateHybridDocument(input).valid).toBe(false)
      expect(input).toEqual(before)
    }
  })
  it('rejects duplicate block identities', () => {
    const result = validateHybridDocument({ ...minimalDocument, blocks: [...minimalDocument.blocks, ...minimalDocument.blocks] })
    expect(result.valid).toBe(false)
    expect(result.errors.some(error => error.includes('Duplicate block id'))).toBe(true)
  })
  it('rejects a balanced ledger entry belonging to another tenant', () => {
    const result = validateHybridDocument({ ...minimalDocument, blocks: [{
      id: 'ledger-1', type: 'erp_record_table', entitySchema: 'journal', records: [{
        id: 'entry-1', tenantId: 'foreign-tenant', periodId: 'period-1', date: '2026-10-24',
        description: 'Memo', sourceKey: 'memo-1', createdBy: 'actor-1', status: 'DRAFT',
        provenance: { createdBy: 'actor-1', riskLevel: 2, aiGenerated: false },
        lines: [{ accountId: 'account-debit', side: 'D', amount: 100 }, { accountId: 'account-credit', side: 'C', amount: 100 }],
      }],
    }] })
    expect(result.valid).toBe(false)
    expect(result.errors.some(error => error.includes('tenant'))).toBe(true)
  })
  it('preserves valid document inputs without coercion or removing extension metadata', () => {
    const input = { ...minimalDocument, metadata: { source: 'host' } }
    const before = structuredClone(input)
    expect(validateHybridDocument(input).valid).toBe(true)
    expect(input).toEqual(before)
  })
})
