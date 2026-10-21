/**
 * Provider keys tracked by the local AI circuit breaker.
 * @see {@link AiCircuitBreaker}
 */
export type AiProvider = 'openai' | 'gemini' | 'claude' | 'workers-ai' | 'ollama'

/**
 * Mutable provider failure count, circuit state and optional latest failure time.
 * @see {@link AiCircuitBreaker}
 */
export interface ProviderHealth {
  
  /** Provider identity from model metadata, travel discovery or connection/circuit health. */
  provider: AiProvider
  
/** Number of failures recorded since the latest success. */
  failures: number
  
  /** CLOSED permits selection, OPEN waits for cooldown and HALF_OPEN permits a retry without concurrency limiting. */
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN'
  
/** Optional latest failure time in Unix epoch milliseconds. */
  lastFailureTime?: number
}

/**
 * Track local provider failures and select a preferred available provider.
 * @remarks Three recorded failures open a provider; a selection more than 30000 ms after its latest failure marks it HALF_OPEN. It does not schedule probes, execute requests, constrain concurrent half-open requests or coordinate across processes. When all providers remain open it still returns the first priority provider; an empty priority list yields undefined at runtime despite the declared return type.
 *
 * @example
 * ```typescript
 * import { AiCircuitBreaker } from "@alneas/eaos-core/agent/circuit-breaker";
 * const breaker = new AiCircuitBreaker(["openai", "gemini"]);
 * breaker.recordFailure("openai");
 * console.log(breaker.getHealthyProvider());
 * ```
 */
export class AiCircuitBreaker {
  private providers = new Map<AiProvider, ProviderHealth>()
  private failureThreshold = 3
  private resetTimeoutMs = 30000 // 30s fallback cooldown

  /**
   * Initialize provider health in caller-specified priority order.
   * @param fallbackPriority - Priority list stored by reference; defaults to gemini, openai, claude, workers-ai, ollama. Supply a nonempty list.
   *
   * @example
   * ```typescript
   * import { AiCircuitBreaker } from "@alneas/eaos-core/agent/circuit-breaker";
   * const breaker = new AiCircuitBreaker(["openai", "gemini"]);
   * console.log(breaker.getHealthyProvider());
   * ```
   */
  constructor(private fallbackPriority: AiProvider[] = ['gemini', 'openai', 'claude', 'workers-ai', 'ollama']) {
    this.fallbackPriority.forEach((p) => {
      this.providers.set(p, { provider: p, failures: 0, state: 'CLOSED' })
    })
  }

  /**
   * Reset a registered provider failure count and close its circuit.
   * @param provider - Provider identifier registered by the constructor.
   * @returns No value; unregistered providers are ignored.
   * @example
   * ```typescript
   * import { AiCircuitBreaker } from "@alneas/eaos-core/agent/circuit-breaker";
   * const breaker = new AiCircuitBreaker(["openai"]);
   * breaker.recordSuccess("openai");
   * ```
   */
  recordSuccess(provider: AiProvider): void {
    const health = this.providers.get(provider)
    if (health) {
      health.failures = 0
      health.state = 'CLOSED'
    }
  }

  /**
   * Increment failures and record the time, opening the circuit at three failures.
   * @param provider - Provider identifier registered by the constructor.
   * @returns No value; unregistered providers are ignored.
   * @example
   * ```typescript
   * import { AiCircuitBreaker } from "@alneas/eaos-core/agent/circuit-breaker";
   * const breaker = new AiCircuitBreaker(["openai"]);
   * breaker.recordFailure("openai");
   * ```
   */
  recordFailure(provider: AiProvider): void {
    const health = this.providers.get(provider)
    if (health) {
      health.failures += 1
      health.lastFailureTime = Date.now()

      if (health.failures >= this.failureThreshold) {
        health.state = 'OPEN'
      }
    }
  }

  /**
   * Select the first closed/half-open provider, or one whose open cooldown elapsed.
   * @returns Preferred provider; first priority is used even when all are degraded.
   * @remarks Selection may transition one open circuit to HALF_OPEN; caller records subsequent success/failure.
   * @example
   * ```typescript
   * import { AiCircuitBreaker } from "@alneas/eaos-core/agent/circuit-breaker";
   * const breaker = new AiCircuitBreaker(["openai"]);
   * console.log(breaker.getHealthyProvider());
   * ```
   */
  getHealthyProvider(): AiProvider {
    const now = Date.now()

    for (const provider of this.fallbackPriority) {
      const health = this.providers.get(provider)
      if (!health) continue

      if (health.state === 'OPEN' && health.lastFailureTime && now - health.lastFailureTime > this.resetTimeoutMs) {
        health.state = 'HALF_OPEN'
        return provider
      }

      if (health.state === 'CLOSED' || health.state === 'HALF_OPEN') {
        return provider
      }
    }

    // Fallback to first priority provider if all are degraded
    return this.fallbackPriority[0]
  }

  /**
   * Expose current tracked provider health records.
   * @returns A new array containing the original mutable health objects.
   * @remarks Mutating a returned health object changes breaker state.
   * @example
   * ```typescript
   * import { AiCircuitBreaker } from "@alneas/eaos-core/agent/circuit-breaker";
   * const breaker = new AiCircuitBreaker(["openai"]);
   * console.log(breaker.getHealthStatus());
   * ```
   */
  getHealthStatus(): ProviderHealth[] {
    return Array.from(this.providers.values())
  }
}

/**
 * Module-local circuit breaker using the built-in provider priority order.
 * @see {@link AiCircuitBreaker}
 */
export const globalAiCircuitBreaker = new AiCircuitBreaker()
