import type { SourceBoundingBox } from './governance'

/**
 * Citation data pinning a structured field to a source region; hosts own storage and immutability.
 * @see {@link createProvenanceAuditedRecord}
 */
export interface SourceEvidenceCitation {
  /** Unique ID of the citation */
  id: string
  /** Reference to the source document (e.g. storage URL or document ID) */
  documentId: string
  /** Human-readable document name, such as '20261024_source_invoice.pdf'. */
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
 * @see {@link createProvenanceAuditedRecord}
 */
export type RecordEvidenceMap = Record<string, SourceEvidenceCitation>

/**
 * Container tying an ERP record or draft to its full evidence audit trail.
 * @typeParam T - Host-defined record or candidate value type.
 * @see {@link createProvenanceAuditedRecord}
 */
export interface ProvenanceAuditedRecord<T = Record<string, unknown>> {
  /**
   * Original record retained in the evidence container without cloning.
   */
  record: T
  /**
   * Tenant identity supplied by the host; this field alone does not establish authorization.
   */
  tenantId: string
  /**
   * Field-name or line-ID mapping to source citations.
   */
  evidence: RecordEvidenceMap
  /**
   * Evidence counts and first-citation document reference; this is not independent verification.
   */
  auditSummary: {
    /**
     * Number of citation entries supplied in the evidence map.
     */
    totalFieldsWithEvidence: number
    /**
     * Initial count set to zero by this container helper; it does not certify the record.
     */
    unverifiedFieldsCount: number
    /**
     * Document identity from the first citation, when evidence is present.
     */
    primaryDocumentId?: string
  }
}

/**
 * Creates a provenanced audit container for an ERP record with pinned evidence.
 * @param record - Candidate record to associate with evidence; retained by reference.
 * @param tenantId - Host-supplied tenant scope for the container.
 * @param evidence - Field or line citation map to retain alongside the record.
 * @returns Container with supplied references, citation count and the first source document identity.
 * @example
 * ```typescript
 * import { createProvenanceAuditedRecord } from '@alneas/eaos-core/ai/evidence-traceability';
 * const record = createProvenanceAuditedRecord({ title: 'Memo' }, 'tenant-demo', {});
 * console.log(record.auditSummary.totalFieldsWithEvidence); // 0
 * ```
 * @typeParam T - Host-defined record or candidate value type.
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
 * Compare a field value with cited text using whitespace-delimited text or complete numeric tokens.
 * Numeric matching ignores currency formatting and grouping separators; text matching preserves whitespace boundaries.
 * @param fieldValue - Candidate value to compare with the citation text.
 * @param citation - Pinned source citation whose raw text is checked.
 * @returns A normalized text/token match decision and optional mismatch explanation; coordinates are not verified.
 * @example
 * ```typescript
 * import { verifyFieldCitation, type SourceEvidenceCitation } from '@alneas/eaos-core/ai/evidence-traceability';
 * export function verifyAmount(citation: SourceEvidenceCitation) { return verifyFieldCitation(100, citation); }
 * ```
 */
export function verifyFieldCitation(
  fieldValue: unknown,
  citation: SourceEvidenceCitation
): {
  /**
  * Whether the normalized value matches the cited text under this helper’s token rules.
  */
  matched: boolean;
  /**
  * Optional reason the normalized value did not match.
  */
  note?: string
} {
  if (fieldValue === undefined || fieldValue === null) {
    return { matched: false, note: 'Field value is empty' }
  }

  const strVal = String(fieldValue).replace(/[,円￥\s]/g, '').trim()
  const rawClean = citation.rawText.replace(/[,円￥\s]/g, '').trim()

  if (!strVal || !rawClean) {
    return { matched: false, note: 'Field value or citation text is empty' }
  }

  // If the target field value is numeric, perform strict full-token numeric matching
  // This prevents matching 350000 against -350000, 350000.50, 3500000, etc.
  const targetNum = Number(strVal)
  if (!Number.isNaN(targetNum)) {
    if (rawClean === strVal) return { matched: true }
    // Extract signed integer or floating point tokens: e.g. -350000, 350000.50, +100
    // Negative lookbehind and lookahead ensure we capture the whole number token
    const numericTokenRegex = /(?<![0-9.+-])([+-]?[0-9]+(?:\.[0-9]+)?)(?![0-9.])/g
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
  const textValue = String(fieldValue).trim()
  const textCitation = citation.rawText.trim()
  const escapedVal = textValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const boundaryRegex = new RegExp(`(?:^|\\s)${escapedVal}(?:$|\\s)`)

  if (boundaryRegex.test(textCitation)) {
    return { matched: true }
  }

  return {
    matched: false,
    note: `Cited text "${citation.rawText}" does not contain isolated text "${String(fieldValue)}"`,
  }
}
