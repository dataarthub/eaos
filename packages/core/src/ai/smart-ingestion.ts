import type { AIRiskLevel, AIExecutionContext } from './governance'
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
  /** Target workspace domain */
  domain: 'accounting' | 'construction' | 'estate' | 'hospitality' | 'general'
  /** Proposed operation name or workspace command */
  targetMode: string
  /** Confidence score of the domain classification */
  confidence: 'high' | 'medium' | 'low'
  /** Operational risk tier */
  riskLevel: AIRiskLevel
  /** Human-readable explanation of why this classification was chosen */
  rationale: string
}

/**
 * Structured extraction payload produced by LLM models with semantic intent.
 */
export interface LlmIngestionExtraction {
  domain: 'accounting' | 'construction' | 'estate' | 'hospitality' | 'general'
  targetMode: string
  summary: string
  confidence: 'high' | 'medium' | 'low'
  extractedFields: {
    title?: string
    date?: string
    amount?: number
    partyName?: string
    notes?: string
    lineItems?: readonly { name: string; amount: number; quantity?: number; unit?: string }[]
  }
}

/**
 * Model adapter interface for semantic AI understanding.
 * Plugs into Vercel AI SDK (generateObject), LangChain or local models (MLX/Ollama).
 */
export interface IngestionModelAdapter {
  extractIntent(input: {
    item: IngestionItem
    context?: Partial<AIExecutionContext>
  }): Promise<LlmIngestionExtraction>
}

/**
 * Result of smart ingestion processing, containing routing metadata and the reviewable UI draft.
 */
export interface IngestionProcessingResult {
  itemId: string
  classification: IngestionClassification
  uiDraft: RecordWorkspaceAiDraft
  extractedValues: Record<string, unknown>
  processedBy: 'llm_model' | 'heuristic_fallback'
}

/**
 * System prompt template used when querying the LLM for structured ERP extraction.
 */
export const SMART_INGESTION_SYSTEM_PROMPT = `You are an AI ERP Assistant for enterprise domains:
1. 'accounting': Invoices, payments, receipts, journal entries.
2. 'construction': Site logs, subcontractor progress, defects, field inspections.
3. 'estate': Tenant applications, leases, property repairs, smart lock codes.
4. 'hospitality': Guest requests, reservations, dietary preferences, room cleaning.
5. 'general': Unclassified memos.

Analyze the casual or transcribed text. Infer implicit dates, monetary amounts (JPY minor/whole), parties, and line items.
Always output valid structured data conforming to the schema. Do not invent unauthorized commitments.`

/**
 * Fallback classification rules when LLM is unavailable or offline.
 */
export function classifyIngestionText(text: string): IngestionClassification {
  if (/請求|領収|仕訳|支払|振込|インボイス|消込|税抜|税込|円|¥/u.test(text)) {
    return {
      domain: 'accounting',
      targetMode: 'create_journal',
      confidence: 'high',
      riskLevel: 2,
      rationale: '請求・金額・支払に関する記述を検知し、会計仕訳起票（Level 2）として分類しました。',
    }
  }

  if (/工事|工種|足場|打設|クロス|配管|現場|是正|日報|出来高|竣工|着工/u.test(text)) {
    return {
      domain: 'construction',
      targetMode: 'log_progress',
      confidence: 'high',
      riskLevel: 2,
      rationale: '現場・工事・工程進捗に関する記述を検知し、工事日報・進捗更新（Level 2）として分類しました。',
    }
  }

  if (/入居|退去|物件|住戸|家賃|賃貸|仲介|内見|スマートロック|暗証番号/u.test(text)) {
    return {
      domain: 'estate',
      targetMode: 'create_application',
      confidence: 'high',
      riskLevel: 2,
      rationale: '物件・入居者・賃貸管理に関する記述を検知し、不動産契約・申込ドラフト（Level 2）として分類しました。',
    }
  }

  if (/チェックイン|チェックアウト|宿泊|部屋割り|アレルギー|客室|滞在|清掃|支配人/u.test(text)) {
    return {
      domain: 'hospitality',
      targetMode: 'create_guest_request',
      confidence: 'high',
      riskLevel: 2,
      rationale: '宿泊・チェックイン・客室リクエストを検知し、ホテル部門タスク（Level 2）として分類しました。',
    }
  }

  return {
    domain: 'general',
    targetMode: 'create',
    confidence: 'low',
    riskLevel: 1,
    rationale: '特定業務キーワードが検出されなかったため、一般参照・ドラフトメモとして分類しました。',
  }
}

/**
 * Creates an AI model adapter with natural language reasoning (LLM).
 * Can be backed by real AI SDK models or deterministic simulation for tests.
 */
