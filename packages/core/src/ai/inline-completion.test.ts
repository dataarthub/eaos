import { afterEach, describe, expect, it } from 'bun:test'
import {
  getInlineCompletions, registerInlineCompletionProvider, clearInlineCompletionProviders,
  type InlineCompletionProvider, type InlineSuggestion,
} from './inline-completion'

const context = { fieldName: 'notes', currentValue: '/summary', rowValues: { title: 'Memo' } }
const suggestion: InlineSuggestion = {
  id: 'summary-1', command: '/summary', label: 'Summarize', description: 'Review a summary',
  riskLevel: 2, confidence: 'medium', proposedPatch: { notes: 'Summary for review' },
}
const provider: InlineCompletionProvider = { name: 'host-provider', async provideCompletions() { return [suggestion] } }

afterEach(clearInlineCompletionProviders)
describe('Inline completion provider orchestration', () => {
  it('returns no suggestions until a provider is supplied', async () => {
    clearInlineCompletionProviders()
    expect(await getInlineCompletions(context)).toEqual([])
  })
  it('aggregates provider results in registration order and forwards context', async () => {
    const received: unknown[] = []
    registerInlineCompletionProvider({ name: 'first', async provideCompletions(input) {
      received.push(input)
      return [suggestion]
    } })
    registerInlineCompletionProvider({ name: 'second', async provideCompletions(input) {
      received.push(input)
      return [{ ...suggestion, id: 'summary-2' }]
    } })
    expect((await getInlineCompletions(context)).map(value => value.id)).toEqual(['summary-1', 'summary-2'])
    expect(received).toEqual([context, context])
  })
  it('uses an explicit provider list without changing the registry', async () => {
    registerInlineCompletionProvider(provider)
    expect(await getInlineCompletions(context, [])).toEqual([])
    expect(await getInlineCompletions(context)).toEqual([suggestion])
    clearInlineCompletionProviders()
    expect(await getInlineCompletions(context)).toEqual([])
  })
  it('surfaces provider failures to the caller', async () => {
    await expect(getInlineCompletions(context, [{ name: 'unavailable', async provideCompletions() {
      throw new Error('Provider unavailable')
    } }])).rejects.toThrow('Provider unavailable')
  })
})
