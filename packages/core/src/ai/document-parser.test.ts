import { describe, expect, it } from 'bun:test'
import {
  createMockDoclingParser,
  sanitizeParsedDocument,
  type ParsedDocumentResult,
  type DocumentDraftExtractionTarget,
} from './document-parser'

describe('Document parser adapter & pipeline (Docling integration)', () => {
  it('creates mock parser and extracts structured Markdown and table rows', async () => {
    const parser = createMockDoclingParser()
    const result = await parser.parse({
      filename: '見積書_サンプル.pdf',
      content: new Uint8Array([1, 2, 3]),
    })

    expect(result.name).toBe('見積書_サンプル.pdf')
    expect(result.markdown).toContain('見積書_サンプル.pdf')
    expect(result.tables.length).toBe(1)
    expect(result.tables[0].headers).toEqual(['品名・工種', '数量', '単位', '単価', '金額'])
    expect(result.tables[0].rows[0]).toEqual(['仮設工事', '1', '式', '150000', '150000'])
  })

  it('sanitizes parsed document outputs and trims cell whitespace', () => {
    const raw: ParsedDocumentResult = {
      name: 'invoice.pdf',
      markdown: '   # Title   \nBody   ',
      tables: [
        {
          title: '  Summary  ',
          headers: [' Item ', ' Price '],
          rows: [['  Widget A  ', ' 500 ']],
        },
      ],
    }

    const sanitized = sanitizeParsedDocument(raw)
    expect(sanitized.markdown).toBe('# Title   \nBody')
    expect(sanitized.tables[0].title).toBe('Summary')
    expect(sanitized.tables[0].headers).toEqual(['Item', 'Price'])
    expect(sanitized.tables[0].rows[0]).toEqual(['Widget A', '500'])
  })

  it('transforms parsed document into an ERP UI draft via extraction target', async () => {
    const parser = createMockDoclingParser()
    const parsed = await parser.parse({
      filename: '協力会社見積.pdf',
      content: new Uint8Array([0]),
    })

    const constructionEstimateTarget: DocumentDraftExtractionTarget<{
      projectName: string
      totalAmount: number
      items: { name: string; amount: number }[]
    }> = {
      domain: 'construction_estimate',
      mode: 'create',
      riskLevel: 2,
      extract(doc) {
        const table = doc.tables[0]
        const items = table.rows.map(row => ({
          name: row[0],
          amount: Number(row[4]),
        }))
        const totalAmount = items.reduce((sum, item) => sum + item.amount, 0)
        return {
          projectName: '自動抽出工事案件',
          totalAmount,
          items,
        }
      },
    }

    const draft = await constructionEstimateTarget.extract(parsed)
    expect(draft.projectName).toBe('自動抽出工事案件')
    expect(draft.items.length).toBe(2)
    expect(draft.totalAmount).toBe(252000)
    expect(constructionEstimateTarget.riskLevel).toBe(2)
  })
})
