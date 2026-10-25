import { describe, expect, it } from 'bun:test'
import {
  createProvenanceAuditedRecord,
  verifyFieldCitation,
  type SourceEvidenceCitation,
} from './evidence-traceability'

describe('Evidence Traceability & PDF BoundingBox Pinning', () => {
  const sampleCitation: SourceEvidenceCitation = {
    id: 'cite-001',
    documentId: 'doc-invoice-20261024',
    documentTitle: '足場工事請書_丸の内現場.pdf',
    pageNumber: 1,
    boundingBox: { page: 1, x: 120, y: 350, width: 180, height: 24 },
    rawText: '¥350,000 (消費税込)',
    extractedAt: '2026-10-24T12:00:00Z',
    confidence: 'high',
  }

  it('pins structured draft fields directly to exact PDF coordinates and raw text', () => {
    const record = {
      id: 'journal-draft-99',
      date: '2026-10-24',
      amount: 350000,
      description: '足場工事費用',
    }

    const audited = createProvenanceAuditedRecord(record, 'tenant-tokyo', {
      amount: sampleCitation,
    })

    expect(audited.tenantId).toBe('tenant-tokyo')
    expect(audited.auditSummary.totalFieldsWithEvidence).toBe(1)
    expect(audited.auditSummary.primaryDocumentId).toBe('doc-invoice-20261024')
    expect(audited.evidence.amount.boundingBox.y).toBe(350)
  })

  it('verifies cited raw text against parsed numeric value accurately', () => {
    const matchResult = verifyFieldCitation(350000, sampleCitation)
    expect(matchResult.matched).toBe(true)

    const mismatchCitation: SourceEvidenceCitation = {
      ...sampleCitation,
      rawText: '¥180,000',
    }
    const failResult = verifyFieldCitation(350000, mismatchCitation)
    expect(failResult.matched).toBe(false)
    expect(failResult.note).toContain('does not contain')
  })

  it('rejects partial numeric matches that alter magnitude (e.g. 350,000 vs 3,500,000)', () => {
    const wrongMagnitudeCitation: SourceEvidenceCitation = {
      ...sampleCitation,
      rawText: '合計 ¥3,500,000 (消費税込)',
    }
    const result = verifyFieldCitation(350000, wrongMagnitudeCitation)
    expect(result.matched).toBe(false)
  })

  it('rejects sign and decimal mismatches (e.g. 350000 vs -350000 or 350000.50)', () => {
    const negativeCitation: SourceEvidenceCitation = {
      ...sampleCitation,
      rawText: '返金控除: ¥-350,000',
    }
    expect(verifyFieldCitation(350000, negativeCitation).matched).toBe(false)
    expect(verifyFieldCitation(-350000, negativeCitation).matched).toBe(true)

    const decimalCitation: SourceEvidenceCitation = {
      ...sampleCitation,
      rawText: '精算額: ¥350,000.50',
    }
    expect(verifyFieldCitation(350000, decimalCitation).matched).toBe(false)
    expect(verifyFieldCitation(350000.5, decimalCitation).matched).toBe(true)
  })

  it('matches every complete numeric token when adjacent tokens share delimiters', () => {
    const citation = { ...sampleCitation, rawText: '100/200/300' }
    for (const amount of [100, 200, 300]) {
      expect(verifyFieldCitation(amount, citation).matched).toBe(true)
    }
    expect(verifyFieldCitation(20, citation).matched).toBe(false)
    expect(verifyFieldCitation(350000, { ...citation, rawText: '100/-350000' }).matched).toBe(false)
  })

  it('preserves whitespace boundaries for text and rejects partial names', () => {
    const citation = { ...sampleCitation, rawText: 'Vendor Acme Services' }
    expect(verifyFieldCitation('Acme', citation).matched).toBe(true)
    expect(verifyFieldCitation('Acme Services', citation).matched).toBe(true)
    expect(verifyFieldCitation('Ac', citation).matched).toBe(false)
    expect(verifyFieldCitation('Acme', { ...citation, rawText: 'Vendor AcmeCorp' }).matched).toBe(false)
  })

  it('rejects empty strings or empty fields gracefully without false positives', () => {
    const emptyCitation: SourceEvidenceCitation = {
      ...sampleCitation,
      rawText: '',
    }
    expect(verifyFieldCitation(350000, emptyCitation).matched).toBe(false)
    expect(verifyFieldCitation('', sampleCitation).matched).toBe(false)
  })
})
