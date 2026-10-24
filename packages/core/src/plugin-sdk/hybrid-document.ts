import type { LedgerEntry } from './immutable-ledger'
import { assertBalancedLines } from './immutable-ledger'

/**
 * Union types for blocks within a Hybrid Block Document.
 */
export type DocumentBlock =
  | MarkdownTextBlock
  | ErpRecordTableBlock
  | AttachmentRefBlock

export interface BaseBlock {
  id: string
  title?: string
}

/**
 * Free-form unstructured rich text / notes block (Notion-like flexibility).
 * Has lightweight schema constraints.
 */
export interface MarkdownTextBlock extends BaseBlock {
  type: 'markdown'
  content: string
}

/**
 * Strict, transactional ERP ledger record table block.
 * Must obey strict double-entry and immutable ledger rules.
 */
export interface ErpRecordTableBlock extends BaseBlock {
  type: 'erp_record_table'
  entitySchema: 'accounting_journal' | 'construction_progress' | 'cost_budget'
  /** Array of transactional double-entry records */
  records: LedgerEntry[]
}

/**
 * Attached file / evidence block (PDF receipts, site photos, etc.)
 */
export interface AttachmentRefBlock extends BaseBlock {
  type: 'attachment'
  mimeType: string
  fileName: string
  fileUrl: string
  ocrConfidence?: number
}

/**
 * The top-level Hybrid Document container.
 */
export interface HybridDocument {
  id: string
  tenantId: string
  title: string
  createdAt: string
  updatedAt: string
  blocks: DocumentBlock[]
}

export interface HybridValidationResult {
  valid: boolean
  errors: string[]
  verifiedBlocksCount: number
}

/**
 * Validates a Hybrid Block Document.
 * Ensures markdown blocks are safe and non-malformed, while strictly enforcing
 * double-entry balancing and accounting laws on any embedded ERP table blocks.
 */
export function validateHybridDocument(doc: HybridDocument): HybridValidationResult {
  const errors: string[] = []

  if (!doc.id || !doc.tenantId) {
    errors.push('Document must have valid id and tenantId.')
  }

  for (const block of doc.blocks) {
    if (block.type === 'markdown') {
      // Free-form markdown is inherently flexible, but must not be undefined
      if (typeof block.content !== 'string') {
        errors.push(`Block [${block.id}] markdown content must be a string.`)
      }
    } else if (block.type === 'erp_record_table') {
      // Strict ERP validation: check double-entry balancing for all ledger records
      for (let i = 0; i < block.records.length; i++) {
        const entry = block.records[i]
        try {
          assertBalancedLines(entry.lines)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          errors.push(`Block [${block.id}] entry #${i} (${entry.id}) failed ledger balancing: ${msg}`)
        }
      }
    } else if (block.type === 'attachment') {
      if (!block.fileUrl) {
        errors.push(`Block [${block.id}] attachment missing fileUrl.`)
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    verifiedBlocksCount: doc.blocks.length,
  }
}
