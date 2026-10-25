import { createAjvValidator } from '@alneas/appkit-core/ai/validation'
import type { ImmutableLedgerEntry } from './immutable-ledger'
import { assertBalancedLines } from './immutable-ledger'

/**
 * Union types for blocks within a Hybrid Block Document.
 * @see {@link validateHybridDocument}
 */
export type DocumentBlock =
  | MarkdownTextBlock
  | ErpRecordTableBlock
  | AttachmentRefBlock

/**
 * Shared identity and optional heading for a document block.
 * @see {@link validateHybridDocument}
 */
export interface BaseBlock {
  /**
   * Host-assigned identity unique within the document.
   */
  id: string
  /**
   * Optional display heading for the block.
   */
  title?: string
}

/**
 * Free-form unstructured rich text / notes block (Notion-like flexibility).
 * Has lightweight schema constraints.
 * @see {@link validateHybridDocument}
 */
export interface MarkdownTextBlock extends BaseBlock {
  /**
   * Discriminator identifying a Markdown block.
   */
  type: 'markdown'
  /**
   * Unstructured Markdown text; validation does not sanitize or render HTML.
   */
  content: string
}

/**
 * Strict, transactional ERP ledger record table block.
 * Must obey strict double-entry and immutable ledger rules.
 * @see {@link validateHybridDocument}
 */
export interface ErpRecordTableBlock extends BaseBlock {
  /**
   * Discriminator identifying a table of ledger record candidates.
   */
  type: 'erp_record_table'
  /**
   * Host-defined schema identifier associated with the ledger table.
   */
  entitySchema: string
  /** Array of transactional double-entry records */
  records: ImmutableLedgerEntry[]
}

/**
 * Attached file / evidence block (PDF receipts, site photos, etc.)
 * @see {@link validateHybridDocument}
 */
export interface AttachmentRefBlock extends BaseBlock {
  /**
   * Discriminator identifying an attachment reference.
   */
  type: 'attachment'
  /**
   * Media type of the referenced attachment.
   */
  mimeType: string
  /**
   * Display filename of the referenced attachment.
   */
  fileName: string
  /**
   * Host-controlled attachment reference; presence is checked but access is not authorized here.
   */
  fileUrl: string
  /**
   * Optional host-reported OCR confidence score.
   */
  ocrConfidence?: number
}

/**
 * The top-level Hybrid Document container.
 * @see {@link validateHybridDocument}
 */
export interface HybridDocument {
  /**
   * Host-assigned document identity.
   */
  id: string
  /**
   * Tenant identity supplied by the host; this field alone does not establish authorization.
   */
  tenantId: string
  /**
   * Document heading shown to operators.
   */
  title: string
  /**
   * Host-provided document creation timestamp.
   */
  createdAt: string
  /**
   * Host-provided last-update timestamp.
   */
  updatedAt: string
  /**
   * Ordered document blocks to inspect and display.
   */
  blocks: DocumentBlock[]
}

/**
 * Collected structural and ledger validation results for a hybrid document.
 * @see {@link validateHybridDocument}
 */
export interface HybridValidationResult {
  /**
   * Whether the structural and embedded ledger checks found no errors.
   */
  valid: boolean
  /**
   * Validation failures collected from the document and its blocks.
   */
  errors: string[]
  /**
   * Number of blocks visited; this does not imply authorization or independent evidence verification.
   */
  verifiedBlocksCount: number
}

