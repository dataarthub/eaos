import type { AIRiskLevel } from './governance'

/**
 * Normalized table structure parsed from complex documents (e.g. Docling extraction).
 * @see {@link sanitizeParsedDocument}
 */
export interface ExtractedDocumentTable {
  /** Optional table title or label found in the document */
  title?: string
  /** Column header labels in visual order */
  headers: readonly string[]
  /** 2D grid of cell values (rows x columns) */
  rows: readonly (readonly string[])[]
  /** Optional cell-level bounding coordinates for pinpoint PDF preview */
  cellBoxes?: readonly (readonly ({
    /**
    * Source page index using the coordinate convention of the parser or document viewer.
    */
    page: number;
    /**
    * Horizontal origin in the source coordinate system.
    */
    x: number;
    /**
    * Vertical origin in the source coordinate system.
    */
    y: number;
    /**
    * Region width in the source coordinate system.
    */
    width: number;
    /**
    * Region height in the source coordinate system.
    */
    height: number
  } | undefined)[])[]
}

/**
 * Result of document structure parsing.
 * Preserves hierarchical Markdown text, structured tables and metadata.
 * @see {@link sanitizeParsedDocument}
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
 * @see {@link sanitizeParsedDocument}
 */
export interface DocumentParserAdapter {
  /**
   * Parses raw document bytes or buffer into structured Markdown and tables.
   * @param input - Source filename, bytes and optional media type to parse through the host adapter.
   * @returns Normalized document text, tables and optional page/media metadata.
   * @example
   * ```typescript
   * import type { DocumentParserAdapter } from '@alneas/eaos-core/ai/document-parser';
   * export async function parseSource(parser: DocumentParserAdapter, content: Uint8Array) {
   *   return parser.parse({ filename: 'source.pdf', content, mimeType: 'application/pdf' });
   * }
   * ```
   * @throws Host parsing or source access errors reject the returned Promise.
   */
  parse(input: {
    /**
     * Original file name supplied to the parsing adapter.
     */
    filename: string
    /**
     * Document bytes to parse without interpreting them as executable content.
     */
    content: Uint8Array | ArrayBuffer
    /**
     * Optional media type reported by the host or storage adapter.
     */
    mimeType?: string
  }): Promise<ParsedDocumentResult>
}

/**
 * Extraction target schema descriptor for converting parsed documents into ERP draft objects.
 * @typeParam T - Host-defined record or candidate value type.
 * @see {@link sanitizeParsedDocument}
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
   * @param parsed - Normalized document to convert into candidate values.
   * @returns Host-defined draft values, directly or asynchronously.
   * @example
   * ```typescript
   * import type { DocumentDraftExtractionTarget, ParsedDocumentResult } from '@alneas/eaos-core/ai/document-parser';
   * export function extractCandidate(target: DocumentDraftExtractionTarget, document: ParsedDocumentResult) {
   *   return target.extract(document);
   * }
   * ```
   * @throws Host extraction failures propagate to the caller.
   */
  extract(parsed: ParsedDocumentResult): Promise<T> | T
}

/**
 * Validates and normalizes parsed tables to ensure no undefined or irregular shapes.
 * @param parsed - Parsed source document to normalize.
 * @returns A new document with trimmed Markdown, string table cells and normalized headings.
 * @example
 * ```typescript
 * import { sanitizeParsedDocument } from '@alneas/eaos-core/ai/document-parser';
 * const document = sanitizeParsedDocument({ name: 'memo.pdf', markdown: ' # Memo ', tables: [] });
 * ```
 * @throws If the document name is empty/nonstring or Markdown is not a string.
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
 * @param handler - Optional filename callback supplying deterministic parsed fixtures.
 * @returns An in-memory parser adapter for tests and local demonstrations; it does not perform OCR.
 * @example
 * ```typescript
 * import { createMockDoclingParser } from '@alneas/eaos-core/ai/document-parser';
 * const parser = createMockDoclingParser(() => ({ markdown: '# Fixture', tables: [] }));
 * const parsed = await parser.parse({ filename: 'fixture.pdf', content: new Uint8Array() });
 * ```
 * @throws Parsing rejects when the supplied fixture fails document normalization.
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
