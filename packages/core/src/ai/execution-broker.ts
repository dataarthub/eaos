import type { AIExecutionContext, AIDataSensitivityLevel } from './governance'
import type { AIModelCapability } from './model-registry'

/**
 * Execution locations considered by the host-controlled route broker.
 * @see {@link createAIExecutionBroker}
 */
export type AIExecutionTarget = 'local-subscription-cli' | 'local-mlx' | 'arm-agent' | 'external-no-training'
/**
 * Interactive request or durable-workflow placement mode.
 * @see {@link createAIExecutionBroker}
 */
export type AIExecutionMode = 'durable-workflow' | 'interactive'
/**
 * Relative quality preference used in broker scoring.
 * @see {@link createAIExecutionBroker}
 */
export type AIExecutionQuality = 'economy' | 'standard' | 'premium'
/**
 * Latency preference used when ranking compatible candidates.
 * @see {@link createAIExecutionBroker}
 */
export type AIExecutionLatency = 'interactive' | 'normal' | 'batch'
/**
 * Host-reported route availability; offline candidates are excluded.
 * @see {@link createAIExecutionBroker}
 */
export type AIExecutionAvailability = 'available' | 'degraded' | 'offline'

/**
 * Host capacity snapshot used as a scoring/filtering input.
 * @see {@link createAIExecutionBroker}
 */
export interface AIExecutionCapacity {
  
  /** Host availability snapshot; offline routes are excluded and degraded routes receive a score penalty. */
  state: AIExecutionAvailability
  
/** Optional nonnegative safe-integer number of queued requests in the capacity snapshot. */
  queueDepth?: number
  
/** Optional host guidance for when capacity/budget may be retried, in milliseconds. */
  retryAfterMs?: number
  
/** Timestamp associated with the reported evaluation or measurement. */
  checkedAt?: string
}

/**
 * A host-advertised execution route. It contains no endpoint, credential or
 * provider SDK. A route can represent a user's local subscription CLI, a
 * local MLX process, the ARM worker pool, or an approved external model.
 * @see {@link createAIExecutionBroker}
 */
export interface AIExecutionCandidate {
  
/** Unique host route identity used as the deterministic final tie-breaker. */
  routeId: string
  
  /** Approved resource identity or execution placement; this metadata does not independently enforce access. */
  target: AIExecutionTarget
  
/** Host adapter identity that binds routing/receipts to the implementation actually used. */
  adapterId: string
  
/** Advertised operation/capability names; presence alone does not authorize execution. */
  capabilities: readonly AIModelCapability[]
  
/** Data classifications the host advertises as permitted on this model/route. */
  allowedSensitivity: readonly AIDataSensitivityLevel[]
  
/** Declared no-training policy requirement; the host must verify and enforce the provider agreement. */
  requiresNoTraining: boolean
  
  /** Relative route quality used for scoring; request quality is a preference rather than a hard minimum. */
  quality: AIExecutionQuality
  
/** Execution modes the host advertises as supported by this route. */
  supportedModes: readonly AIExecutionMode[]
  
/** Optional host availability/queue snapshot; omitted capacity is treated as available in filtering. */
  capacity?: AIExecutionCapacity
  /** A subscription CLI is user-bound and must be explicitly allowed. */
  userBound?: boolean
  /** Host policy tie-breaker; larger values win after hard constraints. */
  priority?: number
}

/**
 * Verified operation context and hard/soft placement constraints.
 * @see {@link createAIExecutionBroker}
 */
export interface AIExecutionRequest {
  
  /** Verified host execution scope propagated to adapters/guards/hooks; callers must establish identity and authorization before use. */
  context: Pick<AIExecutionContext, 'tenantId' | 'userId' | 'operation'>
  
  /** Required model capability used as a hard route filter. */
  capability: AIModelCapability
  
/** Classification used by the host to constrain eligible execution routes. */
  sensitivityLevel: AIDataSensitivityLevel
  
