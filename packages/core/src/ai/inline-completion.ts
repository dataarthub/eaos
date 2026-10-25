import type { AIRiskLevel } from './governance'

/**
 * Context payload passed to inline completion providers when triggered in an input or table cell.
 * @see {@link getInlineCompletions}
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
 * @see {@link getInlineCompletions}
 */
export interface InlineSuggestion {
  /**
   * Provider-assigned identity for the suggestion.
   */
  id: string
  /** Command trigger if invoked via slash command, e.g. "/split", "/doc" */
  command?: string
  /** Label shown in the suggestion dropdown */
  label: string
  /** Detailed explanation of what this action does */
  description: string
  /** Risk level supplied by the completion provider; Core does not assign a default */
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
 * @see {@link getInlineCompletions}
 */
export interface InlineCompletionProvider {
  /**
   * Provider identity used by host registration and diagnostics.
   */
  name: string
  /**
   * Produce reviewable suggestions for the active input context.
   * @param context - Field value, sibling values and optional source references supplied by the host.
   * @returns Provider suggestions, possibly empty; proposals do not apply mutations.
   * @example
   * ```typescript
   * import type { InlineCompletionProvider } from '@alneas/eaos-core/ai/inline-completion';
   * export async function suggest(provider: InlineCompletionProvider) {
   *   return provider.provideCompletions({ fieldName: 'notes', currentValue: '/summary' });
   * }
   * ```
   * @throws Provider failures reject the Promise.
   */
  provideCompletions(context: InlineCompletionContext): Promise<InlineSuggestion[]>
}

/**
 * Pure registry for inline completion providers.
 * Core does not hardcode business account IDs or regional tax rules;
 * business plugins register their own completion providers.
 */
const registeredInlineProviders: InlineCompletionProvider[] = []

/**
 * Append a host provider to the module-local completion registry.
 * @param provider - Completion provider to invoke after previously registered providers.
 * @returns No value; subsequent registry-based requests include the provider.
 * @example
 * ```typescript
 * import { registerInlineCompletionProvider } from '@alneas/eaos-core/ai/inline-completion';
 * registerInlineCompletionProvider({ name: 'empty-provider', async provideCompletions() { return []; } });
 * ```
 */
export function registerInlineCompletionProvider(provider: InlineCompletionProvider): void {
  registeredInlineProviders.push(provider)
}

/**
 * Remove every provider from the module-local completion registry.
 * @returns No value; subsequent registry-based requests return no suggestions until registration.
 * @example
 * ```typescript
 * import { clearInlineCompletionProviders } from '@alneas/eaos-core/ai/inline-completion';
 * clearInlineCompletionProviders();
 * ```
 */
export function clearInlineCompletionProviders(): void {
  registeredInlineProviders.length = 0
}

/**
 * Resolves inline suggestions from a list of providers given an active input context.
 * @param context - Active field value and optional sibling/source context to forward to each provider.
 * @param providers - Ordered provider list; omission uses the module-local registry.
 * @returns All provider suggestions concatenated in provider order.
 * @example
 * ```typescript
 * import { getInlineCompletions } from '@alneas/eaos-core/ai/inline-completion';
 * const suggestions = await getInlineCompletions({ fieldName: 'notes', currentValue: '/summary' }, []);
 * ```
 * @throws Provider failures reject the Promise and stop aggregation.
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
