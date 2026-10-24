import { describe, expect, it } from 'bun:test'
import {
  classifyIngestionText,
  createMockLlmModelAdapter,
  processSmartIngestionWithAi,
  type IngestionItem,
} from './smart-ingestion'

describe('Smart Ingestion Inbox with LLM AI Model Adapter', () => {
  it('uses LLM semantic inference to extract financial draft from ambiguous natural language', async () => {
    const aiAdapter = createMockLlmModelAdapter()
    const item: IngestionItem = {
      id: 'memo-ai-01',
      tenantId: 'tenant-demo',
      sourceType: 'audio_transcript',
      title: '移動中の音声メモ',
      content: 'えーと、昨日頼んだ足場の代金、いつものA社に35万、来月末払いで登録しといて。',
      createdAt: '2026-10-24T12:00:00Z',
    }

    // Register a business plugin handler to map accounting draft lines (Clean domain isolation)
    const result = await processSmartIngestionWithAi(item, {
      modelAdapter: aiAdapter,
      domainHandlers: {
        accounting: {
          domain: 'accounting',
          mapToDraftValues(fields, itm) {
            return {
              date: fields.date ?? itm.createdAt.slice(0, 10),
              description: `[AI推論仕訳] ${fields.title ?? itm.title}`,
              sourceKey: `ai-inbox:${itm.id}`,
              lines: [
                { accountId: 'acc-scaffolding-cost', side: 'D', amount: fields.amount ?? 0 },
                { accountId: 'acc-payable-vendor-a', side: 'C', amount: fields.amount ?? 0 },
              ],
            }
          },
        },
      },
    })

    expect(result.processedBy).toBe('llm_model')
    expect(result.classification.domain).toBe('accounting')
    expect(result.classification.targetMode).toBe('create_journal')
    expect(result.classification.confidence).toBe('high')
    expect(result.uiDraft.summary).toContain('仮設足場工事')
    expect(result.extractedValues.lines).toBeDefined()
    const lines = result.extractedValues.lines as any[]
    expect(lines[0].amount).toBe(350000)
    expect(lines[1].amount).toBe(350000)
    expect(lines[0].accountId).toBe('acc-scaffolding-cost')
  })

  it('uses LLM to understand casual site voice report and creates construction progress draft', async () => {
    const aiAdapter = createMockLlmModelAdapter()
    const item: IngestionItem = {
      id: 'memo-ai-02',
      tenantId: 'tenant-demo',
      sourceType: 'audio_transcript',
      title: '現場写真と音声',
      content: 'あー3階の内装だけどさ、クロス貼りは綺麗に終わったよ。ただ下地に一部ひび割れ見つかったからボード是正しとくね。',
      createdAt: '2026-10-24T15:00:00Z',
    }

    const result = await processSmartIngestionWithAi(item, aiAdapter)

    expect(result.processedBy).toBe('llm_model')
    expect(result.classification.domain).toBe('construction')
    expect(result.classification.targetMode).toBe('log_progress')
    expect(result.uiDraft.summary).toContain('内装工事の完了報告')
    expect(result.extractedValues.title).toContain('3階内装クロス張替工事')
  })

  it('falls back gracefully to heuristic rules when no LLM adapter is provided', async () => {
    const item: IngestionItem = {
      id: 'memo-fallback',
      tenantId: 'tenant-demo',
      sourceType: 'memo',
      title: '請求メモ',
      content: '請求書の受領について。',
      createdAt: '2026-10-24T10:00:00Z',
    }

    const result = await processSmartIngestionWithAi(item, undefined)
    expect(result.processedBy).toBe('heuristic_fallback')
    expect(result.classification.domain).toBe('accounting')
  })

  it('triggers proactive duplicate and outlier alerts when processing with existing history', async () => {
    const aiAdapter = createMockLlmModelAdapter()
    const item: IngestionItem = {
      id: 'memo-ai-dup',
      tenantId: 'tenant-demo',
      sourceType: 'memo',
      title: '仮設足場工事の請求',
      content: '仮設足場の費用として 350,000円。',
      createdAt: '2026-10-24T12:00:00Z',
    }

    // Pass existing entry with same amount and similar title
    const result = await processSmartIngestionWithAi(item, {
      modelAdapter: aiAdapter,
      existingEntries: [
        { title: '仮設足場工事代金の支払', amount: 350000, date: '2026-10-20' },
      ],
      // Pass historical amounts where 350,000 is an outlier compared to 30,000..50,000
      historicalAmounts: [
        { timestamp: 1, value: 30000 },
        { timestamp: 2, value: 35000 },
        { timestamp: 3, value: 32000 },
        { timestamp: 4, value: 31000 },
        { timestamp: 5, value: 34000 },
      ],
    })

    expect(result.alerts).toBeDefined()
    expect(result.alerts!.length).toBeGreaterThanOrEqual(1)

    const dupAlert = result.alerts!.find((a) => a.type === 'duplicate_candidate')
    expect(dupAlert).toBeDefined()
    expect(dupAlert?.severity).toBe('critical')
    expect(dupAlert?.message).toContain('重複登録の警告')

    const outlierAlert = result.alerts!.find((a) => a.type === 'outlier_amount')
    expect(outlierAlert).toBeDefined()
    expect(outlierAlert?.message).toContain('異常値アラート')
  })
})
