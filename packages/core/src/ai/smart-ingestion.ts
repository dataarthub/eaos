import type { AIRiskLevel } from './governance'
import type { RecordWorkspaceAiDraft } from '../../react/src/record-workspace'

/**
 * Raw unstructured input type supported by the Smart Ingestion Inbox.
 */
export type IngestionSourceType = 'memo' | 'pdf' | 'audio_transcript' | 'image' | 'email'

/**
 * An item dropped or fed into the Smart Ingestion Inbox.
 */
export interface IngestionItem {
  id: string
  tenantId: string
  sourceType: IngestionSourceType
  title: string
  content: string
  createdAt: string
  metadata?: Record<string, unknown>
}

/**
 * Classified intent and target workspace routing.
 */
export interface IngestionClassification {
  /** Target workspace domain (e.g. 'accounting', 'construction_progress', 'estate_contracts', 'hospitality_guests') */
  domain: 'accounting' | 'construction' | 'estate' | 'hospitality' | 'general'
  /** Proposed operation name or workspace command (e.g. 'create_journal', 'log_progress') */
  targetMode: string
  /** Confidence score of the domain classification */
  confidence: 'high' | 'medium' | 'low'
  /** Operational risk tier (Level 1: Read/Analysis, Level 2: Draft Mutation, Level 3: Master/Critical) */
  riskLevel: AIRiskLevel
  /** Human-readable explanation of why this classification was chosen */
  rationale: string
}

/**
 * Result of smart ingestion processing, containing routing metadata and the reviewable UI draft.
 */
export interface IngestionProcessingResult {
  itemId: string
  classification: IngestionClassification
  /** Reviewable AI draft payload compatible with RecordWorkspace */
  uiDraft: RecordWorkspaceAiDraft
  /** Extracted structured key-values */
  extractedValues: Record<string, unknown>
}

/**
 * Rules and patterns for classifying unstructured notes/text into ERP domains.
 */
export function classifyIngestionText(text: string): IngestionClassification {
  const normalized = text.toLowerCase()

  // Accounting / Invoices / Financials
  if (/請求|領収|仕訳|支払|振込|インボイス|消込|税抜|税込|円|¥/u.test(text)) {
    return {
      domain: 'accounting',
      targetMode: 'create_journal',
      confidence: 'high',
      riskLevel: 2,
      rationale: '請求・金額・支払に関する記述を検知し、会計仕訳起票（Level 2）として分類しました。',
    }
  }

  // Construction / Field progress / Safety / Inspections
  if (/工事|工種|足場|打設|クロス|配管|現場|是正|日報|出来高|竣工|着工/u.test(text)) {
    return {
      domain: 'construction',
      targetMode: 'log_progress',
      confidence: 'high',
      riskLevel: 2,
      rationale: '現場・工事・工程進捗に関する記述を検知し、工事日報・進捗更新（Level 2）として分類しました。',
    }
  }

  // Real estate / Tenants / Leases / Smart locks
  if (/入居|退去|物件|住戸|家賃|賃貸|仲介|内見|スマートロック|暗証番号/u.test(text)) {
    return {
      domain: 'estate',
      targetMode: 'create_application',
      confidence: 'high',
      riskLevel: 2,
      rationale: '物件・入居者・賃貸管理に関する記述を検知し、不動産契約・申込ドラフト（Level 2）として分類しました。',
    }
  }

  // Hospitality / Hotel guests / Room assign / Dietary requests
  if (/チェックイン|チェックアウト|宿泊|部屋割り|アレルギー|客室|滞在|清掃|支配人/u.test(text)) {
    return {
      domain: 'hospitality',
      targetMode: 'create_guest_request',
      confidence: 'high',
      riskLevel: 2,
      rationale: '宿泊・チェックイン・客室リクエストを検知し、ホテル部門タスク（Level 2）として分類しました。',
    }
  }

  // Default fallback
  return {
    domain: 'general',
    targetMode: 'create',
    confidence: 'low',
    riskLevel: 1,
    rationale: '特定業務キーワードが検出されなかったため、一般参照・ドラフトメモとして分類しました。',
  }
}

/**
 * Processes an unstructured ingestion item (memo/transcript) into an ERP AI-to-UI draft.
 */
export function processSmartIngestion(item: IngestionItem): IngestionProcessingResult {
  const classification = classifyIngestionText(item.content)
  const extractedValues: Record<string, unknown> = {}

  // Extract date
  const dateMatch = item.content.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/)
  const detectedDate = dateMatch
    ? `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`
    : item.createdAt.slice(0, 10)

  // Extract monetary amounts
  const amountMatch = item.content.match(/[¥￥]?([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)\s*(?:円|万円)?/)
  let amount = 0
  if (amountMatch) {
    const raw = amountMatch[1].replace(/,/g, '')
    amount = item.content.includes('万円') ? Number(raw) * 10000 : Number(raw)
  }

  if (classification.domain === 'accounting') {
    extractedValues.date = detectedDate
    extractedValues.description = `[メモ起票] ${item.title}`
    extractedValues.sourceKey = `inbox:${item.id}`
    if (amount > 0) {
      extractedValues.lines = [
        { accountId: 'acc-unassigned-cost', side: 'D', amount },
        { accountId: 'acc-unassigned-payable', side: 'C', amount },
      ]
    }
  } else if (classification.domain === 'construction') {
    extractedValues.date = detectedDate
    extractedValues.title = item.title
    extractedValues.notes = item.content
  } else {
    extractedValues.title = item.title
    extractedValues.description = item.content
  }

  const uiDraft: RecordWorkspaceAiDraft = {
    mode: classification.targetMode,
    riskLevel: classification.riskLevel,
    summary: `${classification.rationale}（元の入力: ${item.sourceType}「${item.title}」）`,
    fieldMetadata: {
      date: { confidence: dateMatch ? 'high' : 'medium', reasoning: dateMatch ? 'テキスト内日付' : '作成日' },
      amount: { confidence: amount > 0 ? 'high' : 'low', reasoning: amount > 0 ? '金額数値を検出' : '金額未記載' },
    },
    values: extractedValues,
  }

  return {
    itemId: item.id,
    classification,
    uiDraft,
    extractedValues,
  }
}
