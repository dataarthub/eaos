import type { AIRiskLevel, AIExecutionContext, CoreAiDraft } from './governance'
import { analyzeLatestMetric, type AINumericMetricPoint } from './anomaly'
import type { SourceEvidenceCitation } from './evidence-traceability'

/**
 * Raw unstructured input type supported by the Smart Ingestion Inbox.
 * @see {@link processSmartIngestionWithAi}
 */
export type IngestionSourceType = 'memo' | 'pdf' | 'audio_transcript' | 'image' | 'email'

/**
 * An item dropped or fed into the Smart Ingestion Inbox.
 * @see {@link processSmartIngestionWithAi}
 */
export interface IngestionItem {
  /**
   * Host-assigned inbox item identity.
   */
  id: string
  /**
   * Tenant identity supplied by the host; this field alone does not establish authorization.
   */
  tenantId: string
  /**
   * Transport or media category of the original input.
   */
  sourceType: IngestionSourceType
  /**
   * Human-readable title supplied with the source item.
   */
  title: string
  /**
   * Unstructured source text to classify or extract.
   */
  content: string
  /**
   * Host-provided creation timestamp for the source item.
   */
  createdAt: string
  /**
   * Optional host metadata associated with the input.
   */
  metadata?: Record<string, unknown>
}

/**
 * Classified intent and target workspace routing.
 * @see {@link processSmartIngestionWithAi}
 */
