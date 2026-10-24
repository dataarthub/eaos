import { describe, expect, it } from 'bun:test'
import {
  classifyIngestionText,
  processSmartIngestion,
  type IngestionItem,
} from './smart-ingestion'

describe('Smart Ingestion Inbox (Unstructured Memo -> Structured ERP Draft)', () => {
  it('classifies a casual site voice memo into a construction progress draft', () => {
    const text = '本日の3階内装クロス張替工事完了。ボード一部にひび割れあり、是正指示出しときました。'
    const classification = classifyIngestionText(text)

    expect(classification.domain).toBe('construction')
    expect(classification.targetMode).toBe('log_progress')
    expect(classification.riskLevel).toBe(2)
    expect(classification.confidence).toBe('high')
  })

  it('classifies a financial payment note into an accounting journal draft with amount parsing', () => {
    const item: IngestionItem = {
      id: 'memo-123',
      tenantId: 'tenant-demo',
      sourceType: 'memo',
      title: '仮設足場工事の請求受領',
      content: '協力会社から請求書受領。仮設足場の費用として 350,000円。支払期日は2026/11/15。',
      createdAt: '2026-10-24T10:00:00Z',
    }

    const result = processSmartIngestion(item)
    expect(result.classification.domain).toBe('accounting')
    expect(result.classification.targetMode).toBe('create_journal')
    expect(result.uiDraft.riskLevel).toBe(2)
    expect(result.uiDraft.summary).toContain('会計仕訳起票')
    expect(result.extractedValues.lines).toBeDefined()
    const lines = result.extractedValues.lines as any[]
    expect(lines[0].amount).toBe(350000)
    expect(lines[1].amount).toBe(350000)
  })

  it('classifies a hotel guest dietary note into a hospitality department task', () => {
    const text = '宿泊客の田中様より電話。そばアレルギーあり。明日の朝食レストランへ手配お願いします。'
    const classification = classifyIngestionText(text)

    expect(classification.domain).toBe('hospitality')
    expect(classification.targetMode).toBe('create_guest_request')
    expect(classification.riskLevel).toBe(2)
  })
})
