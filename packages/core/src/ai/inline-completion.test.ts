import { describe, expect, it } from 'bun:test'
import {
  getInlineCompletions,
  type InlineCompletionContext,
  type InlineCompletionProvider,
} from './inline-completion'

describe('Inline AI Completion & Slash Commands (/split, /predict, etc.)', () => {
  it('provides tax breakdown completion when /split is triggered on a monetary row', async () => {
    const context: InlineCompletionContext = {
      fieldName: 'amount',
      currentValue: '/split',
      rowValues: {
        accountId: 'acc-purchase',
        amount: 330000,
        description: 'オフィス什器購入',
      },
    }

    const suggestions = await getInlineCompletions(context)

    expect(suggestions.length).toBeGreaterThan(0)
    const splitSuggestion = suggestions.find((s) => s.command === '/split')
    expect(splitSuggestion).toBeDefined()
    expect(splitSuggestion?.label).toContain('消費税10%')
    expect(splitSuggestion?.riskLevel).toBe(2)

    // Verify mathematical correctness (330,000 / 1.1 = 300,000 net, 30,000 tax)
    const patch = splitSuggestion!.proposedPatch
    expect(patch.amount).toBe(300000)
    expect(patch.taxAmount).toBe(30000)
    expect(patch.taxRate).toBe(0.1)
  })

  it('predicts account title from description when /predict or / is invoked', async () => {
    const context: InlineCompletionContext = {
      fieldName: 'accountId',
      currentValue: '/predict',
      rowValues: {
        amount: 15400,
        description: '出張新幹線チケット代金（東京-新大阪）',
      },
    }

    const suggestions = await getInlineCompletions(context)

    const predict = suggestions.find((s) => s.command === '/predict')
    expect(predict).toBeDefined()
    expect(predict?.label).toContain('旅費交通費')
    expect(predict?.proposedPatch.accountId).toBe('acc-travel-expenses')
  })

  it('supports custom LLM inline completion provider for arbitrary semantic autocomplete', async () => {
    const customLlmProvider: InlineCompletionProvider = {
      name: 'llm-smart-inline',
      async provideCompletions(ctx) {
        if (ctx.fieldName === 'description' && ctx.currentValue.startsWith('/summary')) {
          return [
            {
              id: 'llm-sum-1',
              command: '/summary',
              label: '会議議事録の要約を適用',
              description: 'AIが長文議事録から1行の決定事項を抽出',
              riskLevel: 2,
              confidence: 'high',
              proposedPatch: {
                description: '【決定】A棟外壁塗装工事の発注承認（総額800万円、11月着工）',
              },
            },
          ]
        }
        return []
      },
    }

    const context: InlineCompletionContext = {
      fieldName: 'description',
      currentValue: '/summary',
    }

    const suggestions = await getInlineCompletions(context, [customLlmProvider])
    expect(suggestions.length).toBe(1)
    expect(suggestions[0].label).toContain('会議議事録の要約')
    expect(suggestions[0].proposedPatch.description).toContain('外壁塗装工事')
  })
})
