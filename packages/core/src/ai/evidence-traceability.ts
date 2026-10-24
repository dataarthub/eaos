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

  // Exact string match
  if (rawClean === strVal) {
    return { matched: true }
  }

  // If the target field value is numeric, perform strict full-token numeric matching
  // This prevents matching 350000 against -350000, 350000.50, 3500000, etc.
  const targetNum = Number(strVal)
  if (!Number.isNaN(targetNum)) {
    // Extract signed integer or floating point tokens: e.g. -350000, 350000.50, +100
    // Negative lookbehind and lookahead ensure we capture the whole number token
    const numericTokenRegex = /(?:^|[^0-9.])([+-]?[0-9]+(?:\.[0-9]+)?)(?:$|[^0-9.])/g
    let match: RegExpExecArray | null
    while ((match = numericTokenRegex.exec(rawClean)) !== null) {
      const tokenStr = match[1]
      const tokenNum = Number(tokenStr)
      if (!Number.isNaN(tokenNum) && tokenNum === targetNum) {
        // Also ensure sign matches exactly if target is positive but token is explicitly negative
        if (targetNum > 0 && tokenStr.startsWith('-')) {
          continue
        }
        return { matched: true }
      }
    }

    return {
      matched: false,
      note: `Cited text "${citation.rawText}" does not contain exact matching numeric token for "${String(fieldValue)}"`,
    }
  }

  // For non-numeric text, require exact boundary token match
  const escapedVal = strVal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const boundaryRegex = new RegExp(`(?:^|\\s)${escapedVal}(?:$|\\s)`)

  if (boundaryRegex.test(rawClean)) {
    return { matched: true }
  }

  return {
    matched: false,
    note: `Cited text "${citation.rawText}" does not contain isolated text "${String(fieldValue)}"`,
  }
}