// This schema describes EAOS ledger projections, not an editor serialization format.
const nonemptyString = { type: 'string', minLength: 1 }
const ledgerEntrySchema = {
  type: 'object',
  required: ['id', 'tenantId', 'periodId', 'date', 'description', 'sourceKey', 'lines', 'status', 'createdBy', 'provenance'],
  properties: {
    id: nonemptyString, tenantId: nonemptyString, periodId: nonemptyString,
    date: nonemptyString, description: { type: 'string' }, sourceKey: nonemptyString,
    status: { enum: ['DRAFT', 'POSTED'] }, createdBy: nonemptyString,
    reverses: nonemptyString, reversesEntryId: nonemptyString,
    lines: {
      type: 'array',
      items: {
        type: 'object', required: ['accountId', 'side', 'amount'],
        properties: { accountId: nonemptyString, side: { enum: ['D', 'C'] }, amount: { type: 'number' } },
      },
    },
    provenance: {
      type: 'object', required: ['createdBy', 'riskLevel', 'aiGenerated'],
      properties: {
        createdBy: nonemptyString, riskLevel: { enum: [1, 2, 3] }, aiGenerated: { type: 'boolean' },
        aiFields: { type: 'array', items: { type: 'string' } },
        humanReviewedFields: { type: 'array', items: { type: 'string' } }, reviewNotes: { type: 'string' },
      },
    },
  },
}
const hybridDocumentSchema = {
  type: 'object', required: ['id', 'tenantId', 'title', 'createdAt', 'updatedAt', 'blocks'],
  properties: {
    id: nonemptyString, tenantId: nonemptyString, title: { type: 'string' },
    createdAt: nonemptyString, updatedAt: nonemptyString,
    blocks: {
      type: 'array',
      items: {
        type: 'object', required: ['id', 'type'],
        properties: { id: nonemptyString, title: { type: 'string' } },
        oneOf: [
          { required: ['content'], properties: { type: { const: 'markdown' }, content: { type: 'string' } } },
          { required: ['entitySchema', 'records'], properties: {
            type: { const: 'erp_record_table' }, entitySchema: nonemptyString,
            records: { type: 'array', items: ledgerEntrySchema },
          } },
          { required: ['mimeType', 'fileName', 'fileUrl'], properties: {
            type: { const: 'attachment' }, mimeType: nonemptyString, fileName: nonemptyString,
            fileUrl: nonemptyString, ocrConfidence: { type: 'number' },
          } },
        ],
      },
    },
  },
}
const validateProjection = createAjvValidator({ locale: 'en' })

/**
 * Validates a Hybrid Block Document.
 * Reuses Appkit JSON Schema validation for the EAOS projection without coercing or modifying input.
 * Then checks unique block identities, ledger tenant consistency and exact line balances.
 * Editor schema and serialization remain owned by Appkit; this is a ledger-oriented projection.
 * Hosts own content sanitization, authorization and business lifecycle validation.
 * @param doc - Untrusted document candidate to validate structurally before inspecting ledger constraints.
 * @returns Collected errors and visited block count; malformed structure returns zero visited blocks.
 * @throws Appkit validator configuration or schema compilation errors indicate a programming/configuration failure; malformed document data returns an invalid result.
 * @example
 * ```typescript
 * import { validateHybridDocument } from '@alneas/eaos-core/plugin-sdk/hybrid-document';
 * const result = validateHybridDocument({ id: 'doc-1', tenantId: 'tenant-demo', title: 'Memo', createdAt: '2026-10-24T00:00:00Z', updatedAt: '2026-10-24T00:00:00Z', blocks: [{ id: 'block-1', type: 'markdown', content: '# Memo' }] });
 * ```
 */
export function validateHybridDocument(doc: unknown): HybridValidationResult {
  const structural = validateProjection(hybridDocumentSchema, doc)
  if (!structural.valid) {
    return { valid: false, errors: structural.errors, verifiedBlocksCount: 0 }
  }
  const document = doc as HybridDocument
  const errors: string[] = []
  const blockIds = new Set<string>()
  for (const block of document.blocks) {
    if (blockIds.has(block.id)) errors.push(`Duplicate block id [${block.id}].`)
    blockIds.add(block.id)
    if (block.type === 'erp_record_table') {
      for (let i = 0; i < block.records.length; i++) {
        const entry = block.records[i]
        if (entry.tenantId !== document.tenantId) {
          errors.push(`Block [${block.id}] entry #${i} (${entry.id}) belongs to a different tenant.`)
        }
        try {
          assertBalancedLines(entry.lines)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          errors.push(`Block [${block.id}] entry #${i} (${entry.id}) failed ledger balancing: ${msg}`)
        }
      }
    }
  }
  return { valid: errors.length === 0, errors, verifiedBlocksCount: document.blocks.length }
}
