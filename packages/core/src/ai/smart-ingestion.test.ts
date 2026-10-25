import { describe, expect, it } from 'bun:test'
import * as ingestion from './smart-ingestion'
import { processSmartIngestionWithAi, type IngestionItem, type IngestionModelAdapter } from './smart-ingestion'

const item: IngestionItem = {
  id: 'memo-1', tenantId: 'tenant-demo', sourceType: 'memo', title: 'Source memo',
  content: '請求書 350,000円 工事 クロス アレルギー', createdAt: '2026-10-24T12:00:00Z',
}
const adapter: IngestionModelAdapter = {
  async extractIntent() {
    return { domain: 'custom-domain', targetMode: 'review', summary: 'Review extracted values', confidence: 'high',
      extractedFields: { title: 'Source memo', amount: 350000, notes: 'Extracted note' } }
  },
}

describe('Smart ingestion extension boundary', () => {
  it('defaults industry text to a general memo without built-in keyword routing', async () => {
    const result = await processSmartIngestionWithAi(item)
    expect(result.classification.domain).toBe('general')
    expect(result.classification.targetMode).toBe('create')
    expect(result.extractedValues).toEqual({ title: item.title, notes: item.content })
    expect('createMockLlmModelAdapter' in ingestion).toBe(false)
    expect('SMART_INGESTION_SYSTEM_PROMPT' in ingestion).toBe(false)
  })

  it('maps extensible model domains through configured handlers', async () => {
    const result = await processSmartIngestionWithAi(item, {
      modelAdapter: adapter,
      domainHandlers: { 'custom-domain': { domain: 'custom-domain', mapToDraftValues(fields, source) {
        return { reference: source.id, total: fields.amount }
      } } },
    })
    expect(result.classification.domain).toBe('custom-domain')
    expect(result.uiDraft.values).toEqual({ reference: item.id, total: 350000 })
    expect(result.processedBy).toBe('llm_model')
  })

  it('uses configured classification and mapping on the fallback path', async () => {
    const result = await processSmartIngestionWithAi(item, {
      classifier: () => ({ domain: 'custom-domain', targetMode: 'review', confidence: 'medium', riskLevel: 2, rationale: 'Host classification' }),
      domainHandlers: { 'custom-domain': { domain: 'custom-domain', mapToDraftValues(fields, source) {
        return { reference: source.id, notes: fields.notes }
      } } },
    })
    expect(result.classification.domain).toBe('custom-domain')
    expect(result.uiDraft.mode).toBe('review')
    expect(result.uiDraft.values).toEqual({ reference: item.id, notes: item.content })
  })

  it('detects duplicate and statistical outlier amounts from extracted data', async () => {
    const result = await processSmartIngestionWithAi(item, {
      modelAdapter: adapter, existingEntries: [{ title: item.title, amount: 350000 }],
      historicalAmounts: [30000, 35000, 32000, 31000, 34000].map((value, timestamp) => ({ value, timestamp })),
    })
    expect(result.alerts?.some(alert => alert.type === 'duplicate_candidate')).toBe(true)
    expect(result.alerts?.some(alert => alert.type === 'outlier_amount')).toBe(true)
  })
})
