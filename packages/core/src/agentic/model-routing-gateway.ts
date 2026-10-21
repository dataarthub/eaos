import type { DataSensitivityLevel, ModelRoutingConfig, ModelTier, SanitizationResult } from './types'

/**
 * Apply built-in prompt heuristics and choose from a fixed model catalog.
 * @remarks This is a heuristic helper, not comprehensive PII detection or verified provider policy. Model metadata is static; no provider is called.
 *
 * @example
 * ```typescript
 * import { ModelRoutingGateway } from "@alneas/eaos-core/agentic/model-routing-gateway";
 * const gateway = new ModelRoutingGateway();
 * const result = gateway.sanitizePrompt("Contact demo@example.com");
 * console.log(result.sanitizedPrompt);
 * ```
 */
export class ModelRoutingGateway {
  private registeredModels: ModelRoutingConfig[] = [
    {
      provider: 'groq',
      modelName: 'llama-3.3-70b-versatile',
      tier: 'tier1_cloud_premium',
      requiresNoTraining: true,
      allowedSensitivity: ['level1_public', 'level2_internal'],
    },
    {
      provider: 'cloudflare_workers_ai',
      modelName: '@cf/meta/llama-3.1-8b-instruct',
      tier: 'tier1_cloud_premium',
      requiresNoTraining: true,
      allowedSensitivity: ['level1_public', 'level2_internal'],
    },
    {
      provider: 'mlx_local',
      modelName: 'qwen-2.5-9b-instruct',
      tier: 'tier2_edge_local',
      requiresNoTraining: true,
      allowedSensitivity: ['level1_public', 'level2_internal', 'level3_strict'],
    },
    {
      provider: 'opencode',
      modelName: 'opencode-go-v1',
      tier: 'tier1_cloud_premium',
      requiresNoTraining: true,
      allowedSensitivity: ['level1_public', 'level2_internal'],
    },
    {
      provider: 'google_ai_studio',
      modelName: 'gemini-1.5-pro',
      tier: 'tier1_cloud_premium',
      requiresNoTraining: true,
      allowedSensitivity: ['level1_public', 'level2_internal'],
    },
    {
      provider: 'oci_local_2b',
      modelName: 'oci-llm-2b-custom',
      tier: 'tier2_edge_local',
      requiresNoTraining: true,
      allowedSensitivity: ['level1_public', 'level2_internal', 'level3_strict'],
    },
    {
      provider: 'ruri_embedding',
      modelName: 'ruri-large-v1',
      tier: 'tier3_embedding_rerank',
      requiresNoTraining: true,
      allowedSensitivity: ['level1_public', 'level2_internal', 'level3_strict'],
    },
  ]

  /**
   * Mask recognized phone/email patterns and classify prompt text heuristically.
   * @param prompt - Text inspected for phone/email patterns and selected Japanese confidentiality/internal markers.
   * @returns Original/sanitized text, detected types, replacement map and recommended tier.
   * @remarks Retains the original prompt and sensitive values in the result; caller must protect it. Pattern detection is incomplete and does not establish a privacy guarantee.
   * @example
   * ```typescript
   * import { ModelRoutingGateway } from "@alneas/eaos-core/agentic/model-routing-gateway";
   * const gateway = new ModelRoutingGateway();
   * console.log(gateway.sanitizePrompt("Contact demo@example.com").sensitivityLevel); // level3_strict
   * ```
   */
  sanitizePrompt(prompt: string): SanitizationResult {
    let sanitized = prompt
    const detectedPiiTypes: string[] = []
    const appliedMaskings: Record<string, string> = {}

    // 1. 電話番号パターン判定 (簡易例)
    const phoneRegex = /\b\d{2,4}-\d{2,4}-\d{4}\b/g
    const phoneMatches = sanitized.match(phoneRegex)
    if (phoneMatches && phoneMatches.length > 0) {
      detectedPiiTypes.push('PHONE_NUMBER')
      phoneMatches.forEach((match, idx) => {
        const mask = `[MASKED_PHONE_${idx + 1}]`
        appliedMaskings[match] = mask
        sanitized = sanitized.replace(match, mask)
      })
    }

    // 2. マイナンバー / クレジットカード / メールアドレス パターン判定
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g
    const emailMatches = sanitized.match(emailRegex)
    if (emailMatches && emailMatches.length > 0) {
      detectedPiiTypes.push('EMAIL_ADDRESS')
      emailMatches.forEach((match, idx) => {
        const mask = `[MASKED_EMAIL_${idx + 1}]`
        appliedMaskings[match] = mask
        sanitized = sanitized.replace(match, mask)
      })
    }

    // 3. データ感度レベル判定
    let sensitivityLevel: DataSensitivityLevel = 'level1_public'
    if (detectedPiiTypes.length > 0 || prompt.includes('秘密') || prompt.includes('個人情報') || prompt.includes('未公開財務')) {
      sensitivityLevel = 'level3_strict'
    } else if (prompt.includes('社内') || prompt.includes('プロジェクト規約')) {
      sensitivityLevel = 'level2_internal'
    }

    // 4. 推奨モデルTierの自動選定
    let recommendedTier: ModelTier = 'tier1_cloud_premium'
    if (sensitivityLevel === 'level3_strict') {
      recommendedTier = 'tier2_edge_local' // PII/機密データは OCI 自前ホスティング 2B に強制ルーティング
    }

    return {
      originalPrompt: prompt,
      sanitizedPrompt: sanitized,
      detectedPiiTypes,
      sensitivityLevel,
      appliedMaskings,
      recommendedTier,
    }
  }

  /**
   * Select a built-in model by sensitivity and requested tier.
   * @param tier - Preferred tier for nonstrict data.
   * @param sensitivityLevel - Strict data selects the first MLX local model regardless of tier; other levels filter by tier and allowedSensitivity.
   * @returns The original mutable model configuration; when no ordinary match exists the first catalog entry is returned.
   * @remarks Does not enforce live provider no-training agreements or authorization; fallback can disregard the requested tier.
   * @example
   * ```typescript
   * import { ModelRoutingGateway } from "@alneas/eaos-core/agentic/model-routing-gateway";
   * const gateway = new ModelRoutingGateway();
   * console.log(gateway.selectModel("tier2_edge_local", "level3_strict").provider);
   * ```
   */
  selectModel(tier: ModelTier, sensitivityLevel: DataSensitivityLevel): ModelRoutingConfig {
    // 感度レベル 3 (機密・厳格データ) の場合は、安全のため最優先でホスト設定済みのローカルQwen、または OCI Local 2B を割り当て
    if (sensitivityLevel === 'level3_strict') {
      const mlxLocal = this.registeredModels.find((m) => m.provider === 'mlx_local')
      if (mlxLocal) return mlxLocal
      const ociLocal = this.registeredModels.find((m) => m.provider === 'oci_local_2b')
      if (ociLocal) return ociLocal
    }

    const candidate = this.registeredModels.find(
      (m) => m.tier === tier && m.allowedSensitivity.includes(sensitivityLevel)
    )

    if (candidate) {
      return candidate
    }

    // フォールバック: デフォルトのモデル (Groq)
    return this.registeredModels[0]
  }
}

/**
 * Module-local instance of the fixed-catalog heuristic routing helper.
 * @see {@link ModelRoutingGateway}
 */
export const globalModelRoutingGateway = new ModelRoutingGateway()
