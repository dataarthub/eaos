import type { AIRiskLevel } from './governance'

/**
 * Context payload passed to inline completion providers when triggered in an input or table cell.
 */
export interface InlineCompletionContext {
  /** The field being edited, e.g. "description", "amount", "accountId" */
  fieldName: string
  /** The current text value in the field (e.g. "/split" or partial prefix) */
  currentValue: string
  /** All sibling field values in the current row/form */
  rowValues?: Record<string, unknown>
  /** Document IDs or context references attached to the record */
  attachedDocumentIds?: string[]
}

/**
 * A single inline suggestion rendered in a slash menu or autocomplete popover.
 */
export interface InlineSuggestion {
  id: string
  /** Command trigger if invoked via slash command, e.g. "/split", "/doc" */
  command?: string
  /** Label shown in the suggestion dropdown */
  label: string
  /** Detailed explanation of what this action does */
  description: string
  /** Risk level associated with this completion (Defaults to Level 2) */
  riskLevel: AIRiskLevel
  /**
   * The preview value to be displayed in the field/row before confirmation.
   * Can be a single field value or multiple field mutations (e.g., splitting into multiple lines).
   */
  proposedPatch: Record<string, unknown>
  /** Confidence rating of the AI suggestion */
  confidence: 'high' | 'medium' | 'low'
}

/**
 * Interface for pluggable inline completion providers (LLM or deterministic helpers).
 */
export interface InlineCompletionProvider {
  name: string
  provideCompletions(context: InlineCompletionContext): Promise<InlineSuggestion[]>
}

/**
 * Built-in deterministic helpers for financial and operational record entry.
 */
export const builtInInlineProviders: InlineCompletionProvider[] = [
  {
    name: 'financial-helpers',
    async provideCompletions(context: InlineCompletionContext): Promise<InlineSuggestion[]> {
      const suggestions: InlineSuggestion[] = []
      const text = context.currentValue.trim()

      // 1. Tax split command (/split)
      if (text.startsWith('/split') || text === '/') {
        const rawAmount = Number(context.rowValues?.amount) || 0
        if (rawAmount > 0) {
          // Standard Japanese consumption tax (10%) calculation: Net = Floor(Total / 1.1), Tax = Total - Net
          const net = Math.floor(rawAmount / 1.1)
          const tax = rawAmount - net
          suggestions.push({
            id: 'split-tax-10',
            command: '/split',
            label: '消費税10%の内税分解',
            description: `税込 ${rawAmount.toLocaleString()} 円 ➔ 本体 ${net.toLocaleString()} 円 + 仮払消費税 ${tax.toLocaleString()} 円`,
            riskLevel: 2,
            confidence: 'high',
            proposedPatch: {
              amount: net,
              taxAmount: tax,
              taxRate: 0.1,
              _splitLines: [
                { accountId: context.rowValues?.accountId ?? 'acc-cost', amount: net, note: '本体金額' },
                { accountId: 'acc-tax-receivable', amount: tax, note: '仮払消費税等' },
              ],
            },
          })
        }
      }

      // 2. Account prediction from description (/predict)
      if (text.startsWith('/predict') || text === '/') {
        const desc = String(context.rowValues?.description ?? '')
        if (desc.includes('交通費') || desc.includes('新幹線') || desc.includes('タクシー')) {
          suggestions.push({
            id: 'predict-travel-cost',
            command: '/predict',
            label: '旅費交通費を自動設定',
            description: '摘要のキーワードから勘定科目を推論',
            riskLevel: 2,
            confidence: 'high',
            proposedPatch: {
              accountId: 'acc-travel-expenses',
              accountName: '旅費交通費',
            },
          })
        } else if (desc.includes('接待') || desc.includes('会食') || desc.includes('飲食')) {
          suggestions.push({
            id: 'predict-entertainment-cost',
            command: '/predict',
            label: '交際費を自動設定',
            description: '摘要のキーワードから勘定科目を推論',
            riskLevel: 2,
            confidence: 'high',
            proposedPatch: {
              accountId: 'acc-entertainment-expenses',
              accountName: '交際費',
            },
          })
        }
      }

      return suggestions
    },
  },
]

/**
 * Resolves inline suggestions from a list of providers given an active input context.
 */
export async function getInlineCompletions(
  context: InlineCompletionContext,
  providers: InlineCompletionProvider[] = builtInInlineProviders
): Promise<InlineSuggestion[]> {
  const allSuggestions: InlineSuggestion[] = []
  for (const provider of providers) {
    const list = await provider.provideCompletions(context)
    allSuggestions.push(...list)
  }
  return allSuggestions
}
