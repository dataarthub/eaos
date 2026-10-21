import { describe, expect, it } from 'bun:test'
import { ModelRoutingGateway } from '../src/agentic/model-routing-gateway'

describe('ModelRoutingGateway (Groq, Workers AI, MLX Qwen 2.5, Zero-Retention)', () => {
  const gateway = new ModelRoutingGateway()

  it('selects groq as default tier1 model with requiresNoTraining = true', () => {
    const model = gateway.selectModel('tier1_cloud_premium', 'level1_public')
    expect(model.provider).toBe('groq')
    expect(model.requiresNoTraining).toBe(true)
    expect(model.modelName).toBe('llama-3.3-70b-versatile')
  })

  it('forces mlx_local (Qwen 2.5) for level3_strict (confidential / PII data)', () => {
    const model = gateway.selectModel('tier1_cloud_premium', 'level3_strict')
    expect(model.provider).toBe('mlx_local')
    expect(model.modelName).toBe('qwen-2.5-9b-instruct')
    expect(model.tier).toBe('tier2_edge_local')
    expect(model.requiresNoTraining).toBe(true)
  })

  it('sanitizes prompt with phone number and emails and upgrades sensitivity to level3_strict', () => {
    const raw = '山田太郎の電話番号 090-1234-5678 とメール taro@example.com は秘密です'
    const result = gateway.sanitizePrompt(raw)

    expect(result.sensitivityLevel).toBe('level3_strict')
    expect(result.recommendedTier).toBe('tier2_edge_local')
    expect(result.detectedPiiTypes).toContain('PHONE_NUMBER')
    expect(result.detectedPiiTypes).toContain('EMAIL_ADDRESS')
    expect(result.sanitizedPrompt).not.toContain('090-1234-5678')
    expect(result.sanitizedPrompt).not.toContain('taro@example.com')
  })
})
