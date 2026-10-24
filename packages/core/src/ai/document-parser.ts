import type { AIRiskLevel } from './governance'

/**
 * Normalized table structure parsed from complex documents (e.g. Docling extraction).
 */
export interface ExtractedDocumentTable {
  /** Optional table title or label found in the document */
  title?: string
  /** Column header labels in visual order */
  headers: readonly string[]
  /** 2D grid of cell values (rows x columns) */
  rows: readonly (readonly string[])[]
  /** Optional cell-level bounding coordinates for pinpoint PDF preview */
  cellBoxes?: readonly (readonly ({ page: number; x: number; y: number; width: number; height: number } | undefined)[])[]
}

/**
 * Result of document structure parsing.
 * Preserves hierarchical Markdown text, structured tables and metadata.
 */
export interface ParsedDocumentResult {
  /** Document title or filename */
  name: string
  /** Clean Markdown representation preserving document hierarchy */
  markdown: string
  /** Formatted tables extracted without column shifts */
  tables: readonly ExtractedDocumentTable[]
  /** Total number of pages or sections parsed */
  pageCount?: number
  /** Document format (pdf, docx, xlsx, etc.) */
  mimeType?: string
}

/**
 * Host adapter interface for structured document parsing (e.g. Docling worker/container).
 */
export interface DocumentParserAdapter {
  /**
   * Parses raw document bytes or buffer into structured Markdown and tables.
   */
  parse(input: {
    filename: string
    content: Uint8Array | ArrayBuffer
    mimeType?: string
  }): Promise<ParsedDocumentResult>
}

/**
 * Extraction target schema descriptor for converting parsed documents into ERP draft objects.
 */
export interface DocumentDraftExtractionTarget<T = Record<string, unknown>> {
  /** Target domain object (e.g. 'construction_estimate', 'vendor_invoice') */
  domain: string
  /** Target UI mode for the draft ('create' | 'edit' | command name) */
  mode: 'create' | 'edit' | string
  /** Associated risk level (defaults to Level 2 for routine drafting) */
  riskLevel?: AIRiskLevel
  /**
   * Deterministic conversion or LLM prompt extraction helper.
   */
  extract(parsed: ParsedDocumentResult): Promise<T> | T
}

/**
 * Validates and normalizes parsed tables to ensure no undefined or irregular shapes.
 */
export function sanitizeParsedDocument(parsed: ParsedDocumentResult): ParsedDocumentResult {
  if (!parsed.name || typeof parsed.name !== 'string') {
    throw new Error('Parsed document must have a valid name')
  }
  if (typeof parsed.markdown !== 'string') {
    throw new Error('Parsed document must contain markdown string')
  }
  const cleanTables = (parsed.tables ?? []).map(table => {
    const headers = (table.headers ?? []).map(h => String(h ?? '').trim())
    const rows = (table.rows ?? []).map(row => (row ?? []).map(cell => String(cell ?? '').trim()))
    return {
      title: table.title ? String(table.title).trim() : undefined,
      headers,
      rows,
      cellBoxes: table.cellBoxes,
    }
  })
  return {
    ...parsed,
    markdown: parsed.markdown.trim(),
    tables: cleanTables,
  }
}

/**
 * Creates an in-memory / mock Docling parser adapter for deterministic testing and local offline runs.
 */
export function createMockDoclingParser(
  handler?: (filename: string) => Partial<ParsedDocumentResult>
): DocumentParserAdapter {
  return {
    async parse({ filename, mimeType }) {
      const custom = handler ? handler(filename) : {}
      const defaultResult: ParsedDocumentResult = {
        name: filename,
        mimeType: mimeType ?? 'application/pdf',
        markdown: custom.markdown ?? `# Document: ${filename}\n\nSummary text extracted via Docling.`,
        tables: custom.tables ?? [
          {
            title: '明細一覧',
            headers: ['品名・工種', '数量', '単位', '単価', '金額'],
            rows: [
              ['仮設工事', '1', '式', '150000', '150000'],
              ['内装クロス張替', '85', 'm2', '1200', '102000'],
            ],
          },
        ],
        pageCount: custom.pageCount ?? 1,
      }
      return sanitizeParsedDocument(defaultResult)
    },
  }
}