export interface IngestionClassification {
  /** Target workspace domain */
  domain: string
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
 * @see {@link processSmartIngestionWithAi}
 */
export interface LlmIngestionExtraction {
  /**
   * Host-defined domain identifier used to select a registered handler.
   */
  domain: string
  /**
   * Host command or form mode proposed for review.
   */
  targetMode: string
  /**
   * Human-readable extraction summary for the review interface.
   */
  summary: string
  /**
   * Confidence category reported by the classifier or model adapter.
   */
  confidence: 'high' | 'medium' | 'low'
  /**
   * Normalized candidate fields returned by the model; business validation remains host-owned.
   */
  extractedFields: {
    /**
     * Human-readable title supplied with the source item.
     */
    title?: string
    /**
     * Optional extracted transaction date.
     */
    date?: string
    /**
     * Optional amount using the units agreed by the host and adapter.
     */
    amount?: number
    /**
     * Optional person or organization name extracted from the input.
     */
    partyName?: string
    /**
     * Optional extracted free-text notes.
     */
    notes?: string
    /**
     * Optional extracted line candidates; no posting or tax policy is applied.
     */
    lineItems?: readonly {
      /**
      * Display name of an extracted line item.
      */
      name: string;
      /**
      * Optional amount using the units agreed by the host and adapter.
      */
      amount: number;
      /**
      * Optional extracted quantity for the line item.
      */
      quantity?: number;
      /**
      * Optional unit label associated with the quantity.
      */
      unit?: string
    }[]
  }
}

/**
 * Model adapter interface for semantic AI understanding.
 * Plugs into Vercel AI SDK (generateObject), LangChain or local models (MLX/Ollama).
 * @see {@link processSmartIngestionWithAi}
 */
export interface IngestionModelAdapter {
  /**
   * Extract host-defined routing intent and candidate fields from an inbox item.
   * @param input - Original source item and optional verified host execution scope.
   * @returns Structured model extraction for subsequent host mapping and review.
   * @example
   * ```typescript
   * import type { IngestionItem, IngestionModelAdapter } from '@alneas/eaos-core/ai/smart-ingestion';
   * export async function extract(adapter: IngestionModelAdapter, item: IngestionItem) { return adapter.extractIntent({ item }); }
   * ```
   * @throws Model/provider failures reject the Promise.
   */
  extractIntent(input: {
    /**
     * Original inbox item supplied to the model adapter.
     */
    item: IngestionItem
    /**
     * Optional execution scope passed by the host.
     */
    context?: Partial<AIExecutionContext>
  }): Promise<LlmIngestionExtraction>
}

/**
 * Warning / anomaly flag generated during smart ingestion.
 * @see {@link processSmartIngestionWithAi}
 */
export interface IngestionAnomalyAlert {
  /**
   * Alert category produced by duplicate or outlier analysis.
   */
  type: 'duplicate_candidate' | 'outlier_amount' | 'unusual_vendor'
  /**
   * Display severity of the detected anomaly.
   */
  severity: 'info' | 'warning' | 'critical'
  /**
   * Human-readable description of the potential anomaly.
   */
  message: string
  /**
   * Optional statistical score reported by the outlier detector.
   */
  score?: number
}

/**
 * Result of smart ingestion processing, containing routing metadata and the reviewable UI draft.
 * @see {@link processSmartIngestionWithAi}
 */
export interface IngestionProcessingResult {
  /**
   * Identity of the processed inbox item.
   */
  itemId: string
  /**
   * Domain routing and risk metadata for the proposed draft.
   */
  classification: IngestionClassification
  /**
   * Reviewable UI proposal containing candidate values; no persistence is performed.
   */
  uiDraft: CoreAiDraft
  /**
   * Candidate values after optional host domain mapping.
   */
  extractedValues: Record<string, unknown>
  /**
   * Whether the result used a supplied model or the fallback classifier.
   */
  processedBy: 'llm_model' | 'heuristic_fallback'
  /** Proactive anomaly alerts (outliers, duplicate entries) */
  alerts?: IngestionAnomalyAlert[]
  /** Pinned source citations (e.g. PDF bounding box coordinates) */
  citations?: Record<string, SourceEvidenceCitation>
}

/**
 * Host-supplied synchronous text classifier used on the model-free ingestion path.
 * @see {@link processSmartIngestionWithAi}
 */
export type IngestionClassifier = (text: string) => IngestionClassification

/**
 * Return a general memo classification without inferring a business domain.
 * @param _text - Input text retained by the classifier signature; the default does not inspect its contents.
 * @returns Low-confidence general memo routing with risk level 1.
 * @example
 * ```typescript
 * import { classifyIngestionText } from '@alneas/eaos-core/ai/smart-ingestion';
 * const classification = classifyIngestionText('Review this source memo'); // domain: general
 * ```
 */
export function classifyIngestionText(_text: string): IngestionClassification {
  return {
    domain: 'general',
    targetMode: 'create',
    confidence: 'low',
    riskLevel: 1,
    rationale: 'Saved as a general memo for review.',
  }
}

/**
 * Pure contract for a domain-specific ingestion handler registered by business plugins.
 * @see {@link processSmartIngestionWithAi}
 */
export interface IngestionDomainPluginHandler {
  /**
   * Host-defined domain identifier used to select a registered handler.
   */
  domain: string
  /**
   * Maps extracted fields into domain-specific record draft values without hardcoding in Core
   * @param extractedFields - Generic extracted fields or source memo fields on the fallback path.
   * @param item - Original source item for host identity and context mapping.
   * @returns Host-domain candidate values for a UI draft.
   * @example
   * ```typescript
   * import type { IngestionDomainPluginHandler, IngestionItem } from '@alneas/eaos-core/ai/smart-ingestion';
   * export function mapMemo(handler: IngestionDomainPluginHandler, item: IngestionItem) {
   *   return handler.mapToDraftValues({ title: item.title, notes: item.content }, item);
   * }
   * ```
   * @throws Host mapping or validation errors propagate.
   */
  mapToDraftValues(
    extractedFields: LlmIngestionExtraction['extractedFields'],
    item: IngestionItem
  ): Record<string, unknown>
}

/**
 * Options for contextual anomaly detection during ingestion processing.
 * @see {@link processSmartIngestionWithAi}
 */
export interface IngestionProcessingOptions {
  /**
   * Optional host adapter responsible for semantic intent extraction.
   */
  modelAdapter?: IngestionModelAdapter
  /**
   * Optional synchronous host classifier used when no model adapter is supplied.
   */
  classifier?: IngestionClassifier
  /** Optional domain plugin handlers to override default draft mapping */
  domainHandlers?: Record<string, IngestionDomainPluginHandler>
  /** Historical transaction amounts for the detected category/vendor to check for outliers */
  historicalAmounts?: readonly {
    /**
    * Timestamp of the historical numeric observation.
    */
    timestamp: number;
    /**
    * Historical numeric amount in the same units as the extracted amount.
    */
    value: number
  }[]
  /** Recent existing entries to detect duplicates */
  existingEntries?: readonly {
    /**
    * Human-readable title supplied with the source item.
    */
    title?: string;
    /**
    * Optional amount using the units agreed by the host and adapter.
    */
    amount?: number;
    /**
    * Optional extracted transaction date.
    */
    date?: string;
    /**
    * Optional vendor identity retained in the host-provided history.
    */
    vendor?: string
  }[]
  /** Optional source document citation for bounding box pinning */
  sourceCitation?: SourceEvidenceCitation
}

/**
 * Detects anomalies such as statistical outliers and duplicate entries during ingestion.
 * @param extractedAmount - Optional extracted amount to compare with supplied history.
 * @param title - Optional extracted title used to narrow duplicate candidates.
 * @param options - Optional duplicate candidates and historical amounts for statistical analysis.
 * @returns Duplicate and outlier warnings; an empty list does not prove business correctness.
 * @example
 * ```typescript
 * import { detectIngestionAnomalies } from '@alneas/eaos-core/ai/smart-ingestion';
 * const alerts = detectIngestionAnomalies(100, 'Memo', { existingEntries: [{ title: 'Memo', amount: 100 }] });
 * ```
 */
export function detectIngestionAnomalies(
  extractedAmount?: number,
  title?: string,
  options?: IngestionProcessingOptions
): IngestionAnomalyAlert[] {
  const alerts: IngestionAnomalyAlert[] = []

  // 1. Check for duplicate transactions
  if (extractedAmount && options?.existingEntries?.length) {
    const isDuplicate = options.existingEntries.some((entry) => {
      const matchAmount = entry.amount === extractedAmount
      if (!matchAmount) return false
      if (!title || !entry.title) return true
      // Check for partial or token overlap
      const t1 = title.toLowerCase()
      const t2 = entry.title.toLowerCase()
      const hasOverlap = t1.includes(t2) || t2.includes(t1) || t1.slice(0, 4) === t2.slice(0, 4)
      return hasOverlap
    })
    if (isDuplicate) {
      alerts.push({
        type: 'duplicate_candidate',
        severity: 'critical',
        message: `⚠️ 重複登録の警告: 同額（${extractedAmount.toLocaleString()}円）かつ類似名称の伝票が直近に既に存在します。`,
      })
    }
  }

  // 2. Check for outlier monetary amounts using IQR / z-score algorithm
  if (extractedAmount && options?.historicalAmounts && options.historicalAmounts.length >= 4) {
    const points: AINumericMetricPoint[] = [
      ...options.historicalAmounts,
      { timestamp: Date.now(), value: extractedAmount },
    ]
    try {
      const results = analyzeLatestMetric({
        metric: 'transaction_amount',
        points,
        config: { minSamples: 4, algorithms: ['iqr', 'zscore'] },
      })
      const anomaly = results.find((r) => r.detected)
      if (anomaly) {
        alerts.push({
          type: 'outlier_amount',
          severity: anomaly.severity,
          message: `📊 異常値アラート: 金額 ${extractedAmount.toLocaleString()} 円は過去実績の通常範囲を逸脱しています。`,
          score: anomaly.score,
        })
      }
    } catch {
      // Ignore calculation errors on metric edge cases
    }
  }

  return alerts
}

/**
 * Process an unstructured item with a host model adapter, or use a host classifier
 * or general memo classification when no model adapter is supplied.
 * @param item - Original tenant-scoped source item to turn into a reviewable candidate.
 * @param optionsOrAdapter - Optional semantic adapter or host classification, mapping, evidence and anomaly options.
 * @returns Routing metadata, candidate values and a UI draft without persisting a business record.
 * @example
 * ```typescript
 * import { processSmartIngestionWithAi } from '@alneas/eaos-core/ai/smart-ingestion';
 * const result = await processSmartIngestionWithAi({ id: 'memo-1', tenantId: 'tenant-demo', sourceType: 'memo', title: 'Review memo', content: 'Source text', createdAt: '2026-10-24T00:00:00Z' });
 * console.log(result.uiDraft.values);
 * ```
 * @throws Host model, classifier and domain-mapping failures propagate to the caller.
 */
export async function processSmartIngestionWithAi(
  item: IngestionItem,
  optionsOrAdapter?: IngestionModelAdapter | IngestionProcessingOptions
): Promise<IngestionProcessingResult> {
  const options: IngestionProcessingOptions =
    optionsOrAdapter && 'extractIntent' in optionsOrAdapter
      ? { modelAdapter: optionsOrAdapter }
      : (optionsOrAdapter ?? {})

  const { modelAdapter } = options
  const alerts: IngestionAnomalyAlert[] = []
  const citations: Record<string, SourceEvidenceCitation> = {}

  if (options.sourceCitation) {
    citations.amount = options.sourceCitation
  }
  // 1. If LLM adapter is provided, use genuine semantic AI inference
  if (modelAdapter) {
    const aiResult = await modelAdapter.extractIntent({ item })
    let extractedValues: Record<string, unknown> = {}
    const { extractedFields } = aiResult

    // If an external domain plugin handler is registered, delegate domain-specific mapping
    const customHandler = options.domainHandlers?.[aiResult.domain]
    if (customHandler) {
      extractedValues = customHandler.mapToDraftValues(extractedFields, item)
    } else {
      // Default domain-agnostic field projection (No hardcoded account IDs or domain rules in Core)
      extractedValues = {
        title: extractedFields.title ?? item.title,
        notes: extractedFields.notes ?? item.content,
        date: extractedFields.date ?? item.createdAt.slice(0, 10),
        amount: extractedFields.amount,
        partyName: extractedFields.partyName,
      }
      if (extractedFields.lineItems) {
        extractedValues.lineItems = extractedFields.lineItems
      }
    }

    const classification: IngestionClassification = {
      domain: aiResult.domain,
      targetMode: aiResult.targetMode,
      confidence: aiResult.confidence,
      riskLevel: 2, // Draft mutation is Level 2 Human-in-the-Loop
      rationale: aiResult.summary,
    }

    const uiDraft: CoreAiDraft = {
      mode: aiResult.targetMode,
      riskLevel: 2,
      summary: aiResult.summary,
      fieldMetadata: {
        domain: { confidence: aiResult.confidence, reasoning: 'LLM文脈理解による自動分類' },
        amount: { confidence: extractedFields.amount ? 'high' : 'low', reasoning: 'LLM抽出' },
      },
      values: extractedValues,
    }

    // Check for anomalies if amount or title are present
    const detectedAlerts = detectIngestionAnomalies(
      extractedFields.amount,
      extractedFields.title ?? item.title,
      options
    )
    alerts.push(...detectedAlerts)

    return {
      itemId: item.id,
      classification,
      uiDraft,
      extractedValues,
      processedBy: 'llm_model',
      alerts: alerts.length > 0 ? alerts : undefined,
      citations: Object.keys(citations).length > 0 ? citations : undefined,
    }
  }

  // 2. Fallback to heuristic rules
  const classification = (options.classifier ?? classifyIngestionText)(item.content)
  const fields = { title: item.title, notes: item.content }
  const handler = options.domainHandlers?.[classification.domain]
  const extractedValues = handler ? handler.mapToDraftValues(fields, item) : fields

  const uiDraft: CoreAiDraft = {
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
    alerts: alerts.length > 0 ? alerts : undefined,
    citations: Object.keys(citations).length > 0 ? citations : undefined,
  }
}
