/**
 * Operational categories attached to classified errors.
 * @see {@link calculateRetryDelay}
 */
export type AIErrorCategory = 'validation' | 'infrastructure' | 'external_api' | 'llm' | 'policy' | 'business'
/**
 * Severity labels used by host error handling and observability.
 * @see {@link calculateRetryDelay}
 */
export type AIErrorSeverity = 'fatal' | 'error' | 'warning' | 'info'

/**
 * Ordered regex rule defining category, retryability and user guidance.
 * @see {@link calculateRetryDelay}
 */
export interface AIErrorClassificationRule {
  
  /**
   * Case-insensitive regular expression matched against error message and stack; invalid syntax throws during classification.
   */
  pattern: string
  
  
  /** Machine-readable classification code copied to results when this rule first matches. */
  code: string
  
  
  /** Operational error category assigned when this regex rule matches. */
  category: AIErrorCategory
  
  /** Handling/alert severity attached to the classified error or detector result. */
  severity: AIErrorSeverity
  
/** Whether the recorded failure permits a host retry; callers must still account for possible completed effects. */
  retryable: boolean
  
  /** Human-readable remediation guidance associated with an error classification rule/result. */
  hint: string
}

/**
 * Normalized error message and handling metadata returned without side effects.
 * @see {@link calculateRetryDelay}
 */
export interface AIErrorClassification {
  
  /** Human-readable provider/failure explanation; do not include secrets in surfaced diagnostics. */
  message: string
  
  
  /** Matched host error code, or ERR_UNKNOWN when no rule matches. */
  code: string
  
  
  /** Matched operational category, business for the unknown-error fallback. */
  category: AIErrorCategory
  
  /** Handling/alert severity attached to the classified error or detector result. */
  severity: AIErrorSeverity
  
/** Whether the recorded failure permits a host retry; callers must still account for possible completed effects. */
  retryable: boolean
  
  /** Human-readable remediation guidance associated with an error classification rule/result. */
  hint: string
  
  /** Verified host execution scope propagated to adapters/guards/hooks; callers must establish identity and authorization before use. */
  context?: Readonly<Record<string, unknown>>
}

/**
 * Host retry limit and exponential delay/jitter parameters.
 * @see {@link calculateRetryDelay}
 */
export interface AIRetryPolicy {
  
/** Maximum intended attempt count; delay calculators validate it but do not themselves stop retries. */
  maxAttempts: number
  
/** Initial retry delay in milliseconds before exponential scaling. */
  baseDelayMs: number
  
/** Upper bound for a calculated retry delay in milliseconds. */
  maxDelayMs: number
  
/** Exponential growth factor for successive retry delays, at least one for validated policies. */
  backoffMultiplier: number
  
/** Fraction from zero to one scaling the injected random retry jitter. */
  jitterFactor: number
}

/**
 * Classify an error using host/plugin-provided rules without logging or side effects.
 * The first matching rule wins, so callers should order rules from specific to broad.
 * @param input - Error, ordered regular-expression rules and optional context. First matching message or stack wins; context is retained by reference.
 * @returns Classification, falling back to ERR_UNKNOWN/business/error/nonretryable when no rule matches.
 * @throws SyntaxError when an evaluated rule contains an invalid regular expression.
 * @remarks Does not log, retry or mutate host state.
 * @example
 * ```typescript
 * import { classifyAIError } from "@alneas/eaos-core/ai/resilience";
 * const result = classifyAIError({ error: new Error("timeout"), rules: [] });
 * console.log(result.code); // ERR_UNKNOWN
 * ```
 */
export function classifyAIError(input: {
  
  /**
   * Error, text or message-bearing object to classify; unsupported shapes use the message Unknown error. Error stack text also participates in matching.
   */
  error: unknown
  
  /**
   * Ordered case-insensitive regular-expression rules; first matching message/stack wins and invalid evaluated regex syntax throws.
   */
  rules: readonly AIErrorClassificationRule[]
  
  /**
   * Optional readonly host metadata retained by reference in the classification; this helper neither logs nor redacts its contents.
   */
  context?: Readonly<Record<string, unknown>>
}): AIErrorClassification {
  const message = errorMessage(input.error)
  const stack = input.error instanceof Error ? input.error.stack ?? '' : ''
  for (const rule of input.rules) {
    if (new RegExp(rule.pattern, 'i').test(message) || new RegExp(rule.pattern, 'i').test(stack)) {
      return { message, code: rule.code, category: rule.category, severity: rule.severity, retryable: rule.retryable, hint: rule.hint, ...(input.context ? { context: input.context } : {}) }
    }
  }
  return {
    message,
    code: 'ERR_UNKNOWN',
    category: 'business',
    severity: 'error',
    retryable: false,
    hint: 'Unknown error. Check logs, escalate if persistent.',
    ...(input.context ? { context: input.context } : {}),
  }
}

/**
 * Calculate one retry delay. Randomness is injected by the host so this helper stays pure and testable.
 * @param input - One-based attempt, retry policy and random factor in [0, 1] (defaults to 0). Delay fields use milliseconds; multiplier must be at least 1 and jitter factor in [0, 1].
 * @returns Delay in milliseconds, capped at maxDelayMs. maxAttempts is validated but does not stop an attempt exceeding it.
 * @throws Error for invalid attempt, policy or random factor.
 * @remarks Does not sleep or execute retries; the caller owns retry count, cancellation and idempotency.
 * @example
 * ```typescript
 * import { calculateRetryDelay } from "@alneas/eaos-core/ai/resilience";
 * const delay = calculateRetryDelay({ attempt: 2, policy: { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000, backoffMultiplier: 2, jitterFactor: 0 } });
 * console.log(delay); // 200
 * ```
 */
export function calculateRetryDelay(input: { 
  /**
   * Positive safe-integer one-based attempt used for exponentiation; the helper does not reject attempts exceeding policy.maxAttempts.
   */
  attempt: number; 
  /**
   * Validated retry parameters; millisecond delays must be finite/nonnegative, multiplier at least one, jitter in [0,1] and maxAttempts a positive safe integer.
   */
  policy: AIRetryPolicy; 
  /**
   * Optional finite injected random factor from zero to one; defaults to zero, producing no added jitter. The helper does not draw randomness.
   */
  random?: number }): number {
  const { attempt, policy, random = 0 } = input
  if (!Number.isSafeInteger(attempt) || attempt < 1) throw new Error('Retry attempt must be a positive integer')
  if (!Number.isSafeInteger(policy.maxAttempts) || policy.maxAttempts < 1 || !Number.isFinite(policy.baseDelayMs) || policy.baseDelayMs < 0 || !Number.isFinite(policy.maxDelayMs) || policy.maxDelayMs < 0 || !Number.isFinite(policy.backoffMultiplier) || policy.backoffMultiplier < 1 || !Number.isFinite(policy.jitterFactor) || policy.jitterFactor < 0 || policy.jitterFactor > 1) throw new Error('Invalid retry policy')
  if (!Number.isFinite(random) || random < 0 || random > 1) throw new Error('Retry random factor must be between 0 and 1')
  const exponential = policy.baseDelayMs * Math.pow(policy.backoffMultiplier, attempt - 1)
  const jitter = exponential * policy.jitterFactor * random
  return Math.min(exponential + jitter, policy.maxDelayMs)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message
  return 'Unknown error'
}
