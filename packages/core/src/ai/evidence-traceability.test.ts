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
    expect(failResult.note).toContain('did not match')
  })
})