  /** Selected operation/storage/execution variant; the owning discriminated union determines applicable fields. */
  mode: AIExecutionMode
  
  /** Relative route quality used for scoring; request quality is a preference rather than a hard minimum. */
  quality: AIExecutionQuality
  
/** Requested latency preference used for scoring, rather than a hard deadline. */
  latency: AIExecutionLatency
  
/** Declared no-training policy requirement; the host must verify and enforce the provider agreement. */
  requiresNoTraining: boolean
  
/** Optional target ranking order; unlisted targets remain eligible unless allowedTargets excludes them. */
  preferredTargets?: readonly AIExecutionTarget[]
  
/** Optional hard target allowlist; an empty list permits no targets. */
  allowedTargets?: readonly AIExecutionTarget[]
  /** Required for unattended workflows that intentionally use a user runner. */
  allowUserBoundRunner?: boolean
}

/**
 * Selected route, ranked compatible fallbacks and the policy version/reason.
 * @see {@link createAIExecutionBroker}
 */
export interface AIExecutionDecision {
  
/** Highest-ranked compatible execution candidate. */
  route: AIExecutionCandidate
  
/** Remaining compatible candidates in deterministic ranking order; no fallback execution happens automatically. */
  fallbacks: readonly AIExecutionCandidate[]
  
/** Host-supplied policy identity included with decisions; default ai-execution-policy-v1. */
  policyVersion: string
  
/** Human-readable explanation of the decision or requested action. */
  reason: string
}

/**
 * Signal that no advertised execution route satisfies broker constraints.
 *
 * @example
 * ```typescript
 * import { AIExecutionRouteUnavailableError } from "@alneas/eaos-core/ai/execution-broker";
 * const error = new AIExecutionRouteUnavailableError();
 * console.log(error.code); // AI_ROUTE_UNAVAILABLE
 * ```
 */
export class AIExecutionRouteUnavailableError extends Error {
  
  /**
   * Stable machine-readable code AI_ROUTE_UNAVAILABLE.
   */
  readonly code = 'AI_ROUTE_UNAVAILABLE' as const

  /**
   * Create the no-compatible-route error.
   * @param message - Human-readable reason; defaults to No AI execution route satisfies the request.
   *
   * @example
   * ```typescript
   * import { AIExecutionRouteUnavailableError } from "@alneas/eaos-core/ai/execution-broker";
   * const error = new AIExecutionRouteUnavailableError();
   * console.log(error.message);
   * ```
   */
  constructor(message = 'No AI execution route satisfies the request') {
    super(message)
    this.name = 'AIExecutionRouteUnavailableError'
  }
}

const QUALITY_RANK: Record<AIExecutionQuality, number> = { economy: 1, standard: 2, premium: 3 }
const TARGET_ORDER: Record<AIExecutionMode, readonly AIExecutionTarget[]> = {
  interactive: ['local-subscription-cli', 'local-mlx', 'external-no-training', 'arm-agent'],
  'durable-workflow': ['arm-agent', 'local-mlx', 'external-no-training', 'local-subscription-cli'],
}

function validText(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) throw new Error(`Invalid ${name}`)
  return value
}

function validateCandidate(candidate: AIExecutionCandidate): AIExecutionCandidate {
  validText(candidate.routeId, 'routeId')
  validText(candidate.adapterId, 'adapterId')
  if (!Array.isArray(candidate.capabilities) || candidate.capabilities.length === 0) throw new Error('Invalid AI execution capabilities')
  if (!Array.isArray(candidate.allowedSensitivity) || candidate.allowedSensitivity.length === 0) throw new Error('Invalid AI execution sensitivity policy')
  if (!Array.isArray(candidate.supportedModes) || candidate.supportedModes.length === 0) throw new Error('Invalid AI execution modes')
  if (!Number.isSafeInteger(candidate.priority ?? 0)) throw new Error('Invalid AI execution priority')
  if (candidate.capacity?.queueDepth !== undefined && (!Number.isSafeInteger(candidate.capacity.queueDepth) || candidate.capacity.queueDepth < 0)) throw new Error('Invalid AI execution queue depth')
  return {
    ...candidate,
    capabilities: [...candidate.capabilities],
    allowedSensitivity: [...candidate.allowedSensitivity],
    supportedModes: [...candidate.supportedModes],
    ...(candidate.capacity ? { capacity: { ...candidate.capacity } } : {}),
  }
}

