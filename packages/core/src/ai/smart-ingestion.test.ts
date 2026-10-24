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

    const result = await processSmartIngestionWithAi(item, aiAdapter)

    expect(result.processedBy).toBe('llm_model')
    expect(result.classification.domain).toBe('accounting')
    expect(result.classification.targetMode).toBe('create_journal')
    expect(result.classification.confidence).toBe('high')
    expect(result.uiDraft.summary).toContain('仮設足場工事')
    expect(result.extractedValues.lines).toBeDefined()
    const lines = result.extractedValues.lines as any[]
    expect(lines[0].amount).toBe(350000)
    expect(lines[1].amount).toBe(350000)
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
})
