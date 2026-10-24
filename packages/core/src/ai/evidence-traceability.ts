import type { SourceBoundingBox } from './governance'

/**
 * An immutable citation pinning a structured data field to an exact region on a source artifact.
 */
export interface SourceEvidenceCitation {
  /** Unique ID of the citation */
  id: string
  /** Reference to the source document (e.g. storage URL or document ID) */
  documentId: string
  /** Human-readable document name (e.g. '20261024_足場工事請求書.pdf') */
  documentTitle: string
  /** Page number where the evidence is located (1-based) */
  pageNumber: number
  /** Visual bounding coordinates (normalized 0..1 or PDF points) */
  boundingBox: SourceBoundingBox
  /** Extracted raw text snippet at this location */
  rawText: string
  /** Ingestion / parse timestamp */
  extractedAt: string
  /** Confidence score of the OCR / layout parse */
  confidence: 'high' | 'medium' | 'low'
}

/**
 * Map of field name or line ID to its pinned source evidence.
 */
export type RecordEvidenceMap = Record<string, SourceEvidenceCitation>

/**
 * Container tying an ERP record or draft to its full evidence audit trail.
 */
export interface ProvenanceAuditedRecord<T = Record<string, unknown>> {
  record: T
  tenantId: string
  evidence: RecordEvidenceMap
  auditSummary: {
    totalFieldsWithEvidence: number
    unverifiedFieldsCount: number
    primaryDocumentId?: string
  }
}

/**
 * Creates a provenanced audit container for an ERP record with pinned evidence.
 */
export function createProvenanceAuditedRecord<T extends Record<string, unknown>>(
  record: T,
  tenantId: string,
  evidence: RecordEvidenceMap
): ProvenanceAuditedRecord<T> {
  const citations = Object.values(evidence)
  const totalFieldsWithEvidence = citations.length
  const primaryDoc = citations[0]?.documentId

  return {
    record,
    tenantId,
    evidence,
    auditSummary: {
      totalFieldsWithEvidence,
      unverifiedFieldsCount: 0,
      primaryDocumentId: primaryDoc,
    },
  }
}

/**
 * Verifies if a given field value matches its cited raw text or bounding box.
 */
export function verifyFieldCitation(
  fieldValue: unknown,
  citation: SourceEvidenceCitation
): { matched: boolean; note?: string } {
  if (fieldValue === undefined || fieldValue === null) {
    return { matched: false, note: 'Field value is empty' }
  }

  const strVal = String(fieldValue).replace(/[,円￥\s]/g, '').trim()
  const rawClean = citation.rawText.replace(/[,円￥\s]/g, '').trim()

  if (!strVal || !rawClean) {
    return { matched: false, note: 'Field value or citation text is empty' }
  }

  // Exact match
  if (rawClean === strVal) {
    return { matched: true }
  }

  // Word/token boundary match: prevent matching 350,000 against 3,500,000 or 1350000
  // Escape regex special characters in strVal
  const escapedVal = strVal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const boundaryRegex = new RegExp(`(?:^|[^0-9])${escapedVal}(?:$|[^0-9])`)

  if (boundaryRegex.test(rawClean)) {
    return { matched: true }
  }

  return {
    matched: false,
    note: `Cited text "${citation.rawText}" does not contain isolated value "${String(fieldValue)}"`,
  }
}