function cloneCandidate(candidate: AIExecutionCandidate): AIExecutionCandidate {
  return validateCandidate(candidate)
}

function targetRank(request: AIExecutionRequest, candidate: AIExecutionCandidate): number {
  const order = request.preferredTargets ?? (request.sensitivityLevel === 'level3_strict'
    ? ['local-mlx', 'arm-agent', 'external-no-training', 'local-subscription-cli']
    : TARGET_ORDER[request.mode])
  const index = order.indexOf(candidate.target)
  return index < 0 ? 0 : (order.length - index) * 100
}

function score(request: AIExecutionRequest, candidate: AIExecutionCandidate): number {
  const capacity = candidate.capacity?.state === 'degraded' ? -80 : 0
  const queuePenalty = Math.min(candidate.capacity?.queueDepth ?? 0, 100) * -2
  const quality = QUALITY_RANK[candidate.quality] >= QUALITY_RANK[request.quality] ? 60 : -500
  const latency = request.latency === 'interactive' && (candidate.target === 'local-subscription-cli' || candidate.target === 'local-mlx') ? 30 : 0
  const strictLocal = request.sensitivityLevel === 'level3_strict' && (candidate.target === 'local-mlx' || candidate.target === 'arm-agent') ? 40 : 0
  return targetRank(request, candidate) + quality + latency + strictLocal + (candidate.priority ?? 0) + capacity + queuePenalty
}

/**
 * Deterministic route selection for server-controlled AI execution.
 *
 * The broker decides where work may run; it never owns credentials or starts
 * a provider process. Availability and quota facts are supplied by the host.
 * @param options - One to 100 unique routes and optional policyVersion, default ai-execution-policy-v1. Routes are copied; capacities are snapshots.
 * @returns A broker with copied route listings and decide(request); decide returns the highest-ranked compatible route and remaining ranked fallbacks.
 * @throws Error for invalid/duplicate route data or malformed request context; decide throws AIExecutionRouteUnavailableError when no compatible candidate remains.
 * @remarks No process/provider calls, retries or reservations occur. Quality/latency/preferredTargets affect score; they are not hard constraints. Offline, capability, sensitivity, mode, no-training, allowedTargets and userBound checks filter routes. Host authorization and fresh capacity remain caller responsibilities.
 * @example
 * ```typescript
 * import { createAIExecutionBroker } from "@alneas/eaos-core/ai/execution-broker";
 * const broker = createAIExecutionBroker({ routes: [{ routeId: "local", target: "local-mlx", adapterId: "mlx", capabilities: ["chat"], allowedSensitivity: ["level1_public"], requiresNoTraining: true, quality: "standard", supportedModes: ["interactive"] }] });
 * console.log(broker.decide({ context: { tenantId: "tenant-demo", userId: "user-demo", operation: "preview" }, capability: "chat", sensitivityLevel: "level1_public", mode: "interactive", quality: "standard", latency: "interactive", requiresNoTraining: true }).route.routeId);
 * ```
 */