export function createMockLlmModelAdapter(
  customHandler?: (text: string) => Partial<LlmIngestionExtraction>
): IngestionModelAdapter {
  return {
    async extractIntent({ item }) {
      if (customHandler) {
        const custom = customHandler(item.content)
        return {
          domain: custom.domain ?? 'general',
          targetMode: custom.targetMode ?? 'create',
          summary: custom.summary ?? `LLM extracted intent from ${item.title}`,
          confidence: custom.confidence ?? 'high',
          extractedFields: custom.extractedFields ?? {},
        }
      }

      // Default LLM simulated semantic parser
      const text = item.content
      if (/クロス|内装|ボード|ひび割れ|是正/u.test(text)) {
        return {
          domain: 'construction',
          targetMode: 'log_progress',
          summary: '現場音声メモから内装工事の完了報告およびボード是正タスクを抽出しました。',
          confidence: 'high',
          extractedFields: {
            title: '3階内装クロス張替工事 進捗日報',
            notes: 'クロス張替完了。ボード一部ひび割れあり、是正指示済。',
          },
        }
      }

      if (/足場|35万|請求/u.test(text)) {
        return {
          domain: 'accounting',
          targetMode: 'create_journal',
          summary: '請求受領メモから仮設足場工事の未払費用（¥350,000）の仕訳ドラフトを抽出しました。',
          confidence: 'high',
          extractedFields: {
            title: '仮設足場工事 請求仕訳',
            amount: 350000,
            date: '2026-11-15',
            lineItems: [{ name: '仮設足場費用', amount: 350000 }],
          },
        }
      }

      if (/そば|アレルギー|朝食/u.test(text)) {
        return {
          domain: 'hospitality',
          targetMode: 'create_guest_request',
          summary: '顧客アレルギー（そば）対応のレストラン手配タスクを抽出しました。',
          confidence: 'high',
          extractedFields: {
            title: '朝食レストラン: そばアレルギー対応手配',
            partyName: '田中様',
            notes: 'そばアレルギーのため朝食メニュー要変更',
          },
        }
      }

      return {
        domain: 'general',
        targetMode: 'create',
        summary: `AIメモ抽出: ${item.title}`,
        confidence: 'low',
        extractedFields: { title: item.title, notes: item.content },
      }
    },
  }
}

/**
 * Processes an unstructured ingestion item using an AI Model Adapter (LLM)
 * with automatic fallback to heuristic rules if no model adapter is supplied.
 */
export async function processSmartIngestionWithAi(
  item: IngestionItem,
  modelAdapter?: IngestionModelAdapter
): Promise<IngestionProcessingResult> {
  // 1. If LLM adapter is provided, use genuine semantic AI inference
  if (modelAdapter) {
    const aiResult = await modelAdapter.extractIntent({ item })
    const extractedValues: Record<string, unknown> = {}
    const { extractedFields } = aiResult

    if (aiResult.domain === 'accounting') {
      extractedValues.date = extractedFields.date ?? item.createdAt.slice(0, 10)
      extractedValues.description = `[AI推論仕訳] ${extractedFields.title ?? item.title}`
      extractedValues.sourceKey = `ai-inbox:${item.id}`
      if (extractedFields.amount && extractedFields.amount > 0) {
        extractedValues.lines = [
          { accountId: 'acc-unassigned-cost', side: 'D', amount: extractedFields.amount },
          { accountId: 'acc-unassigned-payable', side: 'C', amount: extractedFields.amount },
        ]
      }
    } else if (aiResult.domain === 'construction') {
      extractedValues.title = extractedFields.title ?? item.title
      extractedValues.notes = extractedFields.notes ?? item.content
      extractedValues.date = extractedFields.date ?? item.createdAt.slice(0, 10)
    } else {
      extractedValues.title = extractedFields.title ?? item.title
      extractedValues.notes = extractedFields.notes ?? item.content
      if (extractedFields.partyName) extractedValues.partyName = extractedFields.partyName
    }

    const classification: IngestionClassification = {
      domain: aiResult.domain,
      targetMode: aiResult.targetMode,
      confidence: aiResult.confidence,
      riskLevel: 2, // Draft mutation is Level 2 Human-in-the-Loop
      rationale: aiResult.summary,
    }

    const uiDraft: RecordWorkspaceAiDraft = {
      mode: aiResult.targetMode,
      riskLevel: 2,
      summary: aiResult.summary,
      fieldMetadata: {
        domain: { confidence: aiResult.confidence, reasoning: 'LLM文脈理解による自動分類' },
        amount: { confidence: extractedFields.amount ? 'high' : 'low', reasoning: 'LLM抽出' },
      },
      values: extractedValues,
    }

    return {
      itemId: item.id,
      classification,
      uiDraft,
      extractedValues,
      processedBy: 'llm_model',
    }
  }

  // 2. Fallback to heuristic rules
  const classification = classifyIngestionText(item.content)
  const extractedValues: Record<string, unknown> = {
    title: item.title,
    notes: item.content,
  }

  const uiDraft: RecordWorkspaceAiDraft = {
    mode: classification.targetMode,
    riskLevel: classification.riskLevel,
    summary: `${classification.rationale} (Heuristic mode)`,
    values: extractedValues,
  }

  return {
    itemId: item.id,
    classification,
    uiDraft,
    extractedValues,
    processedBy: 'heuristic_fallback',
  }
}
