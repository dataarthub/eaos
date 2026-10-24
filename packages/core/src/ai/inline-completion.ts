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
 * Pure registry for inline completion providers.
 * Core does not hardcode business account IDs or regional tax rules;
 * business plugins register their own completion providers.
 */
const registeredInlineProviders: InlineCompletionProvider[] = []

export function registerInlineCompletionProvider(provider: InlineCompletionProvider): void {
  registeredInlineProviders.push(provider)
}

export function clearInlineCompletionProviders(): void {
  registeredInlineProviders.length = 0
}

/**
 * Resolves inline suggestions from a list of providers given an active input context.
 */
export async function getInlineCompletions(
  context: InlineCompletionContext,
  providers: InlineCompletionProvider[] = registeredInlineProviders
): Promise<InlineSuggestion[]> {
  const allSuggestions: InlineSuggestion[] = []
  for (const provider of providers) {
    const list = await provider.provideCompletions(context)
    allSuggestions.push(...list)
  }
  return allSuggestions
}