export function createAIExecutionBroker(options: { 
  /**
   * One to 100 unique host-advertised execution candidates; capability/sensitivity/mode lists and optional capacity metadata are copied for local selection.
   */
  routes: readonly AIExecutionCandidate[]; 
  /**
   * Optional host policy label included in decisions; omission uses ai-execution-policy-v1.
   */
  policyVersion?: string }): {
  
  /**
   * List copied metadata for the configured execution routes without querying or starting providers.
   * @returns A new array of copied route candidates, including independent capability/sensitivity/mode arrays and capacity objects.
   * @remarks Route availability remains the host snapshot captured when the broker was created; this method performs no live capacity refresh or authorization.
   * @example
   * ```typescript
   * import { createAIExecutionBroker } from "@alneas/eaos-core/ai/execution-broker";
   * export function inspectHostRoutes(broker: ReturnType<typeof createAIExecutionBroker>) {
   *   return broker.listRoutes().map(route => ({ routeId: route.routeId, target: route.target }));
   * }
   * ```
   */
  listRoutes(): readonly AIExecutionCandidate[]
  
  /**
   * Choose the highest-ranked compatible execution candidate and its ranked fallbacks.
   * @param request - Verified operation context and capability/sensitivity/mode/no-training/target constraints; quality, latency and preferredTargets affect scoring rather than hard eligibility.
   * @returns Selected route, remaining compatible fallbacks, policy version and explanation, using copied route metadata.
   * @throws Error for malformed request scope/required fields; AIExecutionRouteUnavailableError when no route remains compatible.
   * @remarks Does not execute providers, reserve capacity, authorize the principal or automatically retry fallbacks; hosts supply current policy/capacity and enforce any side-effect boundaries.
   * @example
   * ```typescript
   * import { createAIExecutionBroker, type AIExecutionRequest } from "@alneas/eaos-core/ai/execution-broker";
   * export function selectHostRoute(
   *   broker: ReturnType<typeof createAIExecutionBroker>, verifiedRequest: AIExecutionRequest,
   * ) {
   *   const decision = broker.decide(verifiedRequest);
   *   return { selected: decision.route.routeId, fallbacks: decision.fallbacks.map(route => route.routeId) };
   * }
   * ```
   */
  decide(request: AIExecutionRequest): AIExecutionDecision
} {
  if (!options || !Array.isArray(options.routes) || options.routes.length === 0 || options.routes.length > 100) throw new Error('At least one AI execution route is required')
  const routes = options.routes.map(validateCandidate)
  if (new Set(routes.map(route => route.routeId)).size !== routes.length) throw new Error('Duplicate AI execution route')
  const policyVersion = options.policyVersion ?? 'ai-execution-policy-v1'

  return {
    listRoutes: () => routes.map(cloneCandidate),
    decide(request) {
      if (!request?.context || !validText(request.context.tenantId, 'tenantId') || !validText(request.context.userId, 'userId') || !validText(request.context.operation, 'operation')) throw new Error('Invalid AI execution context')
      if (!request.capability || !request.sensitivityLevel || !request.mode || !request.quality || !request.latency) throw new Error('Invalid AI execution request')
      const allowedTargets = request.allowedTargets ? new Set(request.allowedTargets) : undefined
      const candidates = routes
        .filter(route => route.capacity?.state !== 'offline')
        .filter(route => route.capabilities.includes(request.capability))
        .filter(route => route.allowedSensitivity.includes(request.sensitivityLevel))
        .filter(route => route.supportedModes.includes(request.mode))
        .filter(route => !request.requiresNoTraining || route.requiresNoTraining)
        .filter(route => !allowedTargets || allowedTargets.has(route.target))
        .filter(route => request.allowUserBoundRunner === true || route.userBound !== true)
        .sort((left, right) => score(request, right) - score(request, left) || left.routeId.localeCompare(right.routeId))
      if (candidates.length === 0) throw new AIExecutionRouteUnavailableError()
      const [route, ...fallbacks] = candidates
      return {
        route: cloneCandidate(route),
        fallbacks: fallbacks.map(cloneCandidate),
        policyVersion,
        reason: `${route.target} selected for ${request.mode}/${request.quality}/${request.sensitivityLevel}`,
      }
    },
  }
}
